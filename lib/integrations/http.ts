/**
 * Shared HTTP plumbing for third-party integrations: retry with
 * exponential backoff on transient failures (network errors, 429, 5xx)
 * and a typed error carrying the provider name for logging/auditing.
 */

export class IntegrationError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly status?: number,
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'IntegrationError';
  }
}

export interface RetryOptions {
  /** Additional attempts after the first (default 3). */
  retries?: number;
  /** First backoff delay; doubles per attempt (default 500 ms). */
  backoffMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fetch() with retries on transient failures. Non-transient HTTP errors
 * (4xx other than 429) are returned to the caller for handling — they will
 * not succeed on retry.
 */
export async function fetchWithRetry(
  provider: string,
  url: string,
  init: RequestInit,
  options: RetryOptions = {},
): Promise<Response> {
  const retries = options.retries ?? 3;
  const backoffMs = options.backoffMs ?? 500;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) {
      await sleep(backoffMs * 2 ** (attempt - 1));
    }
    try {
      const response = await fetch(url, init);
      if (response.status >= 500 || response.status === 429) {
        lastError = new IntegrationError(provider, `Transient HTTP ${response.status} from ${url}`, response.status);
        continue;
      }
      return response;
    } catch (error) {
      // Network-level failure — retryable.
      lastError = error;
    }
  }

  if (lastError instanceof IntegrationError) throw lastError;
  throw new IntegrationError(provider, `Request to ${url} failed after ${retries + 1} attempts: ${String(lastError)}`);
}
