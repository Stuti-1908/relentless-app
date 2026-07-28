/**
 * Reusable fetch wrapper with exponential backoff retry logic
 * for external API calls (Airtable, GHL, etc.).
 */

const RETRYABLE_STATUS_MIN = 500;
const RATE_LIMIT_STATUS = 429;
const BASE_DELAY_MS = 1000;

function isRetryableStatus(status: number): boolean {
  return status === RATE_LIMIT_STATUS || status >= RETRYABLE_STATUS_MIN;
}

function getRetryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("Retry-After");

  if (retryAfter) {
    // Retry-After can be seconds (integer) or an HTTP-date
    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds)) {
      return seconds * 1000;
    }
    // Attempt to parse as HTTP-date
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) {
      return Math.max(0, date - Date.now());
    }
  }

  // Exponential backoff: 1s, 2s, 4s, …
  return BASE_DELAY_MS * Math.pow(2, attempt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  let lastError: unknown = null;
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      lastResponse = response;

      // Non-retryable client error (4xx except 429) — return immediately
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== RATE_LIMIT_STATUS
      ) {
        return response;
      }

      // Success — return immediately
      if (response.ok) {
        return response;
      }

      // Retryable status (429 or 5xx)
      if (isRetryableStatus(response.status) && attempt < maxRetries) {
        const delay = getRetryDelay(response, attempt);
        console.warn(
          `[fetchWithRetry] Attempt ${attempt + 1}/${maxRetries + 1} failed with status ${response.status}. ` +
            `Retrying in ${delay}ms… (${url})`,
        );
        await sleep(delay);
        continue;
      }

      // Exhausted retries — return the last failed response
      return response;
    } catch (error) {
      // Network / fetch error — retry if attempts remain
      lastError = error;

      if (attempt < maxRetries) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(
          `[fetchWithRetry] Attempt ${attempt + 1}/${maxRetries + 1} threw a network error. ` +
            `Retrying in ${delay}ms… (${url})`,
          error,
        );
        await sleep(delay);
        continue;
      }
    }
  }

  // If we have a last response, return it; otherwise re-throw the network error
  if (lastResponse) {
    return lastResponse;
  }

  throw lastError;
}
