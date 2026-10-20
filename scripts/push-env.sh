#!/usr/bin/env bash
# Merge the AI provider keys (and booking email key) from your local .env into the server's .env, then restart.
# Existing server keys are never dropped: the merged file must contain every previously present key or we abort.
# Config as deploy.sh (DEPLOY_HOST, DEPLOY_USER required). Run: npm run push-env
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f scripts/deploy.config ] && . scripts/deploy.config
: "${DEPLOY_HOST:?Set DEPLOY_HOST}"; : "${DEPLOY_USER:?Set DEPLOY_USER}"
DIR="${DEPLOY_DIR:-/opt/isla-autopilot}"; SERVICE="${DEPLOY_SERVICE:-isla-autopilot}"
NAMES="OPENROUTER_API_KEY GROQ_API_KEY MISTRAL_API_KEY GEMINI_API_KEY GOOGLE_API_KEY DEEPSEEK_API_KEY SILICONFLOW_API_KEY DASHSCOPE_API_KEY OPENAI_API_KEY PUTER_AUTH_TOKEN TOKENHARBOR_API_KEY NAGAAI_API_KEY NAGAAI_BASE_URL NAGAAI_TRANSCRIBE_MODEL NAGAAI_TTS_MODEL NAGAAI_TTS_VOICE AI_PROVIDERS GROQ_MODELS MISTRAL_MODELS GEMINI_MODELS DEEPSEEK_MODELS SILICONFLOW_MODELS ALIBABA_MODELS OPENAI_MODELS PUTER_MODELS TOKENHARBOR_MODELS PEXELS_API_KEY POLLINATIONS_KEY RESEND_API_KEY BOOKING_FROM_EMAIL"
PATTERN="^($(echo $NAMES | tr ' ' '|'))=.+"

[ -f .env ] || { echo "No .env here"; exit 1; }
LINES="$(grep -E "$PATTERN" .env || true)"
[ -n "$LINES" ] || { echo "No AI keys found in .env"; exit 1; }
echo "Sending: $(echo "$LINES" | cut -d= -f1 | tr '\n' ' ')"

echo "$LINES" | ssh -o StrictHostKeyChecking=yes -o BatchMode=yes -p "${DEPLOY_PORT:-22}" "$DEPLOY_USER@$DEPLOY_HOST" bash -s -- "$DIR" "$SERVICE" <<'REMOTE'
set -euo pipefail
umask 077
DIR=$1; SERVICE=$2
cd "$DIR"
[ -f .env ] || : > .env
OWNER=$(stat -c '%U:%G' .env)
IN=$(mktemp .env.incoming.XXXXXX); NEXT=$(mktemp .env.next.XXXXXX)
trap 'rm -f "$IN" "$NEXT"' EXIT
cat > "$IN"
cp -p .env ".env.bak.$(date +%s)"
PAT=$(cut -d= -f1 "$IN" | paste -sd'|' -)
{ grep -v -E "^($PAT)=" .env || [ $? -eq 1 ]; } > "$NEXT"     # exit 1 = nothing matched (fine); other errors abort
cat "$IN" >> "$NEXT"
# Safety: every key name present before must still be present.
for k in $(grep -oE '^[A-Za-z0-9_]+=' .env | tr -d '='); do
  grep -q "^$k=" "$NEXT" || { echo "Abort: merged file lost key $k" >&2; exit 1; }
done
chmod 600 "$NEXT"; chown "$OWNER" "$NEXT" 2>/dev/null || true
mv -f "$NEXT" .env
PERM=$(stat -c '%a' .env); OWN=$(stat -c '%U:%G' .env)
[ "$PERM" = 600 ] || { echo "Abort: .env perms are $PERM" >&2; exit 1; }
[ "$OWN" = "$OWNER" ] || { echo "Abort: .env owner changed to $OWN (was $OWNER)" >&2; exit 1; }
# Keep only the 5 newest backups of .env
ls -1t .env.bak.* 2>/dev/null | tail -n +6 | xargs -r rm -f --
sudo systemctl restart "$SERVICE"; sleep 3; sudo systemctl is-active "$SERVICE"
REMOTE
echo "Done. The server now uses those keys."
