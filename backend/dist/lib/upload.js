"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.driverPhotoUpload = exports.DRIVERS_UPLOAD_DIR = exports.UPLOADS_ROOT = void 0;
exports.ensureUploadDirs = ensureUploadDirs;
exports.uploadedFile = uploadedFile;
exports.deleteUploadFile = deleteUploadFile;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const multer_1 = __importDefault(require("multer"));
/**
 * Where uploaded files live.
 *
 * Resolved as ../../uploads from src/lib (dev) and dist/lib (prod), both of which
 * land on backend/uploads - so dev and a compiled build read the same directory and
 * photos do not vanish when the server is restarted from dist.
 */
exports.UPLOADS_ROOT = path_1.default.resolve(__dirname, '../../uploads');
exports.DRIVERS_UPLOAD_DIR = path_1.default.join(exports.UPLOADS_ROOT, 'drivers');
/** Create the directories on boot so the first upload cannot fail on ENOENT. */
function ensureUploadDirs() {
    fs_1.default.mkdirSync(exports.DRIVERS_UPLOAD_DIR, { recursive: true });
}
/** Extension for the mimetypes the gate accepts. */
function extensionFor(mimetype) {
    if (mimetype === 'image/png')
        return '.png';
    if (mimetype === 'image/webp')
        return '.webp';
    return '.jpg';
}
/** Read `req.file` without relying on Express' Request type knowing about multer. */
function uploadedFile(req) {
    return req.file;
}
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const driverPhotoStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, exports.DRIVERS_UPLOAD_DIR),
    // The filename is generated here and never derives from request data, so a crafted
    // id cannot influence the path. The driver id lives in the database row instead.
    filename: (_req, file, cb) => cb(null, `${crypto_1.default.randomUUID()}${extensionFor(file.mimetype)}`)
});
exports.driverPhotoUpload = (0, multer_1.default)({
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
async function deleteUploadFile(photoUrl) {
    if (!photoUrl)
        return;
    if (!photoUrl.startsWith('/uploads/'))
        return;
    const rel = photoUrl.slice('/uploads/'.length);
    if (rel.split(/[\\/]/).includes('..'))
        return;
    const target = path_1.default.resolve(exports.UPLOADS_ROOT, rel);
    // Belt and braces: only ever unlink inside the uploads root.
    if (!target.startsWith(exports.UPLOADS_ROOT + path_1.default.sep))
        return;
    await fs_1.default.promises.unlink(target).catch(() => undefined);
}
