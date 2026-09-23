import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.js';
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

function fail(error: PostgrestError): never {
  throw new Error(`Database operation failed (${error.code})`);
}

function required<T>(data: T | null, error: PostgrestError | null): T {
  if (error) fail(error);
  if (data === null) throw new Error('Database operation returned no data');
  return data;
}

export class SupabaseFinanceRepository implements FinanceRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async getCreditBalance(userId: string, now: Date): Promise<CreditBalanceRow> {
    const { data, error } = await this.client.rpc('credit_balance', {
      p_now: now.toISOString(),
      p_user_id: userId,
    });
    if (error) fail(error);
    const row = data[0];
    if (!row) throw new Error('Credit balance was not returned');
    return row;
  }

  async listCreditTransactions(input: CreditHistoryInput) {
    let query = this.client
      .from('credit_transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', input.userId);
    if (input.type) query = query.eq('type', input.type);
    if (input.from) query = query.gte('created_at', input.from.toISOString());
    if (input.to) query = query.lte('created_at', input.to.toISOString());
    const start = (input.page - 1) * input.limit;
    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(start, start + input.limit - 1);
    if (error) fail(error);
    return { items: data, total: count ?? 0 };
  }

  async listCreditProducts(): Promise<CreditProductRow[]> {
    const { data, error } = await this.client
      .from('credit_products')
      .select('*')
      .eq('active', true)
      .not('price', 'is', null)
      .not('credit_amount', 'is', null)
      .order('credit_amount');
    if (error) fail(error);
    return data;
  }

  async findCreditProductById(id: string): Promise<CreditProductRow | null> {
    const { data, error } = await this.client
      .from('credit_products')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) fail(error);
    return data;
  }

  async grantWelcome(userId: string, now: Date): Promise<CreditTransactionRow> {
    const { data, error } = await this.client.rpc('grant_welcome_credit', {
      p_now: now.toISOString(),
      p_user_id: userId,
    });
    return required(data, error);
  }

  async grantWeekly(now: Date): Promise<number> {
    const { data, error } = await this.client.rpc('grant_weekly_credits', {
      p_now: now.toISOString(),
    });
    return required(data, error);
  }

  async grantBonus(
    input: Parameters<FinanceRepository['grantBonus']>[0],
  ): Promise<CreditTransactionRow> {
    const { data, error } = await this.client.rpc('grant_admin_credit_bonus', {
      p_admin_id: input.adminId,
      p_amount: input.amount,
      p_now: input.now.toISOString(),
      p_reason: input.reason,
      p_reference_id: input.referenceId,
      p_user_id: input.userId,
    });
    return required(data, error);
  }

  async grantCredit(
    input: Parameters<FinanceRepository['grantCredit']>[0],
  ): Promise<CreditTransactionRow> {
    const { data, error } = await this.client.rpc('grant_credit', {
      p_amount: input.amount,
      p_bucket_type: input.bucketType,
      ...(input.expiresAt ? { p_expires_at: input.expiresAt.toISOString() } : {}),
      p_now: input.now.toISOString(),
      ...(input.reason ? { p_reason: input.reason } : {}),
      p_reference_id: input.referenceId,
      p_source: input.source,
      p_type: input.type,
      p_user_id: input.userId,
    });
    return required(data, error);
  }

  async debitCredits(
    input: Parameters<FinanceRepository['debitCredits']>[0],
  ): Promise<CreditTransactionRow[]> {
    const { data, error } = await this.client.rpc('debit_credits', {
      p_amount: input.amount,
      p_now: input.now.toISOString(),
      ...(input.reason ? { p_reason: input.reason } : {}),
      p_reference_id: input.referenceId,
      p_source: input.source,
      p_type: input.type,
      p_user_id: input.userId,
    });
    if (error?.code === 'P0001') throw new InsufficientCreditsError();
    if (error) fail(error);
    return data;
  }

  async getApprovedLawyerId(userId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('lawyer_profiles')
      .select('id')
      .eq('user_id', userId)
      .eq('verification_status', 'approved')
      .maybeSingle();
    if (error) fail(error);
    return data?.id ?? null;
  }

  async getAcceptBalance(lawyerId: string, now: Date): Promise<AcceptBalanceRow> {
    const { data, error } = await this.client.rpc('accept_balance', {
      p_lawyer_id: lawyerId,
      p_now: now.toISOString(),
    });
    if (error) fail(error);
    const row = data[0];
    if (!row) throw new Error('Accept balance was not returned');
    return row;
  }

  async listAcceptProducts(): Promise<AcceptProductRow[]> {
    const { data, error } = await this.client
      .from('marketplace_accept_products')
      .select('*')
      .eq('active', true)
      .order('accept_count');
    if (error) fail(error);
    return data;
  }

  async findAcceptProductById(id: string): Promise<AcceptProductRow | null> {
    const { data, error } = await this.client
      .from('marketplace_accept_products')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) fail(error);
    return data;
  }

  async grantAccepts(
    input: Parameters<FinanceRepository['grantAccepts']>[0],
  ): Promise<AcceptTransactionRow> {
    const { data, error } = await this.client.rpc('grant_accepts', {
      p_amount: input.amount,
      ...(input.expiresAt ? { p_expires_at: input.expiresAt.toISOString() } : {}),
      p_lawyer_id: input.lawyerId,
      p_now: input.now.toISOString(),
      p_reference_id: input.referenceId,
      p_type: input.type,
    });
    return required(data, error);
  }

  async debitAccept(
    input: Parameters<FinanceRepository['debitAccept']>[0],
  ): Promise<AcceptTransactionRow> {
    const { data, error } = await this.client.rpc('debit_accept', {
      p_lawyer_id: input.lawyerId,
      p_now: input.now.toISOString(),
      p_reference_id: input.referenceId,
    });
    if (error?.code === 'P0001') throw new InsufficientCreditsError();
    return required(data, error);
  }

  async createPayment(
    input: Database['public']['Tables']['payments']['Insert'],
  ): Promise<PaymentRow> {
    const { data, error } = await this.client.from('payments').insert(input).select('*').single();
    return required(data, error);
  }

  async findPaymentById(id: string): Promise<PaymentRow | null> {
    const { data, error } = await this.client
      .from('payments')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) fail(error);
    return data;
  }

  async findPaymentByIdempotencyKey(idempotencyKey: string): Promise<PaymentRow | null> {
    const { data, error } = await this.client
      .from('payments')
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (error) fail(error);
    return data;
  }

  async processPaymentWebhook(
    input: Parameters<FinanceRepository['processPaymentWebhook']>[0],
  ): Promise<PaymentWebhookResult> {
    const { data, error } = await this.client.rpc('process_payment_webhook', {
      p_now: input.now.toISOString(),
      p_payment_id: input.paymentId,
      p_provider: input.provider,
      p_provider_payment_id: input.providerPaymentId,
      p_status: input.status,
    });
    if (error?.code === 'P0002') throw new PaymentNotFoundError();
    if (error?.code === '40001' || error?.code === '22023' || error?.code === '23505')
      throw new PaymentStateError();
    if (error) fail(error);
    const row = data[0];
    if (!row) throw new Error('Payment webhook result was not returned');
    return { paymentId: row.payment_id, processed: row.processed, status: row.payment_status };
  }
}
