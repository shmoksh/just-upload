import type {
  CropRect,
  Decision,
  ImageInfo,
  FileOutput,
  SerializedFile,
  SerializedTransform,
  TransformOptions,
  UploadRequirements,
} from '../models';
import { OUTPUT_FORMATS } from '../formats';
import type { ErrorCode } from '../utils/errors';

/** Messages between the content script, background, offscreen document and worker. */
export type JobRequest =
  | {
      kind: 'prepare';
      id: string;
      file: SerializedFile;
      requirements: UploadRequirements;
    }
  | {
      kind: 'transform';
      id: string;
      file: SerializedFile;
      requirements: UploadRequirements;
      options: TransformOptions;
    };

export type SerializedPrepare =
  | { kind: 'pass' }
  | { kind: 'fixed'; result: SerializedTransform }
  | {
      kind: 'confirm';
      decision: Decision;
      info: ImageInfo;
      preview: SerializedFile;
      previews?: SerializedFile[];
    }
  | { kind: 'unsafe'; code: ErrorCode };

export type JobResponse<T = SerializedPrepare | SerializedTransform> =
  { ok: true; value: T } | { ok: false; error: ErrorCode };

const positive = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1e12
    ? value
    : undefined;
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && item.length < 100)
        .slice(0, 64)
    : [];

/**
 * Rebuilds requests field by field. The extension trusts its own content script, but
 * a renderer running a hostile page is not a place to trust object shapes from.
 */
export function sanitizeRequirements(value: unknown): UploadRequirements {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const result: UploadRequirements = {
    acceptedMimeTypes: strings(input.acceptedMimeTypes),
    acceptedExtensions: strings(input.acceptedExtensions),
    confidence: positive(input.confidence) ?? 0,
    sources: [],
  };
  for (const field of [
    'maxBytes',
    'minBytes',
    'minWidth',
    'minHeight',
    'maxWidth',
    'maxHeight',
    'exactWidth',
    'exactHeight',
    'aspectRatio',
    'printWidth',
    'printHeight',
    'dpi',
  ] as const) {
    const number = positive(input[field]);
    if (number !== undefined) result[field] = number;
  }
  return result;
}

function sanitizeCrop(value: unknown): CropRect | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const crop = value as Record<string, unknown>;
  const numbers = [crop.x, crop.y, crop.width, crop.height];
  if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0))
    return undefined;
  return {
    x: crop.x as number,
    y: crop.y as number,
    width: crop.width as number,
    height: crop.height as number,
  };
}

export function sanitizeOptions(value: unknown): TransformOptions {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const crop = sanitizeCrop(input.crop);
  const { sheet } = input;
  return {
    outputFormat: [...OUTPUT_FORMATS, 'pdf', 'csv', 'xlsx'].includes(input.outputFormat as string)
      ? (input.outputFormat as FileOutput)
      : 'jpeg',
    ...(crop ? { crop } : {}),
    ...(typeof sheet === 'number' && Number.isInteger(sheet) && sheet > 0 && sheet < 1000
      ? { sheet }
      : {}),
    allowTransparencyLoss: input.allowTransparencyLoss === true,
    allowAnimationLoss: input.allowAnimationLoss === true,
    allowUpscale: input.allowUpscale === true,
  };
}
