#!/bin/bash

# Ensure local AlloyDB/PostgreSQL container is started
if [ "$(docker ps -aq -f name=my-omni 2>/dev/null)" ]; then
    if [ ! "$(docker ps -q -f name=my-omni 2>/dev/null)" ]; then
        echo "Starting local database container 'my-omni'..."
        docker start my-omni
    else
        echo "Database container 'my-omni' is already running."
    fi
else
    echo "Warning: Database container 'my-omni' not found. Please run install-alloydb-omni.sh first."
fi

SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
CONFIG_FILE="$SCRIPT_DIR/config.yaml"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "Error: Configuration file not found at $CONFIG_FILE"
    echo "Please copy $SCRIPT_DIR/config.yaml.example to $SCRIPT_DIR/config.yaml and configure your GCP project ID."
    exit 1
fi

DEBUG_FLAG=""
PORT_FLAG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--debug)
      DEBUG_FLAG="--detailed_debug"
      shift
      ;;
    -p|--port)
      PORT_FLAG="--port $2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

# Ensure Prisma binaries are on PATH if installed via uv
UV_LITELLM_DIR="${UV_TOOL_DIR:-$HOME/.local/share/uv/tools/litellm}"
PRISMA_BIN=$(find "$UV_LITELLM_DIR/bin" -name prisma -type f -executable 2>/dev/null | head -n 1)
if [ -n "$PRISMA_BIN" ]; then
    export PATH="$(dirname "$PRISMA_BIN"):$PATH"
fi

echo "Starting LiteLLM proxy with config: $CONFIG_FILE"
litellm --config "$CONFIG_FILE" $PORT_FLAG $DEBUG_FLAG
