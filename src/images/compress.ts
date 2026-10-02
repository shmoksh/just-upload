import type { OutputFormat } from '../models';
import { safeMinimum } from '../compatibility';
import { isLossy } from '../formats';
import { fail } from '../utils/errors';
import { padTo } from './pad';

export interface CompressionOptions {
  /** The pixel size to encode at. It never changes: only the format and quality do. */
  width: number;
  height: number;
  format: OutputFormat;
  maxBytes?: number;
  /**
   * A file smaller than this is refused by the site: it is saved at a higher quality and,
   * if that is not enough, padded with bytes every reader skips (see padTo).
   */
  minBytes?: number;
  /** Fewer quality steps for slow encoders (AVIF), trading a little precision for time. */
  searchSteps?: number;
}
export interface EncodedImage {
  blob: Blob;
  width: number;
  height: number;
  quality: number;
}
export type Encoder = (width: number, height: number, quality: number) => Promise<Blob>;

export const QUALITY = Object.freeze({
  max: 0.92,
  /** Used only to bring a small file up to a site's minimum size. */
  highest: 1,
  /**
   * The lowest quality tried. Pixel dimensions never shrink to meet a file-size limit,
   * so quality is the only lever; whether a result looks good enough to use without
   * asking is measured afterwards (see needsQualityConsent).
   */
  floor: 0.4,
  /** Target stays a little under the limit, in case the site counts bytes differently. */
  margin: 0.96,
  searchSteps: 4,
});

interface Sample {
  quality: number;
  size: number;
}

/**
 * Where quality should land to hit `target`, assuming file size changes roughly
 * exponentially with quality between two measured samples. This lands within a few
 * percent in one step, where halving the range needs five.
 */
function interpolate(low: Sample, high: Sample, target: number): number {
  const span = Math.log(high.size) - Math.log(low.size);
  const t = span > 0 ? (Math.log(target) - Math.log(low.size)) / span : 0.5;
  const quality = low.quality + Math.min(1, Math.max(0, t)) * (high.quality - low.quality);
  // Stay strictly inside the bracket so every step learns something new.
  const margin = Math.min(0.01, (high.quality - low.quality) / 4);
  return Math.min(high.quality - margin, Math.max(low.quality + margin, quality));
}

/**
 * Finds the highest-quality encoding under the size limit, at the image's full pixel
 * size: it measures real encoded sizes and searches quality down to a floor. If even the
 * floor does not fit, the target is unreachable without changing the pixel size, which
 * Just Upload never does unless the website states one, so it ends with an error and the
 * website gets the original.
 *
 * Every encode of a large photo costs tens of milliseconds, so the search predicts
 * rather than bisects. The encoder is injected so the search can be tested without a
 * canvas.
 */
export async function compressToTarget(
  options: CompressionOptions,
  encode: Encoder,
): Promise<EncodedImage> {
  const { width, height } = options;
  const target =
    options.maxBytes === undefined ? Infinity : Math.floor(options.maxBytes * QUALITY.margin);
  if (!(target > 0)) fail('rules-conflict');
  const best = await encode(width, height, QUALITY.max);
  if (best.size <= target) {
    const minimum =
      options.minBytes === undefined ? 0 : Math.min(safeMinimum(options.minBytes), target);
    if (best.size >= minimum) return { blob: best, width, height, quality: QUALITY.max };
    if (minimum < options.minBytes!) fail('target-unreachable');
    // Too small for the site: the most detailed save, then filler every reader skips.
    let result: EncodedImage = { blob: best, width, height, quality: QUALITY.max };
    if (isLossy(options.format)) {
      const highest = await encode(width, height, QUALITY.highest);
      if (highest.size <= target)
        result = { blob: highest, width, height, quality: QUALITY.highest };
    }
    return { ...result, blob: await padTo(result.blob, options.format, minimum) };
  }
  // A lossless format holds exactly its pixels: there is nothing to trade.
  if (!isLossy(options.format)) fail('target-unreachable');
  const lowest = await encode(width, height, QUALITY.floor);
  if (lowest.size > target) fail('target-unreachable');
  let result: EncodedImage = { blob: lowest, width, height, quality: QUALITY.floor };
  let low: Sample = { quality: QUALITY.floor, size: lowest.size };
  let high: Sample = { quality: QUALITY.max, size: best.size };
  const steps = options.searchSteps ?? QUALITY.searchSteps;
  for (let step = 0; step < steps && high.quality - low.quality > 0.01; step++) {
    const quality = interpolate(low, high, target * 0.995);
    const blob = await encode(width, height, quality);
    if (blob.size <= target) {
      result = { blob, width, height, quality };
      low = { quality, size: blob.size };
    } else high = { quality, size: blob.size };
  }
  return result;
}
