<#
.SYNOPSIS
  Baixa um pg_dump PORTÁTIL (sem instalação, sem admin, sem Docker) para
  ./tools/ . Roda uma única vez; depois o backup-db.ps1 usa esse binário.

.DESCRIPTION
  Baixa o pacote oficial de binários do PostgreSQL (EnterpriseDB), extrai
  apenas o necessário (pasta bin) para tools/pgsql/ e descarta o resto.
  A pasta tools/ é gitignored.

.NOTES
  Não requer privilégios de administrador. Apenas baixa (~300 MB) e extrai.
#>

[CmdletBinding()]
param(
  # Versão dos binários (major.minor-build). Atualize se quiser outra.
  [string]$Version = '17.6-1'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$toolsDir = Join-Path $root 'tools'
$pgRoot = Join-Path $toolsDir 'pgsql'
$pgDumpExe = Join-Path $pgRoot 'bin\pg_dump.exe'

if (Test-Path $pgDumpExe) {
  Write-Host "pg_dump portátil já existe em: $pgDumpExe" -ForegroundColor Green
  & $pgDumpExe --version
  exit 0
}

if (-not (Test-Path $toolsDir)) { New-Item -ItemType Directory -Path $toolsDir | Out-Null }

$url = "https://get.enterprisedb.com/postgresql/postgresql-$Version-windows-x64-binaries.zip"
$zip = Join-Path $toolsDir 'pgsql.zip'

Write-Host "Baixando binários do PostgreSQL ($Version)... (~300 MB, pode demorar)" -ForegroundColor Cyan
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

Write-Host "Extraindo..." -ForegroundColor Cyan
# O zip extrai numa pasta raiz chamada 'pgsql'.
Expand-Archive -Path $zip -DestinationPath $toolsDir -Force
Remove-Item $zip

if (-not (Test-Path $pgDumpExe)) {
  Write-Error "Extração concluída mas pg_dump.exe não encontrado em $pgDumpExe."
  exit 1
}

# Enxuga: mantém só a pasta bin e lib (necessárias pro pg_dump rodar).
foreach ($sub in @('doc', 'include', 'pgAdmin 4', 'share', 'symbols', 'stackbuilder', 'installer')) {
  $p = Join-Path $pgRoot $sub
  if (Test-Path $p) { Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host "pg_dump portátil pronto:" -ForegroundColor Green
& $pgDumpExe --version
