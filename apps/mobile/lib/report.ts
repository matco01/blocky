import { ApiError, api } from './api';

/** How many times to ask, and the longest wait between two asks. */
const ATTEMPTS = 10;
const MAX_DELAY_MS = 10_000;

/**
 * Tell the server about the transaction, retrying while it isn't visible yet
 * and through a dropped connection. Returns whether it was recorded. Never
 * throws: the send already happened.
 *
 * Recording is what counts a send toward the daily limit, settles a request it
 * paid, and tells the person who was paid — so a moment without signal right
 * after sending must not be the end of it. Repeating is safe: a plan records
 * at most once. Only an answer from the server itself is final.
 */
export async function reportWithRetry(planId: string, txHashes: readonly string[]): Promise<boolean> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const result = await api.reportExecution(planId, txHashes);
      if (result.confirmed) return true;
    } catch (error) {
      // Recorded already — by an earlier try whose answer never arrived.
      if (error instanceof ApiError && error.code === 'already_executed') return true;
      // The server looked and said no; asking again won't change that.
      if (!(error instanceof ApiError) || !isTransient(error)) return false;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(1_500 * 2 ** attempt, MAX_DELAY_MS)));
  }
  return false;
}

/** No answer, or one from something in between or a server mid-restart: worth another try. */
function isTransient(error: ApiError): boolean {
  return error.fromInfrastructure || error.status === 0 || error.status >= 500;
}
