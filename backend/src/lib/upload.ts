import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';

/**
 * Where uploaded files live.
 *
 * Resolved as ../../uploads from src/lib (dev) and dist/lib (prod), both of which
 * land on backend/uploads - so dev and a compiled build read the same directory and
 * photos do not vanish when the server is restarted from dist.
 */
export const UPLOADS_ROOT = path.resolve(__dirname, '../../uploads');
export const DRIVERS_UPLOAD_DIR = path.join(UPLOADS_ROOT, 'drivers');

/** Create the directories on boot so the first upload cannot fail on ENOENT. */
export function ensureUploadDirs(): void {
  fs.mkdirSync(DRIVERS_UPLOAD_DIR, { recursive: true });
}

/** Extension for the mimetypes the gate accepts. */
function extensionFor(mimetype: string): string {
  if (mimetype === 'image/png') return '.png';
  if (mimetype === 'image/webp') return '.webp';
  return '.jpg';
}

/** The subset of a stored multer file this app actually reads. */
export interface UploadedFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  filename: string;
  path: string;
}

/** Read `req.file` without relying on Express' Request type knowing about multer. */
export function uploadedFile(req: unknown): UploadedFile | undefined {
  return (req as { file?: UploadedFile }).file;
}

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const driverPhotoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, DRIVERS_UPLOAD_DIR),
  // The filename is generated here and never derives from request data, so a crafted
  // id cannot influence the path. The driver id lives in the database row instead.
  filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${extensionFor(file.mimetype)}`)
});

export const driverPhotoUpload = multer({
  storage: driverPhotoStorage,
  // Rejects anything that is not an image outright. Rejecting via cb(null, false)
  // rather than an error keeps the "no file" case a plain 400 from the controller
  // instead of a MulterError.
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_TYPES.has(file.mimetype)),
  // 1 MB. The client downscales to a 400x400 JPEG (~30-60 KB) first, so anything
  // near this limit was sent by something other than our own upload control.
  limits: { fileSize: 1024 * 1024 }
}).single('photo');

/**
 * Delete an uploaded file given the stored `photoUrl`.
 *
 * The URL must already live under /uploads and may not contain a `..` segment, so a
 * tampered database value (e.g. "../../secrets") cannot point the unlink outside the
 * uploads tree. The prefix is checked on the raw string: path.normalize() on Windows
 * would have turned "/uploads/..." into "\uploads\..." and silently skipped the guard.
 * Missing files are ignored: the row is already correct either way.
 */
export async function deleteUploadFile(photoUrl: string | null | undefined): Promise<void> {
  if (!photoUrl) return;
  if (!photoUrl.startsWith('/uploads/')) return;

  const rel = photoUrl.slice('/uploads/'.length);
  if (rel.split(/[\\/]/).includes('..')) return;

  const target = path.resolve(UPLOADS_ROOT, rel);
  // Belt and braces: only ever unlink inside the uploads root.
  if (!target.startsWith(UPLOADS_ROOT + path.sep)) return;

  await fs.promises.unlink(target).catch(() => undefined);
}
