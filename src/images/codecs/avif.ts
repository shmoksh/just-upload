import type { AVIFModule } from '@jsquash/avif/codec/enc/avif_enc.js';
import { defaultOptions } from '@jsquash/avif/meta.js';
import { fail } from '../../utils/errors';

let encoder: Promise<AVIFModule> | undefined;

/**
 * The single-threaded libavif encoder, loaded only when a site requires AVIF. (The
 * multi-threaded build needs cross-origin isolation, which extension pages don't have,
 * so it is never bundled.)
 */
function load(): Promise<AVIFModule> {
  encoder ??= import('@jsquash/avif/codec/enc/avif_enc.js').then(({ default: factory }) =>
    factory({ noInitialRun: true }),
  );
  return encoder;
}

/**
 * Maps the pipeline's JPEG-like quality (0.6–0.92) onto AVIF's 0–100 scale, where ~75
 * already looks like JPEG at 0.92. Speed 8 keeps large photos within the time limit.
 */
export function avifQuality(quality: number): number {
  return Math.round(Math.min(90, Math.max(30, 40 + ((quality - 0.6) / 0.32) * 35)));
}

export async function encodeAvif(image: ImageData, quality: number): Promise<Uint8Array> {
  const module = await load();
  const output = module.encode(
    new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength),
    image.width,
    image.height,
    {
      ...defaultOptions,
      quality: avifQuality(quality),
      speed: 8,
    },
  );
  if (!output) fail('encode-unsupported');
  return output;
}
