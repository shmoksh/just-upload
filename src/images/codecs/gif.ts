import { applyPalette, GIFEncoder, quantize } from 'gifenc';

/**
 * Writes a still GIF with at most 256 colours. Transparent pixels become GIF's one
 * transparent colour; partly transparent edges become fully opaque or transparent.
 */
export function encodeGif(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  let transparent = false;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i]! < 128) {
      transparent = true;
      break;
    }
  }
  const format = transparent ? 'rgba4444' : 'rgb565';
  const palette = quantize(rgba, 256, { format, oneBitAlpha: transparent });
  const index = applyPalette(rgba, palette, format);
  const transparentIndex = transparent ? palette.findIndex((color) => color[3] === 0) : -1;
  const gif = GIFEncoder();
  gif.writeFrame(index, width, height, {
    palette,
    transparent: transparentIndex >= 0,
    transparentIndex: Math.max(0, transparentIndex),
  });
  gif.finish();
  return gif.bytes();
}
