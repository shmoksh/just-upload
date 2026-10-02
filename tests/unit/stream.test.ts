// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { detectFormat, parseHeader } from '../../src/images/headers';
import { padTo } from '../../src/images/pad';
import { STREAM_DECODERS } from '../../src/images/stream';
import { decodeBmpStream } from '../../src/images/stream/bmp';
import { RowDownscaler, workingSize } from '../../src/images/stream/downscale';
import { decodeJpegStream } from '../../src/images/stream/jpeg';
import { decodePngStream } from '../../src/images/stream/png';
import { decodeTiffStream } from '../../src/images/stream/tiff';
import { LIMITS } from '../../src/security/limits';
import { errorCode, ProcessingError } from '../../src/utils/errors';
import { iccProfile } from './helpers/images';
import { writeTiff } from './helpers/tiff';

const full = (width: number, height: number) => ({ width, height });

/** RGBA pixels of a small deterministic test pattern. */
function pattern(width: number, height: number, alpha = false): number[] {
  const out: number[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      out.push(
        (x * 37 + y * 11) % 256,
        (x * 5 + y * 71) % 256,
        (x * y * 13) % 256,
        alpha ? (x * 23 + y * 3) % 256 : 255,
      );
  return out;
}

// ---- PNG writing, enough to exercise every decoder path ----

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));
function chunk(type: string, data: Uint8Array | number[]): number[] {
  return [...u32(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
}

/** Applies PNG filter `type` to `row` given the previous row, as an encoder would. */
function filter(type: number, row: number[], previous: number[], step: number): number[] {
  return row.map((value, i) => {
    const a = i >= step ? row[i - step]! : 0;
    const b = previous[i] ?? 0;
    const c = i >= step ? (previous[i - step] ?? 0) : 0;
    const predictor =
      type === 0
        ? 0
        : type === 1
          ? a
          : type === 2
            ? b
            : type === 3
              ? (a + b) >> 1
              : (() => {
                  const p = a + b - c;
                  const pa = Math.abs(p - a);
                  const pb = Math.abs(p - b);
                  const pc = Math.abs(p - c);
                  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
                })();
    return (value - predictor + 256) % 256;
  });
}

function png({
  width,
  height,
  colorType,
  depth,
  rows,
  extra = [],
  idatPieces = 1,
  interlace = 0,
}: {
  width: number;
  height: number;
  colorType: number;
  depth: number;
  /** Raw row bytes, before filtering. */
  rows: number[][];
  extra?: number[][];
  idatPieces?: number;
  interlace?: number;
}): Blob {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]!;
  const step = Math.max(1, (channels * depth) / 8);
  const filtered: number[] = [];
  rows.forEach((row, y) => {
    const type = y % 5; // every filter type in turn
    filtered.push(type, ...filter(type, row, rows[y - 1] ?? [], step));
  });
  const compressed = deflateSync(Uint8Array.from(filtered));
  const pieceSize = Math.ceil(compressed.length / idatPieces);
  const idats: number[] = [];
  for (let i = 0; i < compressed.length; i += pieceSize)
    idats.push(...chunk('IDAT', compressed.subarray(i, i + pieceSize)));
  const ihdr = chunk('IHDR', [...u32(width), ...u32(height), depth, colorType, 0, 0, interlace]);
  return new Blob([
    Uint8Array.from([
      137,
      80,
      78,
      71,
      13,
      10,
      26,
      10,
      ...ihdr,
      ...extra.flat(),
      ...idats,
      ...chunk('IEND', []),
    ]),
  ]);
}

const decodeError = async (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => errorCode(error),
  );

describe('streaming PNG decoding', () => {
  it('reads RGBA through every row filter, across several IDAT chunks', async () => {
    const pixels = pattern(7, 9, true);
    const rows = Array.from({ length: 9 }, (_, y) => pixels.slice(y * 28, y * 28 + 28));
    const decoded = await decodePngStream(
      png({ width: 7, height: 9, colorType: 6, depth: 8, rows, idatPieces: 4 }),
      full,
    );
    expect([decoded.width, decoded.height, decoded.fullWidth, decoded.fullHeight]).toEqual([
      7, 9, 7, 9,
    ]);
    expect(Array.from(decoded.pixels)).toEqual(pixels);
    expect(decoded.transparent).toBe(true);
  });

  it('reads RGB with a transparent colour key, and 16-bit samples', async () => {
    const rgb = [
      [10, 20, 30, 40, 50, 60],
      [40, 50, 60, 70, 80, 90],
    ];
    const keyed = await decodePngStream(
      png({
        width: 2,
        height: 2,
        colorType: 2,
        depth: 8,
        rows: rgb,
        extra: [chunk('tRNS', [0, 40, 0, 50, 0, 60])],
      }),
      full,
    );
    // Keyed pixels become fully transparent; an invisible pixel carries no colour.
    expect(Array.from(keyed.pixels)).toEqual([
      10, 20, 30, 255, 0, 0, 0, 0, 0, 0, 0, 0, 70, 80, 90, 255,
    ]);

    const wide = await decodePngStream(
      png({
        width: 1,
        height: 1,
        colorType: 2,
        depth: 16,
        rows: [[0x12, 0x34, 0xab, 0xcd, 0xff, 0x00]],
      }),
      full,
    );
    expect(Array.from(wide.pixels)).toEqual([0x12, 0xab, 0xff, 255]);
  });

  it('reads palettes with transparency, and 1-bit greyscale', async () => {
    const palette = await decodePngStream(
      png({
        width: 4,
        height: 1,
        colorType: 3,
        depth: 2,
        rows: [[0b00011011]],
        extra: [
          chunk('PLTE', [255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9]),
          chunk('tRNS', [255, 128]),
        ],
      }),
      full,
    );
    expect(Array.from(palette.pixels)).toEqual([
      255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 9, 9, 9, 255,
    ]);

    const bits = await decodePngStream(
      png({ width: 8, height: 1, colorType: 0, depth: 1, rows: [[0b10100000]] }),
      full,
    );
    expect(Array.from(bits.pixels.filter((_, i) => i % 4 === 0))).toEqual([
      255, 0, 255, 0, 0, 0, 0, 0,
    ]);
  });

  it('averages down to the working size', async () => {
    const rows = [
      [0, 0, 0, 100, 100, 100],
      [200, 200, 200, 255, 255, 255],
    ];
    const small = await decodePngStream(
      png({ width: 2, height: 2, colorType: 2, depth: 8, rows }),
      () => ({
        width: 1,
        height: 1,
      }),
    );
    expect([small.fullWidth, small.fullHeight, small.width, small.height]).toEqual([2, 2, 1, 1]);
    expect(Array.from(small.pixels.subarray(0, 3)).map((v) => Math.round(v))).toEqual([
      139, 139, 139,
    ]);
  });

  it('keeps an embedded colour profile', async () => {
    const profile = iccProfile({
      colorants: [
        [0.5, 0.25, 0],
        [0.3, 0.7, 0.04],
        [0.16, 0.06, 0.78],
      ],
      curve: { gamma: 2.2 },
    });
    const iccp = chunk('iCCP', [...ascii('P3'), 0, 0, ...deflateSync(profile)]);
    const decoded = await decodePngStream(
      png({ width: 1, height: 1, colorType: 0, depth: 8, rows: [[7]], extra: [iccp] }),
      full,
    );
    expect(decoded.color?.kind).toBe('icc');
    expect(decoded.color?.kind === 'icc' && Array.from(decoded.color.profile)).toEqual(
      Array.from(profile),
    );
  });

  it('cannot stream interlaced or broken files', async () => {
    expect(
      await decodeError(
        decodePngStream(
          png({ width: 1, height: 1, colorType: 0, depth: 8, rows: [[1]], interlace: 1 }),
          full,
        ),
      ),
    ).toBe('too-large-to-process');
    const good = await png({
      width: 4,
      height: 4,
      colorType: 0,
      depth: 8,
      rows: [
        [1, 2, 3, 4],
        [1, 2, 3, 4],
        [1, 2, 3, 4],
        [1, 2, 3, 4],
      ],
    }).arrayBuffer();
    expect(
      await decodeError(decodePngStream(new Blob([good.slice(0, good.byteLength - 20)]), full)),
    ).toBe('damaged');
    expect(await decodeError(decodePngStream(new Blob([new Uint8Array(40)]), full))).toBe(
      'damaged',
    );
  });
});

// ---- BMP writing ----

function bmp({
  width,
  height,
  bits,
  topDown = false,
  pixel,
  compression = 0,
  masks = [] as number[],
  palette = [] as number[],
}: {
  width: number;
  height: number;
  bits: number;
  topDown?: boolean;
  pixel: (x: number, y: number) => number[];
  compression?: number;
  masks?: number[];
  palette?: number[];
}): Blob {
  const stride = Math.floor((bits * width + 31) / 32) * 4;
  const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
  const extra = [...masks.flatMap(le32), ...palette];
  const dataOffset = 14 + 40 + extra.length;
  const rows: number[] = [];
  for (let i = 0; i < height; i++) {
    const y = topDown ? i : height - 1 - i;
    const row: number[] = [];
    for (let x = 0; x < width; x++) row.push(...pixel(x, y));
    while (row.length < stride) row.push(0);
    rows.push(...row);
  }
  const header = [
    ...ascii('BM'),
    ...le32(dataOffset + rows.length),
    0,
    0,
    0,
    0,
    ...le32(dataOffset),
    ...le32(40),
    ...le32(width),
    ...le32(topDown ? -height >>> 0 : height),
    ...le16(1),
    ...le16(bits),
    ...le32(compression),
    ...le32(rows.length),
    ...le32(2835),
    ...le32(2835),
    ...le32(palette.length / 4),
    ...le32(0),
  ];
  return new Blob([Uint8Array.from([...header, ...extra, ...rows])]);
}

describe('streaming BMP decoding', () => {
  const expected = (width: number, height: number) => {
    const out: number[] = [];
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) out.push(x * 40, y * 50, 99, 255);
    return out;
  };

  it('reads bottom-up 24-bit and top-down 32-bit files the right way up', async () => {
    const bottomUp = await decodeBmpStream(
      bmp({ width: 3, height: 4, bits: 24, pixel: (x, y) => [99, y * 50, x * 40] }),
      full,
    );
    expect(Array.from(bottomUp.pixels)).toEqual(expected(3, 4));
    const topDown = await decodeBmpStream(
      bmp({
        width: 3,
        height: 4,
        bits: 32,
        topDown: true,
        pixel: (x, y) => [99, y * 50, x * 40, 0],
      }),
      full,
    );
    expect(Array.from(topDown.pixels)).toEqual(expected(3, 4));
  });

  it('reads 8-bit palettes and 16-bit bit fields', async () => {
    const indexed = await decodeBmpStream(
      bmp({
        width: 2,
        height: 1,
        bits: 8,
        pixel: (x) => [x],
        palette: [3, 2, 1, 0, 30, 20, 10, 0],
      }),
      full,
    );
    expect(Array.from(indexed.pixels)).toEqual([1, 2, 3, 255, 10, 20, 30, 255]);
    const fields = await decodeBmpStream(
      bmp({
        width: 1,
        height: 1,
        bits: 16,
        compression: 3,
        masks: [0xf800, 0x07e0, 0x001f],
        pixel: () => [0x00, 0xf8],
      }),
      full,
    );
    expect(Array.from(fields.pixels)).toEqual([255, 0, 0, 255]);
  });

  it('refuses compressed rows, which cannot be read in blocks', async () => {
    expect(
      await decodeError(
        decodeBmpStream(
          bmp({ width: 1, height: 1, bits: 8, compression: 1, pixel: () => [0] }),
          full,
        ),
      ),
    ).toBe('too-large-to-process');
  });
});

describe('downscaling rows', () => {
  it('averages by area and weights colour by alpha', () => {
    const scaler = new RowDownscaler(2, 2, 1, 1);
    scaler.addRow(Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 0]), 0);
    scaler.addRow(Uint8Array.from([255, 0, 0, 255, 255, 0, 0, 255]), 1);
    const { pixels, transparent } = scaler.finish();
    // The transparent blue pixel adds no colour, only transparency.
    expect(Array.from(pixels)).toEqual([255, 0, 0, 191]);
    expect(transparent).toBe(true);
  });
  it('picks a working size that keeps the shape', () => {
    expect(workingSize(40_000, 30_000, 12_000_000, 16_384)).toEqual({ width: 4000, height: 3000 });
    expect(workingSize(100_000, 1_000, 64_000_000, 16_384)).toEqual({ width: 16_384, height: 163 });
    expect(workingSize(800, 600, 64_000_000, 16_384)).toEqual({ width: 800, height: 600 });
  });
});

describe('streaming TIFF decoding', () => {
  /** `samples` values per pixel of a deterministic pattern. */
  const samplesOf = (width: number, height: number, samples: number, wide = false) => {
    const out: number[] = [];
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        for (let s = 0; s < samples; s++) {
          const value = (x * 41 + y * 17 + s * 89) % 256;
          if (wide) out.push(value, (x + s) % 256);
          else out.push(value);
        }
    return Uint8Array.from(out);
  };
  const rgbaOf = (data: Uint8Array, samples: number) => {
    const out: number[] = [];
    for (let i = 0; i < data.length; i += samples)
      out.push(data[i]!, data[i + 1]!, data[i + 2]!, samples === 4 ? data[i + 3]! : 255);
    return out;
  };

  it('matches a full decode of a real LZW TIFF', async () => {
    const bytes = readFileSync(
      fileURLToPath(new URL('../fixtures/photo-320x240.tif', import.meta.url)),
    );
    const UTIF = ((await import('utif2')) as unknown as { default: typeof import('utif2') })
      .default;
    const ifds = UTIF.decode(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    UTIF.decodeImage(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      ifds[0]!,
    );
    const reference = UTIF.toRGBA8(ifds[0]!);
    const streamed = await decodeTiffStream(new Blob([bytes]), full);
    expect([streamed.width, streamed.height]).toEqual([320, 240]);
    expect(Buffer.from(streamed.pixels).equals(Buffer.from(reference))).toBe(true);
  });

  it('reads strips with LZW and prediction, in either byte order', async () => {
    const data = samplesOf(5, 7, 3);
    for (const little of [true, false]) {
      const decoded = await decodeTiffStream(
        writeTiff({
          width: 5,
          height: 7,
          samples: 3,
          bits: 8,
          photometric: 2,
          data,
          compression: 5,
          predictor: 2,
          rowsPerStrip: 3,
          little,
        }),
        full,
      );
      expect(Array.from(decoded.pixels)).toEqual(rgbaOf(data, 3));
    }
  });

  it('reads tiles that overhang the edge, compressed with Deflate', async () => {
    const data = samplesOf(6, 5, 3);
    const decoded = await decodeTiffStream(
      writeTiff({
        width: 6,
        height: 5,
        samples: 3,
        bits: 8,
        photometric: 2,
        data,
        compression: 8,
        tile: { width: 4, height: 4 },
        little: false,
      }),
      full,
    );
    expect(Array.from(decoded.pixels)).toEqual(rgbaOf(data, 3));
  });

  it('recognises BigTIFF and reads its size from the header', async () => {
    const blob = writeTiff({
      width: 5,
      height: 7,
      samples: 3,
      bits: 8,
      photometric: 2,
      data: samplesOf(5, 7, 3),
      big: true,
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(detectFormat(bytes)).toBe('tiff');
    expect(parseHeader(bytes)).toMatchObject({ format: 'tiff', width: 5, height: 7 });
  });

  it('reads BigTIFF, with the directory after the image and a preview stored first', async () => {
    const data = samplesOf(5, 7, 3);
    const decoded = await decodeTiffStream(
      writeTiff({
        width: 5,
        height: 7,
        samples: 3,
        bits: 8,
        photometric: 2,
        data,
        big: true,
        previewFirst: true,
      }),
      full,
    );
    expect([decoded.fullWidth, decoded.fullHeight]).toEqual([5, 7]);
    expect(Array.from(decoded.pixels)).toEqual(rgbaOf(data, 3));
  });

  it('reads separate colour planes, 16-bit samples with alpha, and PackBits', async () => {
    const data = samplesOf(4, 3, 3);
    const planar = await decodeTiffStream(
      writeTiff({
        width: 4,
        height: 3,
        samples: 3,
        bits: 8,
        photometric: 2,
        data,
        planar: 2,
        rowsPerStrip: 2,
        compression: 32773,
      }),
      full,
    );
    expect(Array.from(planar.pixels)).toEqual(rgbaOf(data, 3));

    const wide = samplesOf(3, 2, 4, true);
    const decoded16 = await decodeTiffStream(
      writeTiff({
        width: 3,
        height: 2,
        samples: 4,
        bits: 16,
        photometric: 2,
        data: wide,
        extraSamples: [2],
        predictor: 2,
      }),
      full,
    );
    // Little-endian 16-bit: each sample's high byte is its second byte.
    const high = Array.from({ length: wide.length / 2 }, (_, i) => wide[i * 2 + 1]!);
    expect(Array.from(decoded16.pixels)).toEqual(high);
  });

  it('reads white-is-zero greyscale, palettes and CMYK', async () => {
    const gray = Uint8Array.from([0, 64, 255, 10]);
    const inverted = await decodeTiffStream(
      writeTiff({
        width: 2,
        height: 2,
        samples: 1,
        bits: 8,
        photometric: 0,
        data: gray,
        compression: 32773,
      }),
      full,
    );
    expect(Array.from(inverted.pixels.filter((_, i) => i % 4 === 0))).toEqual([255, 191, 0, 245]);

    const colorMap = new Array<number>(48).fill(0);
    colorMap[1] = 0xff00; // red of index 1
    colorMap[16 + 2] = 0x8000; // green of index 2
    const indexed = await decodeTiffStream(
      writeTiff({
        width: 2,
        height: 1,
        samples: 1,
        bits: 4,
        photometric: 3,
        data: Uint8Array.from([0x12]),
        colorMap,
      }),
      full,
    );
    expect(Array.from(indexed.pixels)).toEqual([255, 0, 0, 255, 0, 128, 0, 255]);

    const cmyk = await decodeTiffStream(
      writeTiff({
        width: 1,
        height: 1,
        samples: 4,
        bits: 8,
        photometric: 5,
        data: Uint8Array.from([0, 255, 255, 0]),
      }),
      full,
    );
    expect(Array.from(cmyk.pixels)).toEqual([255, 0, 0, 255]);
  });

  it('reports orientation and colour profile, and averages down', async () => {
    const profile = iccProfile({
      colorants: [
        [0.5, 0.25, 0],
        [0.3, 0.7, 0.04],
        [0.16, 0.06, 0.78],
      ],
      curve: { gamma: 2.2 },
    });
    const data = Uint8Array.from([0, 0, 0, 100, 100, 100, 200, 200, 200, 255, 255, 255]);
    const decoded = await decodeTiffStream(
      writeTiff({
        width: 2,
        height: 2,
        samples: 3,
        bits: 8,
        photometric: 2,
        data,
        orientation: 6,
        icc: profile,
      }),
      () => ({ width: 1, height: 1 }),
    );
    expect(decoded.orientation).toBe(6);
    expect(decoded.color?.kind).toBe('icc');
    expect(Array.from(decoded.pixels.subarray(0, 3)).map(Math.round)).toEqual([139, 139, 139]);
  });
});

describe('streaming JPEG decoding at one eighth size', () => {
  const folder = new URL('../fixtures/jpeg/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', folder), 'utf8')) as Record<
    string,
    { reference: string; width: number; height: number; profileBytes?: number }
  >;
  /** Mean and largest difference from libjpeg's own one-eighth decode. */
  const compare = async (name: string) => {
    const entry = manifest[name]!;
    const decoded = await decodeJpegStream(new Blob([readFileSync(new URL(name, folder))]), full);
    const reference = readFileSync(new URL(entry.reference, folder));
    expect([decoded.width, decoded.height]).toEqual([entry.width, entry.height]);
    let total = 0;
    let largest = 0;
    for (let p = 0; p < entry.width * entry.height; p++)
      for (let c = 0; c < 3; c++) {
        const difference = Math.abs(decoded.pixels[p * 4 + c]! - reference[p * 3 + c]!);
        total += difference;
        largest = Math.max(largest, difference);
      }
    return { decoded, mean: total / (entry.width * entry.height * 3), largest };
  };

  it('matches libjpeg exactly for full-resolution colour, greyscale and CMYK', async () => {
    for (const name of ['baseline-444-restart.jpg', 'gray.jpg', 'cmyk.jpg']) {
      const { mean, largest, decoded } = await compare(name);
      expect(mean, name).toBeLessThan(0.5);
      expect(largest, name).toBeLessThanOrEqual(1);
      expect([decoded.fullWidth, decoded.fullHeight]).toEqual([157, 119]);
    }
  });

  it('matches libjpeg closely for subsampled colour, baseline and progressive', async () => {
    for (const name of ['baseline-420.jpg', 'baseline-422.jpg', 'progressive-420.jpg']) {
      const { mean, largest } = await compare(name);
      // Only how shared colour is blended at block edges differs from libjpeg.
      expect(mean, name).toBeLessThan(3);
      expect(largest, name).toBeLessThan(40);
    }
  });

  it('reports the EXIF orientation and joins a colour profile split across segments', async () => {
    const { decoded } = await compare('rotated-6.jpg');
    expect(decoded.orientation).toBe(6);
    const profiled = await decodeJpegStream(
      new Blob([readFileSync(new URL('profile.jpg', folder))]),
      full,
    );
    expect(profiled.color?.kind).toBe('icc');
    if (profiled.color?.kind === 'icc') {
      expect(profiled.color.profile.length).toBe(manifest['profile.jpg']!.profileBytes);
      expect(String.fromCharCode(...profiled.color.profile.subarray(4, 15))).toBe('Just Upload');
    }
  });

  it('refuses kinds of JPEG it cannot read at one eighth size', async () => {
    // A 12-bit frame header (SOF1 with precision 12).
    const twelveBit = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xc1, 0, 11, 12, 0, 8, 0, 8, 1, 1, 0x11, 0,
    ]);
    expect(await decodeError(decodeJpegStream(new Blob([twelveBit]), full))).toBe(
      'too-large-to-process',
    );
  });
});

describe('damaged and hostile files', () => {
  // The streaming decoders read bytes from any file a person picks. Corrupted copies of
  // valid files must end in an image or a ProcessingError, which fails open: never in
  // another exception, a hang or a runaway allocation.
  const working = (width: number, height: number) =>
    workingSize(width, height, LIMITS.maxWorkingPixels, LIMITS.maxWorkingDimension);

  /** Seeded variants: a few changed bytes, many changed bytes, or a cut-off file. */
  function variants(
    bytes: Uint8Array<ArrayBuffer>,
    count: number,
    seed: number,
  ): Uint8Array<ArrayBuffer>[] {
    let state = seed;
    const random = () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    return Array.from({ length: count }, (_, i) => {
      if (i % 3 === 2) return bytes.slice(0, Math.floor(random() * bytes.length));
      const copy = bytes.slice();
      const changes = 1 + Math.floor(random() * (i % 3 === 0 ? 3 : 24));
      for (let n = 0; n < changes; n++)
        copy[Math.floor(random() * copy.length)] = Math.floor(random() * 256);
      return copy;
    });
  }

  async function survives(
    decode: (file: Blob, sizeFor: typeof working) => Promise<unknown>,
    files: Blob[],
  ): Promise<string[]> {
    const unexpected: string[] = [];
    for (const [index, file] of files.entries()) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      for (const variant of variants(bytes, 300, 1000 + index)) {
        try {
          await decode(new Blob([variant]), working);
        } catch (error) {
          if (!(error instanceof ProcessingError)) unexpected.push(String(error));
        }
      }
    }
    return [...new Set(unexpected)];
  }

  const rowsOf = (pixels: number[], width: number, channels: number) =>
    Array.from({ length: pixels.length / (width * channels) }, (_, y) =>
      pixels.slice(y * width * channels, (y + 1) * width * channels),
    );

  it('PNG', { timeout: 60_000 }, async () => {
    const files = [
      png({
        width: 7,
        height: 9,
        colorType: 6,
        depth: 8,
        rows: rowsOf(pattern(7, 9, true), 7, 4),
        idatPieces: 3,
      }),
      png({
        width: 6,
        height: 4,
        colorType: 3,
        depth: 4,
        rows: Array.from({ length: 4 }, (_, y) => [0x01 + y, 0x23, 0x45]),
        extra: [
          chunk(
            'PLTE',
            Array.from({ length: 48 }, (_, i) => (i * 17) % 256),
          ),
        ],
      }),
      png({
        width: 5,
        height: 3,
        colorType: 0,
        depth: 16,
        rows: Array.from({ length: 3 }, (_, y) =>
          Array.from({ length: 10 }, (_, x) => (x * 29 + y * 7) % 256),
        ),
      }),
    ];
    expect(await survives(STREAM_DECODERS.png, files)).toEqual([]);
  });

  it('BMP', { timeout: 60_000 }, async () => {
    const files = [
      bmp({ width: 5, height: 4, bits: 24, pixel: (x, y) => [x * 40, y * 60, 90] }),
      bmp({
        width: 4,
        height: 3,
        bits: 32,
        compression: 3,
        masks: [0xff0000, 0xff00, 0xff, 0xff000000],
        pixel: (x, y) => [x * 50, y * 70, 30, 200],
      }),
      bmp({
        width: 3,
        height: 3,
        bits: 8,
        topDown: true,
        palette: Array.from({ length: 1024 }, (_, i) => (i * 13) % 256),
        pixel: (x, y) => [(x + y * 3) % 256],
      }),
    ];
    expect(await survives(STREAM_DECODERS.bmp, files)).toEqual([]);
  });

  it('TIFF and BigTIFF', { timeout: 60_000 }, async () => {
    const data = Uint8Array.from({ length: 9 * 7 * 3 }, (_, i) => (i * 41) % 256);
    const base = { width: 9, height: 7, samples: 3, bits: 8, photometric: 2, data } as const;
    const files = [
      writeTiff({ ...base, compression: 5, predictor: 2, rowsPerStrip: 3 }),
      writeTiff({ ...base, compression: 8, tile: { width: 4, height: 4 }, little: false }),
      writeTiff({ ...base, compression: 32773, rowsPerStrip: 2 }),
      writeTiff({ ...base, big: true, previewFirst: true }),
    ];
    expect(await survives(STREAM_DECODERS.tiff, files)).toEqual([]);
  });

  it('JPEG', { timeout: 60_000 }, async () => {
    const folder = new URL('../fixtures/jpeg/', import.meta.url);
    const files = [
      'baseline-420.jpg',
      'progressive-420.jpg',
      'baseline-444-restart.jpg',
      'cmyk.jpg',
    ].map((name) => new Blob([readFileSync(new URL(name, folder))]));
    expect(await survives(STREAM_DECODERS.jpeg, files)).toEqual([]);
  });
});

describe('padding a file up to a site’s minimum size', () => {
  it('adds JPEG comments after the APP segments: same picture, orientation and colour profile', async () => {
    const folder = new URL('../fixtures/jpeg/', import.meta.url);
    for (const name of ['baseline-420.jpg', 'rotated-6.jpg', 'profile.jpg']) {
      const original = new Blob([readFileSync(new URL(name, folder))], { type: 'image/jpeg' });
      const before = await decodeJpegStream(original, full);
      // One byte short, and more than one comment segment's worth.
      for (const size of [original.size + 1, original.size + 70_000]) {
        const padded = await padTo(original, 'jpeg', size);
        expect(padded.size, name).toBeGreaterThanOrEqual(size);
        expect(padded.size, name).toBeLessThan(size + 4);
        expect(padded.type).toBe('image/jpeg');
        const after = await decodeJpegStream(padded, full);
        expect(after.pixels, name).toEqual(before.pixels);
        expect(after.orientation, name).toBe(before.orientation);
        expect(after.color, name).toEqual(before.color);
      }
    }
  });

  it('adds a PNG text chunk before IEND with a valid checksum: same picture', async () => {
    const pixels = pattern(7, 9, true);
    const rows = Array.from({ length: 9 }, (_, y) => pixels.slice(y * 28, y * 28 + 28));
    const original = png({ width: 7, height: 9, colorType: 6, depth: 8, rows });
    const padded = await padTo(original, 'png', original.size + 30_000);
    expect(padded.size).toBe(original.size + 30_000);
    expect(Array.from((await decodePngStream(padded, full)).pixels)).toEqual(pixels);
    const bytes = new Uint8Array(await padded.arrayBuffer());
    const at = original.size - 12;
    const length = new DataView(bytes.buffer).getUint32(at);
    expect(String.fromCharCode(...bytes.subarray(at + 4, at + 16))).toBe('tEXtComment\0');
    expect(new DataView(bytes.buffer).getUint32(at + 8 + length)).toBe(
      crc32(bytes.subarray(at + 4, at + 8 + length)),
    );
    expect(String.fromCharCode(...bytes.subarray(-8, -4))).toBe('IEND');
  });

  it('leaves a file that is big enough alone, and refuses formats it cannot pad safely', async () => {
    const file = new Blob([new Uint8Array(100)], { type: 'image/webp' });
    expect(await padTo(file, 'webp', 50)).toBe(file);
    expect(await decodeError(padTo(file, 'webp', 500))).toBe('target-unreachable');
    expect(await decodeError(padTo(file, 'jpeg', 500))).toBe('target-unreachable');
  });
});
