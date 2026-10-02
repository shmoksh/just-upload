import { fail, ProcessingError } from '../../utils/errors';
import { decodeBmpStream } from './bmp';
import { decodeJpegStream } from './jpeg';
import { decodePngStream } from './png';
import { decodeTiffStream } from './tiff';
import type { Progress, SizeFor, StreamedImage } from './types';

type StreamDecoder = (file: Blob, sizeFor: SizeFor, progress?: Progress) => Promise<StreamedImage>;

/**
 * Bad data can surface from deep inside a decoder as a RangeError, a TypeError from the
 * browser's inflater or a plain string from pako. To the person, all of them mean the
 * file is damaged; only a failed allocation means it was too large.
 */
function guarded(decode: StreamDecoder): StreamDecoder {
  return async (file, sizeFor, progress) => {
    try {
      return await decode(file, sizeFor, progress);
    } catch (error) {
      if (error instanceof ProcessingError) throw error;
      if (
        error instanceof RangeError &&
        /allocation failed|invalid (typed )?array length/i.test(error.message)
      )
        fail('too-large-to-process');
      fail('damaged');
    }
  };
}

/** The formats read in a stream, at any size their limits allow. */
export const STREAM_DECODERS = {
  jpeg: guarded(decodeJpegStream),
  png: guarded(decodePngStream),
  tiff: guarded(decodeTiffStream),
  bmp: guarded(decodeBmpStream),
} as const;
