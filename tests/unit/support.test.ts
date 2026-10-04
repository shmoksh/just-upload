import { describe, expect, it } from 'vitest';
import { decide } from '../../src/decision';
import { sanitizeOptions, sanitizeRequirements } from '../../src/images/protocol';
import type { ImageInfo, TransformResult, UploadRequirements } from '../../src/models';
import { parseAccept, parseText } from '../../src/requirements';
import { isActiveOn, normalizeSettings } from '../../src/settings';
import {
  normalizeProblem,
  normalizeProblems,
  roundBytes,
  withProblem,
} from '../../src/storage/problems';
import { addFixes, isChangeList, normalizeStats } from '../../src/storage/stats';
import {
  dialogCopy,
  failureCopy,
  problemLabel,
  problemReport,
  processingCopy,
  rulesSummary,
  successCopy,
} from '../../src/ui/copy';
import { clampCrop, panCrop, zoomCrop, zoomOf } from '../../src/ui/crop-math';
import { widenedAccept } from '../../src/upload/picker';
import {
  base64ToBytes,
  bytesToBase64,
  deserializeFile,
  formatBytes,
  isSerializedFile,
  serializeFile,
} from '../../src/utils/files';

const result = (values: Partial<TransformResult> = {}): TransformResult => ({
  file: new File([], 'x.jpg'),
  changes: ['converted', 'compressed'],
  originalSize: 5_800_000,
  finalSize: 1_800_000,
  originalWidth: 3024,
  originalHeight: 4032,
  finalWidth: 3024,
  finalHeight: 4032,
  originalFormat: 'heic',
  finalFormat: 'jpeg',
  qualityKept: 98,
  resizedToFit: false,
  sizeLimited: true,
  ...values,
});
const info = (values: Partial<ImageInfo> = {}): ImageInfo => ({
  format: 'jpeg',
  width: 900,
  height: 1200,
  bytes: 500_000,
  transparent: false,
  animated: false,
  ...values,
});

describe('copy', () => {
  it('writes the success toast from the spec', () => {
    expect(successCopy([result()])).toEqual({
      title: 'Ready to upload',
      detail: 'HEIC → JPG · 5.8 MB → 1.8 MB · Quality kept: 98%',
      receipt: {
        from: { name: 'HEIC', size: '5.8 MB' },
        to: { name: 'JPG', size: '1.8 MB' },
        quality: '98%',
        noticeable: false,
      },
    });
  });
  it('draws the change as tags: format and size, pixels, or a crop', () => {
    const bigger = successCopy([result({ originalSize: 192_000, finalSize: 428_000 })]).receipt;
    expect([bigger?.from, bigger?.to]).toEqual([{ name: 'HEIC' }, { name: 'JPG' }]);
    const resized = successCopy([
      result({ originalFormat: 'jpeg', changes: ['resized'], finalWidth: 1512, finalHeight: 2016 }),
    ]).receipt;
    expect([resized?.from?.name, resized?.to?.name]).toEqual(['3024 × 4032', '1512 × 2016']);
    const cropped = successCopy([
      result({ originalFormat: 'jpeg', changes: ['cropped'], finalWidth: 600, finalHeight: 600 }),
    ]).receipt;
    expect(cropped).toMatchObject({ note: 'Cropped to', to: { name: '600 × 600' } });
    expect(cropped?.from).toBeUndefined();
    const several = successCopy([result({ qualityKept: 96 }), result()]).receipt;
    expect(several).toEqual({
      note: '2 images, in the same order',
      quality: '96–98%',
      noticeable: true,
    });
  });
  it('describes same-format fixes plainly, and never brags about a bigger file', () => {
    expect(successCopy([result({ originalFormat: 'jpeg', changes: ['resized'] })]).detail).toBe(
      'Resized to fit · 5.8 MB → 1.8 MB · Quality kept: 98%',
    );
    expect(successCopy([result({ originalFormat: 'jpeg', changes: ['compressed'] })]).detail).toBe(
      'Made smaller · 5.8 MB → 1.8 MB · Quality kept: 98%',
    );
    expect(successCopy([result({ originalSize: 192_000, finalSize: 428_000 })]).detail).toBe(
      'HEIC → JPG · Quality kept: 98%',
    );
    expect(successCopy([result(), result()]).detail).toBe(
      '2 images prepared, in the same order · Quality kept: 98%',
    );
    expect(successCopy([result({ qualityKept: 97 }), result({ qualityKept: 100 })]).detail).toBe(
      '2 images prepared, in the same order · Quality kept: 97–100%',
    );
  });
  it('keeps processing and failure messages calm and non-technical', () => {
    expect(processingCopy(1).title).toBe('Preparing image…');
    expect(failureCopy('damaged', false)).toEqual({
      title: 'Couldn’t safely prepare this image',
      detail: 'Your original file is still selected.',
    });
    expect(failureCopy('damaged', true).detail).toBe('Please choose a different file.');
    for (const copy of [
      failureCopy('too-large-to-process', false),
      failureCopy('target-unreachable', false),
    ]) {
      expect(`${copy.title} ${copy.detail}`).not.toMatch(/quality|encoder|pixel|%|MB/);
    }
  });
  it('asks simple questions in dialogs', () => {
    const crop = dialogCopy(
      decide(info(), parseText('Square profile image')),
      parseText('Square profile image'),
      false,
    );
    expect(crop).toMatchObject({
      title: 'This site needs a square photo',
      confirm: 'Use this crop',
      decline: 'Use original',
    });
    const wide = parseText('Aspect ratio 16:9');
    expect(dialogCopy(decide(info(), wide), wide, false).title).toBe(
      'This site needs a wide photo',
    );
    const jpegOnly = parseAccept('image/jpeg');
    const alpha = dialogCopy(
      decide(info({ format: 'png', transparent: true, width: 500, height: 500 }), jpegOnly),
      jpegOnly,
      true,
    );
    expect(alpha).toMatchObject({
      title: 'This site only accepts JPG',
      confirm: 'Convert & upload',
      decline: 'Cancel',
      notes: [],
    });
    const both: UploadRequirements = { ...jpegOnly, aspectRatio: 1 };
    expect(
      dialogCopy(decide(info({ format: 'png', transparent: true }), both), both, false).notes,
    ).toEqual(['The transparent background will be filled with white.']);
  });
  it('states how much quality a file keeps, as a percentage', () => {
    const decision = {
      action: 'USER_CONFIRMATION' as const,
      issues: [],
      outputFormat: 'jpeg' as const,
      consents: ['quality' as const],
    };
    const rules = parseAccept('image/jpeg');
    expect(dialogCopy(decision, rules, false, 91)).toEqual({
      title: 'Some quality would be lost',
      body: 'Quality kept: 91% of your photo. That’s the best that fits this site’s limits.',
      notes: [],
      confirm: 'Upload at 91%',
      decline: 'Use original',
    });
    expect(dialogCopy(decision, rules, true, 88)).toMatchObject({
      title: 'Some quality would be lost',
      confirm: 'Upload at 88%',
      decline: 'Cancel',
    });
  });
  it('says what fewer pixels means: the new size, and the quality it keeps', () => {
    const shrink = (outputFormat: 'jpeg' | 'pdf') => ({
      action: 'USER_CONFIRMATION' as const,
      issues: [],
      outputFormat,
      consents: ['shrink' as const],
    });
    const rules = parseText('File size should not exceed 500 KB');
    const photo = { format: 'jpeg' as const, width: 6240, height: 4160 };
    const fitted = { width: 2830, height: 1887 };
    expect(dialogCopy(shrink('jpeg'), rules, false, 97, { ...photo, fitted })).toEqual({
      title: 'This image can’t fit 500 KB at full size',
      body: 'To fit, it needs fewer pixels: 6240 × 4160 → 2830 × 1887. It keeps 97% of its quality, so it looks the same on a screen.',
      notes: [],
      confirm: 'Make it smaller',
      decline: 'Use original',
    });
    expect(dialogCopy(shrink('jpeg'), rules, false, 93, { ...photo, fitted }).body).toBe(
      'To fit, it needs fewer pixels: 6240 × 4160 → 2830 × 1887. It keeps 93% of its quality.',
    );
    const scan = {
      format: 'pdf' as const,
      width: 2480,
      height: 3508,
      fitted: { width: 1240, height: 1754 },
    };
    expect(dialogCopy(shrink('pdf'), rules, false, 94, scan)).toMatchObject({
      title: 'This PDF can’t fit 500 KB at full size',
      body: 'To fit, its pictures need fewer pixels (the largest goes from 2480 × 3508 to 1240 × 1754). Its text and layout stay the same, and the pictures keep 94% of their quality.',
    });
  });
});

describe('crop math', () => {
  const [W, H] = [3024, 4032];
  it('zooms around the centre and keeps the shape', () => {
    const start = { x: 0, y: 504, width: 3024, height: 3024 };
    const zoomed = zoomCrop(start, 2, W, H, 1);
    expect(zoomed).toEqual({ x: 756, y: 1260, width: 1512, height: 1512 });
    expect(zoomOf(zoomed, W, H, 1)).toBe(2);
    expect(zoomOf(zoomCrop(start, 99, W, H, 1), W, H, 1)).toBe(4);
    expect(zoomOf(zoomCrop(start, 0.1, W, H, 1), W, H, 1)).toBe(1);
  });
  it('never lets a crop leave the image', () => {
    const crop = { x: 0, y: 0, width: 1000, height: 1000 };
    expect(panCrop(crop, -500, -500, W, H)).toEqual(crop);
    expect(panCrop(crop, 99_999, 99_999, W, H)).toEqual({
      x: 2024,
      y: 3032,
      width: 1000,
      height: 1000,
    });
    expect(clampCrop({ x: -5, y: 0, width: 5000, height: 10 }, W, H)).toEqual({
      x: 0,
      y: 0,
      width: 3024,
      height: 10,
    });
  });
});

describe('settings and local counts', () => {
  it('fills defaults and rejects malformed stored values', () => {
    expect(normalizeSettings(undefined)).toEqual({
      enabled: true,
      showNotifications: true,
      askBeforeQualityChanges: true,
      disabledSites: [],
    });
    const stored = normalizeSettings({
      enabled: 'yes',
      askBeforeQualityChanges: false,
      disabledSites: ['Example.com', 'example.com', 5, 'bad site/', 'a'.repeat(300)],
    });
    expect(stored).toMatchObject({
      enabled: true,
      askBeforeQualityChanges: false,
      disabledSites: ['example.com'],
    });
  });
  it('pauses a frame when its own site or an embedding page is paused', () => {
    const settings = normalizeSettings({ disabledSites: ['shop.example'] });
    expect(isActiveOn(settings, ['widget.uploads.example'])).toBe(true);
    expect(isActiveOn(settings, ['widget.uploads.example', 'shop.example'])).toBe(false);
    expect(isActiveOn(normalizeSettings({ enabled: false }), ['a.example'])).toBe(false);
  });
  it('counts fixes by kind, without anything identifying', () => {
    const stats = addFixes(normalizeStats({}), [['converted', 'compressed'], ['resized']]);
    expect(stats).toEqual({ total: 2, byChange: { converted: 1, compressed: 1, resized: 1 } });
    expect(
      normalizeStats({ total: -1, byChange: { converted: 'x', cropped: 2, evil: 5 } }),
    ).toEqual({ total: 0, byChange: { cropped: 2 } });
    expect(isChangeList([['converted']])).toBe(true);
    expect(isChangeList([['https://example.com']])).toBe(false);
  });
});

describe('picker widening', () => {
  it('adds every format Just Upload can convert to a specific list', () => {
    const widened = widenedAccept('image/jpeg,image/png')!;
    expect(widened.startsWith('image/jpeg,image/png,')).toBe(true);
    for (const token of [
      '.heic',
      '.heif',
      '.webp',
      '.avif',
      '.gif',
      '.tif',
      '.bmp',
      '.ico',
      '.svg',
      '.jxl',
      // A PDF's first page can become the image.
      '.pdf',
    ]) {
      expect(widened.split(',')).toContain(token);
    }
    expect(widened.split(',')).not.toContain('.jpg');
    // A spreadsheet can never become an image.
    expect(widened.split(',')).not.toContain('.csv');
    expect(widenedAccept('.jpg')).toContain('.png');
  });
  it('offers images on a PDF field, and the other spreadsheet format on a spreadsheet field', () => {
    const pdf = widenedAccept('application/pdf')!.split(',');
    expect(pdf).toEqual(expect.arrayContaining(['.heic', '.jpg', '.png', '.webp']));
    expect(pdf).not.toContain('.xlsx');
    const csv = widenedAccept('.csv')!.split(',');
    expect(csv).toEqual(expect.arrayContaining(['.xlsx', '.xls']));
    expect(csv).not.toContain('.jpg');
    expect(widenedAccept('.xlsx')!.split(',')).toEqual(expect.arrayContaining(['.csv', '.xls']));
  });
  it('leaves wildcards and complete lists alone', () => {
    expect(widenedAccept('image/*')).toBeUndefined();
    expect(widenedAccept('image/*,.pdf')).toBeUndefined();
    expect(widenedAccept('')).toBeUndefined();
    const everything = '.jpg,.png,.webp,.avif,.gif,.tif,.bmp,.ico,.heic,.svg,.jxl,.pdf';
    expect(widenedAccept(everything)).toBeUndefined();
  });
});

describe('message boundaries', () => {
  it('rebuilds requirements field by field and drops page text', () => {
    const clean = sanitizeRequirements({
      acceptedMimeTypes: ['image/jpeg', 5, 'x'.repeat(200)],
      maxBytes: 2_000_000,
      minWidth: -1,
      maxWidth: Number.POSITIVE_INFINITY,
      sources: [{ evidence: 'secret page text' }],
      injected: true,
    });
    expect(clean).toEqual({
      acceptedMimeTypes: ['image/jpeg'],
      acceptedExtensions: [],
      confidence: 0,
      sources: [],
      maxBytes: 2_000_000,
    });
  });
  it('defaults consent flags to "not approved"', () => {
    expect(sanitizeOptions({ outputFormat: 'psd', crop: { x: 'a' } })).toEqual({
      outputFormat: 'jpeg',
      allowTransparencyLoss: false,
      allowAnimationLoss: false,
      allowUpscale: false,
    });
  });
  it('carries a chosen sheet only as a small whole number', () => {
    expect(sanitizeOptions({ outputFormat: 'csv', sheet: 2 })).toMatchObject({ sheet: 2 });
    for (const sheet of [0, -1, 1.5, 1e6, '2'])
      expect(sanitizeOptions({ outputFormat: 'csv', sheet })).not.toHaveProperty('sheet');
  });
  it('round-trips files through base64 exactly', async () => {
    const bytes = new Uint8Array(70_000).map((_, i) => (i * 31) % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    const serialized = await serializeFile(
      new File([bytes], 'Café 📷.heic', { type: 'image/heic', lastModified: 42 }),
    );
    expect(isSerializedFile(serialized)).toBe(true);
    const back = deserializeFile(serialized);
    expect([back.name, back.type, back.lastModified, back.size]).toEqual([
      'Café 📷.heic',
      'image/heic',
      42,
      70_000,
    ]);
    expect(new Uint8Array(await back.arrayBuffer())).toEqual(bytes);
    expect(isSerializedFile({ name: 'a', type: '', lastModified: 0, data: 1 })).toBe(false);
  });
  it('formats sizes the way sites write limits', () => {
    expect([
      formatBytes(512),
      formatBytes(900_000),
      formatBytes(1_800_000),
      formatBytes(5_800_000),
      formatBytes(2_000_000),
      formatBytes(999_600),
      formatBytes(588_000_000),
      formatBytes(4_560_000_000),
    ]).toEqual(['512 B', '900 KB', '1.8 MB', '5.8 MB', '2 MB', '1 MB', '588 MB', '4.6 GB']);
  });
});

describe('problem notes', () => {
  const note = {
    at: '2026-09-30T14:05:00.000Z',
    code: 'target-unreachable',
    format: 'png',
    bytes: 8_400_000,
    rules: 'JPG · max 100 KB',
  };
  const environment = { version: '1.0.0', browser: 'Google Chrome 141', platform: 'macOS' };

  it('round sizes to two significant figures', () => {
    expect([0, -5, NaN, 7, 512, 1234, 98_765, 8_449_999, 4_560_000_000].map(roundBytes)).toEqual([
      0, 0, 0, 7, 510, 1200, 99_000, 8_400_000, 4_600_000_000,
    ]);
  });
  it('rebuild stored entries and drop anything unexpected', () => {
    expect(normalizeProblem({ ...note, bytes: 8_449_999, name: 'IMG_1.png' })).toEqual(note);
    expect(normalizeProblem({ ...note, code: 'stolen' })).toBeUndefined();
    expect(normalizeProblem({ ...note, at: 'yesterday' })).toBeUndefined();
    expect(normalizeProblem({ ...note, format: 'exe' })?.format).toBe('unknown');
    expect(normalizeProblem({ ...note, rules: 'a\nb\u0000c'.repeat(100) })?.rules).toMatch(
      /^a b c/,
    );
    expect(normalizeProblem({ ...note, rules: 'x'.repeat(500) })?.rules).toHaveLength(160);
    expect(normalizeProblems('nope')).toEqual([]);
    expect(normalizeProblems([note, null, 4])).toEqual([note]);
  });
  it('keep only the 20 most recent', () => {
    let problems = normalizeProblems([]);
    for (let i = 0; i < 25; i++)
      problems = withProblem(problems, { ...normalizeProblem(note)!, bytes: i });
    expect(problems).toHaveLength(20);
    expect(problems[0]!.bytes).toBe(5);
    expect(problems.at(-1)!.bytes).toBe(24);
    expect(normalizeProblems(Array.from({ length: 30 }, () => note))).toHaveLength(20);
  });
  it('make a plain report, newest first, with only what the person typed added', () => {
    const older = {
      ...normalizeProblem(note)!,
      at: '2026-09-29T09:00:00.000Z',
      code: 'damaged' as const,
    };
    const report = problemReport([older, normalizeProblem(note)!], {
      ...environment,
      website: '  jobs.example  ',
    });
    expect(report).toBe(
      [
        'Just Upload problem report',
        'Version 1.0.0 · Google Chrome 141 · macOS',
        'Website: jobs.example',
        '',
        '1. 2026-09-30 14:05 UTC: The image could not be made small enough (target-unreachable)',
        '   Image: PNG, about 8.4 MB',
        '   Upload rules: JPG · max 100 KB',
        '2. 2026-09-29 09:00 UTC: The image could not be read (damaged)',
        '   Image: PNG, about 8.4 MB',
        '   Upload rules: JPG · max 100 KB',
      ].join('\n'),
    );
    expect(problemReport([], environment)).toContain('Website: not given\n\nNo problems recorded.');
    expect(problemLabel('failed')).toBe('Something went wrong while preparing the image');
  });
  it('summarise a field’s rules in one line', () => {
    expect(
      rulesSummary({
        ...parseAccept('.jpg,.png'),
        maxBytes: 2_000_000,
        exactWidth: 600,
        exactHeight: 600,
      }),
    ).toBe('JPG, PNG · max 2 MB · 600 × 600');
    expect(rulesSummary(parseText('Max 1920 x 1080 pixels'))).toBe('at most 1920 × 1080');
    expect(rulesSummary(parseAccept('.webp'))).toBe('WebP');
    expect(rulesSummary(parseText('Photo (JPG, 20-50 KB, 200x230 px)'))).toBe(
      'JPG · 20 KB–50 KB · 200 × 230',
    );
    expect(rulesSummary(parseAccept('image/png,.jpeg,.jpg'))).toBe('PNG, JPG');
    expect(rulesSummary(parseAccept('image/*'))).toBe('any image');
    expect(rulesSummary(parseAccept(''))).toBe('no rules found');
  });
});
