#!/usr/bin/env bash
# Self-signed certificate for trying the `tls` compose profile locally (browsers will warn). Use a real certificate in deployment.
set -euo pipefail
dir="${1:-$(dirname "$0")/../deploy/certs}"
mkdir -p "$dir"
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" -keyout "$dir/tls.key" -out "$dir/tls.crt" 2>/dev/null
chmod 600 "$dir/tls.key"
echo "Wrote $dir/tls.crt and $dir/tls.key"
