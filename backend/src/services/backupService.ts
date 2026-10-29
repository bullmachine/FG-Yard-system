import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { spawn } from 'child_process';
import { notifyEvent } from './notificationService';

/**
 * Daily database backup. mysqldump writes a gzip file into BACKUP_DIR on this server;
 * the Admin team copies the files from that folder to another system. Old files are
 * deleted after BACKUP_KEEP_DAYS, but the newest MIN_KEEP are always kept.
 *
 * .env settings (all optional):
 *   BACKUP_DIR        folder for the files (default: db-backups next to the project)
 *   MYSQLDUMP_PATH    full path to mysqldump.exe (default: XAMPP on C:, D: or E:, then PATH)
 *   BACKUP_CRON       when to run (default 0 1 * * *, every night at 01:00)
 *   BACKUP_KEEP_DAYS  days to keep (default 14)
 */

export const FILE_PREFIX = 'fg-yard_';
const MIN_KEEP = 3;

export interface DbTarget {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

/** mysql://user:pass@host:3306/db?params -> its parts. Throws on any other URL. */
export function parseDatabaseUrl(url: string | undefined): DbTarget {
  if (!url) throw new Error('DATABASE_URL is not set');
  const u = new URL(url);
  if (u.protocol !== 'mysql:') throw new Error('DATABASE_URL is not a mysql:// URL');
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!database) throw new Error('DATABASE_URL has no database name');
  return {
    host: u.hostname || 'localhost',
    port: u.port || '3306',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** fg-yard_2026-10-29_0100.sql.gz, in server local time so it matches the folder view. */
export function backupFileName(at: Date): string {
  return `${FILE_PREFIX}${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}_${pad(at.getHours())}${pad(at.getMinutes())}.sql.gz`;
}

export interface BackupFile {
  name: string;
  size: number;
  modifiedAt: Date;
}

/** Files older than keepDays, never touching the newest MIN_KEEP. */
export function filesToDelete(files: BackupFile[], now: Date, keepDays: number): BackupFile[] {
  const cutoff = now.getTime() - keepDays * 24 * 60 * 60 * 1000;
  return [...files]
    .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())
    .slice(MIN_KEEP)
    .filter((f) => f.modifiedAt.getTime() < cutoff);
}

export function backupConfig() {
  const keep = parseInt(process.env.BACKUP_KEEP_DAYS ?? '', 10);
  return {
    dir: path.resolve(process.env.BACKUP_DIR || path.resolve(__dirname, '../../../db-backups')),
    cron: process.env.BACKUP_CRON || '0 1 * * *',
    keepDays: Number.isFinite(keep) && keep > 0 ? keep : 14
  };
}

function findMysqldump(): string {
  if (process.env.MYSQLDUMP_PATH) return process.env.MYSQLDUMP_PATH;
  for (const drive of ['C', 'D', 'E']) {
    const p = `${drive}:\\xampp\\mysql\\bin\\mysqldump.exe`;
    if (fs.existsSync(p)) return p;
  }
  return 'mysqldump';
}

export function listBackups(): BackupFile[] {
  const { dir } = backupConfig();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => n.startsWith(FILE_PREFIX) && n.endsWith('.sql.gz'))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, modifiedAt: st.mtime };
    })
    .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
}

export interface BackupResult {
  ok: boolean;
  startedAt: Date;
  finishedAt: Date;
  file?: string;
  size?: number;
  deleted?: number;
  error?: string;
  trigger: string;
}

let running = false;
let last: BackupResult | null = null;

export function backupStatus() {
  const cfg = backupConfig();
  return { ...cfg, running, last, files: listBackups() };
}

/** mysqldump | gzip into a .partial file, renamed only when both finish cleanly. */
function dumpTo(target: string, db: DbTarget): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '--single-transaction', '--routines', '--triggers', '--default-character-set=utf8mb4',
      '-h', db.host, '-P', db.port, '-u', db.user, db.database
    ];
    // The password goes in the environment, not the command line, so it is not
    // visible in the process list.
    const child = spawn(findMysqldump(), args, { env: { ...process.env, MYSQL_PWD: db.password }, windowsHide: true });
    const out = fs.createWriteStream(target);
    let stderr = '';
    let failed = false;
    const fail = (err: Error) => {
      if (failed) return;
      failed = true;
      child.kill();
      out.destroy();
      reject(err);
    };
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => fail(new Error(`Could not start mysqldump: ${err.message}. Set MYSQLDUMP_PATH in backend/.env.`)));
    const gzip = zlib.createGzip();
    gzip.on('error', fail);
    out.on('error', fail);
    child.stdout.pipe(gzip).pipe(out);
    let exitCode: number | null = null;
    let written = false;
    const done = () => {
      if (failed || exitCode === null || !written) return;
      if (exitCode !== 0) return fail(new Error(`mysqldump exited with code ${exitCode}: ${stderr.trim().slice(0, 300)}`));
      resolve();
    };
    child.on('close', (code) => { exitCode = code ?? 1; done(); });
    out.on('finish', () => { written = true; done(); });
  });
}

export async function runBackup(trigger: string): Promise<BackupResult> {
  if (running) return { ok: false, startedAt: new Date(), finishedAt: new Date(), error: 'A backup is already running', trigger };
  running = true;
  const startedAt = new Date();
  const { dir, keepDays } = backupConfig();
  const name = backupFileName(startedAt);
  const partial = path.join(dir, `${name}.partial`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    await dumpTo(partial, parseDatabaseUrl(process.env.DATABASE_URL));
    const size = fs.statSync(partial).size;
    // A dump of this schema is never this small; it means mysqldump wrote nothing useful.
    if (size < 512) throw new Error('The backup file is empty');
    fs.renameSync(partial, path.join(dir, name));

    let deleted = 0;
    for (const f of filesToDelete(listBackups(), new Date(), keepDays)) {
      fs.unlinkSync(path.join(dir, f.name));
      deleted++;
    }
    last = { ok: true, startedAt, finishedAt: new Date(), file: name, size, deleted, trigger };
    console.log(`Database backup written: ${path.join(dir, name)} (${size} bytes, ${deleted} old file(s) removed)`);
  } catch (error) {
    fs.rmSync(partial, { force: true });
    const message = error instanceof Error ? error.message : String(error);
    last = { ok: false, startedAt, finishedAt: new Date(), error: message, trigger };
    console.error('Database backup failed:', message);
    await notifyEvent({
      type: 'BACKUP_FAILED',
      severity: 'CRITICAL',
      title: 'Database backup failed',
      message: message.slice(0, 250),
      link: 'settings'
    }).catch(() => undefined);
  } finally {
    running = false;
  }
  return last;
}
