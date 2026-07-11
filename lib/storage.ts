/**
 * CV file storage access. Phase 1 stores files on local disk under
 * CV_UPLOAD_DIR; production swaps this module for S3 (eu-central-1,
 * SSE-KMS) reads — CVDocument.fileRef is the storage key either way.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type StorageErrorCode = 'FILE_NOT_FOUND' | 'INVALID_FILE_REF';

export class StorageError extends Error {
  constructor(
    public readonly code: StorageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

function uploadRoot(): string {
  return path.resolve(process.cwd(), process.env.CV_UPLOAD_DIR ?? 'uploads/cv');
}

/**
 * Reads a stored CV by its fileRef (e.g. "uploads/cv/<application>-v1.pdf").
 * Rejects any ref that resolves outside the upload root, so a tampered
 * database value can never read arbitrary files.
 */
export async function readStoredFile(fileRef: string): Promise<Buffer> {
  const root = uploadRoot();
  const absolute = path.resolve(process.cwd(), fileRef);

  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new StorageError('INVALID_FILE_REF', 'The CV file reference points outside the upload directory.');
  }

  try {
    return await readFile(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new StorageError(
        'FILE_NOT_FOUND',
        'The CV file is missing from storage. It may predate this environment — re-upload the CV.',
      );
    }
    throw error;
  }
}
