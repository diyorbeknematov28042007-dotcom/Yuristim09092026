import type {
  AiProviderErrorCategory,
  AiProviderName,
  AiProviderRuntimeState,
} from './ai-repository.js';

type SqlValue = string | number | null;
interface Statement {
  bind(...values: SqlValue[]): Statement;
  first<T>(): Promise<T | null>;
}
export interface D1AiProviderBinding {
  prepare(sql: string): Statement;
}
interface StateRow {
  provider: AiProviderName;
  manual_enabled: number;
  circuit_state: AiProviderRuntimeState['circuitState'];
  consecutive_failures: number;
  failure_window_started_at: string | null;
  paused_until: string | null;
  cooldown_seconds: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error_category: AiProviderErrorCategory | null;
}

function validProvider(provider: string): boolean {
  return ['gemini', 'bai', 'openai', 'anthropic'].includes(provider);
}
function range(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}
function invalid(): never {
  throw Object.assign(new Error('Invalid AI provider state operation'), { databaseCode: '22023' });
}
function state(row: StateRow): AiProviderRuntimeState {
  return {
    provider: row.provider,
    manualEnabled: row.manual_enabled === 1,
    circuitState: row.circuit_state,
    consecutiveFailures: row.consecutive_failures,
    failureWindowStartedAt: row.failure_window_started_at,
    pausedUntil: row.paused_until,
    cooldownSeconds: row.cooldown_seconds,
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
    lastErrorCategory: row.last_error_category,
  };
}
function required(row: StateRow | null): StateRow {
  if (!row) throw new Error('AI provider state not found');
  return row;
}

/** Every transition uses one conditional SQL UPDATE; leases cannot be acquired twice. */
export class D1AiProviderRepository {
  constructor(private readonly db: D1AiProviderBinding) {}

  async getProviderState(provider: AiProviderName): Promise<AiProviderRuntimeState | null> {
    const row = await this.db
      .prepare('SELECT * FROM ai_provider_runtime_state WHERE provider=?')
      .bind(provider)
      .first<StateRow>();
    return row ? state(row) : null;
  }

  async acquireProvider(input: {
    provider: AiProviderName;
    now: Date;
    halfOpenLeaseSeconds: number;
  }): Promise<{ allowed: boolean; state: AiProviderRuntimeState }> {
    if (!validProvider(input.provider) || !range(input.halfOpenLeaseSeconds, 5, 3600)) invalid();
    const now = input.now.toISOString();
    // A single UPDATE grants the probe; concurrent arrivals observe its future paused_until.
    const lease = await this.db
      .prepare(
        `UPDATE ai_provider_runtime_state SET circuit_state='HALF_OPEN',
        paused_until=?,updated_at=?
        WHERE provider=? AND manual_enabled=1 AND circuit_state IN ('OPEN','HALF_OPEN')
          AND paused_until<=? RETURNING *`,
      )
      .bind(
        new Date(input.now.getTime() + input.halfOpenLeaseSeconds * 1000).toISOString(),
        now,
        input.provider,
        now,
      )
      .first<StateRow>();
    if (lease) return { allowed: true, state: state(lease) };
    const current = required(
      await this.db
        .prepare('SELECT * FROM ai_provider_runtime_state WHERE provider=?')
        .bind(input.provider)
        .first<StateRow>(),
    );
    return {
      allowed: current.manual_enabled === 1 && current.circuit_state === 'ACTIVE',
      state: state(current),
    };
  }

  async recordProviderSuccess(input: {
    provider: AiProviderName;
    now: Date;
    baseCooldownSeconds: number;
  }): Promise<AiProviderRuntimeState> {
    if (!validProvider(input.provider) || !range(input.baseCooldownSeconds, 10, 86400)) invalid();
    return state(
      required(
        await this.db
          .prepare(
            `UPDATE ai_provider_runtime_state SET
            circuit_state=CASE WHEN manual_enabled=1 THEN 'ACTIVE' ELSE 'MANUAL_PAUSED' END,
            consecutive_failures=0,failure_window_started_at=NULL,paused_until=NULL,
            cooldown_seconds=?,last_success_at=?,last_error_category=NULL,updated_at=?
            WHERE provider=? RETURNING *`,
          )
          .bind(
            input.baseCooldownSeconds,
            input.now.toISOString(),
            input.now.toISOString(),
            input.provider,
          )
          .first<StateRow>(),
      ),
    );
  }

  async recordProviderFailure(input: {
    provider: AiProviderName;
    category: AiProviderErrorCategory;
    now: Date;
    failureThreshold: number;
    failureWindowSeconds: number;
    baseCooldownSeconds: number;
    maxCooldownSeconds: number;
    retryAfterSeconds?: number;
  }): Promise<AiProviderRuntimeState> {
    if (
      !validProvider(input.provider) ||
      !['timeout', 'rate_limit', 'unavailable', 'configuration', 'unknown'].includes(
        input.category,
      ) ||
      !range(input.failureThreshold, 1, 20) ||
      !range(input.failureWindowSeconds, 10, 3600) ||
      !range(input.baseCooldownSeconds, 10, 86400) ||
      !range(input.maxCooldownSeconds, input.baseCooldownSeconds, 86400) ||
      (input.retryAfterSeconds !== undefined &&
        !range(input.retryAfterSeconds, 0, Number.MAX_SAFE_INTEGER))
    )
      invalid();
    const now = input.now.toISOString();
    const windowStart = new Date(
      input.now.getTime() - input.failureWindowSeconds * 1000,
    ).toISOString();
    const row = await this.db
      .prepare(
        `WITH next AS (
        SELECT provider,
          CASE WHEN failure_window_started_at>=? THEN consecutive_failures+1 ELSE 1 END failures,
          CASE WHEN failure_window_started_at>=? THEN failure_window_started_at ELSE ? END window_start,
          CASE WHEN circuit_state='HALF_OPEN' THEN min(?,max(?,cooldown_seconds)*2)
            ELSE min(?,max(?,?)) END cooldown,
          CASE WHEN circuit_state='HALF_OPEN' OR ? IN ('rate_limit','configuration')
            OR (CASE WHEN failure_window_started_at>=? THEN consecutive_failures+1 ELSE 1 END)>=?
            THEN 1 ELSE 0 END opens
        FROM ai_provider_runtime_state WHERE provider=?
      ) UPDATE ai_provider_runtime_state SET
        consecutive_failures=next.failures,failure_window_started_at=next.window_start,
        cooldown_seconds=next.cooldown,
        circuit_state=CASE WHEN manual_enabled=0 THEN 'MANUAL_PAUSED'
          WHEN next.opens=1 THEN 'OPEN' ELSE 'ACTIVE' END,
        paused_until=CASE WHEN manual_enabled=1 AND next.opens=1
          THEN strftime('%Y-%m-%dT%H:%M:%fZ',?, '+'||next.cooldown||' seconds') ELSE NULL END,
        last_failure_at=?,last_error_category=?,updated_at=?
      FROM next WHERE ai_provider_runtime_state.provider=next.provider RETURNING *`,
      )
      .bind(
        windowStart,
        windowStart,
        now,
        input.maxCooldownSeconds,
        input.baseCooldownSeconds,
        input.maxCooldownSeconds,
        input.baseCooldownSeconds,
        input.retryAfterSeconds ?? 0,
        input.category,
        windowStart,
        input.failureThreshold,
        input.provider,
        now,
        now,
        input.category,
        now,
      )
      .first<StateRow>();
    return state(required(row));
  }
}
