$path = '.kiro/specs/admin-financeiro/requirements.md'
$bytes = [System.IO.File]::ReadAllBytes($path)
$first = $bytes[0..15]
Write-Output ($first | ForEach-Object { '{0:X2}' -f $_ })
Write-Output '---'
$text = [System.IO.File]::ReadAllText($path)
Write-Output ('Length chars: ' + $text.Length)
Write-Output ('First 100: ' + $text.Substring(0, [Math]::Min(100, $text.Length)))
