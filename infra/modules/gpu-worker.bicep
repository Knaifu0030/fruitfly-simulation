param namePrefix string
param location string
param containerImage string

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${namePrefix}-env'
  location: location
  properties: {
    workloadProfiles: [{ name: 'gpu-t4', workloadProfileType: 'Consumption-GPU-NC8as-T4', minimumCount: 0, maximumCount: 1 }]
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-worker'
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    managedEnvironmentId: environment.id
    workloadProfileName: 'gpu-t4'
    configuration: { ingress: { external: true, targetPort: 8000, transport: 'auto' } }
    template: {
      containers: [{ name: 'simulation', image: containerImage, resources: { cpu: json('8'), memory: '56Gi' } }]
      scale: { minReplicas: 0, maxReplicas: 1, rules: [{ name: 'http', http: { metadata: { concurrentRequests: '10' } } }] }
    }
  }
}

output fqdn string = app.properties.configuration.ingress.fqdn
