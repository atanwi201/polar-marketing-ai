#!/usr/bin/env bash
# Copy the AI provider keys (and the booking email key) from your local .env to the server's .env, then restart. Run it once after
# adding or changing a key: npm run push-env. Only the names listed below are sent (never ADMIN_*, PUBLIC_URL,
# social tokens); values go over ssh and are never printed.
set -euo pipefail
HOST="${DEPLOY_HOST:-root@217.160.204.176}"
DIR=/opt/isla-autopilot
NAMES="OPENROUTER_API_KEY GROQ_API_KEY MISTRAL_API_KEY GEMINI_API_KEY GOOGLE_API_KEY DEEPSEEK_API_KEY SILICONFLOW_API_KEY DASHSCOPE_API_KEY OPENAI_API_KEY PUTER_AUTH_TOKEN AI_PROVIDERS GROQ_MODELS MISTRAL_MODELS GEMINI_MODELS DEEPSEEK_MODELS SILICONFLOW_MODELS ALIBABA_MODELS OPENAI_MODELS PUTER_MODELS PEXELS_API_KEY POLLINATIONS_KEY RESEND_API_KEY BOOKING_FROM_EMAIL"
PATTERN="^($(echo $NAMES | tr ' ' '|'))=.+"

[ -f .env ] || { echo "No .env here"; exit 1; }
LINES="$(grep -E "$PATTERN" .env || true)"
[ -n "$LINES" ] || { echo "No AI keys found in .env"; exit 1; }
echo "Sending: $(echo "$LINES" | cut -d= -f1 | tr '\n' ' ')"

echo "$LINES" | ssh "$HOST" "cd $DIR && touch .env && cat > .env.incoming \
  && grep -v -E \"^(\$(cut -d= -f1 .env.incoming | paste -sd'|' -))=\" .env > .env.next || true \
  && cat .env.incoming >> .env.next && mv .env.next .env && rm -f .env.incoming \
  && chown isla:isla .env && chmod 600 .env && systemctl restart isla-autopilot && sleep 3 && systemctl is-active isla-autopilot"
echo "Done. The server now uses those keys."
