import net from 'net';
import tls from 'tls';
import os from 'os';
import { getSettings } from './settingsService';

/**
 * Minimal SMTP client on Node's own net/tls modules, so sending mail needs no extra
 * package. Supports what Gmail and Microsoft 365 need: implicit TLS (port 465) or
 * STARTTLS (port 587), then AUTH LOGIN. HTML body only.
 */

export interface MailMessage {
  to: string[];
  subject: string;
  html: string;
}

const TIMEOUT_MS = 20000;

function encodeHeader(value: string): string {
  // RFC 2047 so non-ASCII subjects survive.
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

class SmtpSession {
  private buffer = '';
  private replies: { code: number; text: string }[] = [];
  private waiters: ((line: { code: number; text: string }) => void)[] = [];
  private failure: Error | null = null;

  constructor(private socket: net.Socket) {
    this.attach(socket);
  }

  private attach(socket: net.Socket) {
    this.socket = socket;
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error('SMTP server timed out')));
    socket.on('data', (chunk) => this.onData(chunk.toString('utf8')));
    socket.on('error', (err) => this.fail(err));
    socket.on('close', () => this.fail(new Error('SMTP connection closed')));
  }

  private fail(err: Error) {
    if (this.failure) return;
    this.failure = err;
    // Wake every waiter so the caller sees the error instead of hanging.
    for (const w of this.waiters.splice(0)) w({ code: 0, text: err.message });
  }

  private onData(text: string): void {
    this.buffer += text;
    // A reply is complete when its last line has a space after the code ("250 OK").
    const lines = this.buffer.split('\r\n');
    for (let i = 0; i < lines.length - 1; i++) {
      const m = /^(\d{3})([ -])(.*)$/.exec(lines[i]);
      if (m && m[2] === ' ') {
        const reply = { code: Number(m[1]), text: lines.slice(0, i + 1).join('\n') };
        this.buffer = lines.slice(i + 1).join('\r\n');
        const waiter = this.waiters.shift();
        if (waiter) waiter(reply); else this.replies.push(reply);
        return this.onData('');
      }
    }
  }

  read(): Promise<{ code: number; text: string }> {
    const ready = this.replies.shift();
    if (ready) return Promise.resolve(ready);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.waiters.push((reply) => (reply.code === 0 ? reject(this.failure) : resolve(reply)));
    });
  }

  async command(line: string, expect: number[], shown = line) {
    this.socket.write(`${line}\r\n`);
    const reply = await this.read();
    if (!expect.includes(reply.code)) throw new Error(`SMTP ${shown.split(' ')[0]} failed: ${reply.text}`);
    return reply;
  }

  /** Upgrade the plain connection after STARTTLS. */
  async startTls(host: string) {
    this.socket.removeAllListeners('data');
    this.socket.removeAllListeners('error');
    this.socket.removeAllListeners('close');
    const secure = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const s = tls.connect({ socket: this.socket, servername: host }, () => resolve(s));
      s.once('error', reject);
    });
    this.buffer = '';
    this.replies = [];
    this.attach(secure);
  }

  close() {
    this.socket.end();
  }
}

function connect(host: string, port: number, secure: boolean): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host, port, servername: host }, () => resolve(socket))
      : net.connect({ host, port }, () => resolve(socket));
    socket.once('error', reject);
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error(`Could not reach ${host}:${port}`)));
  });
}

/** Send one message with the SMTP settings saved in Settings. */
export async function sendMail(message: MailMessage): Promise<void> {
  const s = await getSettings();
  if (!s.smtpHost || !s.smtpUser || !s.smtpPassword) {
    throw new Error('E-mail is not set up. Enter the SMTP server, user and password in Settings.');
  }
  const to = message.to.map((t) => t.trim()).filter(Boolean);
  if (to.length === 0) throw new Error('No recipient e-mail address');
  const from = s.smtpFrom || s.smtpUser;

  const session = new SmtpSession(await connect(s.smtpHost, s.smtpPort, s.smtpSecure));
  try {
    const greeting = await session.read();
    if (greeting.code !== 220) throw new Error(`SMTP server refused the connection: ${greeting.text}`);

    const helo = `EHLO ${os.hostname() || 'fg-yard'}`;
    let ehlo = await session.command(helo, [250]);
    if (!s.smtpSecure && /STARTTLS/i.test(ehlo.text)) {
      await session.command('STARTTLS', [220]);
      await session.startTls(s.smtpHost);
      ehlo = await session.command(helo, [250]);
    }

    await session.command('AUTH LOGIN', [334]);
    await session.command(Buffer.from(s.smtpUser).toString('base64'), [334], 'AUTH user');
    await session.command(Buffer.from(s.smtpPassword).toString('base64'), [235], 'AUTH password');

    await session.command(`MAIL FROM:<${from}>`, [250]);
    for (const r of to) await session.command(`RCPT TO:<${r}>`, [250, 251]);
    await session.command('DATA', [354]);

    const body = Buffer.from(message.html, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
    const data = [
      `From: FG Yard <${from}>`,
      `To: ${to.join(', ')}`,
      `Subject: ${encodeHeader(message.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      body,
      '.'
    ].join('\r\n');
    await session.command(data, [250], 'DATA body');
    await session.command('QUIT', [221]).catch(() => undefined);
  } finally {
    session.close();
  }
}
