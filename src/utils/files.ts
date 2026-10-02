import type { SerializedFile } from '../models';
import { LIMITS } from '../security/limits';
import { fail } from './errors';

// Chrome extension messaging is JSON-only, so on the fallback path file bytes travel as
// base64. Recent Chrome converts natively (several times faster); older versions use the
// loops below.

interface NativeBase64 {
  fromBase64?: (data: string) => Uint8Array<ArrayBuffer>;
}
const native = Uint8Array as unknown as NativeBase64;

export function bytesToBase64(bytes: Uint8Array): string {
  const toBase64 = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
  if (typeof toBase64 === 'function') return toBase64.call(bytes);
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  }
  return btoa(chunks.join(''));
}

export function base64ToBytes(data: string): Uint8Array<ArrayBuffer> {
  if (typeof native.fromBase64 === 'function') return native.fromBase64(data);
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const MAX_ENCODED_LENGTH = Math.ceil(LIMITS.maxMessageBytes / 3) * 4;

export function isSerializedFile(value: unknown): value is SerializedFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as Partial<SerializedFile>;
  return (
    typeof file.name === 'string' &&
    file.name.length <= 1024 &&
    typeof file.type === 'string' &&
    file.type.length <= 128 &&
    typeof file.lastModified === 'number' &&
    Number.isFinite(file.lastModified) &&
    typeof file.data === 'string' &&
    file.data.length <= MAX_ENCODED_LENGTH
  );
}

export async function serializeFile(
  blob: Blob,
  name = 'image',
  lastModified = 0,
): Promise<SerializedFile> {
  if (blob.size > LIMITS.maxMessageBytes) fail('too-large-to-process');
  return {
    name: blob instanceof File ? blob.name : name,
    type: blob.type,
    lastModified: blob instanceof File ? blob.lastModified : lastModified,
    data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())),
  };
}

export function deserializeFile(value: unknown): File {
  if (!isSerializedFile(value)) fail('failed');
  return new File([base64ToBytes(value.data)], value.name, {
    type: value.type,
    lastModified: value.lastModified,
  });
}

/** Decimal units, matching how sites write limits and how most file browsers show sizes. */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 999_500) return `${Math.round(bytes / 1_000)} KB`;
  const [value, unit] = bytes < 999_950_000 ? [bytes / 1e6, 'MB'] : [bytes / 1e9, 'GB'];
  // "2 MB" as sites write it, not "2.0 MB".
  return `${Number(value.toFixed(1))} ${unit}`;
}
