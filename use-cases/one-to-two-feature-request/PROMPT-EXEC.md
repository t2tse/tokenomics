Implement the planned feature and run the test. Always report back the test result.

No matter the test is a success or failure, run `skaffold delete` to clean up the deployed resources from the local cluster, so that the cluster is in a clean state ready for the next tester. `kubectl get pod` should show no resources found in default namespace.