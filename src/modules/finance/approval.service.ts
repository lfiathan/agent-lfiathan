import type { Knex } from 'knex';
import {
  ApprovalRepository,
  type TransactionApproval,
  type ListFilters,
} from './approval.repository.js';
import { makeTransactionFingerprint } from '../../common/transaction-fingerprint.js';
import { AppError, NotFoundError } from '../../common/errors.js';

export interface ApproveOverrides {
  amount?: number;
  currency?: string;
  inferredType?: 'income' | 'expense';
  category?: string;
  occurredAt?: string;
}

export interface ApproveResult {
  approval: TransactionApproval;
  transactionId: string | null;
  duplicate: boolean;
}

export class ApprovalService {
  private readonly repo: ApprovalRepository;

  constructor(private readonly knex: Knex) {
    this.repo = new ApprovalRepository(knex);
  }

  async findByUserId(userId: string, filters: ListFilters = {}): Promise<TransactionApproval[]> {
    return this.repo.findByUserId(userId, filters);
  }

  async reject(id: string): Promise<TransactionApproval> {
    const approval = await this.requirePending(id);
    const updated = await this.repo.markDecided(approval.id, 'rejected', null);
    if (!updated) throw new NotFoundError('Approval');
    return updated;
  }

  /**
   * Turn a staged candidate into a ledger row.
   *
   * Overrides exist because staging is a judgement point: the importer's guess
   * at direction or amount is often what made the email need review in the
   * first place, so the approver can correct it as they accept it.
   *
   * The insert and the status change share one transaction. Without that, a
   * crash between them would leave a candidate marked approved with no row to
   * show for it, and re-approving would be blocked by its own status.
   */
  async approve(id: string, overrides: ApproveOverrides = {}): Promise<ApproveResult> {
    const approval = await this.requirePending(id);
    const payload = approval.payload;

    const amount = overrides.amount ?? payload.amount;
    const currency = (overrides.currency ?? payload.currency ?? 'IDR').toUpperCase();
    const type = overrides.inferredType ?? payload.inferredType;
    const occurredAt = overrides.occurredAt ?? payload.occurredAt ?? new Date().toISOString();

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new AppError('Approved amount must be a positive number', 400, 'INVALID_AMOUNT');
    }

    const account = approval.source_account ?? 'unknown';
    const fingerprint = makeTransactionFingerprint({
      sourceSystem: approval.source_system,
      account,
      messageId: approval.source_message_id,
      amount,
      currency,
      transactionDate: occurredAt,
      referenceNumber: payload.referenceNumber,
    });

    return this.knex.transaction(async (trx) => {
      const existing = await trx('transactions')
        .where({ source_fingerprint: fingerprint })
        .first('id');

      let transactionId: string | null = existing?.id ?? null;

      if (!existing) {
        const [row] = await trx('transactions')
          .insert({
            user_id: approval.user_id,
            type,
            amount,
            currency,
            category: overrides.category ?? 'email-import',
            description: payload.subject?.slice(0, 5000) || null,
            occurred_at: occurredAt,
            metadata: {
              sender: payload.from,
              subject: payload.subject,
              reference_number: payload.referenceNumber,
              merchant_vendor: payload.merchantVendor,
              source_message_id: approval.source_message_id,
              approved_from: approval.id,
            },
            source_system: approval.source_system,
            source_account: account,
            source_message_id: approval.source_message_id,
            source_fingerprint: fingerprint,
          })
          .returning('id');

        transactionId = row.id as string;
      }

      const [updated] = await trx('transaction_approvals')
        .where({ id: approval.id })
        .update({
          status: 'approved',
          transaction_id: transactionId,
          decided_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        })
        .returning('*');

      return {
        approval: updated as TransactionApproval,
        transactionId,
        duplicate: Boolean(existing),
      };
    });
  }

  private async requirePending(id: string): Promise<TransactionApproval> {
    const approval = await this.repo.findById(id);
    if (!approval) throw new NotFoundError('Approval');
    if (approval.status !== 'pending') {
      throw new AppError(
        `Approval already ${approval.status}`,
        409,
        'ALREADY_DECIDED'
      );
    }
    return approval;
  }
}
