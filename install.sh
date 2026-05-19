#!/usr/bin/env bash
# MPL Smart Rack — Linux Server Installer
# Usage: sudo bash install.sh

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info() { echo -e "${BLUE}[info]${NC}  $*"; }
ok()   { echo -e "${GREEN}[ ok ]${NC}  $*"; }
warn() { echo -e "${YELLOW}[warn]${NC}  $*"; }
die()  { echo -e "${RED}[fail]${NC}  $*" >&2; exit 1; }

# ── Config ────────────────────────────────────────────────────────────────────
INSTALL_DIR="/opt/mpl-smart-rack"
SERVICE_NAME="mpl-smart-rack"
SERVICE_USER="mpl-rack"
PORT=4000
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── 1. Must run as root ───────────────────────────────────────────────────────
[[ $EUID -eq 0 ]] || die "Please run with sudo:  sudo bash install.sh"

# ── 2. Ensure Node.js 20+ ────────────────────────────────────────────────────
info "Checking Node.js…"
_install_node() {
  info "Installing Node.js 20 via NodeSource…"
  command -v curl &>/dev/null || { apt-get update -qq && apt-get install -y -qq curl 2>/dev/null; }
  if command -v apt-get &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
    apt-get install -y -qq nodejs
  elif command -v dnf &>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >/dev/null
    dnf install -y -q nodejs
  elif command -v yum &>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >/dev/null
    yum install -y -q nodejs
  else
    die "Unsupported package manager — install Node.js 20+ manually from https://nodejs.org"
  fi
}

if ! command -v node &>/dev/null; then
  _install_node
else
  NODE_MAJOR="$(node -e "process.stdout.write(process.versions.node)" | cut -d. -f1)"
  if [[ "$NODE_MAJOR" -lt 20 ]]; then
    warn "Node.js $(node --version) is too old — upgrading to v20…"
    _install_node
  fi
fi

NODE_VER=$(node -e "process.stdout.write(process.versions.node)")
ok "Node.js $NODE_VER"

# ── 3. Build from source ──────────────────────────────────────────────────────
info "Installing dependencies…"
cd "$SCRIPT_DIR/server" && npm install --silent
cd "$SCRIPT_DIR/client" && npm install --silent
ok "Dependencies installed"

info "Building server…"
cd "$SCRIPT_DIR/server" && npm run build
ok "Server compiled"

info "Building client…"
cd "$SCRIPT_DIR/client" && npm run build
ok "Client compiled"

info "Generating Prisma client…"
cd "$SCRIPT_DIR/server" && npx prisma generate 2>&1 | grep -E "(Generated|Error|warning)" || true
ok "Prisma client ready"

cd "$SCRIPT_DIR"

# ── 4. System user and directories ───────────────────────────────────────────
info "Preparing install directory at $INSTALL_DIR…"

if ! id -u "$SERVICE_USER" &>/dev/null; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  ok "System user '$SERVICE_USER' created"
fi

mkdir -p \
  "$INSTALL_DIR/server/dist" \
  "$INSTALL_DIR/server/prisma" \
  "$INSTALL_DIR/server/node_modules" \
  "$INSTALL_DIR/client/dist" \
  "$INSTALL_DIR/data/uploads" \
  "$INSTALL_DIR/data/sessions"

# ── 5. Deploy built artifacts ─────────────────────────────────────────────────
info "Deploying files (this may take a moment)…"

# Clean-copy compiled outputs so stale files don't linger
rm -rf "$INSTALL_DIR/server/dist"
cp -r  "$SCRIPT_DIR/server/dist"    "$INSTALL_DIR/server/dist"

rm -rf "$INSTALL_DIR/server/prisma"
cp -r  "$SCRIPT_DIR/server/prisma"  "$INSTALL_DIR/server/prisma"

cp     "$SCRIPT_DIR/server/package.json" "$INSTALL_DIR/server/package.json"

# node_modules: copy only when missing or explicitly refreshing
if [[ ! -d "$INSTALL_DIR/server/node_modules/@prisma" ]]; then
  rm -rf "$INSTALL_DIR/server/node_modules"
  cp -r  "$SCRIPT_DIR/server/node_modules" "$INSTALL_DIR/server/node_modules"
  ok "node_modules deployed"
else
  # Incremental: overlay new/changed modules without deleting data
  cp -r "$SCRIPT_DIR/server/node_modules/." "$INSTALL_DIR/server/node_modules/"
  ok "node_modules updated"
fi

rm -rf "$INSTALL_DIR/client/dist"
cp -r  "$SCRIPT_DIR/client/dist"    "$INSTALL_DIR/client/dist"

ok "Files deployed"

# ── 6. Environment file (preserved on upgrades) ───────────────────────────────
ENV_FILE="$INSTALL_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  SESSION_SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")
  cat > "$ENV_FILE" <<ENVEOF
DATABASE_URL="file:$INSTALL_DIR/data/mpl_rack.db"
UPLOADS_DIR="$INSTALL_DIR/data/uploads"
SESSION_DIR="$INSTALL_DIR/data/sessions"
CLIENT_DIST="$INSTALL_DIR/client/dist"
SESSION_SECRET="$SESSION_SECRET"
PORT=$PORT
HOST="0.0.0.0"
BOT_TOKEN=""
GROUP_CHAT_ID=""
ENVEOF
  ok "Created $ENV_FILE"
else
  warn "$ENV_FILE already exists — keeping your existing config"
fi

# ── 7. Initialise or sync database ───────────────────────────────────────────
DB_PATH="$INSTALL_DIR/data/mpl_rack.db"
PRISMA_SCHEMA="$INSTALL_DIR/server/prisma/schema.prisma"

if [[ ! -f "$DB_PATH" ]]; then
  info "Initialising database…"
  DATABASE_URL="file:$DB_PATH" \
    npx --prefix "$INSTALL_DIR/server" prisma db push \
      --schema="$PRISMA_SCHEMA" \
      --skip-generate 2>&1 | tail -4
  ok "Database created at $DB_PATH"
else
  info "Database exists — syncing schema…"
  DATABASE_URL="file:$DB_PATH" \
    npx --prefix "$INSTALL_DIR/server" prisma db push \
      --schema="$PRISMA_SCHEMA" \
      --skip-generate 2>&1 | tail -4 || warn "Schema sync skipped (non-critical on upgrade)"
fi

# ── 8. Permissions ────────────────────────────────────────────────────────────
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
chmod 700 "$INSTALL_DIR/data"
ok "Permissions applied"

# ── 9. Systemd service ────────────────────────────────────────────────────────
info "Registering systemd service…"
NODE_BIN=$(command -v node)

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<SVCEOF
[Unit]
Description=MPL Smart Rack System
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR/server
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$NODE_BIN dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable  "$SERVICE_NAME" --quiet
systemctl restart "$SERVICE_NAME"
ok "Service '$SERVICE_NAME' enabled and started"

# ── 10. Summary ───────────────────────────────────────────────────────────────
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "your-server-ip")

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  MPL Smart Rack — installed!            ${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Open:      http://localhost:${PORT}"
[[ -n "${LOCAL_IP:-}" ]] && echo -e "  Network:   http://${LOCAL_IP}:${PORT}"
echo ""
echo -e "  Logs:      journalctl -u ${SERVICE_NAME} -f"
echo -e "  Restart:   systemctl restart ${SERVICE_NAME}"
echo -e "  Stop:      systemctl stop ${SERVICE_NAME}"
echo ""
echo -e "  Config:    ${ENV_FILE}"
echo -e "  Data dir:  ${INSTALL_DIR}/data/"
echo ""
echo -e "  To enable the Telegram bot, edit ${ENV_FILE}"
echo -e "  and set BOT_TOKEN + GROUP_CHAT_ID, then restart the service."
echo ""
