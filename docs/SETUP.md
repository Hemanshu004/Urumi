# Setup Guide

1. Make scripts executable: `chmod +x infra/scripts/*.sh`
2. Run kind initialization: `./infra/scripts/setup-local.sh`
3. Deploy Helm: `helm install urumi infra/helm/urumi -n urumi -f infra/helm/urumi/values-local.yaml --create-namespace`
4. Wait for Pods: `kubectl get pods -n urumi -w`
5. Map `/etc/hosts`: `127.0.0.1 shop.urumi.local api.urumi.local dashboard.urumi.local`
6. Run Seed: `./infra/scripts/seed-woo.sh`
