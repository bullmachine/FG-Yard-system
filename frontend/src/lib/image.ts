/**
 * Client-side photo preparation for driver portraits.
 *
 * The raw input (camera or gallery file) is decodable only in the browser, so it is
 * decoded here, centre-cropped to a square and downscaled to the small JPEG the
 * gate screen and the drivers list need. This keeps uploads at tens of kilobytes
 * even from a 12 MP phone photo, and the server's 1 MB cap catches anything that
 * bypasses this step.
 */

export const DRIVER_PHOTO_SIZE = 400;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(Object.assign(new Error('This file could not be read as an image'), { code: 'unreadable' }));
    img.src = url;
  });
}

export async function downscaleToJpeg(
  file: File,
  size: number = DRIVER_PHOTO_SIZE,
  quality = 0.82
): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);

    // Centre-crop the largest square available so an awkward aspect ratio never
    // distorts the face or squashes the portrait.
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available in this browser');

    // JPEG has no alpha channel; a transparent PNG would otherwise export its
    // background as black, so paint white first.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        b => (b ? resolve(b) : reject(new Error('Could not encode this image to JPEG'))),
        'image/jpeg',
        quality
      );
    });

    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}