/**
 * Writes a 24-bit Windows bitmap: the most widely readable BMP variant. BMP has no
 * transparency, so callers flatten transparent images first (with consent).
 */
export function encodeBmp(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array<ArrayBuffer> {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const dataSize = rowSize * height;
  const out = new Uint8Array(54 + dataSize);
  const header = new DataView(out.buffer);
  out[0] = 0x42; // "B"
  out[1] = 0x4d; // "M"
  header.setUint32(2, out.length, true);
  header.setUint32(10, 54, true);
  header.setUint32(14, 40, true);
  header.setInt32(18, width, true);
  header.setInt32(22, height, true);
  header.setUint16(26, 1, true);
  header.setUint16(28, 24, true);
  header.setUint32(34, dataSize, true);
  header.setInt32(38, 2835, true); // 72 DPI
  header.setInt32(42, 2835, true);
  // Rows are stored bottom-up, as blue, green, red.
  for (let y = 0; y < height; y++) {
    let target = 54 + (height - 1 - y) * rowSize;
    for (let x = 0, source = y * width * 4; x < width; x++, source += 4) {
      out[target++] = rgba[source + 2]!;
      out[target++] = rgba[source + 1]!;
      out[target++] = rgba[source]!;
    }
  }
  return out;
}
