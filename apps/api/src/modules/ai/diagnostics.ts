import { AiProviderError } from '@yuristim/ai';
import { parseAiFailure, type AiFailureDiagnostic } from '@yuristim/types';

export interface AiRequestTrace {
  startedAt: number;
  stage: AiFailureDiagnostic['stage'];
  receivedCharacters: number;
  requestId: string;
  operation?: AiFailureDiagnostic['operation'];
}

export function failureDiagnostic(error: unknown, trace: AiRequestTrace): AiFailureDiagnostic {
  let reason: AiFailureDiagnostic['reason'] = 'internal_error';
  let upstreamStatus: number | undefined;
  const rawDatabaseCode =
    error && typeof error === 'object'
      ? (error as { databaseCode?: unknown }).databaseCode
      : undefined;
  const databaseCode =
    typeof rawDatabaseCode === 'string' && /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(rawDatabaseCode)
      ? rawDatabaseCode
      : undefined;
  if (error instanceof AiProviderError) {
    upstreamStatus = error.diagnostics.statusCode;
    reason =
      error.diagnostics.reason ??
      (error.category === 'configuration'
        ? 'not_configured'
        : error.category === 'rate_limit'
          ? 'rate_limit'
          : error.category === 'timeout'
            ? 'timeout'
            : error.category === 'cancelled'
              ? 'cancelled'
              : 'unknown');
    if (reason === 'http_error') {
      reason =
        upstreamStatus === 401
          ? 'authentication_failed'
          : upstreamStatus === 403
            ? 'permission_denied'
            : upstreamStatus === 429
              ? 'rate_limit'
              : 'http_error';
    }
  }
  if (databaseCode) reason = 'database_error';
  return {
    reason,
    stage: reason === 'delivery_failed' ? 'delivery' : trace.stage,
    ...(trace.operation
      ? { operation: reason === 'delivery_failed' ? 'write_stream' : trace.operation }
      : {}),
    requestId: trace.requestId,
    receivedCharacters: trace.receivedCharacters,
    elapsedMilliseconds: Math.max(0, Date.now() - trace.startedAt),
    ...(upstreamStatus === undefined ? {} : { upstreamStatus }),
    ...(databaseCode ? { databaseCode } : {}),
  };
}

// Fits the existing error_code constraint. No prompt, token or raw error body is persisted.
export function persistedFailureCode(failure: AiFailureDiagnostic): string {
  return `ai_${failure.stage}_${failure.reason}${failure.operation ? `_op_${failure.operation}` : ''}${failure.upstreamStatus === undefined ? '' : `_http_${failure.upstreamStatus}`}${failure.databaseCode ? `_db_${failure.databaseCode.toLowerCase()}` : ''}`;
}

export function storedFailureDiagnostic(code: string | null): AiFailureDiagnostic | undefined {
  if (!code) return undefined;
  const match =
    /^ai_(prepare|generation|finalize|delivery)_([a-z_]+?)(?:_op_([a-z_]+?))?(?:_http_([1-5][0-9]{2}))?(?:_db_([a-z0-9]+))?$/.exec(
      code,
    );
  if (match)
    return parseAiFailure({
      stage: match[1],
      reason: match[2],
      ...(match[3] ? { operation: match[3] } : {}),
      ...(match[4] ? { upstreamStatus: Number(match[4]) } : {}),
      ...(match[5] ? { databaseCode: match[5].toUpperCase() } : {}),
    });
  const legacy: Record<string, AiFailureDiagnostic['reason']> = {
    provider_timeout: 'timeout',
    provider_rate_limit: 'rate_limit',
    provider_configuration: 'not_configured',
    provider_cancelled: 'cancelled',
    provider_unavailable: 'unknown',
    provider_unknown: 'unknown',
    delivery_failed: 'delivery_failed',
    internal_error: 'unknown',
  };
  const reason = legacy[code];
  return reason
    ? { reason, stage: code === 'delivery_failed' ? 'delivery' : 'generation' }
    : undefined;
}
