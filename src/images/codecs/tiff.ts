import { assertDimensions } from '../../security/limits';
import { fail } from '../../utils/errors';

type Utif = typeof import('utif2');

let library: Promise<Utif> | undefined;

/**
 * UTIF finds its deflate implementation on the global object once bundled, so pako is
 * installed there first. Loaded only when a TIFF is actually read or written.
 */
function load(): Promise<Utif> {
  library ??= (async () => {
    const pako = await import('pako');
    (globalThis as { pako?: unknown }).pako = pako.default ?? pako;
    const module = (await import('utif2')) as Utif & { default?: Utif };
    return module.default ?? module;
  })();
  return library;
}

/** Decodes the first full-resolution page of a TIFF to RGBA. */
export async function decodeTiff(buffer: ArrayBuffer): Promise<ImageData> {
  const UTIF = await load();
  const pages = UTIF.decode(buffer);
  // Bit 0 of NewSubfileType marks reduced-resolution previews; skip those.
  const page =
    pages.find((ifd) => !(Number((ifd.t254 as number[] | undefined)?.[0] ?? 0) & 1)) ?? pages[0];
  if (!page) fail('damaged');
  assertDimensions(
    Number((page.t256 as number[] | undefined)?.[0]),
    Number((page.t257 as number[] | undefined)?.[0]),
  );
  // The third argument (all pages) is supported but missing from UTIF's type definitions.
  (UTIF.decodeImage as (data: ArrayBuffer, ifd: typeof page, ifds: typeof pages) => void)(
    buffer,
    page,
    pages,
  );
  const rgba = UTIF.toRGBA8(page);
  if (!page.width || !page.height || rgba.length < page.width * page.height * 4) fail('damaged');
  return new ImageData(
    new Uint8ClampedArray(rgba.subarray(0, page.width * page.height * 4)),
    page.width,
    page.height,
  );
}

/** Writes an uncompressed RGBA TIFF, readable by every TIFF reader. */
export async function encodeTiff(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Promise<ArrayBuffer> {
  const UTIF = await load();
  return UTIF.encodeImage(
    new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength),
    width,
    height,
  );
}
