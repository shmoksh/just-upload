import { describe, expect, it } from 'vitest';
import {
  chooseOutput,
  consentFor,
  decide,
  defaultCrop,
  requiredScale,
  LOOKS_THE_SAME,
  needsQualityConsent,
  transformOptions,
} from '../../src/decision';
import type { ImageInfo, UploadRequirements } from '../../src/models';
import { parseAccept, parseText } from '../../src/requirements';

const rules = (values: Partial<UploadRequirements> = {}): UploadRequirements => ({
  acceptedMimeTypes: [],
  acceptedExtensions: [],
  confidence: 1,
  sources: [],
  ...values,
});
const image = (values: Partial<ImageInfo> = {}): ImageInfo => ({
  format: 'jpeg',
  width: 1200,
  height: 800,
  bytes: 900_000,
  transparent: false,
  animated: false,
  ...values,
});
const PREFS = { askBeforeQualityChanges: true };

describe('decide', () => {
  it('passes compatible files through untouched (acceptance 3)', () => {
    expect(decide(image(), parseText('JPG/PNG · max 2MB'))).toMatchObject({
      action: 'PASS_THROUGH',
      consents: [],
    });
  });
  it('fixes HEIC for a JPG/PNG field automatically, as JPG (definition of done)', () => {
    const decision = decide(
      image({ format: 'heic', width: 3024, height: 4032, bytes: 5_800_000 }),
      parseText('JPG or PNG · Maximum 2 MB'),
    );
    expect(decision).toEqual({
      action: 'AUTO_FIX',
      issues: ['unsupported-format', 'too-large'],
      outputFormat: 'jpeg',
      consents: [],
    });
  });
  it('turns WebP into an allowed format without asking (acceptance 2)', () => {
    expect(decide(image({ format: 'webp' }), parseAccept('image/jpeg,image/png'))).toMatchObject({
      action: 'AUTO_FIX',
      outputFormat: 'jpeg',
    });
  });
  it('asks before cropping a portrait for a square field (acceptance 4)', () => {
    const decision = decide(
      image({ width: 3024, height: 4032 }),
      parseText('Square profile image, 600 × 600'),
    );
    expect(decision).toMatchObject({ action: 'USER_CONFIRMATION', consents: ['crop'] });
  });
  it('never removes transparency silently', () => {
    const decision = decide(image({ format: 'png', transparent: true }), parseAccept('image/jpeg'));
    expect(decision).toMatchObject({
      action: 'USER_CONFIRMATION',
      outputFormat: 'jpeg',
      consents: ['transparency'],
    });
  });
  it('keeps transparency when the field allows PNG or WebP', () => {
    expect(
      decide(image({ format: 'heic', transparent: true }), parseAccept('image/jpeg,image/png')),
    ).toMatchObject({
      action: 'AUTO_FIX',
      outputFormat: 'png',
    });
    expect(
      decide(image({ format: 'png', transparent: true }), parseAccept('image/jpeg,image/webp'))
        .outputFormat,
    ).toBe('webp');
  });
  it('asks before flattening an animation', () => {
    expect(
      decide(image({ format: 'webp', animated: true }), parseAccept('image/jpeg')).consents,
    ).toEqual(['animation']);
  });
  it('enlarges a little silently, a lot only with approval', () => {
    expect(
      decide(image({ width: 580, height: 580 }), rules({ minWidth: 600, minHeight: 600 })),
    ).toMatchObject({ action: 'AUTO_FIX' });
    expect(
      decide(image({ width: 300, height: 300 }), rules({ minWidth: 600, minHeight: 600 })).consents,
    ).toEqual(['upscale']);
  });
  it('meets dimensions the website states without asking: it asked for them', () => {
    const big = image({ width: 4000, height: 3000 });
    const limit = rules({ maxWidth: 1920, maxHeight: 1920 });
    expect(decide(big, limit)).toMatchObject({ action: 'AUTO_FIX', consents: [] });
  });
  it('orders several consents so the most visible change leads', () => {
    const decision = decide(
      image({ format: 'png', transparent: true, width: 200, height: 400 }),
      rules({ acceptedMimeTypes: ['image/jpeg'], exactWidth: 600, exactHeight: 600 }),
    );
    expect(decision.consents).toEqual(['crop', 'transparency', 'upscale']);
  });
  it('refuses to guess when rules conflict or the image is unknown', () => {
    expect(decide(image(), rules({ minWidth: 2000, maxWidth: 1000 })).action).toBe('UNSAFE_TO_FIX');
    expect(decide(image({ format: 'unknown' }), rules()).action).toBe('UNSAFE_TO_FIX');
    expect(decide(image({ format: 'heic' }), parseAccept('image/vnd.adobe.photoshop')).action).toBe(
      'UNSAFE_TO_FIX',
    );
  });
});

describe('decisions for other formats', () => {
  it('asks before turning a photo into a 256-colour GIF, but not a GIF into a GIF', () => {
    expect(decide(image({ format: 'jpeg' }), parseAccept('image/gif')).consents).toEqual([
      'palette',
    ]);
    expect(
      decide(image({ format: 'gif', bytes: 5_000_000 }), {
        ...parseAccept('image/gif'),
        maxBytes: 1_000_000,
      }),
    ).toMatchObject({
      action: 'AUTO_FIX',
      outputFormat: 'gif',
    });
  });
  it('asks before filling transparency for BMP, which cannot keep it', () => {
    const decision = decide(image({ format: 'png', transparent: true }), parseAccept('.bmp'));
    expect(decision).toMatchObject({ outputFormat: 'bmp', consents: ['transparency'] });
  });
  it('fixes SVG, JPEG XL, TIFF, BMP, ICO and AVIF inputs without asking when nothing visible changes', () => {
    for (const format of ['svg', 'jxl', 'tiff', 'bmp', 'ico', 'avif'] as const) {
      expect(decide(image({ format }), parseAccept('image/jpeg'))).toMatchObject({
        action: 'AUTO_FIX',
        outputFormat: 'jpeg',
      });
    }
  });
});

describe('chooseOutput', () => {
  it('turns a heavy TIFF or BMP into a lossy format rather than shrinking it', () => {
    const rules = { ...parseAccept('image/tiff,image/jpeg,image/bmp'), maxBytes: 2_000_000 };
    expect(chooseOutput(image({ format: 'tiff', bytes: 30_000_000 }), rules)).toBe('jpeg');
    expect(chooseOutput(image({ format: 'bmp', bytes: 30_000_000 }), rules)).toBe('jpeg');
    expect(
      chooseOutput(image({ format: 'tiff', bytes: 30_000_000 }), {
        ...parseAccept('image/tiff'),
        maxBytes: 2_000_000,
      }),
    ).toBe('tiff');
  });
  it('keeps transparency where any allowed format can hold it', () => {
    expect(
      chooseOutput(
        image({ format: 'svg', transparent: true }),
        parseAccept('image/jpeg,image/png'),
      ),
    ).toBe('png');
    expect(
      chooseOutput(
        image({ format: 'svg', transparent: true }),
        parseAccept('image/jpeg,image/gif'),
      ),
    ).toBe('gif');
    expect(chooseOutput(image({ format: 'heic' }), parseAccept('image/avif,image/png'))).toBe(
      'avif',
    );
  });
  it('keeps the original format when the field allows it', () => {
    expect(chooseOutput(image({ format: 'png' }), parseAccept('image/png,image/jpeg'))).toBe('png');
    expect(chooseOutput(image({ format: 'webp' }), parseAccept('image/*'))).toBe('webp');
  });
  it('turns a heavy, opaque PNG into JPG rather than shrinking pixels', () => {
    expect(
      chooseOutput(
        image({ format: 'png', bytes: 9_000_000 }),
        rules({ acceptedMimeTypes: ['image/png', 'image/jpeg'], maxBytes: 2_000_000 }),
      ),
    ).toBe('jpeg');
  });
  it('uses JPG for photographs and PNG for transparency', () => {
    expect(
      chooseOutput(image({ format: 'heic' }), parseAccept('image/png,image/jpeg,image/webp')),
    ).toBe('jpeg');
    expect(
      chooseOutput(
        image({ format: 'heic', transparent: true }),
        parseAccept('image/jpeg,image/png'),
      ),
    ).toBe('png');
  });
});

describe('geometry helpers', () => {
  it('finds the largest centred crop of the required shape', () => {
    expect(defaultCrop(3024, 4032, 1)).toEqual({ x: 0, y: 504, width: 3024, height: 3024 });
    expect(defaultCrop(4000, 3000, 16 / 9)).toEqual({ x: 0, y: 375, width: 4000, height: 2250 });
  });
  it('computes how far an image must scale', () => {
    expect(requiredScale(4032, 3024, rules({ maxWidth: 1920, maxHeight: 1920 }))).toBeCloseTo(
      1920 / 4032,
    );
    expect(requiredScale(300, 300, rules({ minWidth: 600 }))).toBe(2);
    expect(requiredScale(3024, 3024, rules({ exactWidth: 600, exactHeight: 600 }))).toBeCloseTo(
      600 / 3024,
    );
    expect(requiredScale(800, 600, rules())).toBe(1);
  });
});

describe('transformOptions', () => {
  const base = decide(image({ format: 'png', transparent: true }), parseAccept('image/jpeg'));
  it('grants exactly what was approved', () => {
    expect(transformOptions(base)).toMatchObject({
      outputFormat: 'jpeg',
      allowTransparencyLoss: true,
      allowAnimationLoss: false,
    });
  });
  it('passes a chosen crop through', () => {
    const crop = { x: 1, y: 2, width: 3, height: 3 };
    expect(transformOptions(base, crop).crop).toEqual(crop);
  });
});

describe('asking before quality loss', () => {
  const kept = (qualityKept: number, resizedToFit = false, sizeLimited = true) => ({
    qualityKept,
    resizedToFit,
    sizeLimited: sizeLimited || resizedToFit,
  });
  it('asks only when the size limit makes the result look visibly worse', () => {
    expect(needsQualityConsent(kept(100), PREFS)).toBe(false);
    expect(needsQualityConsent(kept(LOOKS_THE_SAME), PREFS)).toBe(false);
    expect(needsQualityConsent(kept(LOOKS_THE_SAME - 1), PREFS)).toBe(true);
  });
  it('does not ask about a conversion the size limit did not squeeze', () => {
    expect(needsQualityConsent(kept(90, false, false), PREFS)).toBe(false);
  });
  it('never asks about quality when the setting is off', () => {
    expect(needsQualityConsent(kept(60), { ...PREFS, askBeforeQualityChanges: false })).toBe(false);
  });
});

describe('asking before fewer pixels', () => {
  const kept = (qualityKept: number, resizedToFit: boolean) => ({
    qualityKept,
    resizedToFit,
    sizeLimited: true,
  });
  it('always asks before a copy with fewer pixels, whatever the quality setting', () => {
    const off = { askBeforeQualityChanges: false };
    expect(consentFor(kept(99, true), PREFS)).toBe('shrink');
    expect(consentFor(kept(99, true), off)).toBe('shrink');
    // One question covers both: the pixels and the quality they keep.
    expect(consentFor(kept(80, true), PREFS)).toBe('shrink');
  });
  it('otherwise asks only about visible quality loss, or nothing', () => {
    expect(consentFor(kept(80, false), PREFS)).toBe('quality');
    expect(consentFor(kept(99, false), PREFS)).toBeUndefined();
  });
});
