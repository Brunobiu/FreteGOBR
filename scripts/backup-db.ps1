<#
.SYNOPSIS
  Backup manual completo do banco Supabase (schema + dados) para um arquivo
  .sql local, comprimido em .gz. Usa um pg_dump PORTÁTIL em ./tools/
  (não requer instalação, admin ou Docker).

.DESCRIPTION
  Na primeira vez, rode `./scripts/setup-pgdump.ps1` para baixar o pg_dump
  portátil. Depois, rode este script sempre que quiser um backup.

  A connection string NUNCA fica hardcoded. O script a lê, nesta ordem:
    1. Variável de ambiente $env:SUPABASE_DB_URL
    2. Arquivo local Credencial/supabase_db_url.txt (gitignored)

  Onde pegar a connection string:
    Painel Supabase -> botão "Connect" -> aba "Direct" -> "Session pooler"
    (porta 5432). Troque [YOUR-PASSWORD] pela senha do banco.

  O arquivo .gz fica em ./backups/ (pasta gitignored — NUNCA vai ao Git).

.EXAMPLE
  ./scripts/backup-db.ps1
#>

[CmdletBinding()]
param(
  # Quantos backups manter em ./backups (os mais antigos são apagados).
  [int]$KeepLast = 10
)

$ErrorActionPreference = 'Stop'

# Raiz do projeto (um nível acima de /scripts).
$root = Split-Path -Parent $PSScriptRoot
$backupDir = Join-Path $root 'backups'
$credFile = Join-Path $root 'Credencial\supabase_db_url.txt'
$pgDumpExe = Join-Path $root 'tools\pgsql\bin\pg_dump.exe'

# ── 1. Verificar pg_dump portátil ──────────────────────────────────────
if (-not (Test-Path $pgDumpExe)) {
  Write-Error @"
pg_dump portátil não encontrado em tools\pgsql\bin\pg_dump.exe.
Rode uma vez para baixá-lo:
  ./scripts/setup-pgdump.ps1
"@
  exit 1
}

# ── 2. Obter a connection string (env > arquivo) ───────────────────────
$dbUrl = $env:SUPABASE_DB_URL
if ([string]::IsNullOrWhiteSpace($dbUrl)) {
  if (Test-Path $credFile) {
    $dbUrl = (Get-Content $credFile -Raw).Trim()
  }
}
if ([string]::IsNullOrWhiteSpace($dbUrl)) {
  Write-Error @"
Connection string não encontrada.
Defina a variável de ambiente:
  `$env:SUPABASE_DB_URL = "postgresql://postgres.<ref>:<senha>@...:5432/postgres"
OU crie o arquivo (gitignored):
  Credencial\supabase_db_url.txt
contendo a connection string numa única linha.
"@
  exit 1
}
if ($dbUrl -match '\[YOUR-PASSWORD\]' -or $dbUrl -match '\[' -or $dbUrl -match '\]') {
  Write-Error "A connection string ainda contém [YOUR-PASSWORD]/colchetes. Substitua pela senha real do banco."
  exit 1
}

# ── 2b. Quebrar a URL em partes (evita problema com senha que tem @ : / #) ─
# Em vez de passar a senha dentro da URL (onde caracteres especiais quebram
# o parsing), separamos usuário/host/porta/banco e passamos a senha via
# variável de ambiente PGPASSWORD. Assim a senha pode ter qualquer caractere.
# Formato esperado: postgresql://USUARIO:SENHA@HOST:PORTA/BANCO
$re = '^postgres(?:ql)?://([^:]+):(.*)@([^:/@]+):(\d+)/(.+)$'
$m = [regex]::Match($dbUrl, $re)
if (-not $m.Success) {
  Write-Error "Não consegui interpretar a connection string. Formato esperado: postgresql://usuario:senha@host:porta/banco"
  exit 1
}
$dbUser = $m.Groups[1].Value
$dbPass = $m.Groups[2].Value
$dbHost = $m.Groups[3].Value
$dbPort = $m.Groups[4].Value
# Remove querystring (ex: ?sslmode=require) do nome do banco, se houver.
$dbName = ($m.Groups[5].Value -split '\?')[0]

# ── 3. Preparar pasta e nomes ──────────────────────────────────────────
if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }
$timestamp = Get-Date -Format 'yyyyMMdd_HHmm'
$outFile = Join-Path $backupDir "db_backup_$timestamp.sql"
$gzFile = "$outFile.gz"

# ── 4. Gerar o dump ────────────────────────────────────────────────────
# --no-owner / --no-privileges: backup portável (restaura em qualquer projeto).
# A senha vai via PGPASSWORD (não na linha de comando) pra suportar caracteres
# especiais e não vazar em logs de processo. sslmode=require: Supabase exige SSL.
# stderr do pg_dump é redirecionado para não abortar o script ($ErrorAction=Stop).
Write-Host "Gerando backup do banco..." -ForegroundColor Cyan
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$env:PGPASSWORD = $dbPass
$env:PGSSLMODE = 'require'
& $pgDumpExe --no-owner --no-privileges `
  --host=$dbHost --port=$dbPort --username=$dbUser --dbname=$dbName `
  --file="$outFile" 2>&1 | ForEach-Object { "$_" }
$code = $LASTEXITCODE
Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:\PGSSLMODE -ErrorAction SilentlyContinue
$ErrorActionPreference = $prevEAP

if ($code -ne 0 -or -not (Test-Path $outFile) -or (Get-Item $outFile).Length -eq 0) {
  Write-Error "pg_dump falhou (exit $code) ou gerou arquivo vazio. Verifique a connection string."
  if (Test-Path $outFile) { Remove-Item $outFile }
  exit 1
}

# ── 5. Comprimir ───────────────────────────────────────────────────────
Write-Host "Comprimindo..." -ForegroundColor Cyan
$inStream = [System.IO.File]::OpenRead($outFile)
$outStream = [System.IO.File]::Create($gzFile)
$gzStream = New-Object System.IO.Compression.GzipStream($outStream, [System.IO.Compression.CompressionMode]::Compress)
$inStream.CopyTo($gzStream)
$gzStream.Close(); $outStream.Close(); $inStream.Close()
Remove-Item $outFile  # mantém só o .gz

$sizeMB = [Math]::Round((Get-Item $gzFile).Length / 1MB, 2)
Write-Host "Backup criado: $gzFile ($sizeMB MB)" -ForegroundColor Green

# ── 6. Rotação: manter só os N mais recentes ───────────────────────────
$all = Get-ChildItem $backupDir -Filter 'db_backup_*.sql.gz' | Sort-Object LastWriteTime -Descending
if ($all.Count -gt $KeepLast) {
  $all | Select-Object -Skip $KeepLast | ForEach-Object {
    Remove-Item $_.FullName
    Write-Host "Removido backup antigo: $($_.Name)" -ForegroundColor DarkGray
  }
}

Write-Host "`nConcluído. Guarde este .gz num lugar seguro (nuvem pessoal/HD externo)." -ForegroundColor Green
