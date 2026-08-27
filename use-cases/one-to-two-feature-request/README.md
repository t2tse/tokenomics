# one-to-two-feature-request

This use case provides an automated test setup and prompt instructions for evaluating "one-to-two" feature request workflows on the Google Cloud Online Boutique ([`microservices-demo`](https://github.com/GoogleCloudPlatform/microservices-demo)) microservices application.

## Feature Request Description

The task consists of planning and executing a multi-step feature enhancement:
1. **Currency Selection Update**: Modify the Online Boutique website currency dropdown selection menu from six default currencies to show only four specific currencies: **USD**, **CNY**, **HKD**, and **TWD**.
2. **Automated UI Testing**: Write a Playwright (Node.js) test script to validate that the four specified currencies display correctly in the web application UI.

The prompt definitions for planning and execution are stored in:
- [`PROMPT-PLAN.md`](./PROMPT-PLAN.md): Feature request requirements and planning prompt.
- [`PROMPT-EXEC.md`](./PROMPT-EXEC.md): Execution prompt to implement the feature and run verification tests.

## Setup Overview

Running [`test-setup.sh`](./test-setup.sh) performs the following automated steps:

1. **Repository Retrieval**: Clones a clean, shallow copy of the [`microservices-demo`](https://github.com/GoogleCloudPlatform/microservices-demo) repository into `microservices-demo/` and removes Git tracking (`.git`).
2. **Prerequisites Check**: Verifies that `kubectl` and `skaffold` are installed in your PATH.
3. **Cluster Setup**: Checks for an existing active Kubernetes cluster. If no active cluster is detected:
   - Prompts the user to select between **Minikube** (`minikube start --cpus=4 --memory=4096 --disk-size=32g`) or **Kind** (`kind create cluster`) (or uses the `CLUSTER_TYPE` environment variable / auto-detects in non-interactive environments).
   - Configures Minikube pod network NAT rules (`sudo iptables -t nat -A POSTROUTING -s 10.244.0.0/16 -j MASQUERADE`) to ensure UDP DNS queries resolve reliably without timeouts.
   - Verifies active cluster nodes with `kubectl get nodes`.
4. **Cluster Context & Kubeconfig Export**:
   - Displays current cluster context (`kubectl config current-context`) and cluster information (`kubectl cluster-info`).
   - Generates a standalone, minified reference kubeconfig file at [`kubeconfig.yaml`](./kubeconfig.yaml).
5. **Build and Deploy**: Executes `skaffold run` within `microservices-demo/` to build container images and deploy all microservices to the cluster.
6. **Access & Connection Instructions**:
   - Displays port-forwarding command to access the web application:
     ```bash
     kubectl port-forward service/frontend 9090:80
     ```
     Access the application at `http://localhost:9090`.
   - Explains how to set the `KUBECONFIG` environment variable:
     ```bash
     export KUBECONFIG=$(pwd)/kubeconfig.yaml
     ```

## Useful Commands
- **Run Setup Script**:
  ```bash
  ./test-setup.sh
  ```
- **Execute Test Case (Plan-Execute Mode)**:
  ```bash
  ./bin/tokbench --case one-to-two-feature-request --mode plan-execute --model-planning claude-sonnet --model-execution gemini-flash
  ```
- **Run in Interactive Mode**:
  ```bash
  ./bin/tokbench --case one-to-two-feature-request --interactive
  ```
- **Local Port-forwarding to the Web Application**:
  ```bash
  kubectl port-forward service/frontend 9090:80
  ```
- **Teardown Deployed Application**:
  ```bash
  cd microservices-demo && skaffold delete
  ```
- **Delete Kubernetes Cluster**:
  - Minikube: `minikube delete`
  - Kind: `kind delete cluster`

