import { assertDimensions, assertFileSize, LIMITS } from '../security/limits';
import { fail } from '../utils/errors';
import { detectFormat } from './headers';

// The small slice of libheif-js this adapter relies on. Keeping it narrow is what
// makes the LGPL decoder replaceable (see docs/heic-licensing.md).
interface HeifImage {
  get_width(): number;
  get_height(): number;
  is_primary(): boolean;
  has_alpha_channel(): boolean;
  display(target: ImageData, callback: (result: ImageData | null) => void): void;
  free(): void;
}
interface HeifDecoderInstance {
  decoder: unknown;
  decode(bytes: Uint8Array): HeifImage[];
}
interface Libheif {
  HeifDecoder: new () => HeifDecoderInstance;
  heif_context_free(context: unknown): void;
}

export interface DecodedHeic {
  /** Raw values, in the file's own colour space; see `managedBitmap`. */
  pixels: ImageData;
  /** Burst or sequence files contain more than one image; only the primary is used. */
  multipleImages: boolean;
  hasAlpha: boolean;
}

export interface HeicDecoder {
  /** Loads and compiles the decoder ahead of time, so the first photo doesn't wait for it. */
  warm(): Promise<void>;
  canDecode(file: Blob): Promise<boolean>;
  decode(file: Blob): Promise<DecodedHeic>;
}

let library: Promise<Libheif> | undefined;
function loadLibrary(): Promise<Libheif> {
  // Packaged with the extension as vendor/libheif.mjs; never fetched from the network.
  library ??= import(
    /* @vite-ignore */ new URL('/vendor/libheif.mjs', self.location.origin).href
  ).then((module: { default: () => Libheif | Promise<Libheif> }) => module.default());
  return library;
}

/** The only module that knows how HEIC is decoded. Everything downstream sees pixels. */
export const heicDecoder: HeicDecoder = {
  async warm() {
    await loadLibrary().catch(() => {
      library = undefined;
    });
  },
  async canDecode(file) {
    const format = detectFormat(new Uint8Array(await file.slice(0, 256).arrayBuffer()));
    return format === 'heic' || format === 'heif';
  },
  async decode(file) {
    // libheif decodes from a copy of the whole file in memory.
    assertFileSize(file.size, LIMITS.maxWholeFileBytes);
    let lib: Libheif;
    try {
      lib = await loadLibrary();
    } catch {
      library = undefined;
      fail('failed');
    }
    const decoder = new lib.HeifDecoder();
    const images: HeifImage[] = [];
    try {
      images.push(...decoder.decode(new Uint8Array(await file.arrayBuffer())));
      if (!images.length) fail('damaged');
      const primary = images.find((image) => image.is_primary()) ?? images[0]!;
      const width = primary.get_width();
      const height = primary.get_height();
      assertDimensions(width, height);
      const pixels = await new Promise<ImageData>((resolve, reject) => {
        primary.display(new ImageData(width, height), (result) =>
          result ? resolve(result) : reject(new Error('damaged')),
        );
      });
      return {
        pixels,
        multipleImages: images.length > 1,
        hasAlpha: primary.has_alpha_channel(),
      };
    } finally {
      for (const image of images) image.free();
      if (decoder.decoder) {
        lib.heif_context_free(decoder.decoder);
        decoder.decoder = null;
      }
    }
  },
};
