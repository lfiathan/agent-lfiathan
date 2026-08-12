import type { Knex } from 'knex';

const TABLE = 'transaction_approvals';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

/** The staged candidate exactly as the importer read it. */
export interface ApprovalPayload {
  amount: number;
  currency: string;
  inferredType: 'income' | 'expense' | 'transfer';
  subject: string;
  from: string | null;
  referenceNumber: string | null;
  merchantVendor: string | null;
  occurredAt: string | null;
  rawEmailContent?: string;
}

export interface TransactionApproval {
  id: string;
  user_id: string;
  source_system: string;
  source_account: string | null;
  source_message_id: string;
  status: ApprovalStatus;
  payload: ApprovalPayload;
  confidence: string | null;
  reason: string | null;
  decided_at: Date | null;
  transaction_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateApprovalDTO {
  user_id: string;
  source_system?: string;
  source_account?: string | null;
  source_message_id: string;
  payload: ApprovalPayload;
  confidence?: number | null;
  reason?: string | null;
}

export interface ListFilters {
  status?: ApprovalStatus;
  limit?: number;
}

export class ApprovalRepository {
  constructor(private readonly knex: Knex) {}

  async findById(id: string): Promise<TransactionApproval | undefined> {
    return this.knex<TransactionApproval>(TABLE).where({ id }).first();
  }

  async findByUserId(userId: string, filters: ListFilters = {}): Promise<TransactionApproval[]> {
    const query = this.knex<TransactionApproval>(TABLE).where({ user_id: userId });
    if (filters.status) query.andWhere({ status: filters.status });
    return query.orderBy('created_at', 'desc').limit(filters.limit ?? 100);
  }

  /**
   * Stage a candidate, ignoring any message already recorded.
   *
   * The conflict target is (source_system, source_message_id), so a decision
   * survives re-imports: an email that was rejected last week is not staged
   * again the next time the window covers it.
   */
  async stageIgnoringDuplicates(data: CreateApprovalDTO): Promise<TransactionApproval | undefined> {
    const [row] = await this.knex<TransactionApproval>(TABLE)
      .insert({
        user_id: data.user_id,
        source_system: data.source_system ?? 'gmail',
        source_account: data.source_account ?? null,
        source_message_id: data.source_message_id,
        payload: data.payload as unknown as Record<string, unknown>,
        confidence: data.confidence ?? null,
        reason: data.reason ?? null,
      } as never)
      .onConflict(['source_system', 'source_message_id'])
      .ignore()
      .returning('*');

    return row;
  }

  async markDecided(
    id: string,
    status: Exclude<ApprovalStatus, 'pending'>,
    transactionId: string | null
  ): Promise<TransactionApproval | undefined> {
    const [row] = await this.knex<TransactionApproval>(TABLE)
      .where({ id })
      .update({
        status,
        transaction_id: transactionId,
        decided_at: this.knex.fn.now(),
        updated_at: this.knex.fn.now(),
      } as never)
      .returning('*');

    return row;
  }

  /** Message ids already decided, so the importer can skip them. */
  async decidedMessageIds(sourceSystem: string): Promise<string[]> {
    const rows = await this.knex<TransactionApproval>(TABLE)
      .where({ source_system: sourceSystem })
      .whereNot({ status: 'pending' })
      .select('source_message_id');

    return rows.map((r) => r.source_message_id);
  }
}
