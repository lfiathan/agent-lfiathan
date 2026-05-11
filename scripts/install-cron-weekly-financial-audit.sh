#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/agent-lfiathan"
LOG_DIR="${APP_DIR}/logs/weekly-audit"
MARKER_BEGIN="# >>> AGENT_LFIATHAN_WEEKLY_FIN_AUDIT >>>"
MARKER_END="# <<< AGENT_LFIATHAN_WEEKLY_FIN_AUDIT <<<"
CRON_LINE="0 9 * * 0 cd ${APP_DIR} && /usr/bin/env bash -lc 'npm run report:weekly:financial-audit' >> ${LOG_DIR}/cron.log 2>&1"

mkdir -p "${LOG_DIR}"

tmp_file="$(mktemp)"
existing="$(mktemp)"

crontab -l > "${existing}" 2>/dev/null || true

awk -v begin="$MARKER_BEGIN" -v end="$MARKER_END" '
  $0 == begin { skip=1; next }
  $0 == end { skip=0; next }
  !skip { print }
' "${existing}" > "${tmp_file}"

{
  cat "${tmp_file}"
  echo "$MARKER_BEGIN"
  echo "$CRON_LINE"
  echo "$MARKER_END"
} | crontab -

rm -f "${tmp_file}" "${existing}"

echo "Installed weekly financial audit cron entry (Sunday 09:00)."
