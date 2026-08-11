import { createHash } from 'node:crypto';

export interface FingerprintInput {
  sourceSystem: string;
  account: string;
  messageId: string;
  amount: number | null;
  currency: string | null;
  transactionDate: string | null;
  referenceNumber: string | null;
}

/**
 * The value behind the unique index on transactions.source_fingerprint.
 *
 * Shared by the importer and the approval path deliberately: if the two ever
 * computed it differently, approving a staged candidate would insert a second
 * copy of a transaction the importer had already recorded, and the index could
 * not catch it.
 */
export function makeTransactionFingerprint(input: FingerprintInput): string {
  const payload = [
    input.sourceSystem,
    input.account,
    input.messageId,
    input.amount ?? '',
    input.currency ?? '',
    input.transactionDate ?? '',
    input.referenceNumber ?? '',
  ].join('|');

  return createHash('sha256').update(payload).digest('hex');
}
