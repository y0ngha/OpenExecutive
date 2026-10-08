#!/usr/bin/env bash
# One-time preparation of a fresh Ubuntu 22.04/24.04 server (Oracle Cloud
# "Canonical Ubuntu" image, Ampere A1 or AMD) for ./oe.sh. Safe to run again.
#
#   sudo bash deploy/oracle/setup-server.sh
#
# It installs Docker, opens ports 80/443 in the host firewall (Oracle's
# Ubuntu images reject everything but SSH in iptables, on top of the VCN
# security list), adds swap, and caps Docker's log size. It does not touch
# SSH or create users.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

TARGET_USER="${SUDO_USER:-ubuntu}"

echo "==> Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git sqlite3 python3-cryptography \
  iptables-persistent netfilter-persistent

echo "==> Docker"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
usermod -aG docker "$TARGET_USER"

# Logs of containers started outside compose too; compose sets its own.
if [[ ! -f /etc/docker/daemon.json ]]; then
  cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "local",
  "log-opts": { "max-size": "20m", "max-file": "5" }
}
JSON
  systemctl restart docker
fi

echo "==> Firewall: allow 80/tcp, 443/tcp, 443/udp"
# Oracle's images end the INPUT chain with a REJECT rule, so the ACCEPTs go
# above it (appended after it they would never match). The saved rules file
# is edited directly rather than with `netfilter-persistent save`, which
# would also freeze Docker's own chains into it.
RULES=/etc/iptables/rules.v4
for port_proto in "80 tcp" "443 tcp" "443 udp"; do
  read -r port proto <<<"$port_proto"
  rule=(-p "$proto" -m state --state NEW -m "$proto" --dport "$port" -j ACCEPT)
  if ! iptables -C INPUT "${rule[@]}" 2>/dev/null; then
    reject=$(iptables -L INPUT --line-numbers -n | awk '$2=="REJECT"{print $1; exit}')
    if [[ -n "$reject" ]]; then
      iptables -I INPUT "$reject" "${rule[@]}"
    else
      iptables -A INPUT "${rule[@]}"
    fi
  fi
  line="-A INPUT ${rule[*]}"
  # Persist only where a saved REJECT would block the port after a reboot;
  # without one the saved policy already lets it in.
  if [[ -f "$RULES" ]] && grep -q '^-A INPUT -j REJECT' "$RULES" && ! grep -qF -- "$line" "$RULES"; then
    awk -v l="$line" '!done && /^-A INPUT -j REJECT/{print l; done=1} {print}' "$RULES" > "$RULES.tmp"
    cat "$RULES.tmp" > "$RULES" && rm -f "$RULES.tmp"
  fi
done

echo "==> Swap"
# The API image build (torch, embedding models) and ingest are memory-hungry;
# swap keeps a small instance from being OOM-killed mid-build.
if ! swapon --show | grep -q .; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo
echo "Done. Log out and back in (so '$TARGET_USER' can use docker without sudo),"
echo "then continue with: bash deploy/oracle/init-env.sh"
