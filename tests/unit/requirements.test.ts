import { beforeEach, describe, expect, it } from 'vitest';
import {
  AUTOMATIC_CONFIDENCE,
  detectRequirements,
  parseAccept,
  parseText,
} from '../../src/requirements';

describe('accept attribute', () => {
  it('normalizes case, aliases and duplicates', () => {
    const result = parseAccept(' .JPG, .jpeg, IMAGE/PNG, image/jpg, .JPG, image/avif ');
    expect(result.acceptedExtensions).toEqual(['.jpg', '.jpeg']);
    expect(result.acceptedMimeTypes).toEqual(['image/png', 'image/jpeg', 'image/avif']);
    expect(result.confidence).toBe(1);
    expect(
      result.sources.every((source) => source.source === 'accept' && source.confidence === 1),
    ).toBe(true);
  });
  it('keeps wildcards and non-image types, and ignores invalid tokens like browsers do', () => {
    expect(parseAccept('image/*,.pdf,application/pdf').acceptedMimeTypes).toEqual([
      'image/*',
      'application/pdf',
    ]);
    expect(parseAccept('image/*,.pdf').acceptedExtensions).toEqual(['.pdf']);
    const invalid = parseAccept(' , jpg, png ');
    expect(invalid.acceptedMimeTypes).toEqual([]);
    expect(invalid.acceptedExtensions).toEqual([]);
    expect(invalid.confidence).toBe(0);
  });
});

describe('file size wording', () => {
  it.each([
    ['Maximum 2 MB', 2_000_000],
    ['Max 2MB', 2_000_000],
    ['Up to 2 MB', 2_000_000],
    ['Less than 2MB', 2_000_000],
    ['File must be under 2 MB', 2_000_000],
    ['Maximum file size: 5MB', 5_000_000],
    ['10 MB max', 10_000_000],
    ['max 5mb', 5_000_000],
    ['Under 10 MB', 10_000_000],
    ['Up to 500 KB', 500_000],
    ['(max. 2 MB)', 2_000_000],
    ['Max. file size 4 MB', 4_000_000],
    ['No more than 3 MB', 3_000_000],
    ['must not exceed 8 MB', 8_000_000],
    ['File size limit: 2MB', 2_000_000],
    ['2 MB or less', 2_000_000],
    ['≤ 1 MB', 1_000_000],
    ['< 700KB', 700_000],
    ['Files larger than 2 MB will be rejected', 2_000_000],
    ['Maximum size is 1.5 megabytes', 1_500_000],
    ['Max 1.5 MiB', 1_572_864],
    ['Maximum 256 KiB', 262_144],
    ['Under 1 GB', 1_000_000_000],
    ['Max 1,5 MB', 1_500_000],
    ['Max 1,500 KB', 1_500_000],
    ['Minimum 600x600, max 2MB', 2_000_000],
  ])('reads "%s"', (text, bytes) => {
    const result = parseText(text);
    expect(result.maxBytes).toBe(bytes);
    expect(result.sources.find((source) => source.field === 'maxBytes')?.evidence).toContain(
      text.trim().replace(/[()]/g, '').slice(0, 6),
    );
  });

  it.each([
    'File size 2 MB',
    'Minimum 2MB',
    'At least 2MB',
    'Must be more than 100 KB',
    'Downloaded 2 MB',
    'Recommended max 2 MB',
    'We will compress images to under 2 MB for you',
    'Up to 50 MB total',
  ])('does not treat "%s" as a limit', (text) => {
    expect(parseText(text).maxBytes).toBeUndefined();
  });

  it('keeps the per-file limit when a total is also given', () => {
    expect(parseText('Max 10 MB per file, 50 MB total').maxBytes).toBe(10_000_000);
  });
  it('drops contradictory limits from equally close sources (fail open)', () => {
    const result = parseText('Max 2MB · maximum 5MB');
    expect(result.maxBytes).toBeUndefined();
    expect(result.sources.filter((source) => source.field === 'maxBytes')).toHaveLength(2);
  });
});

describe('dimension wording', () => {
  it.each([
    ['600 x 600', { exactWidth: 600, exactHeight: 600 }],
    ['600×600', { exactWidth: 600, exactHeight: 600 }],
    ['600X600px', { exactWidth: 600, exactHeight: 600 }],
    ['minimum 600x600', { minWidth: 600, minHeight: 600 }],
    ['Min. 600 × 600 pixels', { minWidth: 600, minHeight: 600 }],
    ['600x600 minimum', { minWidth: 600, minHeight: 600 }],
    ['at least 600 pixels wide', { minWidth: 600 }],
    ['at least 400px tall', { minHeight: 400 }],
    ['maximum 2000px', { maxWidth: 2000, maxHeight: 2000 }],
    ['1200 × 800 pixels', { exactWidth: 1200, exactHeight: 800 }],
    ['Maximum 1920x1920', { maxWidth: 1920, maxHeight: 1920 }],
    ['up to 4000 by 3000 pixels', { maxWidth: 4000, maxHeight: 3000 }],
    ['no larger than 2048 x 2048', { maxWidth: 2048, maxHeight: 2048 }],
    ['minimum width: 600px; maximum height: 2000px', { minWidth: 600, maxHeight: 2000 }],
    ['Width at least 800px', { minWidth: 800 }],
    ['at least 1080px on the shortest side', { minWidth: 1080, minHeight: 1080 }],
    ['max 2048px on the longest side', { maxWidth: 2048, maxHeight: 2048 }],
  ])('reads "%s"', (text, expected) => expect(parseText(text)).toMatchObject(expected));

  it('records a lone "1200px wide" as evidence but does not enforce it', () => {
    const result = parseText('1200px wide');
    expect(result.exactWidth).toBeUndefined();
    const evidence = result.sources.find((source) => source.field === 'exactWidth');
    expect(evidence?.value).toBe(1200);
    expect(evidence!.confidence).toBeLessThan(AUTOMATIC_CONFIDENCE);
    expect(parseText('exactly 1200px wide').exactWidth).toBe(1200);
  });
  it('treats recommendations as evidence only', () => {
    const result = parseText('Recommended 1200 x 630');
    expect(result.exactWidth).toBeUndefined();
    expect(result.sources).toHaveLength(2);
    expect(result.sources.every((source) => source.confidence < AUTOMATIC_CONFIDENCE)).toBe(true);
  });
  it('does not read version numbers or prices as dimensions', () => {
    expect(parseText('Version 2.5 released')).toMatchObject({ sources: [] });
    expect(parseText('Costs 5 x 10 dollars').exactWidth).toBeUndefined();
  });
});

describe('aspect ratio wording', () => {
  it.each([
    ['1:1', 1],
    ['4:3', 4 / 3],
    ['3:2', 1.5],
    ['16:9', 16 / 9],
    ['9:16 story image', 9 / 16],
    ['Aspect ratio 16:10', 1.6],
    ['Square profile image', 1],
    ['Square photo, 600 × 600 pixels', 1],
    ['The photo must be square', 1],
  ])('reads "%s"', (text, ratio) => expect(parseText(text).aspectRatio).toBeCloseTo(ratio));

  it.each([
    'Open at 12:30',
    'Photo uploads close at 10:45',
    'Your photo does not need to be square',
    'Squarespace',
  ])('ignores "%s"', (text) => expect(parseText(text).aspectRatio).toBeUndefined());
});

describe('format wording', () => {
  it.each([
    ['JPG/PNG · max 2MB', ['image/jpeg', 'image/png']],
    ['JPG or PNG', ['image/jpeg', 'image/png']],
    ['Accepted formats: .jpg, .jpeg, .png', ['image/jpeg', 'image/png']],
    ['PNG only', ['image/png']],
    ['Please upload a JPEG image.', ['image/jpeg']],
    ['Supported: image/jpeg, image/webp', ['image/jpeg', 'image/webp']],
    [
      'JPEG WEBP HEIC HEIF image/png',
      ['image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'image/png'],
    ],
    ['JPG, PNG (no GIFs)', ['image/jpeg', 'image/png']],
    ['JPG or PNG. HEIC is not supported', ['image/jpeg', 'image/png']],
  ])('reads "%s"', (text, formats) => expect(parseText(text).acceptedMimeTypes).toEqual(formats));

  it.each([
    ['Please upload a PNG file', ['image/png']],
    ['Upload as .webp', ['image/webp']],
    ['Image must be in JPEG format', ['image/jpeg']],
    ['Accepted file types: JPEG, GIF', ['image/jpeg', 'image/gif']],
    ['Only .png files are allowed', ['image/png']],
    ['File format: AVIF', ['image/avif']],
    [
      'Supported formats: JPG, JPEG, PNG, GIF, WEBP',
      ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    ],
    ['Allowed extensions: jpg, jpeg, png', ['image/jpeg', 'image/png']],
    ['Save your scan as a TIFF before uploading', ['image/tiff']],
    ['We only accept BMP images', ['image/bmp']],
    ['Favicon (.ico), 32 × 32 pixels', ['image/x-icon']],
    ['Sticker: WEBP only, 512 × 512 pixels, max 100 KB', ['image/webp']],
    ['Must be a GIF', ['image/gif']],
    ['JPEG or PNG format required', ['image/jpeg', 'image/png']],
    ['Please convert your photo to PNG before uploading', ['image/png']],
    ['Format: .jpg', ['image/jpeg']],
    ['Images should be saved as JPG', ['image/jpeg']],
    ['Logo: PNG format with a transparent background', ['image/png']],
  ])('reads the format a site names in "%s"', (text, formats) =>
    expect(parseText(text).acceptedMimeTypes).toEqual(formats),
  );

  it('does not take a site describing its own processing as a rule', () => {
    expect(parseText('We will convert your image to WebP').acceptedMimeTypes).toEqual([]);
    expect(parseText('Your photo is automatically converted to JPG').acceptedMimeTypes).toEqual([]);
  });
  it('does not take a refusal as a rule', () => {
    expect(parseText("Don't upload HEIC files").acceptedMimeTypes).toEqual([]);
  });

  it('treats a lone mention as a hint, not a rule', () => {
    expect(parseText('WebP images welcome').acceptedMimeTypes).toEqual([]);
    expect(parseText('HEIC not supported').acceptedMimeTypes).toEqual([]);
  });
  it('ignores file names and paths', () => {
    expect(parseText('see example-logo.png for details').acceptedMimeTypes).toEqual([]);
  });
});

describe('finding a field’s rules in the page', () => {
  beforeEach(() => document.body.replaceChildren());
  const field = (markup: string, id = 'upload') => {
    document.body.innerHTML = markup;
    return document.getElementById(id) as HTMLInputElement;
  };

  it('combines the accept attribute with aria-describedby help text', () => {
    const input = field(
      '<label for="upload">Profile picture</label><input id="upload" type="file" accept=".jpg,.png" aria-describedby="help"><p id="help">Maximum file size: 2MB. Square profile image</p>',
    );
    const result = detectRequirements(input);
    expect(result).toMatchObject({
      acceptedExtensions: ['.jpg', '.png'],
      maxBytes: 2_000_000,
      aspectRatio: 1,
    });
    expect(
      result.sources.some(
        (source) => source.source === 'aria-describedby' && source.confidence >= 0.95,
      ),
    ).toBe(true);
  });
  it('reads the label, aria-label and title', () => {
    expect(
      detectRequirements(field('<label>Photo (max 1 MB) <input id="upload" type="file"></label>'))
        .maxBytes,
    ).toBe(1_000_000);
    expect(
      detectRequirements(
        field('<input id="upload" type="file" aria-label="Upload a JPG under 3 MB">'),
      ).maxBytes,
    ).toBe(3_000_000);
    expect(
      detectRequirements(field('<input id="upload" type="file" title="Up to 4 MB">')).maxBytes,
    ).toBe(4_000_000);
  });
  it('reads data attributes that upload libraries commonly use', () => {
    expect(
      detectRequirements(field('<input id="upload" type="file" data-max-file-size="2MB">'))
        .maxBytes,
    ).toBe(2_000_000);
    expect(
      detectRequirements(field('<input id="upload" type="file" data-max-size="2097152">')).maxBytes,
    ).toBe(2_097_152);
    expect(
      detectRequirements(field('<input id="upload" type="file" data-max-size="5">')).maxBytes,
    ).toBeUndefined();
  });
  it('finds help text for a hidden input inside a custom widget', () => {
    const input = field(
      '<div class="uploader"><p>JPG/PNG · maximum 2MB</p><label>Choose a picture<span><input hidden type="file" id="upload"></span></label></div>',
    );
    expect(detectRequirements(input).maxBytes).toBe(2_000_000);
  });
  it('does not count plain wrapper elements as distance', () => {
    const input = field(
      '<div class="card"><small>Max 2 MB</small><div><div><div><div><input type="file" id="upload"></div></div></div></div></div>',
    );
    expect(detectRequirements(input).maxBytes).toBe(2_000_000);
  });
  it('never borrows rules from another upload field', () => {
    const input = field(
      '<form><div><p>JPG only · Maximum 2 MB</p><input type="file" id="upload"></div><div><p>PNG only · Maximum 5 MB</p><input type="file"></div></form>',
    );
    expect(detectRequirements(input)).toMatchObject({
      acceptedMimeTypes: ['image/jpeg'],
      maxBytes: 2_000_000,
    });
  });
  it('lets the closest source win over a distant, broader one', () => {
    const input = field(
      '<div><p>Uploads up to 10 MB</p><div><p>Avatar</p><div><p>Max 2 MB</p><input type="file" id="upload"></div></div></div>',
    );
    expect(detectRequirements(input).maxBytes).toBe(2_000_000);
  });
  it('uses form-level help text only when the form has a single upload', () => {
    const input = field(
      '<form><p>Max 3 MB</p><div><div><input type="file" id="upload"></div><span>Photo</span></div></form>',
    );
    expect(detectRequirements(input).maxBytes).toBe(3_000_000);
  });
  it('lets prose narrow a wildcard accept but never widen a specific one', () => {
    expect(
      detectRequirements(
        field('<div>JPG or PNG only<input id="upload" type="file" accept="image/*"></div>'),
      ).acceptedMimeTypes,
    ).toEqual(['image/jpeg', 'image/png']);
    expect(
      detectRequirements(
        field('<div>JPG/PNG files<input id="upload" type="file" accept="image/png"></div>'),
      ).acceptedMimeTypes,
    ).toEqual(['image/png']);
  });
  it('ignores scripts, headings and unrelated page content', () => {
    const input = field(
      '<h1>Maximum 99MB images</h1><div><input id="upload" type="file"><script>const text = "Max 8MB"</script></div>',
    );
    expect(detectRequirements(input).maxBytes).toBeUndefined();
  });
  it('skips long blocks of page text', () => {
    const essay = 'Lorem ipsum dolor sit amet. '.repeat(80);
    const input = field(`<div><p>${essay} Max 1 MB</p><input id="upload" type="file"></div>`);
    expect(detectRequirements(input).maxBytes).toBeUndefined();
  });
  it('re-reads help text on every selection, following single-page app updates', () => {
    const input = field(
      '<div><input id="upload" type="file" aria-describedby="help"><small id="help">Max 2MB</small></div>',
    );
    expect(detectRequirements(input).maxBytes).toBe(2_000_000);
    document.getElementById('help')!.textContent = 'Max 500KB';
    expect(detectRequirements(input).maxBytes).toBe(500_000);
  });
  it('finds help text around an input inside an open shadow root', () => {
    document.body.innerHTML = '<div><p>Max 1 MB</p><x-uploader></x-uploader></div>';
    const root = document.querySelector('x-uploader')!.attachShadow({ mode: 'open' });
    root.innerHTML = '<input type="file" id="inner">';
    expect(detectRequirements(root.getElementById('inner') as HTMLInputElement).maxBytes).toBe(
      1_000_000,
    );
  });
});
