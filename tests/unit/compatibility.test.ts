import { describe, expect, it } from 'vitest';
import {
  allowedOutputs,
  conflictingRules,
  evaluateCompatibility,
  formatAllowed,
  guessFormat,
  mightNeedWork,
  safeMinimum,
  sameRatio,
} from '../../src/compatibility';
import type { ImageInfo, UploadRequirements } from '../../src/models';
import { parseAccept, parseText } from '../../src/requirements';

const rules = (values: Partial<UploadRequirements> = {}): UploadRequirements => ({
  acceptedMimeTypes: [],
  acceptedExtensions: [],
  confidence: 1,
  sources: [],
  ...values,
});
const photo: ImageInfo = {
  format: 'jpeg',
  width: 1200,
  height: 800,
  bytes: 900_000,
  transparent: false,
  animated: false,
};

describe('evaluateCompatibility', () => {
  it('reports every issue, not just the first: HEIC 5.8 MB on "JPG/PNG · max 2MB"', () => {
    const issues = evaluateCompatibility(
      { ...photo, format: 'heic', bytes: 5_800_000 },
      parseText('JPG/PNG · Maximum 2MB'),
    );
    expect(issues).toEqual(['unsupported-format', 'too-large']);
  });
  it('accepts a compatible 900 KB JPG on "JPG/PNG · max 2MB"', () => {
    expect(evaluateCompatibility(photo, parseText('JPG/PNG · max 2MB'))).toEqual([]);
  });
  it('honours accept alternatives and wildcards', () => {
    expect(evaluateCompatibility(photo, parseAccept('.png,image/jpeg'))).toEqual([]);
    expect(evaluateCompatibility({ ...photo, format: 'heic' }, parseAccept('image/*'))).toEqual([]);
    expect(evaluateCompatibility({ ...photo, format: 'heif' }, parseAccept('.heic'))).toEqual([]);
  });
  it('checks dimension rules', () => {
    expect(evaluateCompatibility(photo, rules({ minWidth: 1600 }))).toEqual([
      'too-small-dimensions',
    ]);
    expect(evaluateCompatibility(photo, rules({ maxWidth: 1000, maxHeight: 1000 }))).toEqual([
      'too-large-dimensions',
    ]);
    expect(evaluateCompatibility(photo, rules({ exactWidth: 1200, exactHeight: 800 }))).toEqual([]);
    expect(evaluateCompatibility(photo, rules({ exactWidth: 600, exactHeight: 600 }))).toEqual([
      'exact-dimensions-required',
      'wrong-aspect-ratio',
    ]);
    expect(evaluateCompatibility(photo, rules({ aspectRatio: 1 }))).toEqual(['wrong-aspect-ratio']);
    expect(evaluateCompatibility(photo, rules({ aspectRatio: 3 / 2 }))).toEqual([]);
  });
  it('flags unknown or empty images', () => {
    expect(evaluateCompatibility({ ...photo, format: 'unknown' }, rules())).toEqual(['unknown']);
    expect(evaluateCompatibility({ ...photo, bytes: 0 }, rules())).toEqual(['unknown']);
    expect(evaluateCompatibility({ ...photo, width: 0 }, rules({ maxWidth: 10 }))).toEqual([
      'unknown',
    ]);
  });
  it('reads a minimum file size strictly: "20 KB" may be counted as 20,480 bytes', () => {
    const exam = parseText('Photo size should be between 20 KB and 50 KB');
    expect(safeMinimum(20_000)).toBe(20_480);
    expect(safeMinimum(1_000_000)).toBe(1_048_576);
    expect(evaluateCompatibility({ ...photo, bytes: 20_100 }, exam)).toEqual(['too-small-file']);
    expect(evaluateCompatibility({ ...photo, bytes: 20_600 }, exam)).toEqual([]);
    expect(mightNeedWork({ name: 'a.jpg', type: 'image/jpeg', size: 20_100 }, exam)).toBe(true);
    expect(mightNeedWork({ name: 'a.jpg', type: 'image/jpeg', size: 20_600 }, exam)).toBe(false);
  });
});

describe('mightNeedWork (synchronous, before any file read)', () => {
  const file = (name: string, type: string, size = 900_000) => ({ name, type, size });
  it('lets compatible files through without any interception', () => {
    expect(mightNeedWork(file('photo.jpg', 'image/jpeg'), parseText('JPG/PNG · max 2MB'))).toBe(
      false,
    );
    expect(mightNeedWork(file('photo.jpg', 'image/jpeg'), rules())).toBe(false);
  });
  it('flags wrong formats, even with no MIME type', () => {
    expect(mightNeedWork(file('IMG_1.HEIC', ''), parseAccept('image/jpeg'))).toBe(true);
    expect(
      mightNeedWork(file('IMG_1.heif', 'application/octet-stream'), parseAccept('image/jpeg')),
    ).toBe(true);
  });
  it('flags files over the limit and fields with dimension rules', () => {
    expect(mightNeedWork(file('big.jpg', 'image/jpeg', 3_000_000), parseText('max 2MB'))).toBe(
      true,
    );
    expect(mightNeedWork(file('a.jpg', 'image/jpeg'), rules({ minWidth: 10 }))).toBe(true);
  });
  it('ignores fields it cannot fill, empty files and formats we cannot handle', () => {
    // A photo becomes a PDF where only a PDF is taken; a video field is not ours.
    expect(mightNeedWork(file('a.heic', 'image/heic'), parseAccept('application/pdf'))).toBe(true);
    expect(mightNeedWork(file('a.heic', 'image/heic'), parseAccept('video/mp4'))).toBe(false);
    expect(mightNeedWork(file('cv.docx', ''), parseAccept('application/pdf'))).toBe(false);
    expect(mightNeedWork(file('a.heic', 'image/heic', 0), parseAccept('image/jpeg'))).toBe(false);
    expect(
      mightNeedWork(file('a.psd', 'image/vnd.adobe.photoshop'), parseAccept('image/jpeg')),
    ).toBe(false);
    expect(mightNeedWork(file('RAW_0001.NEF', ''), parseAccept('image/jpeg'))).toBe(false);
  });
});

describe('format helpers', () => {
  it.each([
    [{ name: 'a.JPG', type: '' }, 'jpeg'],
    [{ name: 'a.jpeg', type: 'image/pjpeg' }, 'jpeg'],
    [{ name: 'photo.backup.HEIC', type: '' }, 'heic'],
    [{ name: 'noext', type: 'image/heif' }, 'heif'],
    [{ name: 'x.webp', type: 'image/webp' }, 'webp'],
    [{ name: 'x.png', type: 'image/x-png' }, 'png'],
    [{ name: 'x.gif', type: 'image/gif' }, 'gif'],
    [{ name: 'x.avif', type: '' }, 'avif'],
    [{ name: 'SCAN.TIF', type: '' }, 'tiff'],
    [{ name: 'x.bmp', type: 'image/x-ms-bmp' }, 'bmp'],
    [{ name: 'favicon.ico', type: 'image/vnd.microsoft.icon' }, 'ico'],
    [{ name: 'logo.svg', type: 'image/svg+xml' }, 'svg'],
    [{ name: 'x.jxl', type: '' }, 'jxl'],
    [{ name: 'design.psd', type: '' }, 'unknown'],
    [{ name: 'RAW_0001.NEF', type: '' }, 'unknown'],
    [{ name: 'noext', type: '' }, 'unknown'],
  ])('guesses %j as %s', (file, format) => expect(guessFormat(file)).toBe(format));

  it('lists the outputs a field accepts, in preference order', () => {
    expect(allowedOutputs(parseAccept('image/png,image/jpeg'))).toEqual(['jpeg', 'png']);
    expect(allowedOutputs(parseAccept('image/*'))).toEqual([
      'jpeg',
      'png',
      'webp',
      'avif',
      'gif',
      'tiff',
      'bmp',
      'ico',
    ]);
    expect(allowedOutputs(parseAccept('.ico,image/tiff'))).toEqual(['tiff', 'ico']);
    expect(formatAllowed('heif', parseAccept('.heic'))).toBe(true);
    expect(formatAllowed('svg', parseAccept('image/svg+xml'))).toBe(true);
    expect(allowedOutputs(parseAccept('application/pdf'))).toEqual([]);
    expect(formatAllowed('unknown', parseAccept('image/*'))).toBe(false);
  });
  it('compares shapes with a one-pixel tolerance only', () => {
    expect(sameRatio(600, 600, 1)).toBe(true);
    expect(sameRatio(601, 600, 1)).toBe(true);
    expect(sameRatio(1000, 990, 1)).toBe(false);
    expect(sameRatio(1366, 768, 16 / 9)).toBe(true);
  });
  it('detects rules that contradict each other', () => {
    expect(conflictingRules(rules({ minWidth: 800, maxWidth: 600 }))).toBe(true);
    expect(conflictingRules(rules({ exactWidth: 500, minWidth: 600 }))).toBe(true);
    expect(conflictingRules(rules({ exactWidth: 600, exactHeight: 400, aspectRatio: 1 }))).toBe(
      true,
    );
    expect(conflictingRules(rules({ minWidth: 600, maxWidth: 1920 }))).toBe(false);
  });
});
