@description('Globally unique lowercase prefix, for example ffblackjack0030')
param namePrefix string
param location string = 'centralindia'
@description('GPU worker is off by default. Enable only after quota and cost review.')
param deployGpuWorker bool = false
param containerImage string = ''

var tags = { project: 'fruitfly-simulation', purpose: 'research-simulator' }

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: '${namePrefix}store'
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: { allowBlobPublicAccess: false, minimumTlsVersion: 'TLS1_2' }
}

resource blob 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}
resource replays 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blob
  name: 'replays'
  properties: { publicAccess: 'None' }
}
resource checkpoints 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blob
  name: 'checkpoints'
  properties: { publicAccess: 'None' }
}
resource queue 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = {
  parent: storage
  name: 'default'
}
resource jobs 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  parent: queue
  name: 'training-jobs'
}

resource staticSite 'Microsoft.Web/staticSites@2023-12-01' = {
  name: '${namePrefix}-web'
  location: 'centralus'
  tags: tags
  sku: { name: 'Free', tier: 'Free' }
  properties: { allowConfigFileUpdates: true }
}

module gpu 'modules/gpu-worker.bicep' = if (deployGpuWorker) {
  name: 'gpu-worker'
  params: { namePrefix: namePrefix, location: location, containerImage: containerImage }
}

output staticSiteName string = staticSite.name
output storageAccountName string = storage.name
output gpuWorkerEnabled bool = deployGpuWorker
