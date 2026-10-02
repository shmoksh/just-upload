import type { UploadRequirements } from '../models';
import { addEvidence, emptyRequirements } from './evidence';
import { normalizeMime } from '../formats';

/**
 * Parses an HTML `accept` attribute. Tokens are alternatives. Invalid tokens are
 * ignored, exactly as browsers ignore them.
 */
export function parseAccept(value: string): UploadRequirements {
  const result = emptyRequirements();
  const extensions = new Set<string>();
  const mimeTypes = new Set<string>();
  for (const raw of value.split(',')) {
    const token = raw.trim().toLowerCase();
    if (/^\.[a-z0-9][a-z0-9.+_-]*$/.test(token)) extensions.add(token);
    else if (/^[a-z0-9.+-]+\/(?:[a-z0-9.+-]+|\*)$/.test(token)) mimeTypes.add(normalizeMime(token));
  }
  result.acceptedExtensions = [...extensions];
  result.acceptedMimeTypes = [...mimeTypes];
  if (mimeTypes.size)
    addEvidence(result.sources, 'acceptedMimeTypes', result.acceptedMimeTypes, 'accept', 1, value);
  if (extensions.size)
    addEvidence(
      result.sources,
      'acceptedExtensions',
      result.acceptedExtensions,
      'accept',
      1,
      value,
    );
  if (mimeTypes.size || extensions.size) result.confidence = 1;
  return result;
}

/** True when the list names specific types rather than only wildcards such as image/*. */
export function isSpecificFormatList(
  requirements: Pick<UploadRequirements, 'acceptedMimeTypes' | 'acceptedExtensions'>,
): boolean {
  return (
    requirements.acceptedExtensions.length > 0 ||
    requirements.acceptedMimeTypes.some((mime) => !mime.endsWith('/*'))
  );
}
