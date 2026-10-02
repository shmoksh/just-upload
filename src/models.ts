export type OutputFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'tiff' | 'bmp' | 'ico';
/** Everything Just Upload can read. HEIC/HEIF, SVG and JPEG XL are read-only. */
export type ImageFormat = OutputFormat | 'heic' | 'heif' | 'svg' | 'jxl' | 'unknown';

export type RequirementField =
  | 'acceptedMimeTypes'
  | 'acceptedExtensions'
  | 'maxBytes'
  | 'minBytes'
  | 'minWidth'
  | 'minHeight'
  | 'maxWidth'
  | 'maxHeight'
  | 'exactWidth'
  | 'exactHeight'
  | 'aspectRatio';

/** One piece of evidence for a requirement, kept so every decision can be explained. */
export interface RequirementSource {
  field: RequirementField;
  value: string | number | string[];
  /** Where the evidence came from, e.g. "accept", "aria-describedby", "label", "parent". */
  source: string;
  confidence: number;
  evidence: string;
}

export interface UploadRequirements {
  acceptedMimeTypes: string[];
  acceptedExtensions: string[];
  maxBytes?: number;
  /** Some forms (often government and exam portals) also refuse files that are too small. */
  minBytes?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  exactWidth?: number;
  exactHeight?: number;
  aspectRatio?: number;
  confidence: number;
  sources: RequirementSource[];
}

export interface ImageInfo {
  format: ImageFormat;
  width: number;
  height: number;
  bytes: number;
  transparent: boolean;
  animated: boolean;
  orientation?: number;
}

export type CompatibilityIssue =
  | 'unsupported-format'
  | 'too-large'
  | 'too-small-file'
  | 'too-small-dimensions'
  | 'too-large-dimensions'
  | 'wrong-aspect-ratio'
  | 'exact-dimensions-required'
  | 'unknown';

export type DecisionAction = 'PASS_THROUGH' | 'AUTO_FIX' | 'USER_CONFIRMATION' | 'UNSAFE_TO_FIX';

/** Content-changing steps that a person must approve before they happen. */
export type Consent = 'crop' | 'transparency' | 'animation' | 'palette' | 'upscale' | 'quality';

export interface Decision {
  action: DecisionAction;
  issues: CompatibilityIssue[];
  outputFormat?: OutputFormat;
  consents: Consent[];
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TransformOptions {
  outputFormat: OutputFormat;
  crop?: CropRect;
  allowTransparencyLoss?: boolean;
  allowAnimationLoss?: boolean;
  allowUpscale?: boolean;
}

export type TransformChange =
  | 'converted'
  | 'resized'
  | 'compressed'
  | 'cropped'
  | 'background-added'
  | 'first-frame'
  | 'orientation-applied'
  | 'raised-to-minimum';

export interface TransformResult {
  file: File;
  changes: TransformChange[];
  originalSize: number;
  finalSize: number;
  originalWidth: number;
  originalHeight: number;
  finalWidth: number;
  finalHeight: number;
  originalFormat: ImageFormat;
  finalFormat: OutputFormat;
  /** How much of the original's look the file keeps, 0–100 (see images/quality.ts). */
  qualityKept: number;
  /** Made smaller than the site's own rules ask, to meet its file-size limit. */
  resizedToFit: boolean;
  /**
   * The file-size limit cost quality: compressed below the format's usual quality, or
   * resized to fit. Without it, the file is as good as its format allows.
   */
  sizeLimited: boolean;
}

export interface InspectionResult {
  info: ImageInfo;
  /** A small, browser-displayable rendering (HEIC cannot be shown by Chromium directly). */
  preview?: Blob;
}

export interface SerializedFile {
  name: string;
  type: string;
  lastModified: number;
  data: string;
}
export interface SerializedInspection {
  info: ImageInfo;
  preview?: SerializedFile;
}
export type SerializedTransform = Omit<TransformResult, 'file'> & { file: SerializedFile };

export interface Settings {
  enabled: boolean;
  showNotifications: boolean;
  askBeforeQualityChanges: boolean;
  disabledSites: string[];
}

export interface Stats {
  total: number;
  byChange: Partial<Record<TransformChange, number>>;
}
