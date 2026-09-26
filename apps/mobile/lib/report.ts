import { api } from './api';

/**
 * Tell the server about the transaction, retrying while it isn't visible yet.
 * Returns whether it was recorded. Never throws: the send already happened.
 */
export async function reportWithRetry(planId: string, txHashes: readonly string[]): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const result = await api.reportExecution(planId, txHashes);
      if (result.confirmed) return true;
    } catch {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return false;
}
