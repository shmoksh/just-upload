/** ICO entries cannot describe images larger than 256 × 256. */
export const ICO_MAX_SIZE = 256;

/**
 * Wraps a PNG in an ICO container, which every current browser and Windows version
 * reads. The image must already fit within 256 × 256.
 */
export function encodeIco(png: Uint8Array, width: number, height: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(22 + png.length);
  const header = new DataView(out.buffer);
  header.setUint16(2, 1, true); // icon
  header.setUint16(4, 1, true); // one image
  out[6] = width >= ICO_MAX_SIZE ? 0 : width; // 0 means 256
  out[7] = height >= ICO_MAX_SIZE ? 0 : height;
  header.setUint16(10, 1, true); // colour planes
  header.setUint16(12, 32, true); // bits per pixel
  header.setUint32(14, png.length, true);
  header.setUint32(18, 22, true);
  out.set(png, 22);
  return out;
}
