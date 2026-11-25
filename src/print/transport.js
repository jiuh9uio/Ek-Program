'use strict';
/**
 * Druckwege:
 *  - escpos_tcp : ESC/POS-Rohdaten über TCP (Port 9100) – alle gängigen Netzwerk-Bondrucker
 *  - epos_http  : Epson ePOS-Print (HTTP/XML) – z. B. Epson TM-m30II, liefert Statusmeldungen
 *  - windows_raw: ESC/POS-Rohdaten an einen in Windows installierten Drucker (USB/Bluetooth)
 */
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

function netErrorText(err, host, port) {
  const code = err && err.code;
  switch (code) {
    case 'ECONNREFUSED': return `Drucker ${host}:${port} verweigert die Verbindung (Port falsch oder Drucker belegt).`;
    case 'EHOSTUNREACH': case 'ENETUNREACH': return `Drucker ${host} ist im Netzwerk nicht erreichbar.`;
    case 'ETIMEDOUT': case 'TIMEOUT': return `Zeitüberschreitung: Drucker ${host}:${port} antwortet nicht (ausgeschaltet oder falsche IP?).`;
    case 'ENOTFOUND': return `Druckeradresse "${host}" ist unbekannt.`;
    case 'ECONNRESET': return 'Verbindung zum Drucker wurde unterbrochen.';
    default: return `Druckfehler: ${err && err.message ? err.message : String(err)}`;
  }
}

function sendTcp(host, port, data, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (err) => {
      if (done) return; done = true;
      sock.destroy();
      if (err) reject(new Error(netErrorText(err, host, port))); else resolve();
    };
    sock.setTimeout(timeoutMs, () => finish({ code: 'TIMEOUT' }));
    sock.once('error', finish);
    sock.connect(port, host, () => {
      sock.write(data, (err) => {
        if (err) return finish(err);
        sock.end();
        // Dem Drucker kurz Zeit lassen, die Daten vollständig zu übernehmen
        setTimeout(() => finish(null), 300);
      });
    });
  });
}

/** Echtzeitstatus per DLE EOT (ESC/POS). */
function statusTcp(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const chunks = [];
    let done = false;
    const finish = (result) => { if (done) return; done = true; sock.destroy(); resolve(result); };
    sock.setTimeout(timeoutMs, () => {
      if (chunks.length) finish(parseDleEot(Buffer.concat(chunks)));
      else finish({ online: !!sock.remoteAddress, reachable: !!sock.remoteAddress, message: sock.remoteAddress ? 'Erreichbar (Drucker liefert keinen Status)' : netErrorText({ code: 'TIMEOUT' }, host, port) });
    });
    sock.once('error', (err) => finish({ online: false, reachable: false, message: netErrorText(err, host, port) }));
    sock.on('data', (d) => {
      chunks.push(d);
      const buf = Buffer.concat(chunks);
      if (buf.length >= 3) finish(parseDleEot(buf));
    });
    sock.connect(port, host, () => {
      sock.write(Buffer.from([0x10, 0x04, 0x01, 0x10, 0x04, 0x02, 0x10, 0x04, 0x04]));
    });
  });
}

function parseDleEot(buf) {
  const valid = (b) => (b & 0x93) === 0x12;
  const [s1, s2, s4] = buf;
  const problems = [];
  if (s1 !== undefined && valid(s1) && (s1 & 0x08)) problems.push('offline');
  if (s2 !== undefined && valid(s2)) {
    if (s2 & 0x04) problems.push('Deckel offen');
    if (s2 & 0x20) problems.push('Papier leer');
    if (s2 & 0x40) problems.push('Druckerfehler');
  }
  let nearEnd = false;
  if (s4 !== undefined && valid(s4)) {
    if (s4 & 0x60 && !problems.includes('Papier leer')) problems.push('Papier leer');
    if (s4 & 0x0C) nearEnd = true;
  }
  const ok = problems.length === 0;
  return {
    online: ok, reachable: true, paper_near_end: nearEnd,
    message: ok ? (nearEnd ? 'Bereit – Papier geht zur Neige' : 'Bereit') : `Störung: ${problems.join(', ')}`,
  };
}

const EPOS_ASB = {
  NO_RESPONSE: 0x00000001, OFF_LINE: 0x00000008, COVER_OPEN: 0x00000020, AUTOCUTTER_ERR: 0x00000800,
  MECHANICAL_ERR: 0x00000400, UNRECOVER_ERR: 0x00002000, RECEIPT_NEAR_END: 0x00020000, RECEIPT_END: 0x00080000,
};

function parseEposResponse(text) {
  const success = /success="true"/.test(text);
  const code = (/code="([^"]*)"/.exec(text) || [])[1] || '';
  const status = Number((/status="(\d+)"/.exec(text) || [])[1] || 0);
  const problems = [];
  if (status & EPOS_ASB.NO_RESPONSE) problems.push('keine Antwort vom Druckwerk');
  if (status & EPOS_ASB.OFF_LINE) problems.push('offline');
  if (status & EPOS_ASB.COVER_OPEN) problems.push('Deckel offen');
  if (status & EPOS_ASB.RECEIPT_END) problems.push('Papier leer');
  if (status & EPOS_ASB.AUTOCUTTER_ERR) problems.push('Abschneider-Fehler');
  if (status & (EPOS_ASB.MECHANICAL_ERR | EPOS_ASB.UNRECOVER_ERR)) problems.push('Druckerfehler');
  const nearEnd = !!(status & EPOS_ASB.RECEIPT_NEAR_END);
  return { success, code, status, problems, nearEnd };
}

async function postEpos(host, port, xml, timeoutMs = 15000) {
  const url = `http://${host}:${port || 80}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""', 'If-Modified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT' },
      body: xml,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const cause = e.cause || e;
    if (e.name === 'TimeoutError') throw new Error(netErrorText({ code: 'TIMEOUT' }, host, port));
    throw new Error(netErrorText(cause, host, port));
  }
  const text = await res.text();
  if (res.status === 404) throw new Error('ePOS-Print ist auf dem Drucker nicht aktiviert (Web-Konfiguration → ePOS-Print aktivieren) oder falscher Port.');
  if (!res.ok) throw new Error(`Drucker meldet HTTP ${res.status}.`);
  return parseEposResponse(text);
}

async function sendEpos(host, port, xml) {
  const r = await postEpos(host, port, xml);
  if (!r.success) {
    const reason = r.problems.length ? r.problems.join(', ') : (r.code || 'unbekannter Fehler');
    throw new Error(`Drucker meldet Fehler: ${reason}`);
  }
  return r;
}

async function statusEpos(host, port) {
  try {
    const xml = '<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print"></epos-print></s:Body></s:Envelope>';
    const r = await postEpos(host, port, xml, 6000);
    const ok = r.problems.length === 0;
    return { online: ok, reachable: true, paper_near_end: r.nearEnd, message: ok ? (r.nearEnd ? 'Bereit – Papier geht zur Neige' : 'Bereit') : `Störung: ${r.problems.join(', ')}` };
  } catch (e) {
    return { online: false, reachable: false, message: e.message };
  }
}

// ---------------- Windows-Druckwarteschlange (RAW) ----------------
const PS_RAW = `
$ErrorActionPreference = 'Stop'
$src = @"
using System; using System.Runtime.InteropServices;
public class EkRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DOCINFO { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool OpenPrinter(string src, out IntPtr h, IntPtr pd);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool StartDocPrinter(IntPtr h, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);
  public static string Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return "Drucker nicht gefunden (" + Marshal.GetLastWin32Error() + ")";
    try {
      DOCINFO di = new DOCINFO(); di.pDocName = "EK-Service Bon"; di.pDataType = "RAW";
      if (!StartDocPrinter(h, 1, di)) return "StartDocPrinter fehlgeschlagen (" + Marshal.GetLastWin32Error() + ")";
      StartPagePrinter(h);
      int w; bool ok = WritePrinter(h, data, data.Length, out w);
      EndPagePrinter(h); EndDocPrinter(h);
      if (!ok || w != data.Length) return "WritePrinter fehlgeschlagen (" + Marshal.GetLastWin32Error() + ")";
      return "OK";
    } finally { ClosePrinter(h); }
  }
}
"@
Add-Type -TypeDefinition $src
$bytes = [System.IO.File]::ReadAllBytes($env:EK_PRINT_FILE)
Write-Output ([EkRawPrint]::Send($env:EK_PRINTER_NAME, $bytes))
`;

function runPowerShell(script, env = {}, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('Windows-Druckerwarteschlange ist nur unter Windows verfügbar.'));
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { env: { ...process.env, ...env }, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`PowerShell-Fehler: ${(stderr || err.message).trim()}`));
        resolve(String(stdout).trim());
      });
  });
}

async function sendWindowsRaw(printerName, data) {
  const file = path.join(os.tmpdir(), `ek-bon-${process.pid}-${Date.now()}.bin`);
  fs.writeFileSync(file, data);
  try {
    const out = await runPowerShell(PS_RAW, { EK_PRINT_FILE: file, EK_PRINTER_NAME: printerName });
    if (!out.endsWith('OK')) throw new Error(out || 'Unbekannter Fehler beim Windows-Druck.');
  } finally {
    fs.rm(file, { force: true }, () => {});
  }
}

async function listWindowsPrinters() {
  const out = await runPowerShell('Get-Printer | Select-Object Name, DriverName, PortName, PrinterStatus | ConvertTo-Json -Compress', {}, 20000);
  if (!out) return [];
  const parsed = JSON.parse(out);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((p) => ({ name: p.Name, driver: p.DriverName, port: p.PortName, status: String(p.PrinterStatus) }));
}

async function statusWindows(printerName) {
  try {
    const out = await runPowerShell('$p = Get-Printer -Name $env:EK_PRINTER_NAME; Write-Output ([string]$p.PrinterStatus)', { EK_PRINTER_NAME: printerName }, 15000);
    const ok = /normal|0|idle/i.test(out);
    return { online: ok, reachable: true, message: ok ? 'Bereit (Windows-Status)' : `Windows-Status: ${out}` };
  } catch (e) {
    return { online: false, reachable: false, message: e.message };
  }
}

module.exports = { sendTcp, statusTcp, sendEpos, statusEpos, sendWindowsRaw, statusWindows, listWindowsPrinters, parseDleEot, parseEposResponse };
