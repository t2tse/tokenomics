# LiteLLM Proxy Setup & PostgreSQL Integration

This directory contains configuration templates and automation scripts to run **LiteLLM Proxy** integrated with a local PostgreSQL / AlloyDB Omni database for tokenomics telemetry, virtual keys, and cost tracking.

---

## 📋 Quick Setup Workflow

### Step 1: Start PostgreSQL / AlloyDB Omni Database
Runs an AlloyDB Omni container on port 5432 and initializes the `litellm` database:
```bash
./install-alloydb-omni.sh
```

### Step 2: Configure Models and GCP Project
Copy the example config and replace `YOUR_GCP_PROJECT_ID` with your Google Cloud Project ID:
```bash
cp config.yaml.example config.yaml
# Edit config.yaml with your GCP Project ID
```

Ensure your Google Cloud credentials are authenticated:
```bash
gcloud auth application-default login
```

### Step 3: Install LiteLLM & Sync Database Schema
Installs `litellm[proxy]` via `uv` with Prisma and Google Cloud Auth dependencies, generates the Prisma client, and migrates the database schema:
```bash
./install-litellm.sh
```

### Step 4: Start LiteLLM Proxy
Starts the proxy on port `4000`:
```bash
./start-litellm.sh
```
*(Optionally pass `-d` or `--debug` for verbose debugging logs).*

### Step 5: Test Connectivity (Optional)
Send a sample completion request:
```bash
./test-litellm.sh
```

---

## 📁 Files Overview

- **`install-alloydb-omni.sh`**: Provisions the local Docker database container `my-omni` and verifies health.
- **`config.yaml.example`**: LiteLLM configuration mapping model names to Vertex AI Claude and Gemini endpoints.
- **`install-litellm.sh`**: Installs LiteLLM via `uv tool`, generates Prisma client, and runs `prisma db push`.
- **`start-litellm.sh`**: Starts the database container (if not running) and launches the LiteLLM proxy server.
- **`test-litellm.sh`**: Verifies proxy and model routing via a test curl request.
