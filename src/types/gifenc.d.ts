// gifenc ships without type definitions; this covers the parts Just Upload uses.
declare module 'gifenc' {
  export type Palette = number[][];
  export type ColorFormat = 'rgb565' | 'rgb444' | 'rgba4444';
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: ColorFormat; oneBitAlpha?: boolean | number; clearAlpha?: boolean },
  ): Palette;
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: ColorFormat,
  ): Uint8Array;
  export interface Encoder {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: {
        palette?: Palette;
        transparent?: boolean;
        transparentIndex?: number;
        delay?: number;
      },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  }
  export function GIFEncoder(options?: { initialCapacity?: number; auto?: boolean }): Encoder;
}
