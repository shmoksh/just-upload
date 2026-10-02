/** Decodes JPEG XL with libjxl, loaded only when a JPEG XL file is actually selected. */
export async function decodeJxl(buffer: ArrayBuffer): Promise<ImageData> {
  const { default: decode } = await import('@jsquash/jxl/decode.js');
  return decode(buffer);
}
