import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `__dirname` equivalent for ESM modules — pass `import.meta.url` from the caller. */
export function dirnameFromUrl(metaUrl: string): string {
  return path.dirname(fileURLToPath(metaUrl));
}
