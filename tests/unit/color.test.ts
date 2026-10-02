import { describe, expect, it } from 'vitest';
import {
  convertToSrgb,
  iccSpace,
  isDisplayP3,
  isSrgb,
  nclxSpace,
  spaceOf,
} from '../../src/images/color';
import { parseHeader } from '../../src/images/headers';
import { heicBytes, iccColour, iccProfile, nclxColour } from './helpers/images';

// Colorants as the standard ICC profiles state them, adapted to D50.
const SRGB = [
  [0.436065, 0.222488, 0.013916],
  [0.385147, 0.716873, 0.097076],
  [0.143066, 0.060608, 0.714096],
] as const;
const DISPLAY_P3 = [
  [0.515121, 0.241196, -0.001053],
  [0.291977, 0.692245, 0.041885],
  [0.157104, 0.066574, 0.784073],
] as const;
const ADOBE_RGB = [
  [0.60974, 0.31111, 0.01947],
  [0.20528, 0.62567, 0.06087],
  [0.14919, 0.06322, 0.74457],
] as const;
/** The sRGB tone curve as an ICC parametric curve (type 3). */
const SRGB_CURVE = { type: 3, para: [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045] };

describe('colour profiles', () => {
  it('recognises sRGB and Display P3 profiles, and nothing else as either', () => {
    const srgb = iccSpace(iccProfile({ colorants: SRGB, curve: SRGB_CURVE }))!;
    const p3 = iccSpace(iccProfile({ colorants: DISPLAY_P3, curve: SRGB_CURVE }))!;
    const adobe = iccSpace(iccProfile({ colorants: ADOBE_RGB, curve: { gamma: 2.2 } }))!;
    expect(isSrgb(srgb)).toBe(true);
    expect(isDisplayP3(srgb)).toBe(false);
    expect(isDisplayP3(p3)).toBe(true);
    expect(isSrgb(p3)).toBe(false);
    expect(isSrgb(adobe) || isDisplayP3(adobe)).toBe(false);
  });

  it('reads HEIF colour code points, and ignores HDR and unknown ones', () => {
    expect(isSrgb(nclxSpace(1, 13)!)).toBe(true);
    expect(isDisplayP3(nclxSpace(12, 13)!)).toBe(true);
    const bt2020 = nclxSpace(9, 1)!;
    expect(isSrgb(bt2020) || isDisplayP3(bt2020)).toBe(false);
    expect(nclxSpace(12, 16)).toBeUndefined(); // PQ: HDR, not a still-photo curve
    expect(nclxSpace(4, 13)).toBeUndefined();
  });

  it('leaves profiles it cannot read alone', () => {
    expect(iccSpace(new Uint8Array(200))).toBeUndefined();
    expect(
      iccSpace(iccProfile({ colorants: SRGB, curve: SRGB_CURVE }).subarray(0, 140)),
    ).toBeUndefined();
    expect(spaceOf(undefined)).toBeUndefined();
  });

  it('converts wide-gamut values to sRGB: greys stay grey, colours gain saturation', () => {
    for (const colorants of [DISPLAY_P3, ADOBE_RGB]) {
      const space = iccSpace(
        iccProfile({
          colorants,
          curve: colorants === ADOBE_RGB ? { gamma: 2.2 } : SRGB_CURVE,
        }),
      )!;
      const pixels = new Uint8ClampedArray([128, 128, 128, 255, 200, 90, 60, 128, 60, 150, 70, 0]);
      convertToSrgb(pixels, space);
      // Grey keeps its value (Adobe RGB's 2.2 curve differs a little from sRGB's).
      expect(Math.abs(pixels[0]! - pixels[1]!)).toBeLessThanOrEqual(1);
      expect(Math.abs(pixels[1]! - pixels[2]!)).toBeLessThanOrEqual(1);
      expect(Math.abs(pixels[0]! - 128)).toBeLessThanOrEqual(colorants === ADOBE_RGB ? 6 : 1);
      // The same colour needs more extreme sRGB values than wide-gamut ones.
      expect(pixels[4]! - pixels[6]!).toBeGreaterThan(200 - 60);
      expect(pixels[9]! - pixels[8]!).toBeGreaterThan(150 - 60);
      // Alpha is untouched.
      expect([pixels[3], pixels[7], pixels[11]]).toEqual([255, 128, 0]);
    }
  });

  it('converts sRGB to itself', () => {
    const space = iccSpace(iccProfile({ colorants: SRGB, curve: SRGB_CURVE }))!;
    const pixels = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 12, 140, 230, 255]);
    const before = [...pixels];
    convertToSrgb(pixels, space);
    pixels.forEach((value, index) =>
      expect(Math.abs(value - before[index]!)).toBeLessThanOrEqual(1),
    );
  });
});

describe('colour information in file headers', () => {
  it('reads HEIF code points and prefers an embedded ICC profile', () => {
    const nclx = parseHeader(heicBytes({ colours: [nclxColour(12, 13)] }));
    expect(nclx.color).toEqual({ kind: 'nclx', primaries: 12, transfer: 13 });

    const profile = iccProfile({ colorants: DISPLAY_P3, curve: SRGB_CURVE });
    for (const colours of [
      [nclxColour(1, 13), iccColour(profile)],
      [iccColour(profile), nclxColour(1, 13)],
    ]) {
      const header = parseHeader(heicBytes({ colours }));
      expect(header.color?.kind).toBe('icc');
      expect(isDisplayP3(spaceOf(header.color)!)).toBe(true);
    }
  });

  it('has no colour information when the file gives none', () => {
    expect(parseHeader(heicBytes()).color).toBeUndefined();
  });
});
