#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/ssl.sh"
source "$SCRIPT_DIR/lib/duckdns.sh"

CONTAINER_NAME="business-workspace-db"

# ─── 1. Node.js ──────────────────────────────────────────────────────────────

check_node() {
  if ! command -v node >/dev/null 2>&1; then
    die "Node.js not found. Install Node.js >= 22: https://nodejs.org"
  fi

  local node_major
  node_major=$(node -e 'console.log(process.versions.node.split(".")[0])')
  if [[ "$node_major" -lt 22 ]]; then
    die "Node.js >= 22 required (found v$(node --version)). Update: https://nodejs.org"
  fi

  info "Node.js $(node --version)"
}

# ─── 2. pnpm ─────────────────────────────────────────────────────────────────

check_pnpm() {
  if ! command -v pnpm >/dev/null 2>&1; then
    info "pnpm not found — installing via corepack"
    if command -v corepack >/dev/null 2>&1; then
      corepack enable 2>/dev/null || true
      corepack prepare pnpm@latest --activate 2>/dev/null || true
    fi

    if ! command -v pnpm >/dev/null 2>&1; then
      die "pnpm not found and corepack failed. Install: npm install -g pnpm"
    fi
  fi

  info "pnpm $(pnpm --version)"
}

# ─── 3. Docker ───────────────────────────────────────────────────────────────

check_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    die "Docker not found. Install Docker Desktop: https://docker.com/products/docker-desktop"
  fi

  if ! docker info >/dev/null 2>&1; then
    die "Docker daemon not running. Start Docker Desktop first."
  fi

  info "Docker $(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"
}

# ─── 4. Dependencies ─────────────────────────────────────────────────────────

install_deps() {
  if [[ ! -d "$ROOT_DIR/node_modules" ]] || [[ ! -f "$ROOT_DIR/node_modules/.pnpm/lock.yaml" ]]; then
    info "Installing dependencies..."
    (cd "$ROOT_DIR" && pnpm install)
  else
    info "Dependencies installed"
  fi
}

# ─── 5. Environment ──────────────────────────────────────────────────────────

generate_password() {
  local password=""
  while [[ ${#password} -lt 32 ]]; do
    password+=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9')
  done
  echo "${password:0:32}"
}

check_env() {
  local env_file="$ROOT_DIR/.env.local"

  if [[ ! -f "$env_file" ]]; then
    warn "No .env.local found — generating from template"
    local password
    password=$(generate_password)
    local port="${POSTGRES_PORT:-5433}"
    local bind_address="${POSTGRES_BIND_ADDRESS:-0.0.0.0}"

    cat > "$ROOT_DIR/.env.local" <<EOF
# business-workspace environment variables

# PostgreSQL (Docker)
POSTGRES_PASSWORD=${password}
POSTGRES_PORT=${port}
POSTGRES_BIND_ADDRESS=${bind_address}
DATABASE_URL=postgresql://workspace:${password}@localhost:${port}/workspace?sslmode=require&uselibpqcompat=true

# External Access (optional) — enables remote AI agent connections
# Get a free token at https://www.duckdns.org
DUCKDNS_TOKEN=
DUCKDNS_SUBDOMAIN=

# AI
ANTHROPIC_API_KEY=

# Signal Discovery APIs
PARALLEL_API_KEY=
THEIRSTACK_API_KEY=
EXA_API_KEY=

# Contact Enrichment APIs
LEADMAGIC_API_KEY=
FULLENRICH_API_KEY=

# Outreach APIs
UNIPILE_API_KEY=
UNIPILE_DSN=
EOF
    info "Generated .env.local with random DB password"
  fi

  # Load env for this script
  load_env_file "$ROOT_DIR/.env.local"
  load_env_file "$ROOT_DIR/.env"

  if [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
    die "POSTGRES_PASSWORD not set in .env.local"
  fi

  if [[ -z "${DATABASE_URL:-}" ]]; then
    die "DATABASE_URL not set in .env.local"
  fi

  if [[ -z "${POSTGRES_BIND_ADDRESS:-}" ]]; then
    POSTGRES_BIND_ADDRESS="0.0.0.0"
  fi

  info "Environment loaded"
}

# ─── 6. SSL Certificates ────────────────────────────────────────────────────

# ensure_ssl_certs is defined in scripts/lib/ssl.sh

# ─── 7. PostgreSQL container ────────────────────────────────────────────────

start_postgres() {
  local container_status
  container_status=$(docker inspect -f '{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "missing")

  case "$container_status" in
    running)
      # Check if compose config changed (SSL added, etc.) — recreate if needed
      info "PostgreSQL container running"
      (cd "$ROOT_DIR" && docker compose up -d 2>/dev/null)
      ;;
    exited|created)
      info "Starting PostgreSQL container..."
      (cd "$ROOT_DIR" && docker compose up -d)
      wait_for_postgres
      ;;
    *)
      info "Creating PostgreSQL container..."
      (cd "$ROOT_DIR" && docker compose up -d)
      wait_for_postgres
      ;;
  esac
}

wait_for_postgres() {
  info "Waiting for PostgreSQL to be ready..."
  local retries=0
  local max_retries=30

  while [[ $retries -lt $max_retries ]]; do
    if docker exec "$CONTAINER_NAME" pg_isready -U workspace -d workspace >/dev/null 2>&1; then
      info "PostgreSQL ready"
      return 0
    fi
    retries=$((retries + 1))
    sleep 1
  done

  die "PostgreSQL failed to start after ${max_retries}s. Check: docker logs $CONTAINER_NAME"
}

# ─── 8. Dynamic DNS ─────────────────────────────────────────────────────────

# update_duckdns is defined in scripts/lib/duckdns.sh

warn_exposure_mode() {
  local bind_address="${POSTGRES_BIND_ADDRESS:-0.0.0.0}"
  if [[ "$bind_address" == "127.0.0.1" || "$bind_address" == "localhost" ]]; then
    info "PostgreSQL exposure: local-only (POSTGRES_BIND_ADDRESS=${bind_address})"
    return 0
  fi

  warn "PostgreSQL exposure: network-reachable (POSTGRES_BIND_ADDRESS=${bind_address})"
  warn "Set POSTGRES_BIND_ADDRESS=127.0.0.1 in .env.local for local-only access"
}

# ─── 9. Build ────────────────────────────────────────────────────────────────

build_project() {
  if [[ ! -d "$ROOT_DIR/dist" ]] || [[ "$ROOT_DIR/execution" -nt "$ROOT_DIR/dist" ]]; then
    info "Building TypeScript..."
    (cd "$ROOT_DIR" && pnpm build)
  else
    info "Build up to date"
  fi
}

# ─── 10. Database schema ────────────────────────────────────────────────────

setup_schema() {
  info "Checking database schema..."
  (cd "$ROOT_DIR" && node dist/db/setup.js "$@")
}

# ─── 11. Connection info ────────────────────────────────────────────────────

print_connection_info() {
  local port="${POSTGRES_PORT:-5433}"
  local bind_address="${POSTGRES_BIND_ADDRESS:-0.0.0.0}"
  local is_local_only="false"
  if [[ "$bind_address" == "127.0.0.1" || "$bind_address" == "localhost" ]]; then
    is_local_only="true"
  fi
  local host_ip
  host_ip=$(ipconfig getifaddr en0 2>/dev/null || echo "<your-ip>")

  local duckdns_host=""
  if [[ -n "${DUCKDNS_SUBDOMAIN:-}" ]]; then
    duckdns_host="${DUCKDNS_SUBDOMAIN}.duckdns.org"
  fi

  echo ""
  echo "  ┌─────────────────────────────────────────────────────────────────┐"
  echo "  │  Connection Details                                            │"
  echo "  ├─────────────────────────────────────────────────────────────────┤"
  echo "  │  Local:    postgresql://workspace:***@localhost:${port}/workspace"
  if [[ "$is_local_only" == "false" ]]; then
    echo "  │  Network:  postgresql://workspace:***@${host_ip}:${port}/workspace"
  else
    echo "  │  Network:  disabled (bind address ${bind_address})"
  fi

  if [[ -n "$duckdns_host" ]]; then
    echo "  │  External: postgresql://workspace:***@${duckdns_host}:${port}/workspace?sslmode=require&uselibpqcompat=true"
  fi

  echo "  │  psql:     psql \$DATABASE_URL"
  echo "  └─────────────────────────────────────────────────────────────────┘"

  # Port forwarding reminder for external access
  if [[ -n "$duckdns_host" ]]; then
    echo ""
    echo "  ┌─────────────────────────────────────────────────────────────────┐"
    echo "  │  Router Setup Required                                         │"
    echo "  ├─────────────────────────────────────────────────────────────────┤"
    echo "  │  Forward port ${port} (TCP) to this machine:                       │"
    echo "  │    ${host_ip}:${port}                                              │"
    echo "  └─────────────────────────────────────────────────────────────────┘"
  fi

  # Agent connection string (masked in terminal output)
  if [[ -n "$duckdns_host" ]]; then
    local ext_host="$duckdns_host"
  else
    local ext_host="$host_ip"
  fi

  echo ""
  echo "  ┌─────────────────────────────────────────────────────────────────┐"
  echo "  │  Agent Connection String (copy this):                          │"
  echo "  │                                                                │"
  echo "  │  postgresql://workspace:***@${ext_host}:${port}/workspace?sslmode=require&uselibpqcompat=true"
  echo "  │                                                                │"
  echo "  └─────────────────────────────────────────────────────────────────┘"
  echo "  Secret value lives in .env.local as DATABASE_URL (not printed)"

  if [[ -z "${DUCKDNS_SUBDOMAIN:-}" ]]; then
    echo ""
    echo "  Tip: Set DUCKDNS_TOKEN + DUCKDNS_SUBDOMAIN in .env.local for a"
    echo "       stable hostname. Free at https://www.duckdns.org"
  fi
}

# ─── Main ─────────────────────────────────────────────────────────────────────

main() {
  echo ""
  echo "  business-workspace"
  echo "  ─────────────────────────────"
  echo ""

  check_node
  check_pnpm
  check_docker
  install_deps
  check_env
  warn_exposure_mode
  ensure_ssl_certs
  start_postgres
  update_duckdns
  build_project
  setup_schema "$@"

  print_connection_info

  echo ""
  echo "  Commands:"
  echo "    pnpm dev              Watch mode"
  echo "    pnpm test             Run tests"
  echo "    pnpm typecheck        Type check"
  echo ""
  echo "  Database:"
  echo "    pnpm db:setup         Check + apply schema"
  echo "    pnpm db:reset         Destroy and recreate DB"
  echo "    pnpm db:stop          Stop PostgreSQL container"
  echo "    pnpm db:logs          Tail container logs"
  echo "    pnpm db:psql          Open psql shell"
  echo "    pnpm db:regen-certs   Regenerate SSL certificates"
  echo ""
  info "Ready"
  echo ""
}

main "$@"
