"""One pass of the operator check, run inside the api container by
``oe.sh check``.

Looks at the last WINDOW minutes for what only reaches the logs today: a
brief or follow-up that did not go out, brief lines the grounding pass held
back, a model reply cut off at max_tokens, errors. When something turned up
it sends one Slack DM to OPS_ALERT_SLACK_USER (a Slack member id, set in
api.env) with the bot's own token; with nothing found it sends nothing.

    python ops_check.py LOGFILE WINDOW_MINUTES

LOGFILE holds ``docker logs --since`` of the api container for the window.
Prints a one-line summary; never prints a token.
"""
from __future__ import annotations

import os
import re
import sqlite3
import sys
from datetime import UTC, datetime, timedelta

_LOG_PROBLEM = re.compile(
    r"\b(ERROR|CRITICAL)\b|Traceback|hit max_tokens|NOT delivered", re.IGNORECASE
)
_MAX_LINES = 5
_LINE_CHARS = 180


def _db_findings(db_path: str, since: str) -> list[str]:
    found: list[str] = []
    if not os.path.exists(db_path):
        return [f"DB not found at {db_path}"]
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        rows = conn.execute(
            "SELECT ts, summary FROM audit_log WHERE ts >= ? AND ("
            " (event_type = 'scheduled_action' AND summary LIKE '%NOT delivered%')"
            " OR summary LIKE 'Grounding: held back%'"
            " OR (event_type = 'scheduled_action' AND summary LIKE '%failed%'))"
            " ORDER BY ts",
            (since,),
        ).fetchall()
        for ts, summary in rows[:_MAX_LINES]:
            found.append(f"[{ts[11:16]} UTC] {summary[:_LINE_CHARS]}")
        if len(rows) > _MAX_LINES:
            found.append(f"…and {len(rows) - _MAX_LINES} more audit rows")
        failed = conn.execute(
            "SELECT COUNT(*) FROM scheduled_actions WHERE status = 'failed' AND run_at >= ?",
            (since,),
        ).fetchone()[0]
        if failed:
            found.append(f"{failed} scheduled action(s) failed in the window")
    finally:
        conn.close()
    return found


def _log_findings(logfile: str) -> list[str]:
    try:
        with open(logfile, encoding="utf-8", errors="replace") as fh:
            lines = [ln.rstrip() for ln in fh if _LOG_PROBLEM.search(ln)]
    except OSError:
        return []
    seen: list[str] = []
    for ln in lines:
        short = " ".join(ln.split())[:_LINE_CHARS]
        if short not in seen:
            seen.append(short)
    out = seen[:_MAX_LINES]
    if len(lines) > len(out):
        out.append(f"…{len(lines)} problem line(s) in the log in all")
    return out


def _send(text: str) -> str:
    user = os.environ.get("OPS_ALERT_SLACK_USER", "").strip()
    token = os.environ.get("SLACK_BOT_TOKEN", "").strip()
    if not user or not token:
        return "not sent (OPS_ALERT_SLACK_USER or SLACK_BOT_TOKEN unset)"
    from slack_sdk import WebClient

    WebClient(token=token).chat_postMessage(channel=user, text=text)
    return "sent"


def main() -> int:
    logfile = sys.argv[1] if len(sys.argv) > 1 else ""
    window = int(sys.argv[2]) if len(sys.argv) > 2 else 60
    since = (datetime.now(UTC) - timedelta(minutes=window)).isoformat()
    db_path = os.environ.get("EPISODIC_DB_PATH", "./episodic_memory.db")

    db = _db_findings(db_path, since)
    logs = _log_findings(logfile) if logfile else []
    if not db and not logs:
        print(f"ops-check: ok (last {window} min)")
        return 0
    parts = [f"[운영 점검] 최근 {window}분 동안 확인할 일이 있어요."]
    if db:
        parts += ["", "발송·브리핑:", *(f"• {line}" for line in db)]
    if logs:
        parts += ["", "서버 로그:", *(f"• {line}" for line in logs)]
    parts += ["", "자세히: bash deploy/oracle/oe.sh logs api"]
    status = _send("\n".join(parts))
    print(f"ops-check: {len(db)} db / {len(logs)} log finding(s), alert {status}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
