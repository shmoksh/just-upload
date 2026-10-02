export type OutputFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'tiff' | 'bmp' | 'ico';
/** Every image Just Upload can read. HEIC/HEIF, SVG and JPEG XL are read-only. */
export type ImageFormat = OutputFormat | 'heic' | 'heif' | 'svg' | 'jxl' | 'unknown';
/** Documents and spreadsheets. XLS (Excel 97–2003) is read-only. */
export type DocumentFormat = 'pdf' | 'csv' | 'xlsx' | 'xls';
export type SheetFormat = 'csv' | 'xlsx' | 'xls';
/** Everything Just Upload can read. */
export type FileFormat = ImageFormat | DocumentFormat;
/** Everything Just Upload can write: an image, a PDF, or a spreadsheet. */
export type FileOutput = OutputFormat | 'pdf' | 'csv' | 'xlsx';

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
  format: FileFormat;
  width: number;
  height: number;
  bytes: number;
  transparent: boolean;
  animated: boolean;
  orientation?: number;
  /** A PDF's page count, when one of its pages becomes the image. */
  pages?: number;
  /** A workbook's sheet names, when one sheet becomes a CSV file. */
  sheets?: string[];
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

/**
 * Content-changing steps that a person must approve before they happen. `page`: only one
 * page of a PDF becomes the image. `sheet`: only one sheet of a workbook becomes the CSV.
 * `shrink`: fewer pixels than the original, because no quality meets the file-size limit
 * at full size.
 */
export type Consent =
  | 'crop'
  | 'transparency'
  | 'animation'
  | 'palette'
  | 'upscale'
  | 'shrink'
  | 'quality'
  | 'page'
  | 'sheet';

export interface Decision {
  action: DecisionAction;
  issues: CompatibilityIssue[];
  outputFormat?: FileOutput;
  consents: Consent[];
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TransformOptions {
  outputFormat: FileOutput;
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
  | 'raised-to-minimum'
  | 'first-page'
  | 'first-sheet';

export interface TransformResult {
  file: File;
  changes: TransformChange[];
  originalSize: number;
  finalSize: number;
  originalWidth: number;
  originalHeight: number;
  finalWidth: number;
  finalHeight: number;
  originalFormat: FileFormat;
  finalFormat: FileOutput;
  /** How much of the original's look the file keeps, 0–100 (see images/quality.ts). */
  qualityKept: number;
  /**
   * Fewer pixels than the site's own rules ask, to meet its file-size limit: used only
   * once the person agrees (see needsShrinkConsent).
   */
  resizedToFit: boolean;
  /**
   * The file-size limit cost quality: compressed below the format's usual quality, or
   * resized to fit. Without it, the file is as good as its format allows.
   */
  sizeLimited: boolean;
}

export interface SerializedFile {
  name: string;
  type: string;
  lastModified: number;
  data: string;
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
