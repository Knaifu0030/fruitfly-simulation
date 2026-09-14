# Azure deployment gate

Nothing in this repository provisions resources automatically. The deployment workflow is manual and targets the protected GitHub environment `azure-production`; configure required reviewers before use.

Before approval, run read-only checks for the intended subscription:

```bash
az account show --query '{name:name,id:id,state:state}'
az provider show --namespace Microsoft.App --query registrationState
az containerapp env workload-profile list-supported --location centralindia
az quota list --scope /subscriptions/SUBSCRIPTION_ID/providers/Microsoft.App/locations/centralindia
az deployment group what-if --resource-group EXISTING_RESOURCE_GROUP --template-file infra/main.bicep --parameters infra/main.bicepparam.example
```

The proposed names derive from `namePrefix`: `<prefix>-web`, `<prefix>store`, `<prefix>-env`, and `<prefix>-worker`. The template keeps `deployGpuWorker=false` by default. GPU configuration is T4 (`Consumption-GPU-NC8as-T4`), Central India, zero minimum and one maximum replica. Confirm the currently offered workload-profile identifier and quota before deploying because regional GPU availability changes.

Configure OIDC secrets (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`) and repository variables (`AZURE_RESOURCE_GROUP`, `AZURE_NAME_PREFIX`, `CONTAINER_IMAGE`). The resource group must already exist. Use managed identity and Key Vault for runtime secrets. Add cost budgets and alerts, but remember alerts notify; they do not stop compute. The application also enforces a two-hour run TTL and one active run.

Deployment requires a separate explicit approval after the `what-if` output, regional availability, quota, and estimated credit use have been reviewed.
