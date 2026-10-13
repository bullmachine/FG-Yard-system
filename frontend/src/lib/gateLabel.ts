import { code128Bars, canEncodeCode128 } from './barcode';

/**
 * Renders the gate pass as a 50 mm thermal label (384 px wide = 50 mm at
 * 203 dpi) mirroring the browser print-pass card layout, exported as a PNG
 * data URL that can be opened in a label app (OpenLabel) or downloaded.
 *
 * The driver photo is loaded before drawing (2.5s cap) and degrades to a
 * rounded initial placeholder when unavailable, keeping the print crisp.
 */

export interface GateLabelData {
  title: string;
  issued: string;
  ref: string;
  driverName: string;
  badgeCode: string;
  photoUrl: string;
  vehicle: string;
  detailCaption: string;
  detailYard: string;
  detailValue: string;
  footnote: string;
}

const WIDTH = 384; // 50 mm @ 203 dpi
const PAD = 6;
const CONTENT_W = WIDTH - PAD * 2;
const CARD_PAD = 10; // vehicle card inner padding; also anchors the barcode left edge
const FONT = 'Inter, system-ui, -apple-system, sans-serif';

// PNG chunk helpers: canvas.toDataURL() strips physical-size metadata, so many
// label apps size a pasted image off an assumed density (e.g. 96 dpi) and then
// stretch it to the template width, causing right-side cropping on a 50mm roll.
// We inject a pHYs chunk (8000 dots/m = 203 dpi) so the PNG carries its true
// 48mm width and OpenLabel maps it at the correct physical size.
const PNG_DOTS_PER_M = 8000;

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function withPngDpi(dataUrl: string): string {
  const bin = atob(dataUrl.split(',')[1] ?? '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);

  // 8-byte signature + IHDR chunk (4 len + 4 type + 13 data + 4 crc).
  const insertAt = 8 + 4 + 4 + 13 + 4;

  const phys = new Uint8Array(9);
  const pv = new DataView(phys.buffer);
  pv.setUint32(0, PNG_DOTS_PER_M);
  pv.setUint32(4, PNG_DOTS_PER_M);
  phys[8] = 1; // unit: metres

  const typeAndData = new Uint8Array(4 + 9);
  typeAndData.set([0x70, 0x48, 0x59, 0x73], 0); // 'pHYs'
  typeAndData.set(phys, 4);

  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  new DataView(chunk.buffer).setUint32(0, 9);
  chunk.set(typeAndData, 4);
  new DataView(chunk.buffer).setUint32(4 + 13, crc32(typeAndData));

  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes.subarray(0, insertAt), 0);
  out.set(chunk, insertAt);
  out.set(bytes.subarray(insertAt), insertAt + chunk.length);

  let str = '';
  for (let i = 0; i < out.length; i += 8192) {
    str += String.fromCharCode(...out.subarray(i, i + 8192));
  }
  return `data:image/png;base64,${btoa(str)}`;
}

// Tailwind slate palette.
const SLATE_900 = '#0f172a';
const SLATE_600 = '#475569';
const SLATE_500 = '#64748b';
const SLATE_400 = '#94a3b8';
const SLATE_800 = '#1e293b';
const SLATE_300 = '#cbd5e1';
const SLATE_200 = '#e2e8f0';
const SLATE_50 = '#f8fafc';

function loadImage(src: string, timeoutMs = 2500): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    let settled = false;
    const done = (value: HTMLImageElement | null) => { if (!settled) { settled = true; resolve(value); } };
    if (!src.trim()) { done(null); return; }
    img.onload = () => done(img);
    img.onerror = () => done(null);
    img.crossOrigin = 'anonymous';
    img.src = src;
    setTimeout(() => done(null), timeoutMs);
  });
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function renderGateLabel(data: GateLabelData): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const font = (weight: number | string, size: number) => `${weight} ${size}px ${FONT}`;

  // Shrink a line's font until it fits the printable width (min 10px).
  const fit = (text: string, size: number, weight: number | string): number => {
    let s = size;
    ctx.font = font(weight, s);
    while (s > 10 && ctx.measureText(text).width > CONTENT_W) {
      s -= 1;
      ctx.font = font(weight, s);
    }
    return s;
  };

  const TITLE = fit(data.title, 20, 800);
  const SUB = fit(`Issued ${data.issued} · Ref #${data.ref}`, 11, 500);
  const NAME = fit(data.driverName, 16, 700);
  const BADGE = fit(`Badge: ${data.badgeCode || '—'}`, 12, 600);
  const VEHICLE = fit(data.vehicle, 13, 700);
  const YARD = data.detailYard ? fit(data.detailYard, 16, 700) : 0;
  const DETAIL = fit(data.detailValue, 26, 800);
  const FOOT = fit(data.footnote, 10.5, 500);

  const hasBadge = data.badgeCode !== '' && canEncodeCode128(data.badgeCode);
  let barcode: { bars: { x: number; width: number }[]; scale: number; x0: number; w: number; h: number } | null = null;
  if (hasBadge) {
    const geo = code128Bars(data.badgeCode);
    // Left edge lines up with the vehicle/machine text (card inner left).
    const x0 = PAD + CARD_PAD;
    const scale = Math.min(2, (WIDTH - PAD - x0) / geo.widthModules);
    barcode = {
      bars: geo.bars,
      scale,
      x0,
      w: geo.widthModules * scale,
      h: 54,
    };
  }

  const photo = data.photoUrl ? await loadImage(data.photoUrl) : null;

  // ---- layout ----
  const photoSize = 56;
  let cursor = 26; // title baseline
  const titleY = cursor;
  cursor += Math.max(Math.round(TITLE * 1.2), 20);
  const subY = cursor;
  cursor += 15;
  const headerRuleY = cursor;
  cursor += 10;

  const photoTop = cursor;
  const captionDriverY = photoTop + 12;
  const nameY = photoTop + 32;
  const badgeY = photoTop + 50;
  cursor += photoSize;
  cursor += 10;

  const cardTop = cursor;
  const cap1Y = cardTop + CARD_PAD + 9;   // "Vehicle" caption
  const val1Y = cap1Y + 16;              // machine serial - clear of caption
  const cap2Y = val1Y + 21;              // "Assigned slot" / "Direction" - clear of value
  const val2Y = cap2Y + 16;              // slot / direction value - clear of caption
  const cardBottom = val2Y + 16;
  cursor = cardBottom;

  cursor += 12;
  const footRuleY = cursor;
  cursor += 12;
  const footY = cursor;
  cursor += 16;

  let barTopY = 0;
  let barCodeY = 0;
  let barCaptionY = 0;
  if (barcode) {
    barTopY = cursor;
    cursor += barcode.h;           // bars bottom edge
    barCodeY = cursor + 12;        // readable employee code - clear of the bars
    barCaptionY = barCodeY + 16;   // "Driver badge" caption - clear of the code
    cursor = barCaptionY + 12;
  }
  const H = cursor + 10;

  canvas.height = H;

  const text = (str: string, y: number, size: number, weight: number | string, color: string, align: CanvasTextAlign = 'left', x = PAD) => {
    ctx.fillStyle = color;
    ctx.font = font(weight, size);
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(str, align === 'center' ? WIDTH / 2 : x, y);
  };
  const rule = (y: number, width: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(WIDTH - PAD, y);
    ctx.stroke();
  };

  // ---- header ----
  text(data.title, titleY, TITLE, 800, SLATE_900);
  text(`Issued ${data.issued} · Ref #${data.ref}`, subY, SUB, 500, SLATE_500);
  rule(headerRuleY, 2, SLATE_800);

  // ---- driver row ----
  const photoY = photoTop;
  if (photo && photo.naturalWidth > 0) {
    ctx.save();
    roundRectPath(ctx, PAD, photoY, photoSize, photoSize, 8);
    ctx.clip();
    ctx.drawImage(photo, PAD, photoY, photoSize, photoSize);
    ctx.restore();
  } else {
    ctx.fillStyle = SLATE_200;
    roundRectPath(ctx, PAD, photoY, photoSize, photoSize, 8);
    ctx.fill();
    const initial = (data.driverName.trim().charAt(0) || '?').toUpperCase();
    ctx.fillStyle = SLATE_500;
    ctx.font = font(700, 22);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initial, PAD + photoSize / 2, photoY + photoSize / 2 + 2);
  }
  ctx.strokeStyle = SLATE_300;
  ctx.lineWidth = 1;
  roundRectPath(ctx, PAD, photoY, photoSize, photoSize, 8);
  ctx.stroke();

  const tx = PAD + photoSize + 12;
  text('Driver', captionDriverY, 10, 600, SLATE_500, 'left', tx);
  text(data.driverName, nameY, NAME, 700, SLATE_900, 'left', tx);
  text(`Badge: ${data.badgeCode || '—'}`, badgeY, BADGE, 600, SLATE_600, 'left', tx);

  // ---- vehicle card ----
  ctx.fillStyle = SLATE_50;
  roundRectPath(ctx, PAD, cardTop, CONTENT_W, cardBottom - cardTop, 8);
  ctx.fill();
  ctx.strokeStyle = SLATE_200;
  ctx.lineWidth = 1;
  roundRectPath(ctx, PAD, cardTop, CONTENT_W, cardBottom - cardTop, 8);
  ctx.stroke();

  const ix = PAD + CARD_PAD;
  text('Vehicle', cap1Y, 10, 600, SLATE_500, 'left', ix);
  text(data.vehicle, val1Y, VEHICLE, 700, SLATE_900, 'left', ix);
  text(data.detailCaption, cap2Y, 10, 600, SLATE_500, 'left', ix);
  if (data.detailYard) {
    // Yard name stays regular-sized; only the slot number is emphasised.
    ctx.font = font(700, YARD);
    const yardW = ctx.measureText(data.detailYard).width;
    text(data.detailYard, val2Y, YARD, 700, SLATE_900, 'left', ix);
    text(data.detailValue, val2Y, DETAIL, 800, SLATE_900, 'left', ix + yardW + 8);
  } else {
    text(data.detailValue, val2Y, DETAIL, 800, SLATE_900, 'left', ix);
  }

  // ---- footer ----
  rule(footRuleY, 1, SLATE_300);
  text(data.footnote, footY, FOOT, 500, SLATE_600);

  // ---- barcode ----
  if (barcode) {
    ctx.fillStyle = SLATE_900;
    for (const bar of barcode.bars) {
      ctx.fillRect(barcode.x0 + bar.x * barcode.scale, barTopY, bar.width * barcode.scale, barcode.h);
    }
    // Employee code and caption sit centred under the barcode symbol.
    const cx = barcode.x0 + barcode.w / 2;
    ctx.fillStyle = SLATE_600;
    ctx.font = font(600, 12);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(data.badgeCode, cx, barCodeY);
    ctx.fillStyle = SLATE_400;
    ctx.font = font(600, 9);
    ctx.fillText('Driver badge', cx, barCaptionY);
  }

  return withPngDpi(canvas.toDataURL('image/png'));
}