"""Write deploy/oracle/{.env,api.env,ui.env} from a private secrets YAML.

The non-interactive twin of init-env.sh, for keeping every value in one file
outside the repo (see secrets.example.yaml). It never prints a value: only
which fields are set and, by name, what is wrong. Secrets the app needs
(shared secret, Auth.js secret, the caller-signing key pair) are generated.

    uv run --with pyyaml --with cryptography python deploy/oracle/env-from-yaml.py SRC OUTDIR

OUTDIR is deploy/oracle on the server, or a private folder to copy from
(`scp -p`). Existing files there are refused unless --force.
"""
from __future__ import annotations

import argparse
import base64
import os
import re
import secrets
import subprocess
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[2]
EMAIL = re.compile(r"[^@\s']+@[^@\s']+\.[^@\s']+")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("src")
    ap.add_argument("outdir")
    ap.add_argument("--force", action="store_true", help="overwrite existing files")
    args = ap.parse_args()

    text = Path(args.src).expanduser().read_text(encoding="utf-8").replace("\t", "    ")
    try:
        data = yaml.safe_load(text) or {}
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None)
        print(f"{args.src} is not valid YAML near line {mark.line + 1 if mark else '?'} (values not shown)")
        return 1

    def get(*path: str) -> str:
        cur: object = data
        for p in path:
            cur = cur.get(p) if isinstance(cur, dict) else None
        return "" if cur is None else str(cur).strip()

    users = {str(k): str(v).strip() for k, v in (data.get("users") or {}).items() if v}
    owner = get("owner") or next(iter(users), "")
    f = {
        "domain": get("domain"),
        "acme_email": get("acme_email") or users.get(owner, ""),
        "google_oauth.client_id": get("google_oauth", "client_id"),
        "google_oauth.client_secret": get("google_oauth", "client_secret"),
        "anthropic.key": get("anthropic", "key"),
        "owner": users.get(owner, ""),
        "exec_email_address": get("exec_email_address"),
        "exec_display_name": get("exec_display_name"),
        "oe_language": get("oe_language") or "en",
        "timezone": get("timezone"),
        "slack.app_token": get("slack", "app_token"),
        "slack.bot_user_oauth": get("slack", "bot_user_oauth"),
    }
    problems: list[str] = []
    checks = {
        "domain": lambda v: bool(re.fullmatch(r"[a-z0-9.-]+\.[a-z]{2,}", v)),
        "acme_email": EMAIL.fullmatch,
        "owner": EMAIL.fullmatch,
        "exec_email_address": EMAIL.fullmatch,
        "anthropic.key": lambda v: v.startswith("sk-ant-"),
        "google_oauth.client_id": lambda v: v.endswith(".apps.googleusercontent.com"),
        "slack.app_token": lambda v: v.startswith("xapp-"),
        "slack.bot_user_oauth": lambda v: v.startswith("xoxb-"),
    }
    for name, ok in checks.items():
        if f[name] and not ok(f[name]):
            problems.append(f"{name}: unexpected format")
    lang = {"korean": "ko", "english": "en"}.get(f["oe_language"].lower(), f["oe_language"].lower())
    if lang not in ("en", "ko"):
        problems.append("oe_language: use en or ko")
    for name, value in list(f.items()) + list(users.items()):
        if "'" in value or "\n" in value:
            problems.append(f"{name}: contains a quote or line break")
    print("fields (values hidden):")
    for name, value in f.items():
        print(f"  {'set    ' if value else '-      '} {name}")
    print(f"  users: {len(users)} (owner: {owner or '?'})")
    required = ["domain", "acme_email", "google_oauth.client_id", "google_oauth.client_secret",
                "anthropic.key", "owner", "exec_email_address"]
    problems += [f"{name}: required" for name in required if not f[name]]
    if problems:
        print("\n".join(f"PROBLEM: {p}" for p in problems))
        return 1

    out = Path(args.outdir).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    targets = [out / ".env", out / "api.env", out / "ui.env"]
    if not args.force and any(t.exists() for t in targets):
        print(f"{out} already has settings files; pass --force to replace them (signs everyone out).")
        return 1

    keys = subprocess.run([sys.executable, str(REPO / "scripts" / "make-caller-keys.py")],
                          capture_output=True, text=True, check=True).stdout
    private = re.search(r"^CALLER_ASSERTION_PRIVATE_KEY=(.+)$", keys, re.MULTILINE).group(1)  # type: ignore[union-attr]
    public = re.search(r"^CALLER_ASSERTION_PUBLIC_KEYS=(.+)$", keys, re.MULTILINE).group(1)  # type: ignore[union-attr]
    shared = secrets.token_hex(32)

    def q(v: str) -> str:
        return f"'{v}'"

    api = ["# The API's settings (written by env-from-yaml.py). More: the repo's .env.example.",
           "# CALLER_ASSERTION_PRIVATE_KEY and AUTH_* belong in ui.env, never here.", "",
           f"ANTHROPIC_API_KEY={q(f['anthropic.key'])}",
           f"EXEC_EMAIL_ADDRESS={q(f['exec_email_address'])}",
           f"OE_LANGUAGE={lang}"]
    if f["exec_display_name"]:
        api.append(f"EXEC_DISPLAY_NAME={q(f['exec_display_name'])}")
    if f["timezone"]:
        api.append(f"USER_TIMEZONE={q(f['timezone'])}")
    api += ["", "# Must equal BACKEND_SHARED_SECRET in ui.env.", f"BACKEND_SHARED_SECRET={shared}",
            f"CALLER_ASSERTION_PUBLIC_KEYS={public}"]
    if f["slack.app_token"] and f["slack.bot_user_oauth"]:
        api += ["", "# Slack (Socket Mode). People need their Slack member ID on the People page.",
                f"SLACK_BOT_TOKEN={q(f['slack.bot_user_oauth'])}", f"SLACK_APP_TOKEN={q(f['slack.app_token'])}"]
    if data.get("only_slack"):
        api += ["", "# Only Slack: everything else off explicitly.", "MCP_ENABLED=false",
                "DRIVE_SYNC_ENABLED=false", "ONEDRIVE_SYNC_ENABLED=false",
                "CONFLUENCE_SYNC_ENABLED=false", "NOTION_SYNC_ENABLED=false", "HONCHO_ENABLED=false"]
    ui = ["# The UI's settings (written by env-from-yaml.py). AUTH_URL / BACKEND_BASE_URL come from",
          "# docker-compose.yml.", "", f"OE_LANGUAGE={lang}",
          "# Must equal BACKEND_SHARED_SECRET in api.env.", f"BACKEND_SHARED_SECRET={shared}",
          f"CALLER_ASSERTION_PRIVATE_KEY={private}", "",
          f"AUTH_SECRET={base64.b64encode(secrets.token_bytes(32)).decode()}", "",
          "# Only the owner at first: until their People entry has their email, anyone",
          "# listed here could claim the owner's entry. Others sign in once the owner",
          "# adds them on the People page.",
          f"ALLOWED_EMAILS={q(f['owner'])}", "",
          f"# Redirect URI: https://{f['domain']}/api/auth/callback/google",
          f"AUTH_GOOGLE_ID={q(f['google_oauth.client_id'])}",
          f"AUTH_GOOGLE_SECRET={q(f['google_oauth.client_secret'])}"]
    env = ["# Read by docker compose for deploy/oracle/docker-compose.yml.",
           f"OE_DOMAIN={f['domain']}", f"ACME_EMAIL={q(f['acme_email'])}"]

    old = os.umask(0o077)
    try:
        for path, lines in zip(targets, (env, api, ui), strict=True):
            path.write_text("\n".join(lines) + "\n", encoding="utf-8")
            path.chmod(0o600)
    finally:
        os.umask(old)
    print(f"wrote {out}/.env, api.env, ui.env (mode 600)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
