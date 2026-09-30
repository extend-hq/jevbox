#!/bin/sh
set -eu
export SPICEDB_HTTP_URL="http://${SPICEDB_HTTP_HOSTPORT:?Missing private authorization endpoint}"
case "${1:-}" in
  web) exec node --import tsx server/index.ts ;;
  worker) exec node --import tsx server/worker.ts ;;
  *) echo 'Choose a service process' >&2; exit 1 ;;
esac
