/** Prepared images are compared at up to this long side: full screen on a large display. */
export const VIEW_LONG_SIDE = 3000;

const TILE = 64;
const MAX_TILES_PER_SIDE = 8;
const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;

/** A picture as brightness and two colour channels, the way JPEG splits it. */
function planes(pixels: Uint8ClampedArray, length: number): Float32Array[] {
  const brightness = new Float32Array(length);
  const blue = new Float32Array(length);
  const red = new Float32Array(length);
  for (let i = 0, j = 0; j < length; i += 4, j++) {
    const [r, g, b] = [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
    brightness[j] = 0.299 * r + 0.587 * g + 0.114 * b;
    blue[j] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    red[j] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  }
  return [brightness, blue, red];
}

/** SSIM of the 8 × 8 block at (x, y) in one channel of two images. */
function blockSsim(a: Float32Array, b: Float32Array, width: number, x: number, y: number): number {
  let meanA = 0;
  let meanB = 0;
  for (let row = 0; row < 8; row++)
    for (let column = 0; column < 8; column++) {
      const k = (y + row) * width + x + column;
      meanA += a[k]!;
      meanB += b[k]!;
    }
  meanA /= 64;
  meanB /= 64;
  let varianceA = 0;
  let varianceB = 0;
  let covariance = 0;
  for (let row = 0; row < 8; row++)
    for (let column = 0; column < 8; column++) {
      const k = (y + row) * width + x + column;
      const da = a[k]! - meanA;
      const db = b[k]! - meanB;
      varianceA += da * da;
      varianceB += db * db;
      covariance += da * db;
    }
  return (
    ((2 * meanA * meanB + C1) * ((2 * covariance) / 63 + C2)) /
    ((meanA * meanA + meanB * meanB + C1) * ((varianceA + varianceB) / 63 + C2))
  );
}

/**
 * Sum of the similarity of the 8 × 8 blocks that fit in two equally sized RGBA images,
 * and how many blocks there were. A block's similarity is the SSIM of its brightness,
 * lowered when its colour fared worse: colour counts for a quarter (6:1:1, the weights
 * video tools use) and never raises a score, so smeared coloured text is not hidden by
 * brightness that came through well.
 */
export function blockSimilarity(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  width: number,
  height: number,
): { sum: number; count: number } {
  const [brightnessA, blueA, redA] = planes(a, width * height);
  const [brightnessB, blueB, redB] = planes(b, width * height);
  let sum = 0;
  let count = 0;
  for (let y = 0; y + 8 <= height; y += 8) {
    for (let x = 0; x + 8 <= width; x += 8) {
      const brightness = blockSsim(brightnessA!, brightnessB!, width, x, y);
      const colour =
        (blockSsim(blueA!, blueB!, width, x, y) + blockSsim(redA!, redB!, width, x, y)) / 2;
      sum += Math.min(brightness, 0.75 * brightness + 0.25 * colour);
      count++;
    }
  }
  return { sum, count };
}

/** Where tiles start along one side: spread evenly, each fully inside. */
function tileStarts(length: number, tile: number): number[] {
  const count = Math.min(MAX_TILES_PER_SIDE, Math.ceil(length / tile));
  return Array.from({ length: count }, (_, i) =>
    Math.min(length - tile, Math.max(0, Math.round(((i + 0.5) * length) / count - tile / 2))),
  );
}

/**
 * How much of the original's look the prepared image keeps, from 0 to 100: the
 * structural similarity (SSIM) of their brightness and colour, compared as they would
 * look full screen on a large display. `reference` is the original at the size the site's rules
 * call for, so resizing those rules require is not counted as a loss; shrinking to meet
 * a file-size limit is. Sampled in tiles across the image, so it costs milliseconds.
 */
export async function qualityKept(
  reference: { source: ImageBitmap; width: number; height: number },
  result: ImageBitmapSource,
): Promise<number> {
  const scale = Math.min(1, VIEW_LONG_SIDE / Math.max(reference.width, reference.height));
  const width = Math.max(1, Math.round(reference.width * scale));
  const height = Math.max(1, Math.round(reference.height * scale));
  if (width < 8 || height < 8) return 100;
  const resize = { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' } as const;
  const [original, prepared] = await Promise.all([
    createImageBitmap(reference.source, resize),
    createImageBitmap(result, resize),
  ]);
  const tileWidth = Math.min(TILE, width);
  const tileHeight = Math.min(TILE, height);
  const canvas = new OffscreenCanvas(tileWidth, tileHeight);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  try {
    if (!context) return 100;
    // Transparent areas compare as white, the way a JPEG would show them.
    const tile = (image: ImageBitmap, x: number, y: number) => {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, tileWidth, tileHeight);
      context.drawImage(image, x, y, tileWidth, tileHeight, 0, 0, tileWidth, tileHeight);
      return context.getImageData(0, 0, tileWidth, tileHeight).data;
    };
    let sum = 0;
    let count = 0;
    for (const y of tileStarts(height, tileHeight)) {
      for (const x of tileStarts(width, tileWidth)) {
        const blocks = blockSimilarity(
          tile(original, x, y),
          tile(prepared, x, y),
          tileWidth,
          tileHeight,
        );
        sum += blocks.sum;
        count += blocks.count;
      }
    }
    if (!count) return 100;
    return Math.max(0, Math.min(100, Math.floor((sum / count) * 100 + 1e-9)));
  } finally {
    original.close();
    prepared.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}
