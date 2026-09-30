#!/bin/sh
set -eu
export SPICEDB_HTTP_ADDR=":${PORT:-8443}"
export SPICEDB_GRPC_PRESHARED_KEY="${SPICEDB_PRESHARED_KEY:?Missing authorization token}"
case "${SPICEDB_DATASTORE_CONN_URI:?Missing authorization database}" in
  *sslmode=*) ;;
  *\?*) export SPICEDB_DATASTORE_CONN_URI="${SPICEDB_DATASTORE_CONN_URI}&sslmode=disable" ;;
  *) export SPICEDB_DATASTORE_CONN_URI="${SPICEDB_DATASTORE_CONN_URI}?sslmode=disable" ;;
esac
attempt=0
until spicedb datastore migrate head; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 15 ]; then
    echo 'Authorization migrations did not become ready' >&2
    exit 1
  fi
  sleep 2
done
exec spicedb serve --telemetry-endpoint=
