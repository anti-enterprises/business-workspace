#!/usr/bin/env bash
set -euo pipefail

_LIB_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$_LIB_DIR/../.." && pwd)"

info()  { printf '\033[0;36m[INFO]\033[0m %s\n' "$*"; }
warn()  { printf '\033[0;33m[WARN]\033[0m %s\n' "$*" >&2; }
error() { printf '\033[0;31m[ERROR]\033[0m %s\n' "$*" >&2; }
die()   { error "$*"; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

require_env() {
  local value="${!1:-}"
  [[ -n "$value" ]] || die "Missing required environment variable: $1"
}

load_env_file() {
  local file_path="${1:-$ROOT_DIR/.env}"
  if [[ -f "$file_path" ]]; then
    info "Loading environment from $file_path"
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ "$line" =~ ^[[:space:]]*# ]] && continue
      [[ ! "$line" == *=* ]] && continue
      local key="${line%%=*}"
      local value="${line#*=}"
      if [[ -z "${!key:-}" ]]; then
        export "$key=$value"
      fi
    done < "$file_path"
  fi
}
