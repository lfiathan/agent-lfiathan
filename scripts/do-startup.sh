#!/usr/bin/env bash
set -euo pipefail

# DigitalOcean droplet bootstrap for agent-lfiathan.
# Usage: paste into DO User Data (or run as root).

REPO_URL="${REPO_URL:-https://github.com/lfiathan/agent-lfiathan.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/agent-lfiathan}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env}"

export DEBIAN_FRONTEND=noninteractive

if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    gnupg \
    docker.io \
    docker-compose-plugin
  systemctl enable --now docker
fi

if [ ! -d "${APP_DIR}/.git" ]; then
  mkdir -p "${APP_DIR}"
  git clone "${REPO_URL}" "${APP_DIR}"
fi

git -C "${APP_DIR}" fetch origin

git -C "${APP_DIR}" checkout "${BRANCH}"

git -C "${APP_DIR}" pull --ff-only origin "${BRANCH}"

if [ ! -f "${ENV_FILE}" ]; then
  cat > "${ENV_FILE}" <<'EOF'
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info

# Database (PostgreSQL)
DB_HOST=postgres
DB_PORT=5432
DB_USER=lfiathan
DB_PASSWORD=MeandHERMESDB13
DB_NAME=agent_lfiathan

# Redis
REDIS_URL=redis://redis:6379
REDIS_KEY_PREFIX=lfiathan:
REDIS_DEFAULT_TTL=300

# Hermes
HERMES_API_URL=http://hermes:8642
HERMES_MODEL=minimax/minimax-m2.5:free
HERMES_TIMEOUT=30000

EOF
  chmod 600 "${ENV_FILE}"
  echo "Created ${ENV_FILE}. Update secrets before running."
fi

cd "${APP_DIR}"

docker compose pull

docker compose up -d --build

echo "Done. Check status with: docker compose ps"
