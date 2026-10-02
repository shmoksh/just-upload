// Minimal, structurally valid image headers for tests. They carry no pixels, which is
// all the header parser and the in-page quick check ever look at.

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];
const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));

function pngChunk(type: string, data: number[] = []): number[] {
  return [...u32(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
}

export function pngBytes({
  width = 100,
  height = 80,
  colorType = 6,
  extra = [] as string[],
  truncated = false,
} = {}): Uint8Array<ArrayBuffer> {
  const ihdr = [...u32(width), ...u32(height), 8, colorType, 0, 0, 0];
  const bytes = [
    0x89,
    ...ascii('PNG\r\n\x1a\n'),
    ...pngChunk('IHDR', ihdr),
    ...extra.flatMap((type) => pngChunk(type, [0, 0, 0, 0])),
    ...(truncated ? [] : pngChunk('IEND')),
  ];
  return new Uint8Array(bytes);
}

export function jpegBytes({
  width = 100,
  height = 80,
  orientation,
}: { width?: number; height?: number; orientation?: number } = {}): Uint8Array<ArrayBuffer> {
  const bytes = [0xff, 0xd8];
  if (orientation) {
    const tiff = [
      ...ascii('MM'),
      0,
      42,
      ...u32(8),
      ...u16(1),
      ...u16(0x0112),
      ...u16(3),
      ...u32(1),
      ...u16(orientation),
      0,
      0,
      ...u32(0),
    ];
    const exif = [...ascii('Exif'), 0, 0, ...tiff];
    bytes.push(0xff, 0xe1, ...u16(exif.length + 2), ...exif);
  }
  bytes.push(
    0xff,
    0xc0,
    ...u16(17),
    8,
    ...u16(height),
    ...u16(width),
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  );
  bytes.push(0xff, 0xda, ...u16(8), 1, 1, 0, 0, 63, 0, 0xff, 0xd9);
  return new Uint8Array(bytes);
}

export function webpBytes({
  width = 100,
  height = 80,
  alpha = false,
  animated = false,
} = {}): Uint8Array<ArrayBuffer> {
  const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
  const vp8x = [
    ...ascii('VP8X'),
    10,
    0,
    0,
    0,
    (alpha ? 0x10 : 0) | (animated ? 0x02 : 0),
    0,
    0,
    0,
    ...le24(width - 1),
    ...le24(height - 1),
  ];
  const size = 4 + vp8x.length;
  return new Uint8Array([
    ...ascii('RIFF'),
    size & 255,
    (size >>> 8) & 255,
    0,
    0,
    ...ascii('WEBP'),
    ...vp8x,
  ]);
}

function box(type: string, payload: number[], full = false): number[] {
  const body = full ? [0, 0, 0, 0, ...payload] : payload;
  return [...u32(8 + body.length), ...ascii(type), ...body];
}

export function heicBytes({
  width = 4032,
  height = 3024,
  brand = 'heic',
  compatible = ['mif1', 'heic'],
  /** Colour properties, e.g. `nclxColour(12, 13)` or `iccColour(profile)`. */
  colours = [] as number[][],
} = {}): Uint8Array<ArrayBuffer> {
  const ftyp = box('ftyp', [...ascii(brand), 0, 0, 0, 0, ...compatible.flatMap(ascii)]);
  const ispe = box('ispe', [...u32(width), ...u32(height)], true);
  const meta = box('meta', box('iprp', box('ipco', [...ispe, ...colours.flat()])), true);
  return new Uint8Array([...ftyp, ...meta]);
}

/** A HEIF 'colr' property with H.273 code points. */
export function nclxColour(primaries: number, transfer: number, matrix = 6): number[] {
  return box('colr', [...ascii('nclx'), ...u16(primaries), ...u16(transfer), ...u16(matrix), 0x80]);
}

/** A HEIF 'colr' property carrying an ICC profile. */
export function iccColour(profile: Uint8Array): number[] {
  return box('colr', [...ascii('prof'), ...profile]);
}

const s15 = (value: number) => u32(Math.round(value * 65536) >>> 0);

/**
 * A minimal RGB matrix-and-curves ICC profile: three colorants (XYZ, D50) and one tone
 * curve for all channels, either an ICC 'para' curve or a plain gamma.
 */
export function iccProfile({
  colorants,
  curve,
}: {
  colorants: readonly [readonly number[], readonly number[], readonly number[]];
  curve: { para: number[]; type: number } | { gamma: number };
}): Uint8Array {
  const xyz = (values: readonly number[]) => [...ascii('XYZ '), 0, 0, 0, 0, ...values.flatMap(s15)];
  const trc =
    'gamma' in curve
      ? [...ascii('curv'), 0, 0, 0, 0, ...u32(1), ...u16(Math.round(curve.gamma * 256)), 0, 0]
      : [...ascii('para'), 0, 0, 0, 0, ...u16(curve.type), 0, 0, ...curve.para.flatMap(s15)];
  const tags: [string, number[]][] = [
    ['rXYZ', xyz(colorants[0])],
    ['gXYZ', xyz(colorants[1])],
    ['bXYZ', xyz(colorants[2])],
    ['rTRC', trc],
    ['gTRC', trc],
    ['bTRC', trc],
  ];
  let offset = 128 + 4 + tags.length * 12;
  const table: number[] = [];
  const data: number[] = [];
  for (const [signature, body] of tags) {
    table.push(...ascii(signature), ...u32(offset), ...u32(body.length));
    data.push(...body);
    offset += body.length;
  }
  const header = new Array<number>(128).fill(0);
  header.splice(0, 4, ...u32(offset));
  header.splice(12, 4, ...ascii('mntr'));
  header.splice(16, 4, ...ascii('RGB '));
  header.splice(20, 4, ...ascii('XYZ '));
  header.splice(36, 4, ...ascii('acsp'));
  return new Uint8Array([...header, ...u32(tags.length), ...table, ...data]);
}

export function fileOf(bytes: Uint8Array<ArrayBuffer>, name: string, type = ''): File {
  return new File([bytes], name, { type });
}
