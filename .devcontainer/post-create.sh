#!/usr/bin/env bash
set -euo pipefail

QUIET=false
if [[ "${1:-}" == "--quiet" ]]; then
  QUIET=true
fi

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_MODULES_DIR="${REPO_ROOT}/node_modules"
PNPM_STORE_PRIMARY="/home/node/.pnpm-store"
PNPM_STORE_FALLBACK="${REPO_ROOT}/.devcontainer/.state/pnpm-store"

log() {
  if [[ "$QUIET" == false ]]; then
    echo "$@"
  fi
}

can_write_dir() {
  local dir="$1"
  mkdir -p "$dir" 2>/dev/null || true
  local probe="${dir}/.write-test-$$"
  if ( : > "$probe" ) 2>/dev/null; then
    rm -f "$probe" >/dev/null 2>&1 || true
    return 0
  fi
  return 1
}

repair_dir_with_sudo() {
  local dir="$1"
  if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    sudo mkdir -p "$dir" >/dev/null 2>&1 || true
    sudo chown -R "$(id -u):$(id -g)" "$dir" >/dev/null 2>&1 || true
    sudo chmod -R u+rwX "$dir" >/dev/null 2>&1 || true
    return 0
  fi
  return 1
}

print_node_modules_remediation() {
  cat >&2 <<'REMEDIATION'
Error: node_modules volume is not writable after ownership repair attempt.

Remediation:
  1) In VS Code, run: Dev Containers: Rebuild Container
  2) If the issue persists, remove the repo node_modules volume and reopen:
     docker volume rm <repo-name>-node_modules

Then reopen the folder in the dev container.
REMEDIATION
}

run_pnpm_install() {
  local store_dir="$1"

  if (cd "$REPO_ROOT" && pnpm install --no-frozen-lockfile --store-dir "$store_dir"); then
    return 0
  fi

  local rc=$?
  if [[ "$rc" -eq 137 ]]; then
    log "pnpm install was killed (exit 137), likely due container memory pressure."
    log "Retrying once with reduced concurrency settings..."

    if (cd "$REPO_ROOT" && pnpm install --no-frozen-lockfile --store-dir "$store_dir" --prefer-offline --child-concurrency=1 --workspace-concurrency=1 --network-concurrency=8); then
      return 0
    fi

    rc=$?
  fi

  return "$rc"
}

if [[ -f "$REPO_ROOT/package.json" && -f "$REPO_ROOT/pnpm-lock.yaml" ]]; then
  if ! command -v pnpm >/dev/null 2>&1 && command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
  fi

  if command -v pnpm >/dev/null 2>&1; then
    mkdir -p "$NODE_MODULES_DIR"

    if can_write_dir "$NODE_MODULES_DIR"; then
      log "node_modules is writable: $NODE_MODULES_DIR"
    else
      log "node_modules is not writable: $NODE_MODULES_DIR"
      log "Attempting ownership repair for node_modules with sudo..."

      if repair_dir_with_sudo "$NODE_MODULES_DIR"; then
        log "Ownership repair attempted for node_modules."
      else
        log "sudo is unavailable or requires a password; cannot repair node_modules ownership automatically."
      fi

      if can_write_dir "$NODE_MODULES_DIR"; then
        log "node_modules ownership repair succeeded."
      else
        print_node_modules_remediation
        exit 1
      fi
    fi

    STORE_DIR="$PNPM_STORE_PRIMARY"
    STORE_SOURCE="named-volume"

    if ! can_write_dir "$PNPM_STORE_PRIMARY"; then
      log "Primary pnpm store is not writable: $PNPM_STORE_PRIMARY"
      log "Attempting ownership repair with sudo..."

      if repair_dir_with_sudo "$PNPM_STORE_PRIMARY"; then
        log "Ownership repair attempted for primary pnpm store."
      else
        log "sudo is unavailable or requires a password; skipping ownership repair."
      fi

      if can_write_dir "$PNPM_STORE_PRIMARY"; then
        log "Ownership repair succeeded for primary pnpm store."
      else
        STORE_DIR="$PNPM_STORE_FALLBACK"
        STORE_SOURCE="repo-local-fallback"
        mkdir -p "$STORE_DIR"
        chmod 700 "$STORE_DIR" 2>/dev/null || true
        if ! can_write_dir "$STORE_DIR"; then
          echo "Error: fallback pnpm store is not writable: $STORE_DIR" >&2
          exit 1
        fi
        log "Primary pnpm store remains unwritable; falling back to: $STORE_DIR"
      fi
    fi

    pnpm config set store-dir "$STORE_DIR" --global >/dev/null 2>&1 || true

    log "Using pnpm store ($STORE_SOURCE): $STORE_DIR"
    log "Installing Node dependencies with pnpm (Linux-native binaries, permissive lockfile mode)..."

    if run_pnpm_install "$STORE_DIR"; then
      :
    else
      rc=$?
      echo "Error: pnpm install failed (exit $rc)." >&2
      if [[ "$rc" -eq 137 ]]; then
        cat >&2 <<'OOM_HINT'
The install process was killed by container memory limits.
Try increasing Docker Desktop memory and rerun, or run manually:
  pnpm install --no-frozen-lockfile --prefer-offline --child-concurrency=1 --workspace-concurrency=1 --network-concurrency=8
If you see "Command \"tsx\" not found", rerun install to complete linking.
OOM_HINT
      fi
      exit "$rc"
    fi

    log "Dependency install complete."
  else
    echo "Warning: pnpm was not found in the container; skipped dependency install." >&2
  fi
fi

if [[ "$QUIET" == false ]]; then
  echo "Post-create setup complete."
fi
