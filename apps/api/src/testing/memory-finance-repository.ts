import { randomUUID } from 'node:crypto';
import {
  InsufficientCreditsError,
  PaymentNotFoundError,
  PaymentStateError,
  type AcceptProductRow,
  type AcceptTransactionRow,
  type CreditBalanceRow,
  type CreditHistoryInput,
  type CreditProductRow,
  type CreditTransactionRow,
  type FinanceRepository,
  type PaymentRow,
  type PaymentWebhookResult,
} from '@yuristim/db';

function active(expiresAt: string | null, now: Date): boolean {
  return expiresAt === null || new Date(expiresAt).getTime() > now.getTime();
}

function week(now: Date): { end: Date; reference: string } {
  const local = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const day = local.getUTCDay() || 7;
  const monday = new Date(local);
  monday.setUTCDate(local.getUTCDate() - day + 1);
  monday.setUTCHours(0, 0, 0, 0);
  const end = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000 - 5 * 60 * 60 * 1000);
  const year = monday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstDay = firstThursday.getUTCDay() || 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 1);
  const weekNumber = Math.floor((monday.getTime() - firstThursday.getTime()) / 604_800_000) + 1;
  return { end, reference: `${year}-W${String(weekNumber).padStart(2, '0')}` };
}

export class MemoryFinanceRepository implements FinanceRepository {
  readonly transactions: CreditTransactionRow[] = [];
  readonly acceptTransactions: AcceptTransactionRow[] = [];
  readonly payments = new Map<string, PaymentRow>();
  readonly creditProducts = new Map<string, CreditProductRow>();
  readonly acceptProducts = new Map<string, AcceptProductRow>();
  readonly approvedLawyers = new Map<string, string>();
  readonly auditLogs: Array<{ action: string; entityId: string }> = [];
  readonly userIds = new Set<string>();

  async getCreditBalance(userId: string, now: Date): Promise<CreditBalanceRow> {
    const rows = this.transactions.filter(
      (row) => row.user_id === userId && active(row.expires_at, now),
    );
    const sum = (bucket?: string) =>
      rows
        .filter((row) => !bucket || row.bucket_type === bucket)
        .reduce((total, row) => total + row.amount, 0);
    const expiries = rows
      .map((row) => row.expires_at)
      .filter((value): value is string => value !== null)
      .sort();
    return {
      bonus: sum('bonus'),
      next_expiry: expiries[0] ?? null,
      paid: sum('paid'),
      total: sum(),
      weekly: sum('weekly'),
    };
  }

  async listCreditTransactions(input: CreditHistoryInput) {
    let rows = this.transactions.filter((row) => row.user_id === input.userId);
    if (input.type) rows = rows.filter((row) => row.type === input.type);
    if (input.from)
      rows = rows.filter((row) => new Date(row.created_at).getTime() >= input.from!.getTime());
    if (input.to)
      rows = rows.filter((row) => new Date(row.created_at).getTime() <= input.to!.getTime());
    rows = rows.toSorted((left, right) => right.created_at.localeCompare(left.created_at));
    const start = (input.page - 1) * input.limit;
    return { items: rows.slice(start, start + input.limit), total: rows.length };
  }

  listCreditProducts(): Promise<CreditProductRow[]> {
    return Promise.resolve(
      [...this.creditProducts.values()].filter(
        (row) => row.active && row.credit_amount !== null && row.price !== null,
      ),
    );
  }
  findCreditProductById(id: string): Promise<CreditProductRow | null> {
    return Promise.resolve(this.creditProducts.get(id) ?? null);
  }

  grantWelcome(userId: string, now: Date): Promise<CreditTransactionRow> {
    this.userIds.add(userId);
    return this.grantCredit({
      amount: 50,
      bucketType: 'bonus',
      expiresAt: null,
      now,
      reason: 'Welcome credit',
      referenceId: 'welcome:v1',
      source: 'onboarding',
      type: 'welcome_bonus',
      userId,
    });
  }

  async grantWeekly(now: Date): Promise<number> {
    const period = week(now);
    let granted = 0;
    for (const userId of this.userIds) {
      const before = this.transactions.length;
      await this.grantCredit({
        amount: 12,
        bucketType: 'weekly',
        expiresAt: period.end,
        now,
        reason: 'Weekly credit',
        referenceId: period.reference,
        source: 'weekly_cron',
        type: 'weekly_bonus',
        userId,
      });
      if (this.transactions.length > before) granted += 1;
    }
    return granted;
  }

  async grantBonus(input: Parameters<FinanceRepository['grantBonus']>[0]) {
    const row = await this.grantCredit({
      amount: input.amount,
      bucketType: 'bonus',
      expiresAt: null,
      now: input.now,
      reason: input.reason,
      referenceId: input.referenceId,
      source: 'admin',
      type: 'admin_bonus',
      userId: input.userId,
    });
    if (!this.auditLogs.some((log) => log.entityId === row.id))
      this.auditLogs.push({ action: 'credits.admin_bonus', entityId: row.id });
    return row;
  }

  async grantCredit(input: Parameters<FinanceRepository['grantCredit']>[0]) {
    this.userIds.add(input.userId);
    const expiry = input.expiresAt?.toISOString() ?? null;
    const existing = this.transactions.find(
      (row) =>
        row.user_id === input.userId &&
        row.type === input.type &&
        row.source === input.source &&
        row.reference_id === input.referenceId &&
        row.bucket_type === input.bucketType &&
        row.expires_at === expiry,
    );
    if (existing) return existing;
    const balance = await this.getCreditBalance(input.userId, input.now);
    const row: CreditTransactionRow = {
      amount: input.amount,
      balance_after: balance.total + input.amount,
      bucket_type: input.bucketType,
      created_at: input.now.toISOString(),
      created_by: null,
      expires_at: expiry,
      id: randomUUID(),
      reason: input.reason,
      reference_id: input.referenceId,
      source: input.source,
      type: input.type,
      user_id: input.userId,
    };
    this.transactions.push(row);
    return row;
  }

  async debitCredits(input: Parameters<FinanceRepository['debitCredits']>[0]) {
    const existing = this.transactions.filter(
      (row) =>
        row.user_id === input.userId &&
        row.type === input.type &&
        row.source === input.source &&
        row.reference_id === input.referenceId &&
        row.amount < 0,
    );
    if (existing.length > 0) return existing;
    const balance = await this.getCreditBalance(input.userId, input.now);
    if (balance.total < input.amount) {
      throw new InsufficientCreditsError();
    }
    const groups = new Map<string, { bucket: string; expiry: string | null; amount: number }>();
    for (const row of this.transactions) {
      if (row.user_id !== input.userId || !active(row.expires_at, input.now)) continue;
      const key = `${row.bucket_type}:${row.expires_at ?? ''}`;
      const group = groups.get(key) ?? {
        amount: 0,
        bucket: row.bucket_type,
        expiry: row.expires_at,
      };
      group.amount += row.amount;
      groups.set(key, group);
    }
    const priority = (group: { bucket: string; expiry: string | null }) =>
      group.bucket === 'weekly'
        ? 1
        : group.bucket === 'bonus' && group.expiry
          ? 2
          : group.bucket === 'bonus'
            ? 3
            : 4;
    const ordered = [...groups.values()]
      .filter((group) => group.amount > 0)
      .toSorted(
        (left, right) =>
          priority(left) - priority(right) ||
          String(left.expiry ?? 'z').localeCompare(String(right.expiry ?? 'z')),
      );
    let remaining = input.amount;
    let running = balance.total;
    const rows: CreditTransactionRow[] = [];
    for (const group of ordered) {
      if (remaining === 0) break;
      const take = Math.min(remaining, group.amount);
      running -= take;
      const row: CreditTransactionRow = {
        amount: -take,
        balance_after: running,
        bucket_type: group.bucket,
        created_at: input.now.toISOString(),
        created_by: null,
        expires_at: group.expiry,
        id: randomUUID(),
        reason: input.reason,
        reference_id: input.referenceId,
        source: input.source,
        type: input.type,
        user_id: input.userId,
      };
      this.transactions.push(row);
      rows.push(row);
      remaining -= take;
    }
    return rows;
  }

  getApprovedLawyerId(userId: string): Promise<string | null> {
    return Promise.resolve(this.approvedLawyers.get(userId) ?? null);
  }
  async getAcceptBalance(lawyerId: string, now: Date) {
    const rows = this.acceptTransactions.filter(
      (row) => row.lawyer_id === lawyerId && active(row.expires_at, now),
    );
    const expiries = rows
      .map((row) => row.expires_at)
      .filter((value): value is string => value !== null)
      .sort();
    return {
      balance: rows.reduce((total, row) => total + row.amount, 0),
      next_expiry: expiries[0] ?? null,
    };
  }
  listAcceptProducts(): Promise<AcceptProductRow[]> {
    return Promise.resolve([...this.acceptProducts.values()].filter((row) => row.active));
  }
  findAcceptProductById(id: string): Promise<AcceptProductRow | null> {
    return Promise.resolve(this.acceptProducts.get(id) ?? null);
  }
  async grantAccepts(input: Parameters<FinanceRepository['grantAccepts']>[0]) {
    const expiry = input.expiresAt?.toISOString() ?? null;
    const existing = this.acceptTransactions.find(
      (row) =>
        row.lawyer_id === input.lawyerId &&
        row.type === input.type &&
        row.reference_id === input.referenceId &&
        row.expires_at === expiry,
    );
    if (existing) return existing;
    const balance = await this.getAcceptBalance(input.lawyerId, input.now);
    const row: AcceptTransactionRow = {
      amount: input.amount,
      balance_after: balance.balance + input.amount,
      created_at: input.now.toISOString(),
      expires_at: expiry,
      id: randomUUID(),
      lawyer_id: input.lawyerId,
      reference_id: input.referenceId,
      type: input.type,
    };
    this.acceptTransactions.push(row);
    return row;
  }
  async debitAccept(input: Parameters<FinanceRepository['debitAccept']>[0]) {
    const existing = this.acceptTransactions.find(
      (row) =>
        row.lawyer_id === input.lawyerId &&
        row.type === 'usage' &&
        row.reference_id === input.referenceId,
    );
    if (existing) return existing;
    const balance = await this.getAcceptBalance(input.lawyerId, input.now);
    if (balance.balance < 1) {
      throw new InsufficientCreditsError();
    }
    const expiry =
      this.acceptTransactions
        .filter(
          (row) =>
            row.lawyer_id === input.lawyerId && active(row.expires_at, input.now) && row.amount > 0,
        )
        .toSorted((a, b) =>
          String(a.expires_at ?? 'z').localeCompare(String(b.expires_at ?? 'z')),
        )[0]?.expires_at ?? null;
    const row: AcceptTransactionRow = {
      amount: -1,
      balance_after: balance.balance - 1,
      created_at: input.now.toISOString(),
      expires_at: expiry,
      id: randomUUID(),
      lawyer_id: input.lawyerId,
      reference_id: input.referenceId,
      type: 'usage',
    };
    this.acceptTransactions.push(row);
    return row;
  }

  createPayment(input: Parameters<FinanceRepository['createPayment']>[0]): Promise<PaymentRow> {
    if ([...this.payments.values()].some((row) => row.idempotency_key === input.idempotency_key))
      throw new Error('duplicate payment');
    const row: PaymentRow = {
      amount_money: input.amount_money,
      created_at: input.created_at ?? new Date().toISOString(),
      currency: input.currency ?? 'UZS',
      failed_at: input.failed_at ?? null,
      id: input.id ?? randomUUID(),
      idempotency_key: input.idempotency_key,
      paid_at: input.paid_at ?? null,
      product_code: input.product_code,
      product_id: input.product_id,
      product_units: input.product_units,
      provider: input.provider,
      provider_payment_id: input.provider_payment_id ?? null,
      status: input.status ?? 'created',
      type: input.type,
      user_id: input.user_id,
    };
    this.payments.set(row.id, row);
    return Promise.resolve(row);
  }
  findPaymentById(id: string): Promise<PaymentRow | null> {
    return Promise.resolve(this.payments.get(id) ?? null);
  }
  findPaymentByIdempotencyKey(key: string): Promise<PaymentRow | null> {
    return Promise.resolve(
      [...this.payments.values()].find((row) => row.idempotency_key === key) ?? null,
    );
  }
  async processPaymentWebhook(
    input: Parameters<FinanceRepository['processPaymentWebhook']>[0],
  ): Promise<PaymentWebhookResult> {
    const payment = this.payments.get(input.paymentId);
    if (!payment) throw new PaymentNotFoundError();
    if (
      payment.provider_payment_id !== null &&
      payment.provider_payment_id !== input.providerPaymentId
    )
      throw new PaymentStateError();
    if (payment.status === input.status)
      return { paymentId: payment.id, processed: false, status: payment.status };
    if (['paid', 'failed', 'cancelled'].includes(payment.status)) {
      throw new PaymentStateError();
    }
    const updated: PaymentRow = {
      ...payment,
      failed_at: input.status === 'paid' ? null : input.now.toISOString(),
      paid_at: input.status === 'paid' ? input.now.toISOString() : null,
      provider_payment_id: input.providerPaymentId,
      status: input.status,
    };
    this.payments.set(payment.id, updated);
    if (input.status === 'paid') {
      if (payment.type === 'credits') {
        await this.grantCredit({
          amount: payment.product_units,
          bucketType: 'paid',
          expiresAt: null,
          now: input.now,
          reason: 'Credit purchase',
          referenceId: payment.id,
          source: payment.provider,
          type: 'purchase',
          userId: payment.user_id,
        });
      } else {
        const lawyerId = this.approvedLawyers.get(payment.user_id);
        if (!lawyerId) throw new Error('lawyer missing');
        const product = this.acceptProducts.get(payment.product_id);
        const expiresAt = product?.expires_in_days
          ? new Date(input.now.getTime() + product.expires_in_days * 86_400_000)
          : null;
        await this.grantAccepts({
          amount: payment.product_units,
          expiresAt,
          lawyerId,
          now: input.now,
          referenceId: payment.id,
          type: 'purchase',
        });
      }
    }
    return { paymentId: payment.id, processed: true, status: input.status };
  }

  seedCreditProduct(overrides: Partial<CreditProductRow> = {}): CreditProductRow {
    const now = new Date().toISOString();
    const row: CreditProductRow = {
      active: true,
      code: 'credits_100',
      created_at: now,
      credit_amount: 100,
      currency: 'UZS',
      id: randomUUID(),
      name: '100 credits',
      name_en: '100 credits',
      name_ru: '100 кредитов',
      name_uz: '100 kredit',
      price: 10_000,
      updated_at: now,
      ...overrides,
    };
    this.creditProducts.set(row.id, row);
    return row;
  }

  seedAcceptProduct(overrides: Partial<AcceptProductRow> = {}): AcceptProductRow {
    const now = new Date().toISOString();
    const row: AcceptProductRow = {
      accept_count: 1,
      active: true,
      code: 'single_accept',
      created_at: now,
      currency: 'UZS',
      expires_in_days: null,
      id: randomUUID(),
      name: '1 accept',
      name_en: '1 accept',
      name_ru: '1 принятие',
      name_uz: '1 qabul',
      price: 9900,
      updated_at: now,
      ...overrides,
    };
    this.acceptProducts.set(row.id, row);
    return row;
  }
}
