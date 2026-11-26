#!/usr/bin/env bash
set -euo pipefail

export PORT=${PORT:-4318}
base_url="http://127.0.0.1:$PORT"
scratch=$(mktemp -d)

# Give npm and its server a process group so cleanup stops both.
set -m
export MT_DATA_DIR="$scratch/storage"
npm start >"$scratch/server.log" 2>&1 &
server_pid=$!

cleanup() {
  result=$?
  kill -TERM -- "-$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
  if (( result != 0 )); then
    cat "$scratch/server.log" >&2
  fi
  rm -f "$scratch/server.log" "$scratch/body"
  rm -f "$MT_DATA_DIR/areas.sqlite"
  if [[ -d "$MT_DATA_DIR" ]]; then rmdir "$MT_DATA_DIR"; fi
  rmdir "$scratch"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# The app prints this URL once its own listener has bound successfully.
deadline=$((SECONDS + 10))
until grep -Fxq "$base_url" "$scratch/server.log"; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "Server exited before listening on $base_url" >&2
    exit 1
  fi
  if (( SECONDS >= deadline )); then
    echo "Server did not start within 10 seconds on $base_url" >&2
    exit 1
  fi
  sleep 0.1
done

check_route() {
  local route=$1 expected_type=$2 response status media_type
  echo "Checking $route"
  response=$(curl --noproxy '*' --silent --show-error --max-time 3 \
    --output "$scratch/body" --write-out '%{http_code} %{content_type}' "$base_url$route")
  status=${response%% *}
  media_type=${response#* }
  media_type=${media_type%%;*}
  if [[ $status != 200 || $media_type != "$expected_type" || ! -s "$scratch/body" ]]; then
    echo "$route: expected HTTP 200, $expected_type and a nonempty body; got $response, $(wc -c < "$scratch/body") bytes" >&2
    return 1
  fi
}

check_route / text/html
check_route /style.css text/css
check_route /sidebar.js text/javascript
