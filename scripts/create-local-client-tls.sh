#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
umask 077
cert_dir=deployment/client-access/local-tls
mkdir -p "$cert_dir"
if [ -f "$cert_dir/key.pem" ] || [ -f "$cert_dir/cert.pem" ]; then
  echo 'Local certificate already exists. No files were replaced.'
  exit 0
fi
openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
  -keyout "$cert_dir/key.pem" -out "$cert_dir/cert.pem" \
  -subj '/CN=EvsEye Local Client Development' \
  -addext 'subjectAltName=DNS:localhost,DNS:app.localhost,DNS:acme.localhost,DNS:bluemobility.localhost,DNS:unknown.localhost' \
  -addext 'basicConstraints=critical,CA:TRUE' 2>/dev/null
echo 'Created a 30-day local certificate. No operating-system trust settings were changed.'
