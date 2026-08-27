#!/bin/bash
set -e

# Check for uv
if ! command -v uv &> /dev/null; then
    echo "Error: 'uv' command not found. Please install Astral uv first: https://docs.astral.sh/uv/"
    exit 1
fi

echo "Installing LiteLLM proxy with Prisma and Google Cloud Auth support via uv..."
uv tool install "litellm[proxy]" --with prisma --with google-auth --with google-cloud-aiplatform --force

echo "Locating Prisma schema and binaries..."
UV_LITELLM_DIR="${UV_TOOL_DIR:-$HOME/.local/share/uv/tools/litellm}"
SCHEMA_PATH=$(find "$UV_LITELLM_DIR" -name schema.prisma | grep proxy/schema.prisma | head -n 1)
PRISMA_BIN=$(find "$UV_LITELLM_DIR/bin" -name prisma -type f -executable 2>/dev/null | head -n 1)

if [ -z "$PRISMA_BIN" ]; then
    PRISMA_BIN=$(find "$UV_LITELLM_DIR" -name prisma -type f -executable 2>/dev/null | head -n 1)
fi

if [ -z "$SCHEMA_PATH" ] || [ -z "$PRISMA_BIN" ]; then
    echo "Error: Could not locate Prisma schema or binary in $UV_LITELLM_DIR"
    exit 1
fi

UV_BIN=$(dirname "$PRISMA_BIN")
echo "Found schema: $SCHEMA_PATH"
echo "Found prisma binary in: $PRISMA_BIN"

echo "Generating Prisma Client..."
PATH="$UV_BIN:$PATH" "$PRISMA_BIN" generate --schema "$SCHEMA_PATH"

DB_URL="${DATABASE_URL:-postgresql://postgres:pg1234@localhost:5432/litellm}"
echo "Synchronizing database schema to: $DB_URL..."
DATABASE_URL="$DB_URL" PATH="$UV_BIN:$PATH" "$PRISMA_BIN" db push --schema "$SCHEMA_PATH"

echo "✅ LiteLLM and Prisma database schema setup completed successfully!"
