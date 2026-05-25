Get-ChildItem .kiro/specs -Directory | ForEach-Object {
  $tasks = Join-Path $_.FullName 'tasks.md'
  if (Test-Path $tasks) {
    $c = Get-Content $tasks -Raw
    $p = ([regex]::Matches($c, '- \[ \]')).Count
    $opt = ([regex]::Matches($c, '- \[ \]\*')).Count
    $req = $p - $opt
    Write-Output ("{0}: pendentes_obrigatorios={1} pendentes_opcionais={2}" -f $_.Name, $req, $opt)
  }
}
