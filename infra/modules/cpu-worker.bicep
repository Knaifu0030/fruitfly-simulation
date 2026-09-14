param namePrefix string
param location string
param containerImage string

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${namePrefix}-env'
  location: location
  properties: {}
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-api'
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    managedEnvironmentId: environment.id
    configuration: { ingress: { external: true, targetPort: 8000, transport: 'auto' } }
    template: {
      containers: [{ name: 'api', image: containerImage, resources: { cpu: json('0.5'), memory: '1Gi' } }]
      scale: { minReplicas: 0, maxReplicas: 1, rules: [{ name: 'http', http: { metadata: { concurrentRequests: '20' } } }] }
    }
  }
}

output fqdn string = app.properties.configuration.ingress.fqdn
