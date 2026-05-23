#!/usr/bin/env bash
# SSL certificate generation for PostgreSQL

CERT_DIR="$ROOT_DIR/certs"

ensure_ssl_certs() {
  mkdir -p "$CERT_DIR"

  if [[ -f "$CERT_DIR/server.key" && -f "$CERT_DIR/server.crt" ]]; then
    # Check expiry
    local expiry_epoch
    expiry_epoch=$(date -j -f "%b %d %T %Y %Z" \
      "$(openssl x509 -enddate -noout -in "$CERT_DIR/server.crt" | cut -d= -f2)" \
      +%s 2>/dev/null || echo "0")

    local now_epoch
    now_epoch=$(date +%s)
    local days_left=$(( (expiry_epoch - now_epoch) / 86400 ))

    if [[ $days_left -lt 30 && $days_left -gt 0 ]]; then
      warn "SSL cert expires in ${days_left} days. Regenerate: pnpm db:regen-certs"
    elif [[ $days_left -le 0 && "$expiry_epoch" -ne 0 ]]; then
      warn "SSL cert EXPIRED. Regenerating..."
      rm -f "$CERT_DIR/server.key" "$CERT_DIR/server.crt"
    fi
  fi

  if [[ -f "$CERT_DIR/server.key" && -f "$CERT_DIR/server.crt" ]]; then
    info "SSL certificates present"
    return 0
  fi

  info "Generating self-signed SSL certificate..."

  # Determine CN and SANs
  local cn="localhost"
  local san="DNS:localhost,IP:127.0.0.1"

  local lan_ip
  lan_ip=$(ipconfig getifaddr en0 2>/dev/null || echo "")
  if [[ -n "$lan_ip" ]]; then
    san="${san},IP:${lan_ip}"
  fi

  if [[ -n "${DUCKDNS_SUBDOMAIN:-}" ]]; then
    cn="${DUCKDNS_SUBDOMAIN}.duckdns.org"
    san="${san},DNS:${cn}"
  fi

  openssl req -x509 -newkey rsa:2048 -sha256 -days 365 -nodes \
    -keyout "$CERT_DIR/server.key" \
    -out "$CERT_DIR/server.crt" \
    -subj "/CN=${cn}" \
    -addext "subjectAltName=${san}" \
    2>/dev/null

  chmod 600 "$CERT_DIR/server.key"

  info "SSL certificate generated (CN=${cn}, valid 365 days)"
}
