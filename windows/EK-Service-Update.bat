@echo off
chcp 65001 >nul
title EK-Service – Update
if /i "%~1"=="--aus-temp" goto :start
rem Kopie im Temp-Ordner ausführen, damit sich die Datei beim Update nicht selbst überschreibt
set "EK_DIR=%~dp0"
set "EK_ORIG=%~f0"
copy /y "%~f0" "%TEMP%\ek-service-update.bat" >nul
call "%TEMP%\ek-service-update.bat" --aus-temp & goto :ende
:start
set "EK_SELF=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText($env:EK_SELF,[Text.Encoding]::UTF8); $m='#=='+'PS==#'; iex $s.Substring($s.IndexOf($m))"
set "EK_RC=%ERRORLEVEL%"
if not "%EK_UPDATE_YES%"=="1" pause
exit /b %EK_RC%
:ende
exit /b %ERRORLEVEL%

#==PS==#
# ---------------------------------------------------------------------------
#  EK-Service – geführtes Update (Windows 10/11, PowerShell 5.1+)
#  Spielt ein: Programmordner (ZIP), Installer (EK-Service-Setup.exe) oder alte Einzel-EXE.
#  Sichert vorher Datenbank und alte Version, stellt bei Fehlern den alten Stand wieder her.
#  Unbeaufsichtigt: EK_UPDATE_SOURCE=<Link|Datei>  EK_UPDATE_YES=1
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

$Dir       = $env:EK_DIR.TrimEnd('\')
$Exe       = Join-Path $Dir 'EK-Service.exe'
$LinkFile  = Join-Path $Dir 'update-link.txt'
$OldDir    = Join-Path $Dir 'alte-versionen'
$AppData   = Join-Path $env:APPDATA 'EK-Service\daten'
$Installed = Join-Path $env:LOCALAPPDATA 'Programs\EK-Service\EK-Service.exe'
$Auto      = ($env:EK_UPDATE_YES -eq '1')
$Stamp     = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'

function Say([string]$t, [string]$c = 'Gray') { Write-Host $t -ForegroundColor $c }
function Ok([string]$t)   { Say "  [OK] $t" 'Green' }
function Warn([string]$t) { Say "  [!]  $t" 'Yellow' }
function Fail([string]$t) { Say "  [X]  $t" 'Red' }
function Ask([string]$q, [string]$default = '') {
  if ($Auto) { return $default }
  $hint = ''; if ($default) { $hint = " [$default]" }
  $a = Read-Host "  $q$hint"
  if ([string]::IsNullOrWhiteSpace($a)) { return $default }
  return $a.Trim()
}
function YesNo([string]$q, [bool]$default = $true) {
  if ($Auto) { return $default }
  $d = 'n'; if ($default) { $d = 'j' }
  return ((Ask "$q (j/n)" $d) -match '^(j|ja|y|yes)$')
}
function VersionOf([string]$p) {
  if (-not (Test-Path $p)) { return 'nicht vorhanden' }
  $i = Get-Item $p
  $v = $i.VersionInfo.ProductVersion
  if (-not $v -or $i.VersionInfo.ProductName -ne 'EK-Service') { $v = 'ältere Version' }
  return "$v  (Datei vom $($i.LastWriteTime.ToString('dd.MM.yyyy HH:mm')))"
}
function Mode {
  if (Test-Path (Join-Path $Dir 'Uninstall EK-Service.exe')) { return 'installiert' }
  if (Test-Path (Join-Path $Dir 'resources\app.asar')) { return 'ordner' }
  if (Test-Path $Exe) { return 'exe' }
  return 'leer'
}
function Banner {
  if (-not $Auto) { Clear-Host }
  Say ''
  Say '  ╔══════════════════════════════════════════════╗' 'Cyan'
  Say '  ║          EK-Service  ·  Update               ║' 'Cyan'
  Say '  ╚══════════════════════════════════════════════╝' 'Cyan'
  Say ''
  Say "  Ordner:               $Dir"
  Say "  Installierte Version: $(VersionOf $Exe)"
  Say ''
}
function Normalize-Link([string]$u) {
  $u = $u.Trim().Trim('"')
  if ($u -match 'dropbox\.com') {
    if ($u -match '[?&]dl=0') { $u = $u -replace '([?&])dl=0', '${1}dl=1' }
    elseif ($u -notmatch '[?&]dl=1') { if ($u.Contains('?')) { $u += '&dl=1' } else { $u += '?dl=1' } }
  }
  if ($u -match 'drive\.google\.com/file/d/([^/?]+)') { $u = "https://drive.google.com/uc?export=download&id=$($Matches[1])" }
  if ($u -match 'drive\.google\.com/open\?id=([^&]+)') { $u = "https://drive.google.com/uc?export=download&id=$($Matches[1])" }
  if ($u -match 'sharepoint\.com|onedrive\.live\.com') { if ($u -notmatch '[?&]download=1') { if ($u.Contains('?')) { $u += '&download=1' } else { $u += '?download=1' } } }
  return $u
}
function Download([string]$url, [string]$target) {
  Say '  Lade herunter …'
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($curl) {
    & curl.exe -L --fail --retry 2 --connect-timeout 20 --progress-bar -o $target $url
    if ($LASTEXITCODE -ne 0) { throw "Download fehlgeschlagen (curl-Code $LASTEXITCODE). Link prüfen oder Internetverbindung testen." }
  } else { Invoke-WebRequest -Uri $url -OutFile $target -UseBasicParsing }
  Ok "Heruntergeladen: $([math]::Round((Get-Item $target).Length / 1MB, 1)) MB"
}
function Is-Setup([string]$p) {
  if ((Split-Path $p -Leaf) -like '*Setup*') { return $true }
  $fs = [IO.File]::OpenRead($p); $n = [Math]::Min(4MB, $fs.Length); $b = New-Object byte[] $n; [void]$fs.Read($b, 0, $n); $fs.Close()
  return ([Text.Encoding]::ASCII.GetString($b) -match 'Nullsoft')
}

# Download/Datei prüfen → @{ Type = 'ordner'|'setup'|'exe'; Path; Version }
function Get-Payload([string]$file, [string]$work) {
  if (-not (Test-Path $file)) { throw "Datei nicht gefunden: $file" }
  $fs = [IO.File]::OpenRead($file); $head = New-Object byte[] 2; [void]$fs.Read($head, 0, 2); $fs.Close()
  $sig = [Text.Encoding]::ASCII.GetString($head)
  $p = $null
  if ($sig -eq 'PK') {
    Say '  Entpacke ZIP …'
    $x = Join-Path $work 'zip'
    New-Item -ItemType Directory -Force -Path $x | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($file, $x)
    $asar = Get-ChildItem -Path $x -Recurse -Filter 'app.asar' | Where-Object { $_.Directory.Name -eq 'resources' } | Select-Object -First 1
    if ($asar -and (Test-Path (Join-Path $asar.Directory.Parent.FullName 'EK-Service.exe'))) {
      $root = $asar.Directory.Parent.FullName
      $p = @{ Type = 'ordner'; Path = $root; Exe = (Join-Path $root 'EK-Service.exe') }
    } else {
      $setup = Get-ChildItem -Path $x -Recurse -Filter '*.exe' | Where-Object { $_.Name -like 'EK-Service*Setup*.exe' } | Select-Object -First 1
      $single = Get-ChildItem -Path $x -Recurse -Filter '*.exe' | Where-Object { $_.Name -like 'EK-Service*.exe' } | Select-Object -First 1
      if ($setup) { $p = @{ Type = 'setup'; Path = $setup.FullName; Exe = $setup.FullName } }
      elseif ($single) { $p = @{ Type = 'exe'; Path = $single.FullName; Exe = $single.FullName } }
      else { throw 'In der ZIP-Datei ist kein EK-Service-Programm enthalten.' }
    }
  } elseif ($sig -eq 'MZ') {
    if (Is-Setup $file) { $p = @{ Type = 'setup'; Path = $file; Exe = $file } } else { $p = @{ Type = 'exe'; Path = $file; Exe = $file } }
  } else {
    throw 'Der Download ist keine EXE- oder ZIP-Datei (vermutlich eine Webseite). Bitte einen direkten Download-Link verwenden – bei OneDrive/Google Drive die Freigabe auf „Jeder mit dem Link“ stellen.'
  }
  $vi = (Get-Item $p.Exe).VersionInfo
  if ($p.Type -ne 'ordner' -and (Get-Item $p.Exe).Length -lt 20MB) { throw 'Die Datei ist zu klein – der Download ist vermutlich unvollständig.' }
  $isEk = ($vi.ProductName -eq 'EK-Service') -or ($p.Type -eq 'setup' -and ("$($vi.ProductName) $($vi.FileDescription) $(Split-Path $p.Path -Leaf)" -match 'EK-Service'))
  if (-not $isEk) {
    Warn 'Die Datei trägt keine EK-Service-Versionsangabe.'
    if (-not (YesNo 'Trotzdem installieren?' $false)) { throw 'Abgebrochen.' }
  } else {
    $art = @{ ordner = 'Programmordner'; setup = 'Installer'; exe = 'Einzel-EXE (alt)' }[$p.Type]
    Ok "Neue Version erkannt: $($vi.ProductVersion)  ($art)"
  }
  return $p
}

function Get-Running([string]$path) {
  return @(Get-Process -Name 'EK-Service' -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -eq $path } catch { $true } })
}
function Wait-Closed([string]$path) {
  if ((Get-Running $path).Count -eq 0) { return }
  Warn 'EK-Service ist noch geöffnet. Bitte das Programmfenster schließen …'
  for ($i = 0; $i -lt 60 -and (Get-Running $path).Count -gt 0; $i++) { Start-Sleep -Seconds 1 }
  if ((Get-Running $path).Count -gt 0) {
    if (YesNo 'EK-Service läuft weiterhin. Jetzt beenden?' $true) { Get-Running $path | Stop-Process -Force; Start-Sleep -Seconds 2 }
    else { throw 'Update abgebrochen – EK-Service läuft noch.' }
  }
  Ok 'EK-Service ist geschlossen.'
}
function Backup-Data {
  $db = Join-Path $AppData 'ek-service.db'
  if (-not (Test-Path $db)) { $db = Join-Path $Dir 'ek-data\ek-service.db' }
  if (-not (Test-Path $db)) { return }
  $bdir = Join-Path (Split-Path $db) 'backups'
  New-Item -ItemType Directory -Force -Path $bdir | Out-Null
  $target = Join-Path $bdir "ek-service_${Stamp}_vorupdate.db"
  Copy-Item $db $target -Force
  foreach ($ext in '-wal', '-shm') { if (Test-Path "$db$ext") { Copy-Item "$db$ext" "$target$ext" -Force } }
  Ok "Datenbank gesichert: $(Split-Path $target -Leaf)"
}
function Robo([string]$from, [string]$to) {
  & robocopy.exe $from $to /MIR /R:3 /W:2 /NFL /NDL /NJH /NJS /NP /XD 'alte-versionen' 'ek-data' /XF 'update-link.txt' | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Kopieren fehlgeschlagen (robocopy-Code $LASTEXITCODE)." }
}
function Backup-Program {
  New-Item -ItemType Directory -Force -Path $OldDir | Out-Null
  $m = Mode
  if ($m -eq 'ordner') {
    $dest = Join-Path $OldDir "EK-Service_$Stamp"
    Robo $Dir $dest
    Get-ChildItem $OldDir -Directory -Filter 'EK-Service_*' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 2 | Remove-Item -Recurse -Force
    Ok "Alte Version gesichert: alte-versionen\$(Split-Path $dest -Leaf)"
    return @{ Type = 'ordner'; Path = $dest }
  } elseif ($m -eq 'exe') {
    $dest = Join-Path $OldDir "EK-Service_$Stamp.exe"
    Copy-Item $Exe $dest -Force
    Get-ChildItem $OldDir -Filter 'EK-Service_*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 3 | Remove-Item -Force
    Ok "Alte Version gesichert: alte-versionen\$(Split-Path $dest -Leaf)"
    return @{ Type = 'exe'; Path = $dest }
  }
  return $null
}

function Install([hashtable]$p) {
  $before = VersionOf $Exe
  $runExe = $Exe
  if ($p.Type -eq 'setup') {
    Wait-Closed $Installed
    Wait-Closed $Exe
    Backup-Data
    New-Item -ItemType Directory -Force -Path $OldDir | Out-Null
    $keep = Join-Path $OldDir ("EK-Service-Setup_$Stamp.exe")
    Copy-Item $p.Path $keep -Force
    Get-ChildItem $OldDir -Filter 'EK-Service-Setup_*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 2 | Remove-Item -Force
    Say '  Installiere …'
    $proc = Start-Process -FilePath $p.Path -ArgumentList '/S' -PassThru -Wait
    if ($proc.ExitCode -ne 0 -or -not (Test-Path $Installed)) { throw "Die Installation ist fehlgeschlagen (Code $($proc.ExitCode))." }
    $runExe = $Installed
  } else {
    if ($p.Type -eq 'exe' -and (Mode) -in @('ordner', 'installiert')) { throw 'Das ist eine alte Einzel-EXE-Version. Bitte den aktuellen Programmordner (ZIP) oder Installer verwenden.' }
    if ((Mode) -eq 'installiert') { throw 'EK-Service ist per Installer installiert – bitte den Installer (EK-Service-Setup.exe) für das Update verwenden.' }
    Wait-Closed $Exe
    Backup-Data
    $old = Backup-Program
    try {
      if ($p.Type -eq 'ordner') { Robo $p.Path $Dir }
      else { Copy-Item $p.Path $Exe -Force }
    } catch {
      if ($old -and $old.Type -eq 'ordner') { Robo $old.Path $Dir } elseif ($old) { Copy-Item $old.Path $Exe -Force }
      throw "Austausch fehlgeschlagen – alter Stand wiederhergestellt. ($($_.Exception.Message))"
    }
    try { Get-ChildItem $Dir -Recurse -File -Filter '*.exe' | Unblock-File } catch { }
  }
  Say ''
  Say '  ────────────────────────────────────────────────' 'Green'
  Ok  'Update erfolgreich!'
  Say "     vorher:  $before"
  Say "     jetzt:   $(VersionOf $runExe)" 'Green'
  Say '  ────────────────────────────────────────────────' 'Green'
  if (-not $Auto -and (YesNo 'EK-Service jetzt starten?' $true)) { Start-Process -FilePath $runExe -WorkingDirectory (Split-Path $runExe) }
}

function New-Work { $w = Join-Path $env:TEMP "ek-update-$Stamp"; New-Item -ItemType Directory -Force -Path $w | Out-Null; return $w }

function Update-FromLink {
  $last = ''
  if (Test-Path $LinkFile) { $last = (Get-Content $LinkFile -Raw -Encoding UTF8).Trim() }
  if ($env:EK_UPDATE_SOURCE) { $url = $env:EK_UPDATE_SOURCE } else {
    Say '  Download-Link zur neuen Version einfügen (ZIP oder Setup-EXE).'
    Say '  Rechtsklick oder Strg+V fügt ein.' 'DarkGray'
    if ($last) { Say "  Enter = zuletzt verwendeter Link: $last" 'DarkGray' }
    $url = Ask 'Link' $last
  }
  if (-not $url) { throw 'Kein Link eingegeben.' }
  $url = Normalize-Link $url
  if ($url -notmatch '^https?://') { throw 'Das ist kein Internet-Link (muss mit http:// oder https:// beginnen).' }
  $work = New-Work
  try {
    $name = 'download.bin'
    if ($url -match 'Setup[^/?]*\.exe') { $name = 'EK-Service-Setup.exe' }
    $file = Join-Path $work $name
    Download $url $file
    Install (Get-Payload $file $work)
    Set-Content -Path $LinkFile -Value $url -Encoding UTF8
  } finally { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }
}

function Update-FromFile {
  if ($env:EK_UPDATE_SOURCE) { $p = $env:EK_UPDATE_SOURCE } else {
    Say '  Die heruntergeladene ZIP- oder Setup-Datei jetzt in dieses Fenster ziehen'
    Say '  (oder den Pfad eintippen) und Enter drücken.' 'DarkGray'
    $dl = Join-Path $env:USERPROFILE 'Downloads'
    $cand = Get-ChildItem $dl -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'EK-Service*.zip' -or $_.Name -like 'EK-Service*.exe' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $def = ''
    if ($cand) { $def = $cand.FullName; Say "  Enter = neueste Datei im Download-Ordner: $($cand.Name)" 'DarkGray' }
    $p = Ask 'Datei' $def
  }
  $p = $p.Trim().Trim('"')
  if (-not $p) { throw 'Keine Datei angegeben.' }
  $work = New-Work
  try { Install (Get-Payload $p $work) } finally { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }
}

function Restore-Previous {
  $list = @(Get-ChildItem $OldDir -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'EK-Service_*' -or $_.Name -like 'EK-Service-Setup_*' } | Sort-Object LastWriteTime -Descending)
  if ($list.Count -eq 0) { throw 'Es gibt noch keine gesicherten älteren Versionen.' }
  Say '  Gesicherte Versionen:'
  for ($i = 0; $i -lt $list.Count; $i++) {
    $e = $list[$i]; $v = if ($e.PSIsContainer) { VersionOf (Join-Path $e.FullName 'EK-Service.exe') } else { VersionOf $e.FullName }
    Say "   [$($i + 1)] $($e.Name)  –  $v"
  }
  $n = [int](Ask 'Welche wiederherstellen? (Nummer)' '1')
  if ($n -lt 1 -or $n -gt $list.Count) { throw 'Ungültige Auswahl.' }
  Warn 'Die Daten bleiben unverändert. Eine Datenbanksicherung von vor dem Update liegt unter backups (Wiederherstellung im Programm unter System → Datensicherung).'
  if (-not (YesNo 'Jetzt wiederherstellen?' $true)) { throw 'Abgebrochen.' }
  $e = $list[$n - 1]
  $work = New-Work
  try {
    if ($e.PSIsContainer) {
      $tmp = Join-Path $work 'ordner'; Robo $e.FullName $tmp
      Install @{ Type = 'ordner'; Path = $tmp; Exe = (Join-Path $tmp 'EK-Service.exe') }
    } else {
      $tmp = Join-Path $work $e.Name; Copy-Item $e.FullName $tmp -Force
      Install (Get-Payload $tmp $work)
    }
  } finally { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }
}

function New-UpdateShortcut {
  $ws = New-Object -ComObject WScript.Shell
  $lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'EK-Service aktualisieren.lnk'
  $s = $ws.CreateShortcut($lnk)
  $s.TargetPath = $env:EK_ORIG
  $s.WorkingDirectory = $Dir
  if (Test-Path $Exe) { $s.IconLocation = "$Exe,0" }
  $s.Description = 'EK-Service aktualisieren'
  $s.Save()
  Ok 'Desktop-Verknüpfung „EK-Service aktualisieren“ angelegt.'
}

# ------------------------------- Ablauf -------------------------------------
try {
  Banner
  if ($env:EK_UPDATE_SOURCE) {
    if ($env:EK_UPDATE_SOURCE -match '^https?://') { Update-FromLink } else { Update-FromFile }
    exit 0
  }
  Say '  Was möchtest du tun?' 'White'
  Say '   [1] Update über Download-Link  (Link einfügen)'
  Say '   [2] Update aus heruntergeladener Datei  (ZIP/Setup ins Fenster ziehen)'
  Say '   [3] Vorherige Version wiederherstellen'
  Say '   [4] Desktop-Verknüpfung „EK-Service aktualisieren“ anlegen'
  Say '   [0] Beenden'
  Say ''
  $c = Ask 'Auswahl' '1'
  Say ''
  switch ($c) {
    '1' { Update-FromLink }
    '2' { Update-FromFile }
    '3' { Restore-Previous }
    '4' { New-UpdateShortcut }
    default { Say '  Kein Update durchgeführt.' }
  }
  exit 0
} catch {
  Say ''
  Fail $_.Exception.Message
  Say '  Es wurde nichts verändert bzw. der vorherige Stand wiederhergestellt.' 'DarkGray'
  exit 1
}
