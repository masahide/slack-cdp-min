param(
  [ValidateSet('setup','remove')]
  [string]$Mode = 'setup',
  [int]$Port = 9222
)

# IP of vEthernet (WSL)
$nic = Get-NetIPConfiguration |
  Where-Object { $_.InterfaceAlias -like 'vEthernet (WSL*)' -and $_.IPv4Address }
$hostIp = $nic.IPv4Address.IPAddress | Select-Object -First 1
if (-not $hostIp) { Write-Error "Failed to obtain WSL host IP."; exit 1 }

# Start iphlpsvc (required for portproxy)
$svc = Get-Service iphlpsvc -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -ne 'Running') { Start-Service iphlpsvc }

$ruleName = "CDP $Port from WSL"

if ($Mode -eq 'remove') {
  Write-Host ("[INFO] Removing: {0}:{1}" -f $hostIp, $Port)
  & netsh interface portproxy delete v4tov4 listenaddress=$hostIp listenport=$Port | Out-Null
  & netsh advfirewall firewall delete rule name="$ruleName" | Out-Null
  Write-Host "[OK] Removed"
  exit 0
}

Write-Host ("[INFO] Setting: {0}:{1} -> 127.0.0.1:{1}" -f $hostIp, $Port)

# remove existing
& netsh interface portproxy delete v4tov4 listenaddress=$hostIp listenport=$Port | Out-Null

# add
& netsh interface portproxy add v4tov4 listenaddress=$hostIp listenport=$Port connectaddress=127.0.0.1 connectport=$Port | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Error "Failed to create portproxy"; exit 1 }

# Firewall rule (allow only WSL range 172.16.0.0/12)
& netsh advfirewall firewall delete rule name="$ruleName" | Out-Null
& netsh advfirewall firewall add rule name="$ruleName" dir=in action=allow protocol=TCP localip=$hostIp localport=$Port remoteip=172.16.0.0/12 | Out-Null

Write-Host "[OK] Ready"
& netsh interface portproxy show all
