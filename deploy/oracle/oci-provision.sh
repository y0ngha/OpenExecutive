#!/usr/bin/env bash
# Create the Oracle Cloud side of the deployment with the OCI CLI: network,
# reserved public IP and an Always Free Ampere A1 VM, retrying while the
# region is out of A1 capacity. Safe to run again: everything is looked up
# by name first and reused.
#
#   brew install oci-cli
#   oci session authenticate --region <region> --profile-name oe
#   bash deploy/oracle/oci-provision.sh --check   # read-only: what exists
#   bash deploy/oracle/oci-provision.sh           # create what's missing
#
# Settings (environment): OCI_PROFILE (oe), NAME (openexecutive, the VM),
# PREFIX (oe: <prefix>-vcn, -igw, -public, -ip),
# OCPUS (2), MEMORY_GB (12), BOOT_GB (100), SSH_PUBKEY (~/.ssh/oe_oracle.pub,
# created when missing). The defaults stay inside Always Free (A1: 2 OCPU /
# 12 GB in total per tenancy, 200 GB of block storage).
set -euo pipefail

export OCI_CLI_PROFILE=${OCI_PROFILE:-oe}
export OCI_CLI_AUTH=security_token
export SUPPRESS_LABEL_WARNING=True PYTHONWARNINGS=ignore
NAME=${NAME:-openexecutive}
PREFIX=${PREFIX:-oe}
OCPUS=${OCPUS:-2}
MEMORY_GB=${MEMORY_GB:-12}
BOOT_GB=${BOOT_GB:-100}
SSH_PUBKEY=${SSH_PUBKEY:-$HOME/.ssh/oe_oracle.pub}
CHECK=false
[[ "${1:-}" == --check ]] && CHECK=true

q() { oci "$@" </dev/null 2>/dev/null; }

T=$(sed -n "/^\[$OCI_CLI_PROFILE\]/,/^\[/s/^tenancy=//p" ~/.oci/config | head -1)
[[ -n "$T" ]] || { echo "No tenancy for profile $OCI_CLI_PROFILE; run oci session authenticate first." >&2; exit 1; }
q session refresh --profile "$OCI_CLI_PROFILE" >/dev/null || true
AD=$(q iam availability-domain list -c "$T" --query 'data[0].name' --raw-output)
[[ -n "$AD" ]] || { echo "Session expired or no access; run oci session authenticate again." >&2; exit 1; }
echo "tenancy ok, availability domain: $AD"

find_id() {  # find_id <oci list args...> — first non-terminated match's id
  q "$@" --query 'data[?"lifecycle-state"!=`TERMINATED`] | [0].id' --raw-output | grep -v '^$' || true
}

VCN=$(find_id network vcn list -c "$T" --display-name "$PREFIX-vcn")
IPID=$(q network public-ip list -c "$T" --scope REGION --lifetime RESERVED \
  --query "data[?\"display-name\"=='$PREFIX-ip'] | [0].id" --raw-output | grep -v '^$' || true)
INST=$(find_id compute instance list -c "$T" --display-name "$NAME")

if $CHECK; then
  echo "vcn:         ${VCN:+exists}${VCN:-missing}"
  echo "reserved ip: ${IPID:+exists}${IPID:-missing}"
  echo "instance:    ${INST:+exists}${INST:-missing}"
  exit 0
fi

if [[ -z "$VCN" ]]; then
  echo "==> Network"
  VCN=$(q network vcn create -c "$T" --display-name "$PREFIX-vcn" --cidr-blocks '["10.0.0.0/16"]' \
    --dns-label oevcn --wait-for-state AVAILABLE --query data.id --raw-output)
fi
IGW=$(find_id network internet-gateway list -c "$T" --vcn-id "$VCN")
[[ -n "$IGW" ]] || IGW=$(q network internet-gateway create -c "$T" --vcn-id "$VCN" --display-name "$PREFIX-igw" \
  --is-enabled true --wait-for-state AVAILABLE --query data.id --raw-output)
RT=$(q network vcn get --vcn-id "$VCN" --query 'data."default-route-table-id"' --raw-output)
q network route-table update --rt-id "$RT" --force --wait-for-state AVAILABLE \
  --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$IGW\"}]" >/dev/null
SL=$(q network vcn get --vcn-id "$VCN" --query 'data."default-security-list-id"' --raw-output)
# SSH, HTTP (Caddy and the ACME challenge), HTTPS, HTTP/3, path-MTU ICMP.
q network security-list update --security-list-id "$SL" --force --wait-for-state AVAILABLE \
  --egress-security-rules '[{"protocol":"all","destination":"0.0.0.0/0","destinationType":"CIDR_BLOCK"}]' \
  --ingress-security-rules '[
    {"protocol":"6","source":"0.0.0.0/0","sourceType":"CIDR_BLOCK","tcpOptions":{"destinationPortRange":{"min":22,"max":22}}},
    {"protocol":"6","source":"0.0.0.0/0","sourceType":"CIDR_BLOCK","tcpOptions":{"destinationPortRange":{"min":80,"max":80}}},
    {"protocol":"6","source":"0.0.0.0/0","sourceType":"CIDR_BLOCK","tcpOptions":{"destinationPortRange":{"min":443,"max":443}}},
    {"protocol":"17","source":"0.0.0.0/0","sourceType":"CIDR_BLOCK","udpOptions":{"destinationPortRange":{"min":443,"max":443}}},
    {"protocol":"1","source":"0.0.0.0/0","sourceType":"CIDR_BLOCK","icmpOptions":{"type":3,"code":4}},
    {"protocol":"1","source":"10.0.0.0/16","sourceType":"CIDR_BLOCK","icmpOptions":{"type":3}}]' >/dev/null
SUB=$(find_id network subnet list -c "$T" --vcn-id "$VCN" --display-name "$PREFIX-public")
[[ -n "$SUB" ]] || SUB=$(q network subnet create -c "$T" --vcn-id "$VCN" --display-name "$PREFIX-public" \
  --cidr-block 10.0.0.0/24 --dns-label pub --route-table-id "$RT" --security-list-ids "[\"$SL\"]" \
  --wait-for-state AVAILABLE --query data.id --raw-output)
echo "network ready"

if [[ -z "$IPID" ]]; then
  echo "==> Reserved public IP"
  IPID=$(q network public-ip create -c "$T" --lifetime RESERVED --display-name "$PREFIX-ip" \
    --wait-for-state AVAILABLE --query data.id --raw-output)
fi
IP=$(q network public-ip get --public-ip-id "$IPID" --query 'data."ip-address"' --raw-output)
echo "reserved IP: $IP  (point the domain's A record here now; DNS can propagate while the VM is pending)"

if [[ ! -f "$SSH_PUBKEY" ]]; then
  ssh-keygen -t ed25519 -f "${SSH_PUBKEY%.pub}" -N "" -C "$NAME-oracle" -q
  echo "created SSH key ${SSH_PUBKEY%.pub}"
fi

if [[ -z "$INST" ]]; then
  echo "==> A1 instance ($OCPUS OCPU / ${MEMORY_GB} GB, ${BOOT_GB} GB boot)"
  IMG=$(q compute image list -c "$T" --operating-system "Canonical Ubuntu" --operating-system-version 24.04 \
    --shape VM.Standard.A1.Flex --sort-by TIMECREATED --sort-order DESC --limit 1 --query 'data[0].id' --raw-output)
  # A1 capacity comes and goes; each "Out of host capacity" answer takes the
  # API about a minute, and retrying faster than ~30 s hits the rate limit.
  for i in $(seq 1 1500); do
    (( i % 10 == 1 )) && q session refresh --profile "$OCI_CLI_PROFILE" >/dev/null || true
    out=$(oci compute instance launch -c "$T" --availability-domain "$AD" --display-name "$NAME" \
      --shape VM.Standard.A1.Flex --shape-config "{\"ocpus\":$OCPUS,\"memoryInGBs\":$MEMORY_GB}" \
      --image-id "$IMG" --boot-volume-size-in-gbs "$BOOT_GB" --subnet-id "$SUB" --assign-public-ip false \
      --ssh-authorized-keys-file "$SSH_PUBKEY" --hostname-label oe </dev/null 2>&1 || true)
    if grep -q '"id": "ocid1.instance' <<<"$out"; then echo "$(date +%T) try $i: launched"; break; fi
    msg=$(grep -E '"message"' <<<"$out" | head -1 | sed 's/^ *"message": //')
    echo "$(date +%T) try $i: $msg"
    if grep -qiE 'NotAuthenticated|"status": 401' <<<"$out"; then
      echo "Session expired: run oci session authenticate again, then rerun this script." >&2; exit 1
    fi
    if grep -qiE 'TooManyRequests|Too many requests' <<<"$out"; then sleep 120; continue; fi
    grep -qiE 'capacity|InternalError|"status": 5' <<<"$out" || { echo "$out" | grep -E '"(code|message)"' >&2; exit 1; }
    sleep 30
  done
  INST=$(find_id compute instance list -c "$T" --display-name "$NAME")
  [[ -n "$INST" ]] || { echo "Gave up; run the script again later." >&2; exit 1; }
fi

echo "==> Attaching the reserved IP"
for _ in $(seq 1 60); do
  VNIC=$(q compute vnic-attachment list -c "$T" --instance-id "$INST" --query 'data[0]."vnic-id"' --raw-output | grep -v '^$' || true)
  [[ -n "$VNIC" ]] && break; sleep 10
done
PRIV=$(q network private-ip list --vnic-id "$VNIC" --query 'data[0].id' --raw-output)
q network public-ip update --public-ip-id "$IPID" --private-ip-id "$PRIV" --wait-for-state ASSIGNED >/dev/null
echo "Done. ssh -i ${SSH_PUBKEY%.pub} ubuntu@$IP"
