import { useMemo } from 'react';

/**
 * Code 128 (Set B) — the industrial high-density alphanumeric symbology — rendered
 * as a tiny bit of inline SVG. Employee codes ("BIO-001", "10743", "EMP-001") are
 * all valid Set B characters (ASCII 32–126), so no dependency or mix-mode switching
 * is needed and the output prints crisply on laser / label printers.
 *
 * Pattern table per ISO/IEC 15417 (107 symbols, each 11 modules; stop = 13).
 */
const PATTERNS: readonly string[] = [
  '11011001100', '11001101100', '11001100110', '10010011000', '10010001100', '10001001100',
  '10011001000', '10011000100', '10001100100', '11001001000', '11001000100', '11000100100',
  '10110011100', '10011011100', '10011001110', '10111001100', '10011101100', '10011100110',
  '11001110010', '11001011100', '11001001110', '11011100100', '11001110100', '11101101110',
  '11101001100', '11100101100', '11100100110', '11101100100', '11100110100', '11100110010',
  '11011011000', '11011000110', '11000110110', '10100011000', '10001011000', '10001000110',
  '10110001000', '10001101000', '10001100010', '11010001000', '11000101000', '11000100010',
  '10110111000', '10110001110', '10001101110', '10111011000', '10111000110', '10001110110',
  '11101110110', '11010001110', '11000101110', '11011101000', '11011100010', '11011101110',
  '11101011000', '11101000110', '11100010110', '11101101000', '11101100010', '11100011010',
  '11101111010', '11001000010', '11110001010', '10100110000', '10100001100', '10010110000',
  '10010000110', '10000101100', '10000100110', '10110010000', '10110000100', '10011010000',
  '10011000010', '10000110100', '10000110010', '11000010010', '11001010000', '11110111010',
  '11000010100', '10001111010', '10100111100', '10010111100', '10010011110', '10111100100',
  '10011110100', '10011110010', '11110100100', '11110010100', '11110010010', '11011011110',
  '11011110110', '11110110110', '10101111000', '10100011110', '10001011110', '10111101000',
  '10111100010', '11110101000', '11110100010', '10111011110', '10111101110', '11101011110',
  '11110101110', '11010000100', '11010010000', '11010011100', '1100011101011'
];

const START_B = 104;
const STOP = 106;
// Space needed on either side of a Code 128 symbol to start/stop scanning.
const QUIET_ZONE_MODULES = 10;

export function canEncodeCode128(code: string): boolean {
  return code.length > 0 && [...code].every(c => {
    const n = c.charCodeAt(0);
    return n >= 32 && n <= 126;
  });
}

/**
 * Full module bit pattern for the symbol: Start B, data, checksum, stop.
 * Throws when the input cannot be encoded in Code 128 Set B.
 */
function code128Bits(code: string): string {
  if (!canEncodeCode128(code)) {
    throw new Error('Only printable ASCII (32–126) can be encoded as a Code 128 barcode');
  }
  const values = [...code].map(c => c.charCodeAt(0) - 32);
  // Mod-103 weighted checksum: start value + sum(value_n × n), n starting at 1.
  let checksum = START_B;
  values.forEach((v, i) => { checksum = (checksum + v * (i + 1)) % 103; });

  return [PATTERNS[START_B], ...values.map(v => PATTERNS[v]), PATTERNS[checksum], PATTERNS[STOP]].join('');
}

export interface BarcodeBar { x: number; width: number; }

/**
 * Bar rectangles (in module units, x already offset by the quiet zone) plus the
 * total width in modules. Drawn as same-unit rects so one barcode is never
 * stretched out of proportion (which would stop scanners from reading it).
 */
export function code128Bars(code: string): { bars: BarcodeBar[]; widthModules: number } {
  const bits = code128Bits(code);
  const bars: BarcodeBar[] = [];
  let x = QUIET_ZONE_MODULES;
  for (let i = 0; i < bits.length;) {
    if (bits[i] === '1') {
      let j = i;
      while (j < bits.length && bits[j] === '1') j += 1;
      bars.push({ x, width: j - i });
      x += j - i;
      i = j;
    } else {
      let j = i;
      while (j < bits.length && bits[j] === '0') j += 1;
      x += j - i;
      i = j;
    }
  }
  return { bars, widthModules: QUIET_ZONE_MODULES + bits.length + QUIET_ZONE_MODULES };
}

interface BarcodeProps {
  code: string;
  height?: number;
  className?: string;
}

/** Render a Code 128 barcode for a driver employee code. */
export function Barcode({ code, height = 48, className }: BarcodeProps) {
  const view = useMemo(() => {
    try { return code128Bars(code); } catch { return null; }
  }, [code]);

  if (!view) return null;

  // 2px per module keeps every bar an even pixel width; maxWidth/h-auto allow the
  // whole symbol to shrink uniformly inside a narrow label without distorting modules.
  const px = view.widthModules * 2;
  return (
    <svg
      viewBox={`0 0 ${view.widthModules} ${height}`}
      width={px}
      height={height}
      role="img"
      aria-label={`Barcode ${code}`}
      className={`text-slate-900 ${className ?? ''}`}
      style={{ maxWidth: '100%', height: 'auto' }}
    >
      {view.bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.width} height={height} fill="currentColor" />
      ))}
    </svg>
  );
}