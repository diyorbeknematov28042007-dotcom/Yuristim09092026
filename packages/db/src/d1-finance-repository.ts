import {
  InsufficientCreditsError,
  PaymentNotFoundError,
  PaymentStateError,
  type AcceptBalanceRow,
  type AcceptProductRow,
  type AcceptTransactionRow,
  type CreditBalanceRow,
  type CreditHistoryInput,
  type CreditProductRow,
  type CreditTransactionRow,
  type FinanceRepository,
  type PaymentRow,
  type PaymentWebhookResult,
} from './finance-repository.js';

type SqlValue = string | number | null;
interface Statement {
  bind(...values: SqlValue[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface D1FinanceBinding {
  prepare(sql: string): Statement;
}

type CreditDbRow = Omit<CreditTransactionRow, 'amount' | 'balance_after'> & {
  amount_milli: number;
  balance_after_milli: number;
};
type AcceptDbRow = AcceptTransactionRow;
type CreditProductDbRow = Omit<CreditProductRow, 'credit_amount' | 'price' | 'active'> & {
  credit_amount_milli: number | null;
  price_minor: number | null;
  active: number;
};
type AcceptProductDbRow = Omit<AcceptProductRow, 'price' | 'active'> & {
  price_minor: number;
  active: number;
};
type PaymentDbRow = Omit<PaymentRow, 'amount_money' | 'product_units'> & {
  amount_money_minor: number;
  product_units_milli: number;
};

function decimalUnits(value: number, places: 2 | 3): number {
  if (!Number.isFinite(value)) throw new RangeError('Invalid monetary value');
  const match = String(value).match(/^(\d+)(?:\.(\d+))?$/);
  if (!match || (match[2]?.length ?? 0) > places)
    throw new RangeError('Invalid monetary precision');
  const integer = BigInt(match[1]!);
  const fraction = BigInt((match[2] ?? '').padEnd(places, '0'));
  const scaled = integer * 10n ** BigInt(places) + fraction;
  if (scaled <= 0n || scaled > 99999999999999n) throw new RangeError('Monetary value out of range');
  return Number(scaled);
}
const toMilli = (amount: number): number => decimalUnits(amount, 3);
const toMinor = (amount: number): number => decimalUnits(amount, 2);
const fromMilli = (amount: number): number => amount / 1000;
const fromMinor = (amount: number): number => amount / 100;
function required<T>(row: T | null): T {
  if (row === null) throw new Error('D1 row missing');
  return row;
}
function credit(row: CreditDbRow): CreditTransactionRow {
  const { amount_milli, balance_after_milli, ...rest } = row;
  return {
    ...rest,
    amount: fromMilli(amount_milli),
    balance_after: fromMilli(balance_after_milli),
  };
}
function creditProduct(row: CreditProductDbRow): CreditProductRow {
  const { credit_amount_milli, price_minor, active, ...rest } = row;
  return {
    ...rest,
    credit_amount: credit_amount_milli === null ? null : fromMilli(credit_amount_milli),
    price: price_minor === null ? null : fromMinor(price_minor),
    active: active === 1,
  };
}
function acceptProduct(row: AcceptProductDbRow): AcceptProductRow {
  const { price_minor, active, ...rest } = row;
  return { ...rest, price: fromMinor(price_minor), active: active === 1 };
}
function payment(row: PaymentDbRow): PaymentRow {
  const { amount_money_minor, product_units_milli, ...rest } = row;
  return {
    ...rest,
    amount_money: fromMinor(amount_money_minor),
    product_units: fromMilli(product_units_milli),
  };
}

export class D1FinanceRepository implements FinanceRepository {
  constructor(private readonly db: D1FinanceBinding) {}

  async getCreditBalance(userId: string, now: Date): Promise<CreditBalanceRow> {
    const row = required(
      await this.db
        .prepare(
          `SELECT
      coalesce(sum(amount_milli),0) total,
      coalesce(sum(CASE WHEN bucket_type='paid' THEN amount_milli ELSE 0 END),0) paid,
      coalesce(sum(CASE WHEN bucket_type='weekly' THEN amount_milli ELSE 0 END),0) weekly,
      coalesce(sum(CASE WHEN bucket_type='bonus' THEN amount_milli ELSE 0 END),0) bonus,
      min(CASE WHEN expires_at>? THEN expires_at END) next_expiry
      FROM credit_transactions WHERE user_id=? AND (expires_at IS NULL OR expires_at>?)`,
        )
        .bind(now.toISOString(), userId, now.toISOString())
        .first<{
          total: number;
          paid: number;
          weekly: number;
          bonus: number;
          next_expiry: string | null;
        }>(),
    );
    return {
      total: fromMilli(row.total),
      paid: fromMilli(row.paid),
      weekly: fromMilli(row.weekly),
      bonus: fromMilli(row.bonus),
      next_expiry: row.next_expiry,
    };
  }

  async listCreditTransactions(
    input: CreditHistoryInput,
  ): Promise<{ items: CreditTransactionRow[]; total: number }> {
    const filters = ['user_id=?'];
    const params: SqlValue[] = [input.userId];
    if (input.type) {
      filters.push('type=?');
      params.push(input.type);
    }
    if (input.from) {
      filters.push('created_at>=?');
      params.push(input.from.toISOString());
    }
    if (input.to) {
      filters.push('created_at<=?');
      params.push(input.to.toISOString());
    }
    const where = filters.join(' AND ');
    const total = required(
      await this.db
        .prepare(`SELECT count(*) total FROM credit_transactions WHERE ${where}`)
        .bind(...params)
        .first<{ total: number }>(),
    ).total;
    const rows = (
      await this.db
        .prepare(
          `SELECT * FROM credit_transactions WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
        )
        .bind(...params, input.limit, (input.page - 1) * input.limit)
        .all<CreditDbRow>()
    ).results;
    return { items: rows.map(credit), total };
  }

  async listCreditProducts(): Promise<CreditProductRow[]> {
    const rows = (
      await this.db
        .prepare(
          'SELECT * FROM credit_products WHERE active=1 AND price_minor IS NOT NULL AND credit_amount_milli IS NOT NULL ORDER BY credit_amount_milli',
        )
        .all<CreditProductDbRow>()
    ).results;
    return rows.map(creditProduct);
  }
  async findCreditProductById(id: string): Promise<CreditProductRow | null> {
    const row = await this.db
      .prepare('SELECT * FROM credit_products WHERE id=?')
      .bind(id)
      .first<CreditProductDbRow>();
    return row && creditProduct(row);
  }
  async grantWelcome(userId: string, now: Date): Promise<CreditTransactionRow> {
    return this.grantCredit({
      userId,
      type: 'welcome_bonus',
      bucketType: 'bonus',
      amount: 50,
      source: 'onboarding',
      referenceId: 'welcome:v1',
      expiresAt: null,
      reason: 'Welcome credit',
      now,
    });
  }

  private async insertCredit(
    input: Parameters<FinanceRepository['grantCredit']>[0],
    createdBy: string | null,
  ): Promise<CreditTransactionRow> {
    const now = input.now.toISOString();
    const expires = input.expiresAt?.toISOString() ?? null;
    const row = await this.db
      .prepare(
        `INSERT INTO credit_transactions
      (id,user_id,type,bucket_type,amount_milli,balance_after_milli,source,reference_id,expires_at,reason,created_by,created_at)
      SELECT ?,?,?,?, ?,coalesce((SELECT sum(amount_milli) FROM credit_transactions
        WHERE user_id=? AND (expires_at IS NULL OR expires_at>?)),0)+?, ?,?,?,?,?,?
      WHERE NOT EXISTS(SELECT 1 FROM credit_transactions WHERE user_id=? AND type=? AND source=?
        AND reference_id=? AND bucket_type=? AND expires_at IS ?)
      RETURNING *`,
      )
      .bind(
        crypto.randomUUID(),
        input.userId,
        input.type,
        input.bucketType,
        toMilli(input.amount),
        input.userId,
        now,
        toMilli(input.amount),
        input.source,
        input.referenceId,
        expires,
        input.reason,
        createdBy,
        now,
        input.userId,
        input.type,
        input.source,
        input.referenceId,
        input.bucketType,
        expires,
      )
      .first<CreditDbRow>();
    if (row) return credit(row);
    return credit(
      required(
        await this.db
          .prepare(
            `SELECT * FROM credit_transactions WHERE user_id=? AND type=?
      AND source=? AND reference_id=? AND bucket_type=? AND expires_at IS ? LIMIT 1`,
          )
          .bind(
            input.userId,
            input.type,
            input.source,
            input.referenceId,
            input.bucketType,
            expires,
          )
          .first<CreditDbRow>(),
      ),
    );
  }
  grantCredit(
    input: Parameters<FinanceRepository['grantCredit']>[0],
  ): Promise<CreditTransactionRow> {
    if (
      ![
        'purchase',
        'welcome_bonus',
        'weekly_bonus',
        'student_bonus',
        'admin_bonus',
        'refund',
        'adjustment',
        'reversal',
      ].includes(input.type) ||
      (input.bucketType === 'paid' && input.expiresAt !== null) ||
      (input.bucketType === 'weekly' && input.expiresAt === null) ||
      (input.expiresAt !== null && input.expiresAt <= input.now)
    )
      throw new RangeError('Invalid credit grant');
    return this.insertCredit(input, null);
  }
  grantBonus(input: Parameters<FinanceRepository['grantBonus']>[0]): Promise<CreditTransactionRow> {
    if (input.reason.trim().length < 3) throw new RangeError('Admin bonus reason required');
    return this.insertCredit(
      {
        ...input,
        type: 'admin_bonus',
        bucketType: 'bonus',
        source: 'admin',
        expiresAt: null,
        reason: input.reason.trim(),
      },
      input.adminId,
    );
  }

  async debitCredits(
    input: Parameters<FinanceRepository['debitCredits']>[0],
  ): Promise<CreditTransactionRow[]> {
    const now = input.now.toISOString();
    const amount = toMilli(input.amount);
    if (!['ai_usage', 'document_usage', 'adjustment', 'reversal'].includes(input.type))
      throw new RangeError('Invalid credit debit');
    const prior = await this.db
      .prepare(
        `SELECT * FROM credit_transactions WHERE user_id=? AND type=?
      AND source=? AND reference_id=? AND amount_milli<0 ORDER BY created_at,id`,
      )
      .bind(input.userId, input.type, input.source, input.referenceId)
      .all<CreditDbRow>();
    if (prior.results.length) return prior.results.map(credit);
    // A single INSERT...SELECT holds D1's writer transaction for all allocated buckets.
    // The database trigger checks each running total and the partial unique index protects replay.
    const rows = (
      await this.db
        .prepare(
          `WITH
      groups AS (SELECT bucket_type,expires_at,sum(amount_milli) available,
        CASE WHEN bucket_type='weekly' THEN 1 WHEN bucket_type='bonus' AND expires_at IS NOT NULL THEN 2
          WHEN bucket_type='bonus' THEN 3 ELSE 4 END priority
        FROM credit_transactions WHERE user_id=? AND (expires_at IS NULL OR expires_at>?)
        GROUP BY bucket_type,expires_at HAVING sum(amount_milli)>0),
      ordered AS (SELECT bucket_type,expires_at,available,
        coalesce(sum(available) OVER (ORDER BY priority,expires_at,bucket_type
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) before_amount
        FROM groups),
      total AS (SELECT coalesce(sum(amount_milli),0) balance FROM credit_transactions
        WHERE user_id=? AND (expires_at IS NULL OR expires_at>?))
      INSERT INTO credit_transactions(id,user_id,type,bucket_type,amount_milli,balance_after_milli,
        source,reference_id,expires_at,reason,created_at)
      SELECT lower(hex(randomblob(16))),?,?,ordered.bucket_type,
        -min(ordered.available,?-ordered.before_amount),
        total.balance-min(?,ordered.before_amount+ordered.available),
        ?,?,ordered.expires_at,?,?
      FROM ordered CROSS JOIN total WHERE ordered.before_amount<? AND total.balance>=?
        AND NOT EXISTS(SELECT 1 FROM credit_transactions WHERE user_id=? AND type=?
          AND source=? AND reference_id=? AND amount_milli<0)
      ORDER BY ordered.before_amount RETURNING *`,
        )
        .bind(
          input.userId,
          now,
          input.userId,
          now,
          input.userId,
          input.type,
          amount,
          amount,
          input.source,
          input.referenceId,
          input.reason,
          now,
          amount,
          amount,
          input.userId,
          input.type,
          input.source,
          input.referenceId,
        )
        .all<CreditDbRow>()
    ).results;
    if (rows.length) return rows.map(credit);
    const raced = (
      await this.db
        .prepare(
          `SELECT * FROM credit_transactions WHERE user_id=? AND type=?
      AND source=? AND reference_id=? AND amount_milli<0 ORDER BY created_at,id`,
        )
        .bind(input.userId, input.type, input.source, input.referenceId)
        .all<CreditDbRow>()
    ).results;
    if (raced.length) return raced.map(credit);
    throw new InsufficientCreditsError();
  }

  async grantWeekly(now: Date): Promise<number> {
    const local = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    const day = (local.getUTCDay() + 6) % 7;
    const monday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - day);
    const start = new Date(monday - 5 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    const thursday = new Date(monday + 3 * 24 * 60 * 60 * 1000);
    const year = thursday.getUTCFullYear();
    const jan4 = Date.UTC(year, 0, 4);
    const firstMonday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * 24 * 60 * 60 * 1000;
    const week = Math.floor((monday - firstMonday) / (7 * 24 * 60 * 60 * 1000)) + 1;
    const reference = `${year}-W${String(week).padStart(2, '0')}`;
    const current = now.toISOString();
    const result = await this.db
      .prepare(
        `INSERT INTO credit_transactions(id,user_id,type,bucket_type,
      amount_milli,balance_after_milli,source,reference_id,expires_at,reason,created_at)
      SELECT lower(hex(randomblob(16))),u.id,'weekly_bonus','weekly',12000,
        coalesce((SELECT sum(amount_milli) FROM credit_transactions WHERE user_id=u.id
          AND (expires_at IS NULL OR expires_at>?)),0)+12000,
        'weekly_cron',?,?,'Weekly credit',?
      FROM users u WHERE u.status='active' AND NOT EXISTS(SELECT 1 FROM credit_transactions
        WHERE user_id=u.id AND type='weekly_bonus' AND source='weekly_cron' AND reference_id=?
          AND bucket_type='weekly' AND expires_at=?)`,
      )
      .bind(current, reference, end.toISOString(), current, reference, end.toISOString())
      .run();
    return result.meta.changes;
  }

  async getApprovedLawyerId(userId: string): Promise<string | null> {
    const row = await this.db
      .prepare("SELECT id FROM lawyer_profiles WHERE user_id=? AND verification_status='approved'")
      .bind(userId)
      .first<{ id: string }>();
    return row?.id ?? null;
  }
  async getAcceptBalance(lawyerId: string, now: Date): Promise<AcceptBalanceRow> {
    return required(
      await this.db
        .prepare(
          `SELECT coalesce(sum(amount),0) balance,
      min(CASE WHEN expires_at>? THEN expires_at END) next_expiry FROM marketplace_accept_transactions
      WHERE lawyer_id=? AND (expires_at IS NULL OR expires_at>?)`,
        )
        .bind(now.toISOString(), lawyerId, now.toISOString())
        .first<AcceptBalanceRow>(),
    );
  }
  async listAcceptProducts(): Promise<AcceptProductRow[]> {
    return (
      await this.db
        .prepare('SELECT * FROM marketplace_accept_products WHERE active=1 ORDER BY accept_count')
        .all<AcceptProductDbRow>()
    ).results.map(acceptProduct);
  }
  async findAcceptProductById(id: string): Promise<AcceptProductRow | null> {
    const row = await this.db
      .prepare('SELECT * FROM marketplace_accept_products WHERE id=?')
      .bind(id)
      .first<AcceptProductDbRow>();
    return row && acceptProduct(row);
  }
  async grantAccepts(
    input: Parameters<FinanceRepository['grantAccepts']>[0],
  ): Promise<AcceptTransactionRow> {
    if (
      !['purchase', 'bonus', 'refund', 'adjustment', 'reversal'].includes(input.type) ||
      !Number.isSafeInteger(input.amount) ||
      input.amount <= 0 ||
      (input.expiresAt !== null && input.expiresAt <= input.now)
    )
      throw new RangeError('Invalid accept grant');
    const expires = input.expiresAt?.toISOString() ?? null;
    const now = input.now.toISOString();
    const row = await this.db
      .prepare(
        `INSERT INTO marketplace_accept_transactions
      (id,lawyer_id,type,amount,balance_after,expires_at,reference_id,created_at)
      SELECT ?,?,?,?,coalesce((SELECT sum(amount) FROM marketplace_accept_transactions WHERE lawyer_id=?
        AND (expires_at IS NULL OR expires_at>?)),0)+?, ?,?,?
      WHERE NOT EXISTS(SELECT 1 FROM marketplace_accept_transactions WHERE lawyer_id=? AND type=?
        AND reference_id=? AND expires_at IS ?) RETURNING *`,
      )
      .bind(
        crypto.randomUUID(),
        input.lawyerId,
        input.type,
        input.amount,
        input.lawyerId,
        now,
        input.amount,
        expires,
        input.referenceId,
        now,
        input.lawyerId,
        input.type,
        input.referenceId,
        expires,
      )
      .first<AcceptDbRow>();
    if (row) return row;
    return required(
      await this.db
        .prepare(
          `SELECT * FROM marketplace_accept_transactions WHERE lawyer_id=?
      AND type=? AND reference_id=? AND expires_at IS ? LIMIT 1`,
        )
        .bind(input.lawyerId, input.type, input.referenceId, expires)
        .first<AcceptDbRow>(),
    );
  }
  async debitAccept(
    input: Parameters<FinanceRepository['debitAccept']>[0],
  ): Promise<AcceptTransactionRow> {
    const prior = await this.db
      .prepare(
        `SELECT * FROM marketplace_accept_transactions WHERE lawyer_id=?
      AND type='usage' AND reference_id=? LIMIT 1`,
      )
      .bind(input.lawyerId, input.referenceId)
      .first<AcceptDbRow>();
    if (prior) return prior;
    const now = input.now.toISOString();
    const row = await this.db
      .prepare(
        `INSERT INTO marketplace_accept_transactions
      (id,lawyer_id,type,amount,balance_after,expires_at,reference_id,created_at)
      SELECT ?,?,'usage',-1,coalesce((SELECT sum(amount) FROM marketplace_accept_transactions
        WHERE lawyer_id=? AND (expires_at IS NULL OR expires_at>?)),0)-1,
        g.expires_at,?,? FROM (SELECT expires_at FROM marketplace_accept_transactions
        WHERE lawyer_id=? AND (expires_at IS NULL OR expires_at>?)
        GROUP BY expires_at HAVING sum(amount)>0 ORDER BY expires_at IS NULL,expires_at LIMIT 1) g
      WHERE NOT EXISTS(SELECT 1 FROM marketplace_accept_transactions WHERE lawyer_id=?
        AND type='usage' AND reference_id=?) RETURNING *`,
      )
      .bind(
        crypto.randomUUID(),
        input.lawyerId,
        input.lawyerId,
        now,
        input.referenceId,
        now,
        input.lawyerId,
        now,
        input.lawyerId,
        input.referenceId,
      )
      .first<AcceptDbRow>();
    if (row) return row;
    const raced = await this.db
      .prepare(
        `SELECT * FROM marketplace_accept_transactions WHERE lawyer_id=?
      AND type='usage' AND reference_id=? LIMIT 1`,
      )
      .bind(input.lawyerId, input.referenceId)
      .first<AcceptDbRow>();
    if (raced) return raced;
    throw new InsufficientCreditsError();
  }

  async createPayment(
    input: Parameters<FinanceRepository['createPayment']>[0],
  ): Promise<PaymentRow> {
    const row = required(
      await this.db
        .prepare(
          `INSERT INTO payments
      (id,user_id,provider,provider_payment_id,type,amount_money_minor,currency,status,
        product_id,product_code,product_units_milli,idempotency_key,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
        )
        .bind(
          input.id ?? crypto.randomUUID(),
          input.user_id,
          input.provider,
          input.provider_payment_id ?? null,
          input.type,
          toMinor(input.amount_money),
          input.currency ?? 'UZS',
          input.status ?? 'created',
          input.product_id,
          input.product_code,
          toMilli(input.product_units),
          input.idempotency_key,
          input.created_at ?? new Date().toISOString(),
        )
        .first<PaymentDbRow>(),
    );
    return payment(row);
  }
  async findPaymentById(id: string): Promise<PaymentRow | null> {
    const row = await this.db
      .prepare('SELECT * FROM payments WHERE id=?')
      .bind(id)
      .first<PaymentDbRow>();
    return row && payment(row);
  }
  async findPaymentByIdempotencyKey(key: string): Promise<PaymentRow | null> {
    const row = await this.db
      .prepare('SELECT * FROM payments WHERE idempotency_key=?')
      .bind(key)
      .first<PaymentDbRow>();
    return row && payment(row);
  }
  async processPaymentWebhook(
    input: Parameters<FinanceRepository['processPaymentWebhook']>[0],
  ): Promise<PaymentWebhookResult> {
    const existing = await this.findPaymentById(input.paymentId);
    if (!existing) throw new PaymentNotFoundError();
    if (existing.provider !== input.provider) throw new PaymentStateError();
    if (
      existing.status === input.status &&
      existing.provider_payment_id === input.providerPaymentId
    )
      return { paymentId: existing.id, status: existing.status, processed: false };
    if (!['created', 'pending'].includes(existing.status)) throw new PaymentStateError();
    try {
      const row = await this.db
        .prepare(
          `UPDATE payments SET status=?,provider_payment_id=coalesce(provider_payment_id,?),
        paid_at=CASE WHEN ?='paid' THEN ? ELSE NULL END,
        failed_at=CASE WHEN ? IN ('failed','cancelled') THEN ? ELSE NULL END
        WHERE id=? AND provider=? AND status IN ('created','pending')
          AND (provider_payment_id IS NULL OR provider_payment_id=?) RETURNING *`,
        )
        .bind(
          input.status,
          input.providerPaymentId,
          input.status,
          input.now.toISOString(),
          input.status,
          input.now.toISOString(),
          input.paymentId,
          input.provider,
          input.providerPaymentId,
        )
        .first<PaymentDbRow>();
      if (row) return { paymentId: row.id, status: row.status, processed: true };
    } catch (error) {
      if (
        error instanceof Error &&
        /payment|ledger|balance|product|lawyer|UNIQUE/i.test(error.message)
      )
        throw new PaymentStateError();
      throw error;
    }
    const raced = await this.findPaymentById(input.paymentId);
    if (!raced) throw new PaymentNotFoundError();
    if (
      raced.status === input.status &&
      raced.provider === input.provider &&
      raced.provider_payment_id === input.providerPaymentId
    )
      return { paymentId: raced.id, status: raced.status, processed: false };
    throw new PaymentStateError();
  }
}
