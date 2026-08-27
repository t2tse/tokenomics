#!/bin/bash

BASE_URL="${LITELLM_BASE_URL:-http://127.0.0.1:4000}"
KEY="${LITELLM_MASTER_KEY:-sk-1111}"
MODEL="${1:-gemini-flash}"

echo "Testing LiteLLM completion on $BASE_URL with model '$MODEL'..."
curl -s -X POST "$BASE_URL/chat/completions" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $KEY" \
  -d "{
    \"model\": \"$MODEL\",
    \"messages\": [{\"role\": \"user\", \"content\": \"Respond with 'LiteLLM is operational!' if you can read this.\"}]
  }" | jq . || cat
