#!/usr/bin/env bash
# Write the three settings files the production stack reads (all gitignored,
# mode 600), generating every secret:
#
#   deploy/oracle/.env     OE_DOMAIN, ACME_EMAIL (compose / Caddy)
#   deploy/oracle/api.env  the API's settings
#   deploy/oracle/ui.env   the UI's sign-in settings and signing key
#
#   bash deploy/oracle/init-env.sh
#
# It asks for the values only you know. Leave a sign-in client blank to fill
# it in later by editing ui.env. Refuses to overwrite existing files; delete
# them first to start over (the secrets in them are then replaced, which
# signs everyone out).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

for f in .env api.env ui.env; do
  if [[ -e "$HERE/$f" ]]; then
    echo "$HERE/$f already exists; edit it, or delete all three to start over." >&2
    exit 1
  fi
done

ask() {  # ask VAR "Prompt" [default] — keeps an exported value as the answer
  local var=$1 prompt=$2 default=${3-} value
  value=${!var-}
  if [[ -z "$value" ]]; then
    if [[ -n "$default" ]]; then
      read -r -p "$prompt [$default]: " value || true
      value=${value:-$default}
    else
      read -r -p "$prompt: " value || true
    fi
  fi
  printf -v "$var" '%s' "$value"
}

ask_secret() {
  local var=$1 prompt=$2 value
  value=${!var-}
  if [[ -z "$value" ]]; then
    read -r -s -p "$prompt: " value || true
    echo
  fi
  printf -v "$var" '%s' "$value"
}

echo "Open Executive production settings. Enter keeps the [default]."
ask OE_DOMAIN "Domain for the app (e.g. exec.example.com)"
ask ACME_EMAIL "Email for Let's Encrypt certificate notices"
ask OWNER_EMAIL "Your sign-in email (the owner)"
ask EXEC_EMAIL_ADDRESS "The Executive's own email address (the mailbox it sends from)"
ask OE_LANGUAGE "Language (en or ko)" "ko"
ask USER_TIMEZONE "Time zone (IANA)" "Asia/Seoul"
ask_secret ANTHROPIC_API_KEY "Anthropic API key (sk-ant-...)"
ask AUTH_GOOGLE_ID "Google OAuth client ID for sign-in (blank: fill in ui.env later)" ""
AUTH_GOOGLE_SECRET=${AUTH_GOOGLE_SECRET-}
if [[ -n "$AUTH_GOOGLE_ID" ]]; then
  ask_secret AUTH_GOOGLE_SECRET "Google OAuth client secret"
fi

for v in OE_DOMAIN ACME_EMAIL OWNER_EMAIL EXEC_EMAIL_ADDRESS ANTHROPIC_API_KEY; do
  if [[ -z "${!v}" ]]; then
    echo "$v is required." >&2
    exit 1
  fi
done
OE_DOMAIN=${OE_DOMAIN#https://}
OE_DOMAIN=${OE_DOMAIN%%/*}

echo "==> Generating secrets"
BACKEND_SHARED_SECRET=$(openssl rand -hex 32)
AUTH_SECRET=$(openssl rand -base64 32)
KEYS=$(python3 "$REPO/scripts/make-caller-keys.py")
CALLER_ASSERTION_PRIVATE_KEY=$(sed -n 's/^CALLER_ASSERTION_PRIVATE_KEY=//p' <<<"$KEYS")
CALLER_ASSERTION_PUBLIC_KEYS=$(sed -n 's/^CALLER_ASSERTION_PUBLIC_KEYS=//p' <<<"$KEYS")
if [[ -z "$CALLER_ASSERTION_PRIVATE_KEY" || -z "$CALLER_ASSERTION_PUBLIC_KEYS" ]]; then
  echo "Could not make the signing key pair (is python3-cryptography installed? see setup-server.sh)." >&2
  exit 1
fi

umask 077

# Single-quoted in the env files, so compose reads the value literally: no
# ${VAR} expansion and no " #" comment inside a pasted secret. Compose has no
# escape inside single quotes, so a value holding one is refused instead.
for v in OE_DOMAIN ACME_EMAIL OWNER_EMAIL EXEC_EMAIL_ADDRESS OE_LANGUAGE USER_TIMEZONE \
  ANTHROPIC_API_KEY AUTH_GOOGLE_ID AUTH_GOOGLE_SECRET; do
  if [[ "${!v}" == *"'"* || "${!v}" == *$'\n'* ]]; then
    echo "$v contains a quote (') or a line break, which the env file can't hold." >&2
    exit 1
  fi
done
q() { printf "'%s'" "$1"; }

cat > "$HERE/.env" <<EOF
# Read by docker compose for deploy/oracle/docker-compose.yml.
OE_DOMAIN=$(q "$OE_DOMAIN")
ACME_EMAIL=$(q "$ACME_EMAIL")
EOF

cat > "$HERE/api.env" <<EOF
# The API's settings. Every other option (Slack, Telegram, Discord, Google
# Workspace, Microsoft 365, model choices, ...) is documented in the repo's
# .env.example: copy the lines you need here, then \`./oe.sh up\`.
# Do not put CALLER_ASSERTION_PRIVATE_KEY or AUTH_* here; they belong in ui.env.

ANTHROPIC_API_KEY=$(q "$ANTHROPIC_API_KEY")
EXEC_EMAIL_ADDRESS=$(q "$EXEC_EMAIL_ADDRESS")
OE_LANGUAGE=$(q "$OE_LANGUAGE")
USER_TIMEZONE=$(q "$USER_TIMEZONE")

# Must equal BACKEND_SHARED_SECRET in ui.env.
BACKEND_SHARED_SECRET=$(q "$BACKEND_SHARED_SECRET")
# Checks the UI's signature on who is signed in (docs/auth.md, Signed callers).
CALLER_ASSERTION_PUBLIC_KEYS=$(q "$CALLER_ASSERTION_PUBLIC_KEYS")
EOF

cat > "$HERE/ui.env" <<EOF
# The UI's settings. AUTH_URL and BACKEND_BASE_URL are set by
# docker-compose.yml from OE_DOMAIN.

OE_LANGUAGE=$(q "$OE_LANGUAGE")
# Must equal BACKEND_SHARED_SECRET in api.env.
BACKEND_SHARED_SECRET=$(q "$BACKEND_SHARED_SECRET")
CALLER_ASSERTION_PRIVATE_KEY=$(q "$CALLER_ASSERTION_PRIVATE_KEY")

AUTH_SECRET=$(q "$AUTH_SECRET")
# Who may sign in, besides the People roster (docs/auth.md).
ALLOWED_EMAILS=$(q "$OWNER_EMAIL")

# Google sign-in. Authorized redirect URI in Google Cloud Console:
#   https://$OE_DOMAIN/api/auth/callback/google
AUTH_GOOGLE_ID=$(q "$AUTH_GOOGLE_ID")
AUTH_GOOGLE_SECRET=$(q "$AUTH_GOOGLE_SECRET")

# …and/or SSO (OpenID Connect), redirect URI https://$OE_DOMAIN/api/auth/callback/oidc
# AUTH_OIDC_ISSUER=
# AUTH_OIDC_ID=
# AUTH_OIDC_SECRET=
# AUTH_OIDC_NAME=
EOF

echo
echo "Wrote $HERE/.env, api.env and ui.env (mode 600)."
if [[ -z "$AUTH_GOOGLE_ID" ]]; then
  echo "Nobody can sign in until ui.env has a sign-in client (AUTH_GOOGLE_ID/SECRET or AUTH_OIDC_*)."
fi
echo "Next: bash deploy/oracle/oe.sh up"
