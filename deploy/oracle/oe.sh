#!/usr/bin/env bash
# Day-to-day commands for the production stack in this directory.
#
#   bash deploy/oracle/oe.sh up        build the images and start everything
#   bash deploy/oracle/oe.sh update    git pull, rebuild, restart
#   bash deploy/oracle/oe.sh status    containers and the API's health
#   bash deploy/oracle/oe.sh logs [service]
#   bash deploy/oracle/oe.sh backup    copy the database to deploy/oracle/backups/ (keeps 14)
#   bash deploy/oracle/oe.sh restart [service]
#   bash deploy/oracle/oe.sh down      stop (keeps all data)
#   bash deploy/oracle/oe.sh compose … any other docker compose command
set -euo pipefail
# Backups and anything else this writes are for this account only.
umask 077

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

compose() {
  docker compose --project-directory "$HERE" -f "$HERE/docker-compose.yml" "$@"
}

need_settings() {
  for f in .env api.env ui.env; do
    if [[ ! -f "$HERE/$f" ]]; then
      echo "Missing $HERE/$f; run: bash deploy/oracle/init-env.sh" >&2
      exit 1
    fi
  done
}

health() {
  compose exec -T api curl -fsS http://localhost:8000/health && echo
}

cmd=${1:-}
shift || true
case "$cmd" in
  up)
    need_settings
    compose build "$@"
    compose up -d
    echo "Started. The API takes up to ~5 minutes on its first boot; watch it with:"
    echo "  bash deploy/oracle/oe.sh logs api"
    ;;
  update)
    need_settings
    "$0" backup pre-update
    git -C "$REPO" pull --ff-only
    compose build
    # One API container at a time: the scheduler must never run twice
    # (docs/deployment.md, Single instance only). `up -d` replaces in place.
    compose up -d
    ;;
  status)
    compose ps
    health || echo "API not healthy yet (it can take ~5 minutes after a start)."
    ;;
  logs)
    compose logs -f --tail=200 "$@"
    ;;
  restart)
    compose restart "$@"
    ;;
  down)
    # Never add -v here: it deletes the data volume.
    compose down
    ;;
  backup)
    # `backup [label]`: daily backups keep the newest 14; `update` saves under
    # its own label so a busy day of updates never evicts them.
    label=${1:-daily}
    keep=14
    [[ "$label" == daily ]] || keep=5
    install -d -m 700 "$HERE/backups"
    stamp=$(date -u +%Y%m%dT%H%M%SZ)
    out="$HERE/backups/episodic_memory-$label-$stamp.db"
    # sqlite's online backup, not a file copy: a live database copied as a
    # file can be torn (docs/deployment.md, Backups).
    compose exec -T api python -c "
import sqlite3
src = sqlite3.connect('/data/episodic_memory.db')
dst = sqlite3.connect('/tmp/backup.db')
src.backup(dst)
dst.close(); src.close()
"
    compose cp api:/tmp/backup.db "$out"
    chmod 600 "$out"
    compose exec -T api rm -f /tmp/backup.db
    ls -1t "$HERE"/backups/episodic_memory-"$label"-*.db | tail -n +$((keep + 1)) | xargs -d '\n' -r rm -f
    echo "Saved $out"
    ;;
  compose)
    compose "$@"
    ;;
  *)
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
