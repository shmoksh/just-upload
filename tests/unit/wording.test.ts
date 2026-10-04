import { describe, expect, it } from 'vitest';
import type { UploadRequirements } from '../../src/models';
import { parseText } from '../../src/requirements';

// Websites word the same rule in many ways. Every line here is how a real site might say
// it, and what Just Upload must understand from it. Rules found with less confidence than
// it acts on (advice, a site describing itself) must not appear at all.

const JPG = 'image/jpeg';
const PNG = 'image/png';
const PDF = 'application/pdf';
const CSV = 'text/csv';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLS = 'application/vnd.ms-excel';
const KB = 1_000;
const MB = 1_000_000;

type Expected = Partial<Omit<UploadRequirements, 'sources' | 'confidence'>>;

/** Only rules confident enough to act on: the same threshold the extension uses. */
function read(text: string): Expected {
  const parsed = parseText(text);
  const out: Expected = {};
  const fields = [
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
  ] as const;
  const confident = new Set(
    parsed.sources.filter((source) => source.confidence >= 0.85).map((source) => source.field),
  );
  // A printed size gives the shape, and with a DPI the pixel size, without saying them.
  const printed = confident.has('printWidth') && confident.has('printHeight');
  const fromPrint = new Set(['aspectRatio', 'exactWidth', 'exactHeight']);
  for (const field of fields) {
    const value = parsed[field];
    if (value !== undefined && (confident.has(field) || (printed && fromPrint.has(field))))
      out[field] = value;
  }
  if (parsed.acceptedMimeTypes.length) out.acceptedMimeTypes = [...parsed.acceptedMimeTypes].sort();
  return out;
}

const cases: [string, Expected][] = [
  // File size: the maximum
  ['Max file size: 2MB', { maxBytes: 2 * MB }],
  ['Maximum file size 2 MB', { maxBytes: 2 * MB }],
  ['File size must not exceed 2 MB', { maxBytes: 2 * MB }],
  ['File size should not exceed 500KB', { maxBytes: 500 * KB }],
  ['The file should be less than 1MB', { maxBytes: 1 * MB }],
  ['Upload an image under 5 MB', { maxBytes: 5 * MB }],
  ['Images up to 10 MB', { maxBytes: 10 * MB }],
  ['2MB max', { maxBytes: 2 * MB }],
  ['Max. 2 MB', { maxBytes: 2 * MB }],
  ['max 2mb', { maxBytes: 2 * MB }],
  ['Size limit: 5 MB', { maxBytes: 5 * MB }],
  ['File size limit is 4 MB', { maxBytes: 4 * MB }],
  ['(max 1.5 MB)', { maxBytes: 1.5 * MB }],
  ['Max size 1,5 MB', { maxBytes: 1.5 * MB }],
  ['File size must be less than or equal to 2 MB', { maxBytes: 2 * MB }],
  ['≤ 2 MB', { maxBytes: 2 * MB }],
  ['2 MB or less', { maxBytes: 2 * MB }],
  ['No larger than 3MB', { maxBytes: 3 * MB }],
  ['Files larger than 5 MB will be rejected', { maxBytes: 5 * MB }],
  ['Maximum upload size: 2048 KB', { maxBytes: 2048 * KB }],
  ['Image size should be less than 100kb', { maxBytes: 100 * KB }],
  ['Your photo must be smaller than 8MB', { maxBytes: 8 * MB }],
  ['Please keep it below 2 MB', { maxBytes: 2 * MB }],
  ['Only files up to 2 megabytes', { maxBytes: 2 * MB }],
  ['Maximum allowed file size is 5MB.', { maxBytes: 5 * MB }],
  ['Uploads are limited to 10MB', { maxBytes: 10 * MB }],
  ['Max file size 2 MiB', { maxBytes: 2 * 1024 * 1024 }],
  ['max size: 500 kB', { maxBytes: 500 * KB }],
  ['Image should not be more than 300 KB in size', { maxBytes: 300 * KB }],
  ['The maximum size for a file is 2 MB', { maxBytes: 2 * MB }],
  ['Limit 2MB per image', { maxBytes: 2 * MB }],
  ['Each photo can be up to 5 MB', { maxBytes: 5 * MB }],
  ['Max 5MB each', { maxBytes: 5 * MB }],
  ['File size: 2 MB maximum', { maxBytes: 2 * MB }],
  ['Max size 2 Mb', { maxBytes: 2 * MB }],
  ['Max file size is 2,048 KB', { maxBytes: 2048 * KB }],
  ['Upload limit 1 MB', { maxBytes: 1 * MB }],
  ['Photo must not be larger than 1 MB', { maxBytes: 1 * MB }],
  ['The image cannot exceed 2MB', { maxBytes: 2 * MB }],
  ['Image file should be within 200 KB', { maxBytes: 200 * KB }],

  // File size: a range, as government and exam portals write it
  ['Photo size should be between 20 KB and 50 KB', { minBytes: 20 * KB, maxBytes: 50 * KB }],
  ['File size: 20KB - 50KB', { minBytes: 20 * KB, maxBytes: 50 * KB }],
  ['Size of photo should be from 10 KB to 200 KB', { minBytes: 10 * KB, maxBytes: 200 * KB }],
  ['Photo: 20 to 50 KB', { minBytes: 20 * KB, maxBytes: 50 * KB }],
  ['File size 10-20 KB', { minBytes: 10 * KB, maxBytes: 20 * KB }],
  ['Minimum 20 KB, maximum 100 KB', { minBytes: 20 * KB, maxBytes: 100 * KB }],
  ['At least 10 KB and not more than 50 KB', { minBytes: 10 * KB, maxBytes: 50 * KB }],
  ['Image size must be at least 50 KB', { minBytes: 50 * KB }],

  // Formats
  ['JPG, PNG or GIF', { acceptedMimeTypes: ['image/gif', JPG, PNG] }],
  ['Accepted formats: .jpg, .jpeg, .png', { acceptedMimeTypes: [JPG, PNG] }],
  ['Allowed file types: jpeg, png', { acceptedMimeTypes: [JPG, PNG] }],
  ['Only JPEG/JPG files are accepted', { acceptedMimeTypes: [JPG] }],
  ['Supported: JPG, PNG, WEBP', { acceptedMimeTypes: [JPG, PNG, 'image/webp'] }],
  ['File must be in JPEG format', { acceptedMimeTypes: [JPG] }],
  ['Photo should be in JPG/JPEG format only', { acceptedMimeTypes: [JPG] }],
  ['Upload a PNG or JPEG image', { acceptedMimeTypes: [JPG, PNG] }],
  ['Please upload the photo in .jpg format', { acceptedMimeTypes: [JPG] }],
  ['Accepted file formats: JPG, JPEG, PNG and PDF', { acceptedMimeTypes: [PDF, JPG, PNG] }],
  // Documents and spreadsheets
  ['PDF only, max 2 MB', { acceptedMimeTypes: [PDF], maxBytes: 2 * MB }],
  ['Upload your resume as a PDF', { acceptedMimeTypes: [PDF] }],
  ['Scanned copy (PDF or JPG, max 500 KB)', { acceptedMimeTypes: [PDF, JPG], maxBytes: 500 * KB }],
  ['CSV files only', { acceptedMimeTypes: [CSV] }],
  ['Accepted formats: .csv, .xlsx', { acceptedMimeTypes: [XLSX, CSV] }],
  ['Upload an Excel file', { acceptedMimeTypes: [XLS, XLSX] }],
  ['Images must be JPEG or PNG', { acceptedMimeTypes: [JPG, PNG] }],
  ['Format: JPG', { acceptedMimeTypes: [JPG] }],
  ['File type: JPEG, PNG', { acceptedMimeTypes: [JPG, PNG] }],
  ['We accept JPG and PNG images', { acceptedMimeTypes: [JPG, PNG] }],
  ['JPG only, no PNG', { acceptedMimeTypes: [JPG] }],
  ['Accepted: image/jpeg, image/png', { acceptedMimeTypes: [JPG, PNG] }],
  ['Supported file types: .png .jpg .jpeg .webp', { acceptedMimeTypes: [JPG, PNG, 'image/webp'] }],
  ['(jpg, png)', { acceptedMimeTypes: [JPG, PNG] }],
  ['Please save your file as a TIFF before uploading', { acceptedMimeTypes: ['image/tiff'] }],
  ['Must be a .ico file', { acceptedMimeTypes: ['image/x-icon'] }],
  ['Only .jpg/.jpeg allowed', { acceptedMimeTypes: [JPG] }],
  ['File format should be JPG', { acceptedMimeTypes: [JPG] }],

  // Dimensions
  ['Dimensions: 600 x 600 pixels', { exactWidth: 600, exactHeight: 600 }],
  ['600x600px', { exactWidth: 600, exactHeight: 600 }],
  ['Image must be 600 × 600 px', { exactWidth: 600, exactHeight: 600 }],
  ['Minimum 600 x 600 pixels', { minWidth: 600, minHeight: 600 }],
  ['At least 1080 pixels wide', { minWidth: 1080 }],
  ['Minimum width 800px', { minWidth: 800 }],
  ['Max width: 1920px', { maxWidth: 1920 }],
  ['Maximum dimensions 4000 x 4000 pixels', { maxWidth: 4000, maxHeight: 4000 }],
  ['Photo dimensions: 200 x 230 pixels (width x height)', { exactWidth: 200, exactHeight: 230 }],
  ['Image should be at least 400 by 400 pixels', { minWidth: 400, minHeight: 400 }],
  ['Up to 1920 × 1920 pixels', { maxWidth: 1920, maxHeight: 1920 }],
  ['Max 2000px on the longest side', { maxWidth: 2000, maxHeight: 2000 }],
  ['Minimum 1000px on the shortest side', { minWidth: 1000, minHeight: 1000 }],
  ['Logo should be 512x512', { exactWidth: 512, exactHeight: 512 }],
  ['Height must not exceed 1000 pixels', { maxHeight: 1000 }],
  ['No smaller than 300 x 300 px', { minWidth: 300, minHeight: 300 }],
  ['Resolution: 1280 x 720 minimum', { minWidth: 1280, minHeight: 720 }],
  ['Width 200 px and height 230 px', { exactWidth: 200, exactHeight: 230 }],
  ['Images must be between 600 and 1200 pixels wide', { minWidth: 600, maxWidth: 1200 }],
  ['Aspect ratio must be 1:1', { aspectRatio: 1 }],
  ['The image must be square', { aspectRatio: 1 }],
  ['Aspect ratio 16:9', { aspectRatio: 16 / 9 }],

  // Everything at once
  [
    'JPG or PNG, max 2 MB, at least 400x400 px',
    { acceptedMimeTypes: [JPG, PNG], maxBytes: 2 * MB, minWidth: 400, minHeight: 400 },
  ],
  [
    'Upload a JPEG (max 5MB, 1024x768 minimum)',
    { acceptedMimeTypes: [JPG], maxBytes: 5 * MB, minWidth: 1024, minHeight: 768 },
  ],
  [
    'Photo (JPG/JPEG, 20-50 KB, 200x230 px)',
    {
      acceptedMimeTypes: [JPG],
      minBytes: 20 * KB,
      maxBytes: 50 * KB,
      exactWidth: 200,
      exactHeight: 230,
    },
  ],
  [
    'Signature: JPG, 10 KB to 20 KB, 140 x 60 pixels',
    {
      acceptedMimeTypes: [JPG],
      minBytes: 10 * KB,
      maxBytes: 20 * KB,
      exactWidth: 140,
      exactHeight: 60,
    },
  ],
  [
    'Profile picture must be a JPG or PNG file no larger than 2MB.',
    { acceptedMimeTypes: [JPG, PNG], maxBytes: 2 * MB },
  ],
  [
    'Accepted formats are JPG and PNG. Maximum size is 1 MB.',
    { acceptedMimeTypes: [JPG, PNG], maxBytes: 1 * MB },
  ],
  [
    'Images should be in JPG format and less than 300kb',
    { acceptedMimeTypes: [JPG], maxBytes: 300 * KB },
  ],
  [
    'Please upload a clear photograph in JPEG format of size between 50KB-100KB',
    { acceptedMimeTypes: [JPG], minBytes: 50 * KB, maxBytes: 100 * KB },
  ],
  [
    'Upload your passport-size photo (JPEG, max 240 KB, 600 × 600 pixels)',
    { acceptedMimeTypes: [JPG], maxBytes: 240 * KB, exactWidth: 600, exactHeight: 600 },
  ],

  // More of the same, worded the way people actually write it
  ['Max. file size 5 MB.', { maxBytes: 5 * MB }],
  ['File size: up to 2 MB', { maxBytes: 2 * MB }],
  ['Size: max 2MB', { maxBytes: 2 * MB }],
  ['<2MB', { maxBytes: 2 * MB }],
  ['Under 1MB please', { maxBytes: 1 * MB }],
  ['1MB limit', { maxBytes: 1 * MB }],
  ['Maximum of 2MB', { maxBytes: 2 * MB }],
  ['File must be 2 MB or smaller', { maxBytes: 2 * MB }],
  ['Not more than 200 KB', { maxBytes: 200 * KB }],
  ['Max: 500KB', { maxBytes: 500 * KB }],
  ['Photo should be of size less than 50 kb', { maxBytes: 50 * KB }],
  ['Image upto 2MB', { maxBytes: 2 * MB }],
  ['Maximum size allowed: 2 MB', { maxBytes: 2 * MB }],
  ['Images over 10 MB will not be accepted', { maxBytes: 10 * MB }],
  ['Files bigger than 2MB cannot be uploaded', { maxBytes: 2 * MB }],
  ['File size should be in between 10KB to 100KB', { minBytes: 10 * KB, maxBytes: 100 * KB }],
  ['Size should be 10kb to 20kb', { minBytes: 10 * KB, maxBytes: 20 * KB }],
  ['Min. 600px wide', { minWidth: 600 }],
  ['Minimum resolution 1080 x 1080', { minWidth: 1080, minHeight: 1080 }],
  ['width:600px height:600px', { exactWidth: 600, exactHeight: 600 }],
  ['Please make sure the image is at least 500px by 500px', { minWidth: 500, minHeight: 500 }],
  ['max 1920px', { maxWidth: 1920, maxHeight: 1920 }],
  ['PNG with transparent background, max 1MB', { acceptedMimeTypes: [PNG], maxBytes: 1 * MB }],
  ['SVG or PNG logo', { acceptedMimeTypes: [PNG, 'image/svg+xml'] }],
  ['Only images (jpg, jpeg, png) are allowed', { acceptedMimeTypes: [JPG, PNG] }],
  ['Accepts .jpeg .jpg .png .gif', { acceptedMimeTypes: ['image/gif', JPG, PNG] }],
  ['File types: JPG, JPEG, PNG. Max 5MB.', { acceptedMimeTypes: [JPG, PNG], maxBytes: 5 * MB }],
  ['JPG/PNG up to 5MB', { acceptedMimeTypes: [JPG, PNG], maxBytes: 5 * MB }],
  [
    'WEBP format, 1:1, under 300 KB',
    { acceptedMimeTypes: ['image/webp'], aspectRatio: 1, maxBytes: 300 * KB },
  ],
  ['Upload a GIF (max 1 MB)', { acceptedMimeTypes: ['image/gif'], maxBytes: 1 * MB }],

  // Printed sizes and DPI, as passport and exam forms give them
  ['Photo size 3.5 cm × 4.5 cm', { printWidth: 35, printHeight: 45, aspectRatio: 35 / 45 }],
  ['35 x 45 mm passport photo', { printWidth: 35, printHeight: 45, aspectRatio: 35 / 45 }],
  ['Photo 2 × 2 inches', { printWidth: 50.8, printHeight: 50.8, aspectRatio: 1 }],
  ['2" x 2" photo', { printWidth: 50.8, printHeight: 50.8, aspectRatio: 1 }],
  [
    'Photo: 3.5 cm x 4.5 cm, 200 DPI',
    {
      printWidth: 35,
      printHeight: 45,
      dpi: 200,
      exactWidth: 276,
      exactHeight: 354,
      aspectRatio: 276 / 354,
    },
  ],
  [
    'Photo 51 x 51 mm, 300 dpi',
    {
      printWidth: 51,
      printHeight: 51,
      dpi: 300,
      exactWidth: 602,
      exactHeight: 602,
      aspectRatio: 1,
    },
  ],
  ['Scan at 300 dpi', { dpi: 300 }],
  ['Resolution: 200-300 DPI', { dpi: 200 }],
  // Pixels the form states win over its printed size: they rarely agree exactly.
  [
    'JPG, 200 × 230 pixels, 3.5 cm × 4.5 cm, 20 KB to 50 KB',
    {
      acceptedMimeTypes: [JPG],
      exactWidth: 200,
      exactHeight: 230,
      printWidth: 35,
      printHeight: 45,
      minBytes: 20 * KB,
      maxBytes: 50 * KB,
    },
  ],

  // Not rules
  ['Uploading 10 photos makes your profile 5x more visible', {}],
  ['Our app compresses photos by up to 80%', {}],
  ['Call us at 1-800-555-0199', {}],
  ['Step 2 of 3', {}],
  ['Recommended size: 1200 x 628 pixels', {}],
  ['For best results, use images at least 1080px wide', {}],
  ['We will automatically resize images larger than 4000px', {}],
  ['Total upload size must not exceed 20 MB', {}],
  ['Upload in 3 x 4 in size', {}],
  ['HEIC files are not supported', {}],
];

describe('reading rules however a website words them', () => {
  it.each(cases)('%s', (text, expected) => {
    expect(read(text)).toEqual(expected);
  });
});
