'use strict';
/**
 * Schlanker SMTP-Client (ohne externe Abhängigkeiten) für den Versand von Einkaufslisten.
 * Unterstützt SSL/TLS (Port 465), STARTTLS (Port 587) und unverschlüsselt (nur im LAN),
 * AUTH PLAIN/LOGIN sowie MIME-Mails mit PDF-Anhang.
 */
const net = require('node:net');
const tls = require('node:tls');
const os = require('node:os');
const crypto = require('node:crypto');
const { unprocessable } = require('../http/core');

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

function parseAddresses(input) {
  const list = (Array.isArray(input) ? input : String(input || '').split(/[,;\s]+/)).map((s) => String(s).trim()).filter(Boolean);
  const bad = list.filter((a) => !EMAIL_RE.test(a));
  if (bad.length) throw unprocessable(`Ungültige E-Mail-Adresse: ${bad.join(', ')}`);
  return [...new Set(list)];
}

const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const b64lines = (buf) => buf.toString('base64').replace(/.{1,76}/g, '$&\r\n');

function buildMime({ from, fromName, to, cc, subject, text, attachments = [] }) {
  const boundary = `ek_${crypto.randomBytes(12).toString('hex')}`;
  const domain = from.split('@')[1] || 'localhost';
  const headers = [
    `From: ${fromName ? `${encWord(fromName)} <${from}>` : from}`,
    `To: ${to.join(', ')}`,
    ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
    `Subject: ${encWord(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomBytes(16).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    'X-Mailer: EK-Service',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const parts = [
    `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64lines(Buffer.from(text || '', 'utf8'))}`,
    ...attachments.map((a) => {
      const ascii = a.filename.replace(/[^\w.\-]/g, '_');
      return `--${boundary}\r\nContent-Type: ${a.contentType || 'application/octet-stream'}; name="${ascii}"\r\n`
        + `Content-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(a.filename)}\r\n\r\n${b64lines(a.content)}`;
    }),
  ];
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('')}--${boundary}--\r\n`;
}

/** Verbindung mit zeilenweisem Lesen von SMTP-Antworten. */
class SmtpConn {
  constructor(socket, timeoutMs) {
    this.timeoutMs = timeoutMs;
    this.attach(socket);
  }
  attach(socket) {
    this.socket = socket;
    this.buf = '';
    this.waiters = [];
    this.error = null;
    socket.setEncoding('utf8');
    socket.setTimeout(this.timeoutMs, () => this.fail(Object.assign(new Error('Zeitüberschreitung beim Mailserver.'), { code: 'ETIMEDOUT' })));
    socket.on('data', (d) => { this.buf += d; this.flush(); });
    socket.on('error', (e) => this.fail(e));
    socket.on('close', () => this.fail(new Error('Verbindung zum Mailserver wurde geschlossen.')));
  }
  fail(e) { if (!this.error) this.error = e; while (this.waiters.length) this.waiters.shift().reject(this.error); }
  flush() {
    // vollständige Antwort: letzte Zeile "NNN " (Leerzeichen statt Bindestrich)
    for (;;) {
      const lines = this.buf.split('\r\n');
      let end = -1;
      for (let i = 0; i < lines.length - 1; i++) if (/^\d{3} /.test(lines[i]) || /^\d{3}$/.test(lines[i])) { end = i; break; }
      if (end < 0 || !this.waiters.length) return;
      const resp = lines.slice(0, end + 1);
      this.buf = lines.slice(end + 1).join('\r\n');
      const code = Number(resp[end].slice(0, 3));
      this.waiters.shift().resolve({ code, lines: resp.map((l) => l.slice(4)), text: resp.join(' ') });
    }
  }
  read() {
    return new Promise((resolve, reject) => {
      if (this.error) return reject(this.error);
      this.waiters.push({ resolve, reject });
      this.flush();
    });
  }
  async cmd(line, expect) {
    if (line !== null) this.socket.write(line + '\r\n');
    const r = await this.read();
    if (expect && !expect.includes(r.code)) {
      const e = new Error(r.text); e.smtpCode = r.code; e.command = line ? line.split(' ')[0] : 'CONNECT';
      throw e;
    }
    return r;
  }
}

function connect(host, port, secure, timeoutMs) {
  return new Promise((resolve, reject) => {
    const opts = { host, port, servername: host };
    const s = secure ? tls.connect(opts) : net.connect(opts);
    const t = setTimeout(() => { s.destroy(); reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })); }, timeoutMs);
    s.once(secure ? 'secureConnect' : 'connect', () => { clearTimeout(t); resolve(s); });
    s.once('error', (e) => { clearTimeout(t); reject(e); });
  });
}

function friendlyError(e, cfg) {
  const code = e.code || '';
  if (e.smtpCode === 535 || e.smtpCode === 534 || (e.command === 'AUTH' && e.smtpCode >= 500)) return 'Anmeldung am Mailserver fehlgeschlagen. Benutzername/Passwort prüfen (bei Gmail/Outlook ist meist ein App-Passwort nötig).';
  if (e.command === 'RCPT') return `Empfänger wurde vom Mailserver abgelehnt: ${e.message}`;
  if (e.command === 'MAIL') return `Absenderadresse wurde abgelehnt (muss meist zum Konto passen): ${e.message}`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `Mailserver „${cfg.host}“ nicht gefunden – Internetverbindung und Servername prüfen.`;
  if (code === 'ECONNREFUSED') return `Mailserver ${cfg.host}:${cfg.port} verweigert die Verbindung – Port/Verschlüsselung prüfen (465 = SSL, 587 = STARTTLS).`;
  if (code === 'ETIMEDOUT') return `Zeitüberschreitung bei ${cfg.host}:${cfg.port} – Port/Verschlüsselung oder Firewall prüfen.`;
  if (/certificate|SSL|TLS|wrong version/i.test(e.message)) return `Verschlüsselungsfehler: ${e.message} – Einstellung SSL/STARTTLS prüfen.`;
  return `E-Mail-Versand fehlgeschlagen: ${e.message}`;
}

/**
 * @param cfg { host, port, secure: 'ssl'|'starttls'|'none', user, pass, from, fromName, timeoutMs }
 * @param mail { to:[], cc:[], subject, text, attachments:[{ filename, content, contentType }] }
 */
async function sendMail(cfg, mail) {
  if (!cfg.host || !cfg.from) throw unprocessable('E-Mail-Versand ist nicht eingerichtet (System → E-Mail).');
  const timeoutMs = cfg.timeoutMs || 20000;
  const to = parseAddresses(mail.to);
  const cc = parseAddresses(mail.cc || []);
  if (!to.length) throw unprocessable('Bitte mindestens einen Empfänger angeben.');
  const port = Number(cfg.port) || (cfg.secure === 'ssl' ? 465 : 587);
  let conn;
  try {
    const sock = await connect(cfg.host, port, cfg.secure === 'ssl', timeoutMs);
    conn = new SmtpConn(sock, timeoutMs);
    await conn.cmd(null, [220]);
    const helo = (os.hostname() || 'ek-service').replace(/[^\w.-]/g, '') || 'ek-service';
    let ehlo = await conn.cmd(`EHLO ${helo}`, [250]);
    if (cfg.secure === 'starttls') {
      if (!ehlo.lines.some((l) => /^STARTTLS/i.test(l))) throw new Error('Der Mailserver unterstützt kein STARTTLS.');
      await conn.cmd('STARTTLS', [220]);
      const plain = conn.socket;
      plain.removeAllListeners('data'); plain.removeAllListeners('close'); plain.removeAllListeners('error');
      const secured = await new Promise((resolve, reject) => {
        const s = tls.connect({ socket: plain, servername: cfg.host }, () => resolve(s));
        s.once('error', reject);
      });
      conn.attach(secured);
      ehlo = await conn.cmd(`EHLO ${helo}`, [250]);
    }
    if (cfg.user) {
      const auth = (ehlo.lines.find((l) => /^AUTH/i.test(l)) || '').toUpperCase();
      try {
        if (auth.includes('PLAIN') || !auth.includes('LOGIN')) {
          await conn.cmd(`AUTH PLAIN ${Buffer.from(`\0${cfg.user}\0${cfg.pass || ''}`).toString('base64')}`, [235]);
        } else {
          await conn.cmd('AUTH LOGIN', [334]);
          await conn.cmd(Buffer.from(cfg.user).toString('base64'), [334]);
          await conn.cmd(Buffer.from(cfg.pass || '').toString('base64'), [235]);
        }
      } catch (e) { e.command = 'AUTH'; throw e; }
    }
    await conn.cmd(`MAIL FROM:<${cfg.from}>`, [250]);
    for (const r of [...to, ...cc]) await conn.cmd(`RCPT TO:<${r}>`, [250, 251]);
    await conn.cmd('DATA', [354]);
    const body = buildMime({ from: cfg.from, fromName: cfg.fromName, to, cc, subject: mail.subject, text: mail.text, attachments: mail.attachments })
      .replace(/\r\n\./g, '\r\n..'); // Dot-Stuffing
    await conn.cmd(`${body}\r\n.`, [250]);
    await conn.cmd('QUIT', [221]).catch(() => {});
    return { to, cc };
  } catch (e) {
    if (e.statusCode === 422 || e.status === 422) throw e;
    throw unprocessable(friendlyError(e, { host: cfg.host, port }));
  } finally {
    if (conn) conn.socket.destroy();
  }
}

function mailConfig(db) {
  return {
    host: db.getSetting('smtp_host', ''),
    port: Number(db.getSetting('smtp_port', 587)) || 587,
    secure: db.getSetting('smtp_secure', 'starttls'),
    user: db.getSetting('smtp_user', ''),
    pass: db.getSetting('smtp_pass', ''),
    from: db.getSetting('smtp_from', ''),
    fromName: db.getSetting('smtp_from_name', '') || db.getSetting('company_name', ''),
    defaultTo: db.getSetting('mail_default_to', ''),
  };
}

module.exports = { sendMail, buildMime, parseAddresses, mailConfig, EMAIL_RE };
