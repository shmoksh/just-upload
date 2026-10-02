import type { UploadRequirements } from '../models';

/** Drawings are rendered at least this large on their longer side… */
const DEFAULT_LONG_SIDE = 1024;
/** …and never larger than this, whatever the file or the site asks for. */
const MAX_LONG_SIDE = 4096;

/**
 * The pixel size to render an SVG at. A vector drawing has no fixed pixel size, so it is
 * drawn directly at the size the site needs (sharp, never enlarged afterwards), at least
 * 1024 px on its longer side when the site doesn't say, within any maximum, and capped
 * at 4096 px. The result is deterministic, so a crop chosen on one rendering applies
 * exactly to the next.
 */
export function svgRenderSize(
  intrinsic: { width: number; height: number },
  requirements: UploadRequirements,
): { width: number; height: number } {
  const { width, height } = intrinsic;
  const long = Math.max(width, height);
  const { exactWidth, exactHeight, minWidth, minHeight, maxWidth, maxHeight } = requirements;
  let scale = Math.max(1, DEFAULT_LONG_SIDE / long);
  scale = Math.max(
    scale,
    (exactWidth ?? minWidth ?? 0) / width,
    (exactHeight ?? minHeight ?? 0) / height,
  );
  scale = Math.min(scale, (maxWidth ?? Infinity) / width, (maxHeight ?? Infinity) / height);
  scale = Math.min(scale, MAX_LONG_SIDE / long);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
