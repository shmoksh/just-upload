/**
 * Averages full-size rows into a smaller image as they arrive, top to bottom, so the
 * full-size image never exists in memory. Each output pixel is the mean of the input
 * pixels it covers (a box filter, which cannot alias however large the reduction).
 * Colours are averaged weighted by alpha, so transparent pixels don't darken edges.
 */
export class RowDownscaler {
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
  private readonly sums: Float64Array;
  private readonly counts: Float64Array;
  private readonly columnOf: Uint32Array;
  private row = 0;
  private opaque = true;

  constructor(
    readonly inWidth: number,
    readonly inHeight: number,
    readonly width: number,
    readonly height: number,
  ) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
    this.sums = new Float64Array(width * 4);
    this.counts = new Float64Array(width);
    this.columnOf = Uint32Array.from({ length: inWidth }, (_, x) =>
      Math.min(width - 1, Math.floor((x * width) / inWidth)),
    );
  }

  private rowFor(y: number): number {
    return Math.min(this.height - 1, Math.floor((y * this.height) / this.inHeight));
  }

  /** Writes the averaged output row and starts the next one. */
  private flush(): void {
    const { sums, counts, pixels, width } = this;
    const base = this.row * width * 4;
    for (let x = 0; x < width; x++) {
      const count = counts[x]!;
      if (!count) continue;
      const i = x * 4;
      const alpha = sums[i + 3]!;
      if (alpha > 0) {
        pixels[base + i] = sums[i]! / alpha;
        pixels[base + i + 1] = sums[i + 1]! / alpha;
        pixels[base + i + 2] = sums[i + 2]! / alpha;
      }
      pixels[base + i + 3] = alpha / count;
    }
    sums.fill(0);
    counts.fill(0);
  }

  /** Adds input row `y` as RGBA values. Rows must come in order, from the top. */
  addRow(rgba: Uint8Array | Uint8ClampedArray, y: number): void {
    const target = this.rowFor(y);
    if (target !== this.row) {
      this.flush();
      this.row = target;
    }
    const { sums, counts, columnOf, inWidth } = this;
    for (let x = 0, i = 0; x < inWidth; x++, i += 4) {
      const o = columnOf[x]! * 4;
      const a = rgba[i + 3]!;
      if (a !== 255) this.opaque = false;
      sums[o] = sums[o]! + rgba[i]! * a;
      sums[o + 1] = sums[o + 1]! + rgba[i + 1]! * a;
      sums[o + 2] = sums[o + 2]! + rgba[i + 2]! * a;
      sums[o + 3] = sums[o + 3]! + a;
      counts[columnOf[x]!] = counts[columnOf[x]!]! + 1;
    }
  }

  /** Finishes the last row. Whether any pixel was less than fully opaque is reported. */
  finish(): {
    pixels: Uint8ClampedArray<ArrayBuffer>;
    width: number;
    height: number;
    transparent: boolean;
  } {
    this.flush();
    return {
      pixels: this.pixels,
      width: this.width,
      height: this.height,
      transparent: !this.opaque,
    };
  }
}

/** The largest size within `maxPixels` (and a side of `maxSide`) with the same shape. */
export function workingSize(
  width: number,
  height: number,
  maxPixels: number,
  maxSide: number,
): { width: number; height: number } {
  const scale = Math.min(
    1,
    Math.sqrt(maxPixels / (width * height)),
    maxSide / Math.max(width, height),
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}
