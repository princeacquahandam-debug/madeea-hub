#!/usr/bin/env bash
#
# Deploy every Edge Function this project owns, in one command.
#
#   1. Make a Personal Access Token: https://supabase.com/dashboard/account/tokens
#   2. export SUPABASE_ACCESS_TOKEN=sbp_...        (PowerShell: $env:SUPABASE_ACCESS_TOKEN="sbp_...")
#   3. bash scripts/deploy-functions.sh
#
# WHY THIS EXISTS. Functions were being pasted into the dashboard one at a time,
# which is slow and has already produced two real failures: two files pasted
# into one editor, and a function left running an older build while everybody
# assumed it was current. Neither is a mistake anybody should be able to make.
#
# The token is read from the environment and never written down here.
set -euo pipefail

PROJECT="${SUPABASE_PROJECT_REF:-bglduxferbjmoeqzyypx}"

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "SUPABASE_ACCESS_TOKEN is not set. Create one at:"
  echo "  https://supabase.com/dashboard/account/tokens"
  exit 1
fi

# Every function, with the ones that must NOT verify a JWT marked. A provider
# redirects a browser into those two with no session, so verification would
# reject the callback after the person has already approved.
NO_JWT="integration-oauth-callback google-oauth-callback microsoft-oauth-callback whatsapp-webhook"

for dir in supabase/functions/*/; do
  name="$(basename "$dir")"
  [ -f "$dir/index.ts" ] || continue

  if echo "$NO_JWT" | grep -qw "$name"; then
    echo "→ $name  (no JWT verification)"
    npx --yes supabase@latest functions deploy "$name" --project-ref "$PROJECT" --no-verify-jwt
  else
    echo "→ $name"
    npx --yes supabase@latest functions deploy "$name" --project-ref "$PROJECT"
  fi
done

echo
echo "Done. Everything in supabase/functions is now what is deployed."
