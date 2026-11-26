@echo off
chcp 65001 >nul
title EK-Service – Update
set "EK_SELF=%~f0"
set "EK_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText($env:EK_SELF,[Text.Encoding]::UTF8); $m='#=='+'PS==#'; iex $s.Substring($s.IndexOf($m))"
set "EK_RC=%ERRORLEVEL%"
if not "%EK_UPDATE_YES%"=="1" pause
exit /b %EK_RC%

#==PS==#
# ---------------------------------------------------------------------------
#  EK-Service – geführtes Update (Windows 10/11, PowerShell 5.1+)
#  Liegt neben EK-Service.exe. Sichert alte Version + Datenbank, ersetzt die EXE,
#  stellt bei Fehlern automatisch den alten Zustand wieder her.
#  Unbeaufsichtigt: EK_UPDATE_SOURCE=<Link|Datei>  EK_UPDATE_YES=1
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

$Dir      = $env:EK_DIR.TrimEnd('\')
$Exe      = Join-Path $Dir 'EK-Service.exe'
$LinkFile = Join-Path $Dir 'update-link.txt'
$OldDir   = Join-Path $Dir 'alte-versionen'
$DataDir  = Join-Path $Dir 'ek-data'
$Auto     = ($env:EK_UPDATE_YES -eq '1')
$Stamp    = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'

function Say([string]$t, [string]$c = 'Gray') { Write-Host $t -ForegroundColor $c }
function Ok([string]$t)   { Say "  [OK] $t" 'Green' }
function Warn([string]$t) { Say "  [!]  $t" 'Yellow' }
function Fail([string]$t) { Say "  [X]  $t" 'Red' }

function Ask([string]$q, [string]$default = '') {
  if ($Auto) { return $default }
  $hint = ''
  if ($default) { $hint = " [$default]" }
  $a = Read-Host "  $q$hint"
  if ([string]::IsNullOrWhiteSpace($a)) { return $default }
  return $a.Trim()
}
function YesNo([string]$q, [bool]$default = $true) {
  if ($Auto) { return $default }
  $d = 'n'
  if ($default) { $d = 'j' }
  $a = Ask "$q (j/n)" $d
  return ($a -match '^(j|ja|y|yes)$')
}

function VersionOf([string]$p) {
  if (-not (Test-Path $p)) { return 'nicht installiert' }
  $i = Get-Item $p
  $v = $i.VersionInfo.ProductVersion
  if (-not $v -or $i.VersionInfo.ProductName -ne 'EK-Service') { $v = 'ältere Version' }
  return "$v  (Datei vom $($i.LastWriteTime.ToString('dd.MM.yyyy HH:mm')))"
}

function Banner {
  if (-not $Auto) { Clear-Host }
  Say ''
  Say '  ╔══════════════════════════════════════════════╗' 'Cyan'
  Say '  ║          EK-Service  ·  Update               ║' 'Cyan'
  Say '  ╚══════════════════════════════════════════════╝' 'Cyan'
  Say ''
  Say "  Ordner:              $Dir"
  Say "  Installierte Version: $(VersionOf $Exe)"
  Say ''
}

# Teilen-Links in Direkt-Download-Links umwandeln
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
  Say "  Lade herunter …"
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($curl) {
    & curl.exe -L --fail --retry 2 --connect-timeout 20 --progress-bar -o $target $url
    if ($LASTEXITCODE -ne 0) { throw "Download fehlgeschlagen (curl-Code $LASTEXITCODE). Link prüfen oder Internetverbindung testen." }
  } else {
    Invoke-WebRequest -Uri $url -OutFile $target -UseBasicParsing
  }
  $mb = [math]::Round((Get-Item $target).Length / 1MB, 1)
  Ok "Heruntergeladen: $mb MB"
}

# ZIP oder EXE prüfen und die neue EK-Service.exe bereitstellen
function Get-NewExe([string]$file, [string]$work) {
  if (-not (Test-Path $file)) { throw "Datei nicht gefunden: $file" }
  $fs = [IO.File]::OpenRead($file); $head = New-Object byte[] 2; [void]$fs.Read($head, 0, 2); $fs.Close()
  $sig = [Text.Encoding]::ASCII.GetString($head)
  if ($sig -eq 'PK') {
    Say '  Entpacke ZIP …'
    $x = Join-Path $work 'zip'
    Expand-Archive -Path $file -DestinationPath $x -Force
    $found = Get-ChildItem -Path $x -Recurse -Filter '*.exe' | Where-Object { $_.Name -like 'EK-Service*.exe' } | Select-Object -First 1
    if (-not $found) { throw 'In der ZIP-Datei ist keine EK-Service.exe enthalten.' }
    $script:NewDocs = Get-ChildItem -Path $x -Recurse -Include 'ANLEITUNG.md', 'EK-Service-Update.bat' -ErrorAction SilentlyContinue
    $newExe = $found.FullName
  } elseif ($sig -eq 'MZ') {
    $newExe = $file
  } else {
    throw 'Der Download ist keine EXE- oder ZIP-Datei (vermutlich eine Webseite). Bitte einen direkten Download-Link verwenden – bei OneDrive/Google Drive die Freigabe auf „Jeder mit dem Link“ stellen.'
  }
  $size = (Get-Item $newExe).Length
  if ($size -lt 20MB) { throw "Die EXE ist mit $([math]::Round($size / 1MB, 1)) MB zu klein – der Download ist vermutlich unvollständig." }
  $vi = (Get-Item $newExe).VersionInfo
  if ($vi.ProductName -ne 'EK-Service') {
    Warn 'Die Datei trägt keine EK-Service-Versionsangabe.'
    if (-not (YesNo 'Trotzdem installieren?' $false)) { throw 'Abgebrochen.' }
  } else { Ok "Neue Version erkannt: $($vi.ProductVersion)" }
  return $newExe
}

function Get-Running {
  return @(Get-Process -Name 'EK-Service' -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -eq $Exe } catch { $true } })
}

function Wait-Closed {
  if ((Get-Running).Count -eq 0) { return }
  Warn 'EK-Service ist noch geöffnet. Bitte das Programmfenster schließen …'
  for ($i = 0; $i -lt 60 -and (Get-Running).Count -gt 0; $i++) { Start-Sleep -Seconds 1 }
  if ((Get-Running).Count -gt 0) {
    if (YesNo 'EK-Service läuft weiterhin (evtl. Handy im WLAN verbunden). Jetzt beenden?' $true) {
      Get-Running | Stop-Process -Force
      Start-Sleep -Seconds 2
    } else { throw 'Update abgebrochen – EK-Service läuft noch.' }
  }
  Ok 'EK-Service ist geschlossen.'
}

function Backup-Current {
  if (Test-Path $Exe) {
    New-Item -ItemType Directory -Force -Path $OldDir | Out-Null
    $script:OldCopy = Join-Path $OldDir "EK-Service_$Stamp.exe"
    Copy-Item $Exe $script:OldCopy -Force
    Ok "Alte Version gesichert: alte-versionen\$(Split-Path $script:OldCopy -Leaf)"
    Get-ChildItem $OldDir -Filter 'EK-Service_*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 3 | Remove-Item -Force
  }
  $db = Join-Path $DataDir 'ek-service.db'
  if (Test-Path $db) {
    $bdir = Join-Path $DataDir 'backups'
    New-Item -ItemType Directory -Force -Path $bdir | Out-Null
    $target = Join-Path $bdir "ek-service_${Stamp}_vorupdate.db"
    Copy-Item $db $target -Force
    foreach ($ext in '-wal', '-shm') { if (Test-Path "$db$ext") { Copy-Item "$db$ext" "$target$ext" -Force } }
    Ok "Datenbank gesichert: ek-data\backups\$(Split-Path $target -Leaf)"
  }
}

function Install-Exe([string]$newExe) {
  $before = VersionOf $Exe
  Wait-Closed
  Backup-Current
  $done = $false
  for ($i = 0; $i -lt 5 -and -not $done; $i++) {
    try { Copy-Item $newExe $Exe -Force; $done = $true } catch { Start-Sleep -Seconds 2 }
  }
  if (-not $done) {
    if ($script:OldCopy) { Copy-Item $script:OldCopy $Exe -Force -ErrorAction SilentlyContinue }
    throw 'Die EXE konnte nicht ersetzt werden (Datei gesperrt?). Der alte Stand wurde wiederhergestellt.'
  }
  try { Unblock-File $Exe } catch { }
  if ($script:NewDocs) {
    foreach ($d in $script:NewDocs) {
      if ($d.Name -eq 'EK-Service-Update.bat') { Copy-Item $d.FullName (Join-Path $Dir 'EK-Service-Update.neu.bat') -Force }
      else { Copy-Item $d.FullName (Join-Path $Dir $d.Name) -Force }
    }
  }
  Say ''
  Say '  ────────────────────────────────────────────────' 'Green'
  Ok  "Update erfolgreich!"
  Say "     vorher:  $before"
  Say "     jetzt:   $(VersionOf $Exe)" 'Green'
  Say '  ────────────────────────────────────────────────' 'Green'
  if (Test-Path (Join-Path $Dir 'EK-Service-Update.neu.bat')) { Say '  Hinweis: Eine neuere Update-Datei liegt als „EK-Service-Update.neu.bat“ bereit.' }
  if (-not $Auto -and (YesNo 'EK-Service jetzt starten?' $true)) { Start-Process -FilePath $Exe -WorkingDirectory $Dir }
}

function Update-FromLink {
  $last = ''
  if (Test-Path $LinkFile) { $last = (Get-Content $LinkFile -Raw -Encoding UTF8).Trim() }
  if ($env:EK_UPDATE_SOURCE) { $url = $env:EK_UPDATE_SOURCE } else {
    Say '  Download-Link zur neuen Version einfügen (ZIP oder EXE).'
    Say '  Rechtsklick oder Strg+V fügt ein.' 'DarkGray'
    if ($last) { Say "  Enter = zuletzt verwendeter Link: $last" 'DarkGray' }
    $url = Ask 'Link' $last
  }
  if (-not $url) { throw 'Kein Link eingegeben.' }
  $url = Normalize-Link $url
  if ($url -notmatch '^https?://') { throw 'Das ist kein Internet-Link (muss mit http:// oder https:// beginnen).' }
  $work = Join-Path $env:TEMP "ek-update-$Stamp"; New-Item -ItemType Directory -Force -Path $work | Out-Null
  try {
    $file = Join-Path $work 'download.bin'
    Download $url $file
    $newExe = Get-NewExe $file $work
    Install-Exe $newExe
    Set-Content -Path $LinkFile -Value $url -Encoding UTF8
  } finally { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }
}

function Update-FromFile {
  if ($env:EK_UPDATE_SOURCE) { $p = $env:EK_UPDATE_SOURCE } else {
    Say '  Die heruntergeladene ZIP- oder EXE-Datei jetzt in dieses Fenster ziehen'
    Say '  (oder den Pfad eintippen) und Enter drücken.' 'DarkGray'
    $dl = Join-Path $env:USERPROFILE 'Downloads'
    $cand = Get-ChildItem $dl -Include 'EK-Service*.zip', 'EK-Service*.exe' -Recurse -Depth 0 -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $def = ''
    if ($cand) { $def = $cand.FullName; Say "  Enter = neueste Datei im Download-Ordner: $($cand.Name)" 'DarkGray' }
    $p = Ask 'Datei' $def
  }
  $p = $p.Trim().Trim('"')
  if (-not $p) { throw 'Keine Datei angegeben.' }
  $work = Join-Path $env:TEMP "ek-update-$Stamp"; New-Item -ItemType Directory -Force -Path $work | Out-Null
  try { Install-Exe (Get-NewExe $p $work) } finally { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }
}

function Restore-Previous {
  $list = @(Get-ChildItem $OldDir -Filter 'EK-Service_*.exe' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  if ($list.Count -eq 0) { throw 'Es gibt noch keine gesicherten älteren Versionen.' }
  Say '  Gesicherte Versionen:'
  for ($i = 0; $i -lt $list.Count; $i++) { Say "   [$($i + 1)] $(VersionOf $list[$i].FullName)" }
  $n = [int](Ask 'Welche wiederherstellen? (Nummer)' '1')
  if ($n -lt 1 -or $n -gt $list.Count) { throw 'Ungültige Auswahl.' }
  Warn 'Hinweis: Die Daten bleiben unverändert. Eine Datenbanksicherung von vor dem Update liegt unter ek-data\backups (Wiederherstellung im Programm unter System → Datensicherung).'
  if (-not (YesNo 'Jetzt wiederherstellen?' $true)) { throw 'Abgebrochen.' }
  $src = Join-Path $env:TEMP "ek-restore-$Stamp.exe"
  Copy-Item $list[$n - 1].FullName $src -Force
  try { Install-Exe $src } finally { Remove-Item $src -Force -ErrorAction SilentlyContinue }
}

function New-UpdateShortcut {
  $ws = New-Object -ComObject WScript.Shell
  $lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'EK-Service aktualisieren.lnk'
  $s = $ws.CreateShortcut($lnk)
  $s.TargetPath = $env:EK_SELF
  $s.WorkingDirectory = $Dir
  if (Test-Path $Exe) { $s.IconLocation = "$Exe,0" }
  $s.Description = 'EK-Service aktualisieren'
  $s.Save()
  Ok 'Desktop-Verknüpfung „EK-Service aktualisieren“ angelegt.'
}

# ------------------------------- Ablauf -------------------------------------
try {
  Banner
  if (-not (Test-Path $Exe)) { Warn 'Neben dieser Datei liegt noch keine EK-Service.exe – das Update installiert sie neu.' ; Say '' }
  if ($env:EK_UPDATE_SOURCE) {
    if ($env:EK_UPDATE_SOURCE -match '^https?://') { Update-FromLink } else { Update-FromFile }
    exit 0
  }
  Say '  Was möchtest du tun?' 'White'
  Say '   [1] Update über Download-Link  (Link einfügen)'
  Say '   [2] Update aus heruntergeladener Datei  (ZIP/EXE ins Fenster ziehen)'
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
