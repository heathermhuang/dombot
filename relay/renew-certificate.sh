#!/bin/sh
set -eu
[ "${RENEWED_LINEAGE:-}" = /etc/letsencrypt/live/dombot-proxy-relay ] || exit 0
install -o root -g dombot-relay -m 0640 "$RENEWED_LINEAGE/fullchain.pem" /etc/dombot-proxy-relay/tls/fullchain.pem
install -o root -g dombot-relay -m 0640 "$RENEWED_LINEAGE/privkey.pem" /etc/dombot-proxy-relay/tls/privkey.pem
if systemctl is-active --quiet dombot-proxy-relay.service; then
  systemctl reload dombot-proxy-relay.service
fi
