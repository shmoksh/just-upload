// Colour management for the decoders that hand back raw pixel values (libheif for HEIC,
// UTIF for TIFF). Those values mean different colours depending on the file's colour
// profile: an iPhone photo is in Display P3, a camera or scanner file may be in Adobe RGB.
// Treated as plain sRGB, such photos look washed out. The browser already does this for
// every format it decodes itself.

/** What a file says about how its pixel values map to colours. */
export type ColorDescription =
  | { kind: 'icc'; profile: Uint8Array }
  /** HEIF and AVIF's compact form: code points from ITU-T H.273. */
  | { kind: 'nclx'; primaries: number; transfer: number };

type Matrix = readonly [number, number, number, number, number, number, number, number, number];
type Curve = (value: number) => number;
/** CIE xy of the red, green and blue primaries. */
type Chromaticities = readonly [number, number, number, number, number, number];

/** An RGB colour space: how to get from stored values to linear light, and on to XYZ. */
export interface RgbSpace {
  /** Linear RGB → XYZ, with columns for red, green and blue. */
  toXyz: Matrix;
  /** The white the XYZ values are relative to: 'D50' for ICC profiles, 'D65' for nclx. */
  white: 'D50' | 'D65';
  curves: readonly [Curve, Curve, Curve];
}

const srgbDecode: Curve = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const srgbEncode: Curve = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const linear: Curve = (v) => v;

/** sRGB and Display P3 as their ICC profiles state them, adapted to D50. */
const SRGB_D50: Matrix = [
  0.436065, 0.385147, 0.143066, 0.222488, 0.716873, 0.060608, 0.013916, 0.097076, 0.714096,
];
const DISPLAY_P3_D50: Matrix = [
  0.515121, 0.291977, 0.157104, 0.241196, 0.692245, 0.066574, -0.001053, 0.041885, 0.784073,
];

function multiply(a: Matrix, b: Matrix): Matrix {
  const out: number[] = [];
  for (let row = 0; row < 3; row++)
    for (let column = 0; column < 3; column++)
      out.push(
        a[row * 3]! * b[column]! +
          a[row * 3 + 1]! * b[3 + column]! +
          a[row * 3 + 2]! * b[6 + column]!,
      );
  return out as unknown as Matrix;
}

function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const determinant = a * A + b * B + c * C;
  if (Math.abs(determinant) < 1e-12) throw new Error('singular');
  return [
    A / determinant,
    -(b * i - c * h) / determinant,
    (b * f - c * e) / determinant,
    B / determinant,
    (a * i - c * g) / determinant,
    -(a * f - c * d) / determinant,
    C / determinant,
    -(a * h - b * g) / determinant,
    (a * e - b * d) / determinant,
  ];
}

/** Linear RGB → XYZ for primaries given as CIE xy chromaticities. */
function fromChromaticities(
  [rx, ry, gx, gy, bx, by]: Chromaticities,
  [wx, wy]: readonly [number, number],
): Matrix {
  const columns: Matrix = [
    rx / ry,
    gx / gy,
    bx / by,
    1,
    1,
    1,
    (1 - rx - ry) / ry,
    (1 - gx - gy) / gy,
    (1 - bx - by) / by,
  ];
  const white = [wx / wy, 1, (1 - wx - wy) / wy];
  const inverse = invert(columns);
  const scale = [0, 1, 2].map(
    (row) =>
      inverse[row * 3]! * white[0]! +
      inverse[row * 3 + 1]! * white[1]! +
      inverse[row * 3 + 2]! * white[2]!,
  );
  return columns.map((value, index) => value * scale[index % 3]!) as unknown as Matrix;
}

const D65: [number, number] = [0.3127, 0.329];
/** Colour primaries by their H.273 code point. */
const PRIMARIES: Record<number, Chromaticities | undefined> = {
  1: [0.64, 0.33, 0.3, 0.6, 0.15, 0.06], // BT.709, the same primaries as sRGB
  9: [0.708, 0.292, 0.17, 0.797, 0.131, 0.046], // BT.2020
  12: [0.68, 0.32, 0.265, 0.69, 0.15, 0.06], // Display P3
};
const SRGB_D65 = fromChromaticities(PRIMARIES[1]!, D65);

function s15Fixed16(data: DataView, offset: number): number {
  return data.getInt32(offset) / 65536;
}

/** Reads an ICC 'curv' or 'para' tone curve; undefined for anything else. */
function readCurve(
  bytes: Uint8Array,
  data: DataView,
  offset: number,
  size: number,
): Curve | undefined {
  if (offset + 12 > bytes.length || size < 12) return undefined;
  const type = String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (type === 'curv') {
    const count = data.getUint32(offset + 8);
    if (count === 0) return linear;
    if (offset + 12 + count * 2 > bytes.length) return undefined;
    if (count === 1) {
      const gamma = data.getUint16(offset + 12) / 256;
      return (v) => v ** gamma;
    }
    const table = Array.from(
      { length: count },
      (_, i) => data.getUint16(offset + 12 + i * 2) / 65535,
    );
    return (v) => {
      const position = Math.min(1, Math.max(0, v)) * (count - 1);
      const index = Math.floor(position);
      const next = table[Math.min(count - 1, index + 1)]!;
      return table[index]! + (next - table[index]!) * (position - index);
    };
  }
  if (type === 'para') {
    const kind = data.getUint16(offset + 8);
    const counts = [1, 3, 4, 5, 7];
    const count = counts[kind];
    if (count === undefined || offset + 12 + count * 4 > bytes.length) return undefined;
    const [g = 1, a = 1, b = 0, c = 0, d = 0, e = 0, f = 0] = Array.from(
      { length: count },
      (_, i) => s15Fixed16(data, offset + 12 + i * 4),
    );
    const power = (x: number) => (x > 0 ? x ** g : 0);
    if (kind === 0) return (v) => power(v);
    if (kind === 1) return (v) => (v >= -b / a ? power(a * v + b) : 0);
    if (kind === 2) return (v) => (v >= -b / a ? power(a * v + b) + c : c);
    if (kind === 3) return (v) => (v >= d ? power(a * v + b) : c * v);
    return (v) => (v >= d ? power(a * v + b) + e : c * v + f);
  }
  return undefined;
}

/**
 * Reads an RGB matrix-and-curves ICC profile, the kind photos and scans carry (sRGB,
 * Display P3, Adobe RGB, ProPhoto). Lookup-table profiles return undefined: those files
 * keep today's behaviour of being read as sRGB.
 */
export function iccSpace(profile: Uint8Array): RgbSpace | undefined {
  if (profile.length < 132) return undefined;
  const data = new DataView(profile.buffer, profile.byteOffset, profile.byteLength);
  const tag4 = (offset: number) => String.fromCharCode(...profile.subarray(offset, offset + 4));
  if (tag4(16) !== 'RGB ' || tag4(20) !== 'XYZ ') return undefined;
  const count = data.getUint32(128);
  if (count > 256 || 132 + count * 12 > profile.length) return undefined;
  const tags = new Map<string, { offset: number; size: number }>();
  for (let i = 0; i < count; i++) {
    const entry = 132 + i * 12;
    const offset = data.getUint32(entry + 4);
    const size = data.getUint32(entry + 8);
    if (offset + size > profile.length) return undefined;
    tags.set(tag4(entry), { offset, size });
  }
  const colorant = (name: string): [number, number, number] | undefined => {
    const tag = tags.get(name);
    if (!tag || tag.size < 20 || tag4(tag.offset) !== 'XYZ ') return undefined;
    return [0, 4, 8].map((step) => s15Fixed16(data, tag.offset + 8 + step)) as [
      number,
      number,
      number,
    ];
  };
  const curve = (name: string) => {
    const tag = tags.get(name);
    return tag && readCurve(profile, data, tag.offset, tag.size);
  };
  const [red, green, blue] = [colorant('rXYZ'), colorant('gXYZ'), colorant('bXYZ')];
  const curves = [curve('rTRC'), curve('gTRC'), curve('bTRC')];
  if (!red || !green || !blue || !curves[0] || !curves[1] || !curves[2]) return undefined;
  return {
    toXyz: [red[0], green[0], blue[0], red[1], green[1], blue[1], red[2], green[2], blue[2]],
    white: 'D50',
    curves: curves as [Curve, Curve, Curve],
  };
}

/** HEIF and AVIF colour code points; undefined for the ones a still photo never uses. */
export function nclxSpace(primaries: number, transfer: number): RgbSpace | undefined {
  const chromaticities = PRIMARIES[primaries];
  if (!chromaticities) return undefined;
  // sRGB and the video transfers (BT.709, BT.601, BT.2020) are displayed with the sRGB curve.
  const curve =
    transfer === 8 ? linear : [1, 6, 13, 14, 15].includes(transfer) ? srgbDecode : undefined;
  if (!curve) return undefined;
  return {
    toXyz: fromChromaticities(chromaticities, D65),
    white: 'D65',
    curves: [curve, curve, curve],
  };
}

export function spaceOf(color: ColorDescription | undefined): RgbSpace | undefined {
  if (!color) return undefined;
  return color.kind === 'icc'
    ? iccSpace(color.profile)
    : nclxSpace(color.primaries, color.transfer);
}

const close = (a: Matrix, b: Matrix, tolerance: number) =>
  a.every((value, index) => Math.abs(value - b[index]!) <= tolerance);

/** Whether the space's curves are the sRGB curve, sampled across the range. */
function hasSrgbCurves(space: RgbSpace): boolean {
  return space.curves.every((curve) =>
    [0.02, 0.2, 0.5, 0.8, 1].every((v) => Math.abs(curve(v) - srgbDecode(v)) < 0.002),
  );
}

export function isSrgb(space: RgbSpace): boolean {
  return (
    hasSrgbCurves(space) && close(space.toXyz, space.white === 'D50' ? SRGB_D50 : SRGB_D65, 0.003)
  );
}

/** Display P3 is the one wide space browsers can take directly, which is much faster. */
export function isDisplayP3(space: RgbSpace): boolean {
  const p3 = space.white === 'D50' ? DISPLAY_P3_D50 : fromChromaticities(PRIMARIES[12]!, D65);
  return hasSrgbCurves(space) && close(space.toXyz, p3, 0.003);
}

/**
 * Converts 8-bit RGBA pixel values in `space` to sRGB, in place. Colours outside sRGB
 * are clipped, as every browser does when it shows such a photo on an sRGB screen.
 */
export function convertToSrgb(pixels: Uint8ClampedArray, space: RgbSpace): void {
  const toSrgb = multiply(invert(space.white === 'D50' ? SRGB_D50 : SRGB_D65), space.toXyz);
  const decode = space.curves.map((curve) =>
    Float32Array.from({ length: 256 }, (_, i) => curve(i / 255)),
  ) as [Float32Array, Float32Array, Float32Array];
  const STEPS = 4096;
  const encode = Uint8ClampedArray.from({ length: STEPS + 1 }, (_, i) =>
    Math.round(srgbEncode(i / STEPS) * 255),
  );
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = toSrgb;
  const [dr, dg, db] = decode;
  const out = (v: number) => encode[v <= 0 ? 0 : v >= 1 ? STEPS : Math.round(v * STEPS)]!;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = dr[pixels[i]!]!;
    const g = dg[pixels[i + 1]!]!;
    const b = db[pixels[i + 2]!]!;
    pixels[i] = out(m0 * r + m1 * g + m2 * b);
    pixels[i + 1] = out(m3 * r + m4 * g + m5 * b);
    pixels[i + 2] = out(m6 * r + m7 * g + m8 * b);
  }
}

/**
 * Turns raw decoded pixels into a bitmap whose colours are right on screen and in the
 * output file. The canvas the pipeline draws into is sRGB.
 */
export async function managedBitmap(
  pixels: ImageData,
  color: ColorDescription | undefined,
): Promise<ImageBitmap> {
  const space = spaceOf(color);
  if (space && !isSrgb(space)) {
    if (isDisplayP3(space)) {
      // The browser converts Display P3 to the canvas's sRGB when the bitmap is drawn.
      return createImageBitmap(
        new ImageData(pixels.data, pixels.width, pixels.height, { colorSpace: 'display-p3' }),
      );
    }
    convertToSrgb(pixels.data, space);
  }
  return createImageBitmap(pixels);
}
