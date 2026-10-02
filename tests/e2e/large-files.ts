import { createWriteStream, type WriteStream } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

// Writers for images far larger than a browser can decode, built as the test runs.
// Each is red on its left half and blue on its right, so the result can be checked.

const RED = [220, 30, 30] as const;
const BLUE = [30, 60, 220] as const;

function write(stream: WriteStream, chunk: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) =>
    stream.write(chunk, (error) => (error ? reject(error) : resolve())),
  );
}
function close(stream: WriteStream): Promise<void> {
  return new Promise((resolve, reject) =>
    stream.end((error?: Error | null) => (error ? reject(error) : resolve())),
  );
}

const u32 = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);

/** One RGB row: red, then blue from the middle. */
function rgbRow(width: number): Uint8Array {
  const row = new Uint8Array(width * 3);
  for (let x = 0; x < width; x++) row.set(x < width / 2 ? RED : BLUE, x * 3);
  return row;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typed = new Uint8Array(4 + data.length);
  typed.set(Array.from(type, (c) => c.charCodeAt(0)));
  typed.set(data, 4);
  const out = new Uint8Array(8 + data.length + 4);
  out.set(u32(data.length));
  out.set(typed, 4);
  out.set(u32(crc32(typed)), 8 + data.length);
  return out;
}

export async function writeHugePng(path: string, width: number, height: number): Promise<void> {
  const stream = createWriteStream(path);
  await write(stream, Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10));
  await write(
    stream,
    pngChunk('IHDR', Uint8Array.of(...u32(width), ...u32(height), 8, 2, 0, 0, 0)),
  );
  // Rows are identical, so a band of them compresses to almost nothing.
  const row = rgbRow(width);
  const band = 256;
  const raw = new Uint8Array((row.length + 1) * band);
  for (let r = 0; r < band; r++) raw.set(row, r * (row.length + 1) + 1);
  // One zlib stream across all bands: deflate each band with a sync flush.
  const { createDeflate } = await import('node:zlib');
  const deflate = createDeflate({ level: 6 });
  const pieces: Buffer[] = [];
  deflate.on('data', (piece: Buffer) => pieces.push(piece));
  const drain = async () => {
    while (pieces.length) await write(stream, pngChunk('IDAT', pieces.shift()!));
  };
  for (let y = 0; y < height; y += band) {
    const rows = Math.min(band, height - y);
    await new Promise<void>((resolve) =>
      deflate.write(raw.subarray(0, (row.length + 1) * rows), () => resolve()),
    );
    await drain();
  }
  const ended = new Promise<void>((resolve) => deflate.on('end', () => resolve()));
  deflate.end();
  await ended;
  await drain();
  await write(stream, pngChunk('IEND', new Uint8Array(0)));
  await close(stream);
}

/** Uncompressed 24-bit, bottom-up: its size is width × height × 3 bytes. */
export async function writeHugeBmp(path: string, width: number, height: number): Promise<void> {
  const stride = Math.ceil((width * 3) / 4) * 4;
  const header = Buffer.alloc(54);
  header.write('BM', 0, 'ascii');
  header.writeUInt32LE(54 + stride * height, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(stride * height, 34);
  const stream = createWriteStream(path, { highWaterMark: 8 * 1024 * 1024 });
  await write(stream, header);
  const rgb = rgbRow(width);
  const row = new Uint8Array(stride);
  for (let x = 0; x < width; x++) row.set([rgb[x * 3 + 2]!, rgb[x * 3 + 1]!, rgb[x * 3]!], x * 3);
  const block = new Uint8Array(stride * 256);
  for (let r = 0; r < 256; r++) block.set(row, r * stride);
  for (let y = 0; y < height; y += 256)
    await write(stream, block.subarray(0, stride * Math.min(256, height - y)));
  await close(stream);
}

/** Tiled, Deflate-compressed, little-endian, with its directory at the end. */
export async function writeHugeTiff(path: string, width: number, height: number): Promise<void> {
  const tile = 256;
  const across = Math.ceil(width / tile);
  const down = Math.ceil(height / tile);
  const stream = createWriteStream(path);
  await write(stream, Uint8Array.of(0x49, 0x49, 42, 0, 0, 0, 0, 0)); // IFD offset patched below
  const tiles = new Map<string, Buffer>();
  const offsets: number[] = [];
  const counts: number[] = [];
  let position = 8;
  for (let row = 0; row < down; row++)
    for (let column = 0; column < across; column++) {
      // Tiles are wholly red, wholly blue, or the one column straddling the middle.
      const left = column * tile;
      const kind = left + tile <= width / 2 ? 'red' : left >= width / 2 ? 'blue' : `mixed${left}`;
      let data = tiles.get(kind);
      if (!data) {
        const pixels = new Uint8Array(tile * tile * 3);
        for (let y = 0; y < tile; y++)
          for (let x = 0; x < tile; x++)
            pixels.set(left + x < width / 2 ? RED : BLUE, (y * tile + x) * 3);
        data = deflateSync(pixels);
        tiles.set(kind, data);
      }
      offsets.push(position);
      counts.push(data.length);
      await write(stream, data);
      position += data.length;
    }
  const entries: [number, number, number[]][] = [
    [256, 4, [width]],
    [257, 4, [height]],
    [258, 3, [8, 8, 8]],
    [259, 3, [8]],
    [262, 3, [2]],
    [277, 3, [3]],
    [284, 3, [1]],
    [322, 3, [tile]],
    [323, 3, [tile]],
    [324, 4, offsets],
    [325, 4, counts],
  ];
  const ifdOffset = position;
  const ifd = Buffer.alloc(2 + entries.length * 12 + 4);
  ifd.writeUInt16LE(entries.length, 0);
  let extra = ifdOffset + ifd.length;
  const extras: Buffer[] = [];
  entries.forEach(([tag, type, values], i) => {
    const at = 2 + i * 12;
    ifd.writeUInt16LE(tag, at);
    ifd.writeUInt16LE(type, at + 2);
    ifd.writeUInt32LE(values.length, at + 4);
    const size = type === 3 ? 2 : 4;
    const bytes = Buffer.alloc(size * values.length);
    values.forEach((value, k) =>
      type === 3 ? bytes.writeUInt16LE(value, k * 2) : bytes.writeUInt32LE(value, k * 4),
    );
    if (bytes.length <= 4) bytes.copy(ifd, at + 8);
    else {
      ifd.writeUInt32LE(extra, at + 8);
      extras.push(bytes);
      extra += bytes.length;
    }
  });
  await write(stream, ifd);
  for (const bytes of extras) await write(stream, bytes);
  await close(stream);
  // Point the header at the directory.
  const { open } = await import('node:fs/promises');
  const handle = await open(path, 'r+');
  const pointer = Buffer.alloc(4);
  pointer.writeUInt32LE(ifdOffset);
  await handle.write(pointer, 0, 4, 4);
  await handle.close();
}

/**
 * A baseline greyscale JPEG with every 8 × 8 block flat: dark on the left half, light on
 * the right. Flat blocks need only a DC code and an end-of-block, so even a 432 MP image
 * is a few megabytes.
 */
export async function writeHugeJpeg(path: string, width: number, height: number): Promise<void> {
  const blocksX = Math.ceil(width / 8);
  const blocksY = Math.ceil(height / 8);
  const quant = new Uint8Array(64).fill(1);
  // DC: categories 0, 10 and 11 as codes 00, 01, 10. AC: end-of-block as a 1-bit code.
  const dht = Uint8Array.of(
    0x00,
    0,
    3,
    ...new Array<number>(14).fill(0),
    0,
    10,
    11,
    0x10,
    1,
    ...new Array<number>(15).fill(0),
    0x00,
  );
  const segment = (marker: number, data: Uint8Array) =>
    Uint8Array.of(0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 255, ...data);
  const head = [
    Uint8Array.of(0xff, 0xd8),
    segment(0xdb, Uint8Array.of(0x00, ...quant)),
    segment(
      0xc0,
      Uint8Array.of(8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0),
    ),
    segment(0xc4, dht),
    segment(0xda, Uint8Array.of(1, 1, 0x00, 0, 63, 0)),
  ];
  const stream = createWriteStream(path);
  for (const part of head) await write(stream, part);
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  const put = (value: number, length: number) => {
    buffer = (buffer << length) | (value & ((1 << length) - 1));
    bits += length;
    while (bits >= 8) {
      const byte = (buffer >>> (bits - 8)) & 255;
      out.push(byte);
      if (byte === 0xff) out.push(0);
      bits -= 8;
    }
    buffer &= (1 << bits) - 1;
  };
  // Levels 64 and 192 are DC values −512 and +512 with a quantiser of 1.
  let previous = 0;
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const dc = bx * 8 < width / 2 ? -512 : 512;
      const diff = dc - previous;
      previous = dc;
      if (diff === 0) put(0b00, 2);
      else {
        const category = Math.abs(diff) === 512 ? 10 : 11;
        put(category === 10 ? 0b01 : 0b10, 2);
        put(diff > 0 ? diff : diff + (1 << category) - 1, category);
      }
      put(0, 1); // end of block
    }
    if (out.length > 4 * 1024 * 1024) await write(stream, Uint8Array.from(out.splice(0)));
  }
  if (bits) put(0x7f, 8 - bits);
  out.push(0xff, 0xd9);
  await write(stream, Uint8Array.from(out));
  await close(stream);
}

/**
 * An uncompressed BigTIFF in strips: width × height × 3 bytes, so 40,000 × 38,000 makes
 * a 4.6 GB file, the size of a gigapixel scan. BigTIFF's 64-bit offsets are what let a
 * TIFF pass 4 GB.
 */
export async function writeHugeBigTiff(path: string, width: number, height: number): Promise<void> {
  const rowsPerStrip = 64;
  const strips = Math.ceil(height / rowsPerStrip);
  const row = rgbRow(width);
  const block = new Uint8Array(row.length * rowsPerStrip);
  for (let r = 0; r < rowsPerStrip; r++) block.set(row, r * row.length);
  const stream = createWriteStream(path, { highWaterMark: 16 * 1024 * 1024 });
  const header = Buffer.alloc(16);
  header.write('II', 0, 'ascii');
  header.writeUInt16LE(43, 2);
  header.writeUInt16LE(8, 4);
  await write(stream, header); // the directory's offset is patched in below
  const offsets: number[] = [];
  const counts: number[] = [];
  let position = 16;
  for (let strip = 0; strip < strips; strip++) {
    const bytes = Math.min(rowsPerStrip, height - strip * rowsPerStrip) * row.length;
    offsets.push(position);
    counts.push(bytes);
    await write(stream, block.subarray(0, bytes));
    position += bytes;
  }
  const entries: [number, number, number[]][] = [
    [256, 4, [width]],
    [257, 4, [height]],
    [258, 3, [8, 8, 8]],
    [259, 3, [1]],
    [262, 3, [2]],
    [273, 16, offsets],
    [277, 3, [3]],
    [278, 4, [rowsPerStrip]],
    [279, 16, counts],
    [284, 3, [1]],
  ];
  const ifdOffset = position;
  const ifd = Buffer.alloc(8 + entries.length * 20 + 8);
  ifd.writeBigUInt64LE(BigInt(entries.length), 0);
  let extra = ifdOffset + ifd.length;
  const extras: Buffer[] = [];
  entries.forEach(([tag, type, values], i) => {
    const at = 8 + i * 20;
    ifd.writeUInt16LE(tag, at);
    ifd.writeUInt16LE(type, at + 2);
    ifd.writeBigUInt64LE(BigInt(values.length), at + 4);
    const size = type === 3 ? 2 : type === 4 ? 4 : 8;
    const bytes = Buffer.alloc(size * values.length);
    values.forEach((value, k) => {
      if (size === 2) bytes.writeUInt16LE(value, k * 2);
      else if (size === 4) bytes.writeUInt32LE(value, k * 4);
      else bytes.writeBigUInt64LE(BigInt(value), k * 8);
    });
    if (bytes.length <= 8) bytes.copy(ifd, at + 12);
    else {
      ifd.writeBigUInt64LE(BigInt(extra), at + 12);
      extras.push(bytes);
      extra += bytes.length;
    }
  });
  await write(stream, ifd);
  for (const bytes of extras) await write(stream, bytes);
  await close(stream);
  const { open } = await import('node:fs/promises');
  const handle = await open(path, 'r+');
  const pointer = Buffer.alloc(8);
  pointer.writeBigUInt64LE(BigInt(ifdOffset));
  await handle.write(pointer, 0, 8, 8);
  await handle.close();
}
