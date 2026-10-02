import { fail } from '../../utils/errors';

/** How much of a file is held in memory at a time while it is read in order. */
const WINDOW = 4 * 1024 * 1024;

/**
 * Reads a file front to back in bounded slices, so a multi-gigabyte image never has to
 * be in memory at once. Big-endian unless asked otherwise, as most image formats are.
 */
export class Source {
  private buffer: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  /** File offset of buffer[0]. */
  private start = 0;
  /** Read position within buffer. */
  private cursor = 0;

  constructor(readonly file: Blob) {}

  get position(): number {
    return this.start + this.cursor;
  }

  get size(): number {
    return this.file.size;
  }

  /** Makes at least `count` bytes available from the read position, if the file has them. */
  private async fill(count: number): Promise<void> {
    if (this.buffer.length - this.cursor >= count) return;
    const from = this.position;
    const until = Math.min(this.file.size, from + Math.max(count, WINDOW));
    if (until - from < count) fail('damaged');
    this.buffer = new Uint8Array(await this.file.slice(from, until).arrayBuffer());
    this.start = from;
    this.cursor = 0;
  }

  /** The next `count` bytes. The view is only valid until the next read. */
  async bytes(count: number): Promise<Uint8Array<ArrayBuffer>> {
    await this.fill(count);
    const view = this.buffer.subarray(this.cursor, this.cursor + count);
    this.cursor += count;
    return view;
  }

  /** The next `count` bytes as a copy that stays valid. */
  async copy(count: number): Promise<Uint8Array<ArrayBuffer>> {
    return (await this.bytes(count)).slice();
  }

  async skip(count: number): Promise<void> {
    if (this.buffer.length - this.cursor >= count) {
      this.cursor += count;
      return;
    }
    this.seek(this.position + count);
  }

  seek(offset: number): void {
    if (offset < 0 || offset > this.file.size) fail('damaged');
    if (offset >= this.start && offset <= this.start + this.buffer.length) {
      this.cursor = offset - this.start;
      return;
    }
    this.buffer = new Uint8Array(0);
    this.start = offset;
    this.cursor = 0;
  }

  async u8(): Promise<number> {
    return (await this.bytes(1))[0]!;
  }

  async u16(little = false): Promise<number> {
    const b = await this.bytes(2);
    return little ? b[0]! | (b[1]! << 8) : (b[0]! << 8) | b[1]!;
  }

  async u32(little = false): Promise<number> {
    const b = await this.bytes(4);
    return little
      ? (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0
      : ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
  }

  /** A 64-bit unsigned value; offsets in files up to 8 PB stay exact as numbers. */
  async u64(little = false): Promise<number> {
    const first = await this.u32(little);
    const second = await this.u32(little);
    return little ? second * 2 ** 32 + first : first * 2 ** 32 + second;
  }

  async ascii(count: number): Promise<string> {
    return String.fromCharCode(...(await this.bytes(count)));
  }
}

/** Reads a byte range of a file, for formats whose data is not in reading order. */
export async function readRange(
  file: Blob,
  offset: number,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (offset < 0 || length < 0 || offset + length > file.size) fail('damaged');
  return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
}
