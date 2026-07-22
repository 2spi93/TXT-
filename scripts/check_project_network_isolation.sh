#!/usr/bin/env bash
set -euo pipefail

TXT_NETWORK="${TXT_NETWORK:-txt_default}"
# Space-separated allowlist for exceptional shared ingress containers. Empty by default.
ALLOWED_GTIXT_ON_TXT_NETWORK="${ALLOWED_GTIXT_ON_TXT_NETWORK:-}"

docker network inspect "$TXT_NETWORK" >/dev/null

is_allowed() {
  local name="$1"
  for allowed in $ALLOWED_GTIXT_ON_TXT_NETWORK; do
    if [[ "$name" == "$allowed" ]]; then
      return 0
    fi
  done
  return 1
}

mapfile -t containers < <(docker network inspect "$TXT_NETWORK" --format '{{range .Containers}}{{.Name}}{{"\n"}}{{end}}' | sed '/^$/d' | sort)
offenders=()

for container in "${containers[@]}"; do
  if is_allowed "$container"; then
    continue
  fi
  labels_json="$(docker inspect "$container" --format '{{json .Config.Labels}}' 2>/dev/null || printf '{}')"
  project="$(python3 - <<'PY' "$labels_json"
import json, sys
try:
    labels = json.loads(sys.argv[1]) or {}
except Exception:
    labels = {}
print(labels.get('com.docker.compose.project') or '')
PY
)"
  service="$(python3 - <<'PY' "$labels_json"
import json, sys
try:
    labels = json.loads(sys.argv[1]) or {}
except Exception:
    labels = {}
print(labels.get('com.docker.compose.service') or '')
PY
)"
  if [[ "$container" == gtixt-* || "$project" == gtixt* || "$service" == gtixt* ]]; then
    offenders+=("$container(project=$project service=$service)")
  fi
done

if (( ${#offenders[@]} > 0 )); then
  printf 'project_network_isolation=FAIL network=%s offenders=%s\n' "$TXT_NETWORK" "${offenders[*]}" >&2
  exit 1
fi

printf 'project_network_isolation=ok network=%s checked=%s\n' "$TXT_NETWORK" "${#containers[@]}"
