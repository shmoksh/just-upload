import type { OutputFormat } from '../models';
import { safeMinimum } from '../compatibility';
import { isLossy } from '../formats';
import { fail } from '../utils/errors';
import { padTo } from './pad';

export interface CompressionOptions {
  /** The pixel size to encode at. Only `shrink` can make it smaller. */
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
  /**
   * When no quality can meet the limit at this pixel size, find the largest smaller size
   * that fits instead of failing, never below these sides (the website's own minimums).
   * The caller asks the person before using such a file (see needsShrinkConsent).
   */
  shrink?: { minWidth: number; minHeight: number };
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
   * The lowest quality tried at full size. Quality is the first lever: fewer pixels come
   * only when even this does not fit, and only with the person's OK. Whether a result
   * looks good enough to use without asking is measured afterwards (see
   * needsQualityConsent).
   */
  floor: 0.4,
  /**
   * When an image needs fewer pixels to fit, its size is chosen at this quality: the
   * lowest at which compression still does not show, so as many pixels as possible are
   * kept. Measured on photos at 500 KB: the same quality kept (95%) as at 0.75, with
   * about 45% more pixels; lower still starts to show blocks in skies and skin.
   */
  fit: 0.6,
  /** The largest size that fits is found to within this share of its width… */
  fitPrecision: 0.02,
  /** …in at most this many encodes. */
  fitSteps: 7,
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

/** File size at `quality`, between two measured samples (size is about exponential in it). */
function sizeAt(quality: number, low: Sample, high: Sample): number {
  const t = (quality - low.quality) / (high.quality - low.quality);
  return Math.exp(Math.log(low.size) + t * (Math.log(high.size) - Math.log(low.size)));
}

/**
 * The largest pixel size below the full one at which the image fits `target`, for a
 * limit no quality can meet at full size: shrinking only as much as needed, never to
 * whatever is smallest. `full` is the file size at full size, at the quality used.
 *
 * File size falls a little more slowly than the pixel count, and how much more slowly
 * depends on the picture, so each step measures a real encode and aims the next one from
 * the measurements, closing in on the size where the limit is met.
 */
async function shrinkToFit(
  options: CompressionOptions,
  encode: Encoder,
  target: number,
  full: Sample,
): Promise<EncodedImage> {
  const { width, height, shrink } = options;
  if (!shrink) return fail('target-unreachable');
  const { quality } = full;
  // Each side at least one pixel, and at least the website's own minimum.
  const smallest = Math.min(
    1,
    Math.max(1 / Math.min(width, height), shrink.minWidth / width, shrink.minHeight / height),
  );
  /** A size tried, as a share of the full width, and the bytes it took. */
  interface Point {
    scale: number;
    size: number;
  }
  let fits: { scale: number; image: EncodedImage } | undefined;
  let tooBig: Point = { scale: 1, size: full.size };
  let last: Point = tooBig;
  // A first guess: size about proportional to pixels^0.9, so to scale^1.8.
  let exponent = 1.8;
  let scale = Math.min(0.98, ((target * 0.97) / full.size) ** (1 / exponent));
  for (let step = 0; step < QUALITY.fitSteps; step++) {
    scale = Math.max(smallest, scale);
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const blob = await encode(w, h, quality);
    const point: Point = { scale, size: blob.size };
    if (blob.size <= target) {
      if (!fits || scale > fits.scale)
        fits = { scale, image: { blob, width: w, height: h, quality } };
    } else if (scale <= smallest) break;
    else if (scale < tooBig.scale) tooBig = point;
    if (fits && tooBig.scale / fits.scale - 1 <= QUALITY.fitPrecision) break;
    // How size changes with scale for this picture, from the last two measurements.
    if (point.scale !== last.scale && point.size !== last.size) {
      const slope = Math.log(point.size / last.size) / Math.log(point.scale / last.scale);
      if (Number.isFinite(slope)) exponent = Math.min(2.5, Math.max(1, slope));
    }
    last = point;
    let next = scale * ((target * 0.985) / blob.size) ** (1 / exponent);
    // Fits, and the measurements say only a sliver more would: close enough.
    if (blob.size <= target && next / scale - 1 <= QUALITY.fitPrecision) break;
    // Stay strictly between the largest size that fits and the smallest that does not.
    if (next >= tooBig.scale) next = Math.sqrt((fits?.scale ?? smallest) * tooBig.scale);
    else if (fits && next <= fits.scale) next = Math.sqrt(fits.scale * tooBig.scale);
    scale = next;
  }
  return fits ? fits.image : fail('target-unreachable');
}

/**
 * Finds the highest-quality encoding under the size limit at the image's full pixel
 * size: it measures real encoded sizes and searches quality down to a floor. If even the
 * floor does not fit, the target is unreachable at full size: with `shrink`, the largest
 * smaller size that fits is found instead (see shrinkToFit); without it, it ends with an
 * error and the website gets the original.
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
  // A lossless format holds exactly its pixels: only fewer of them make it smaller.
  if (!isLossy(options.format))
    return shrinkToFit(options, encode, target, { quality: QUALITY.max, size: best.size });
  const lowest = await encode(width, height, QUALITY.floor);
  if (lowest.size > target) {
    const floor: Sample = { quality: QUALITY.floor, size: lowest.size };
    const top: Sample = { quality: QUALITY.max, size: best.size };
    return shrinkToFit(options, encode, target, {
      quality: QUALITY.fit,
      size: sizeAt(QUALITY.fit, floor, top),
    });
  }
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
