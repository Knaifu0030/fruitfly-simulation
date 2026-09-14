$ErrorActionPreference = 'Stop'

$destination = Join-Path $PSScriptRoot '..\data\malecns-v1.0\raw'
$destination = [System.IO.Path]::GetFullPath($destination)
New-Item -ItemType Directory -Force -Path $destination | Out-Null

$baseUrl = 'https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome'
$files = @(
    'body-annotations-male-cns-v1.0-minconf-0.5.feather',
    'body-neurotransmitters-male-cns-v1.0.feather',
    'body-stats-male-cns-v1.0-minconf-0.5.feather',
    'connectome-weights-male-cns-v1.0-minconf-0.5.feather',
    'syn-partners-male-cns-v1.0-minconf-0.5.feather',
    'syn-points-male-cns-v1.0-minconf-0.5.feather',
    'tbar-neurotransmitters-male-cns-v1.0.feather'
)

foreach ($file in $files) {
    $url = "$baseUrl/$file"
    $output = Join-Path $destination $file
    Write-Host "Downloading $file"
    & curl.exe --fail --location --retry 10 --retry-all-errors --continue-at - --output $output $url
    if ($LASTEXITCODE -ne 0) {
        throw "curl failed for $file with exit code $LASTEXITCODE"
    }
}

Write-Host 'Downloads complete.'
Get-ChildItem -LiteralPath $destination -File |
    Sort-Object Name |
    Select-Object Name, Length
