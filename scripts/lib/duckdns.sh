#!/usr/bin/env bash
# DuckDNS dynamic DNS update

DUCKDNS_PUBLIC_IP=""

update_duckdns() {
  local token="${DUCKDNS_TOKEN:-}"
  local subdomain="${DUCKDNS_SUBDOMAIN:-}"

  if [[ -z "$token" || -z "$subdomain" ]]; then
    return 0
  fi

  info "Updating DuckDNS (${subdomain}.duckdns.org)..."

  local response
  response=$(curl -s "https://www.duckdns.org/update?domains=${subdomain}&token=${token}&verbose=true" 2>/dev/null)

  local status
  status=$(echo "$response" | head -1)

  if [[ "$status" == "OK" ]]; then
    DUCKDNS_PUBLIC_IP=$(echo "$response" | sed -n '2p')
    info "DuckDNS updated → ${subdomain}.duckdns.org (${DUCKDNS_PUBLIC_IP})"
  else
    warn "DuckDNS update failed. Check DUCKDNS_TOKEN and DUCKDNS_SUBDOMAIN in .env.local"
    warn "Response: ${response}"
  fi
}
