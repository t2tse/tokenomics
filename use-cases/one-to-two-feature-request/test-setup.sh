#!/bin/bash
set -e

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${SCRIPT_DIR}/microservices-demo"

echo "Setting up test use case for one-to-two-feature-request..."

# Remove existing directory if present for a clean setup
if [ -d "$TARGET_DIR" ]; then
    echo "Removing existing directory: $TARGET_DIR"
    rm -rf "$TARGET_DIR"
fi

# Shallow clone repository to fetch local files
echo "Cloning https://github.com/GoogleCloudPlatform/microservices-demo.git..."
git clone --depth 1 https://github.com/GoogleCloudPlatform/microservices-demo.git "$TARGET_DIR"

# Remove git tracking
echo "Removing Git tracking (.git)..."
rm -rf "$TARGET_DIR/.git"

echo ""
echo "====================================================================="
echo "Checking Local Development Prerequisites..."
echo "====================================================================="

check_tool() {
    local tool=$1
    if command -v "$tool" >/dev/null 2>&1; then
        echo "  [$tool] ... OK"
    else
        echo "  [$tool] ... MISSING"
        return 1
    fi
}

check_tool kubectl || { echo "Error: kubectl is required."; exit 1; }
check_tool skaffold || { echo "Error: skaffold is required."; exit 1; }

echo ""
echo "====================================================================="
echo "Setting up Kubernetes Cluster..."
echo "====================================================================="

if kubectl get nodes >/dev/null 2>&1; then
    echo "Existing Kubernetes cluster detected:"
    kubectl get nodes
else
    echo "No active Kubernetes cluster detected."
    
    CLUSTER_CHOICE=""
    if [ -n "$CLUSTER_TYPE" ]; then
        CLUSTER_CHOICE="$CLUSTER_TYPE"
    elif [ -t 0 ]; then
        echo "Please select a cluster manager to start:"
        echo "  1) Minikube (minikube start --cpus=4 --memory=4096 --disk-size=32g)"
        echo "  2) Kind (kind create cluster)"
        read -rp "Enter choice [1 or 2] (default 1): " user_choice
        case "$user_choice" in
            2) CLUSTER_CHOICE="kind" ;;
            *) CLUSTER_CHOICE="minikube" ;;
        esac
    else
        if command -v minikube >/dev/null 2>&1; then
            CLUSTER_CHOICE="minikube"
        elif command -v kind >/dev/null 2>&1; then
            CLUSTER_CHOICE="kind"
        else
            echo "Error: Neither minikube nor kind was found in PATH."
            exit 1
        fi
    fi

    if [ "$CLUSTER_CHOICE" = "minikube" ]; then
        echo "Starting Minikube cluster..."
        minikube start --cpus=4 --memory=4096 --disk-size=32g
    elif [ "$CLUSTER_CHOICE" = "kind" ]; then
        echo "Starting Kind cluster..."
        kind create cluster
    else
        echo "Unknown cluster choice: $CLUSTER_CHOICE"
        exit 1
    fi
fi

# Ensure Minikube pod network NAT rules are configured to prevent DNS packet drops
if command -v minikube >/dev/null 2>&1 && minikube status >/dev/null 2>&1; then
    echo "Ensuring Minikube pod network NAT rules are configured..."
    minikube ssh "sudo iptables -t nat -A POSTROUTING -s 10.244.0.0/16 -j MASQUERADE" >/dev/null 2>&1 || true
fi

echo ""
echo "Verifying cluster nodes..."
kubectl get nodes

echo ""
echo "====================================================================="
echo "Cluster Context & Info"
echo "====================================================================="
echo "Current Context:"
kubectl config current-context || true

echo ""
echo "Cluster Info:"
kubectl cluster-info || true

KUBECONFIG_FILE="${SCRIPT_DIR}/kubeconfig.yaml"
echo ""
echo "Generating reference kubeconfig file at: ${KUBECONFIG_FILE}..."
if kubectl config view --flatten --minify > "$KUBECONFIG_FILE" 2>/dev/null; then
    echo "Kubeconfig reference file written to ${KUBECONFIG_FILE}"
else
    kubectl config view --flatten > "$KUBECONFIG_FILE" 2>/dev/null || true
    echo "Kubeconfig reference file written to ${KUBECONFIG_FILE}"
fi

echo ""
echo "====================================================================="
echo "Building and Deploying Application with Skaffold..."
echo "Note: The initial build and deploy may take several minutes."
echo "====================================================================="

cd "$TARGET_DIR"
skaffold run

echo ""
echo "====================================================================="
echo "Deployment Completed Successfully!"
echo "====================================================================="
echo "To access the Online Boutique application, run:"
echo "   kubectl port-forward service/frontend 9090:80"
echo "Then open http://localhost:9090 in your browser."
echo ""
echo "Cluster Context Info:"
echo "   Current context: $(kubectl config current-context 2>/dev/null || echo 'N/A')"
echo "   Kubeconfig reference file: ${SCRIPT_DIR}/kubeconfig.yaml"
echo "   To connect using this kubeconfig, run:"
echo "      export KUBECONFIG=${SCRIPT_DIR}/kubeconfig.yaml"
echo ""
echo "To clean up the deployed resources, run:"
echo "   skaffold delete"
echo ""
echo "To delete Minikube cluster, run:"
echo "   minikube delete"
echo "To delete Kind cluster, run:"
echo "   kind delete cluster"
echo "====================================================================="
