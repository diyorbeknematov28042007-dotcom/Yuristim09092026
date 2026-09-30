import { AiProviderError } from '@yuristim/ai';
import { describe, expect, it } from 'vitest';
import { AI_FAILURE_REASONS, AI_FAILURE_OPERATIONS } from '@yuristim/types';
import { failureDiagnostic, persistedFailureCode, storedFailureDiagnostic } from './diagnostics.js';

describe('safe AI failure diagnostics', () => {
  it('fits every observed backend reason/operation combination into the existing error-code column', () => {
    for (const reason of AI_FAILURE_REASONS) {
      for (const operation of AI_FAILURE_OPERATIONS) {
        const diagnostic = { reason, stage: 'generation' as const, operation, upstreamStatus: 503 };
        const code = persistedFailureCode(diagnostic);
        expect(code.length).toBeLessThanOrEqual(80);
        expect(storedFailureDiagnostic(code)).toEqual(diagnostic);
        const databaseDiagnostic = {
          reason: 'database_error' as const,
          stage: 'finalize' as const,
          operation,
          databaseCode: 'PGRST999',
        };
        const databaseCode = persistedFailureCode(databaseDiagnostic);
        expect(databaseCode.length).toBeLessThanOrEqual(80);
        expect(storedFailureDiagnostic(databaseCode)).toEqual(databaseDiagnostic);
      }
    }
  });
  it('persists safe SQLSTATE with the exact failed database operation', () => {
    const error = Object.assign(new Error('SECRET database detail'), { databaseCode: '23514' });
    const diagnostic = failureDiagnostic(error, {
      stage: 'finalize',
      operation: 'complete_message',
      startedAt: Date.now(),
      receivedCharacters: 8,
      requestId: 'db-ref',
    });
    expect(diagnostic).toMatchObject({
      reason: 'database_error',
      databaseCode: '23514',
      operation: 'complete_message',
    });
    expect(storedFailureDiagnostic(persistedFailureCode(diagnostic))).toMatchObject({
      reason: 'database_error',
      databaseCode: '23514',
      operation: 'complete_message',
    });
  });
  it.each([
    ['missing_finish', 'missing_finish', undefined],
    ['output_limit', 'output_limit', undefined],
    ['http_error', 'authentication_failed', 401],
    ['http_error', 'permission_denied', 403],
    ['http_error', 'rate_limit', 429],
    ['quota_exhausted', 'quota_exhausted', 429],
    ['http_error', 'http_error', 503],
    ['request_budget', 'request_budget', undefined],
  ] as const)('preserves %s as %s without exposing raw errors', (reason, expected, statusCode) => {
    const error = new AiProviderError('unavailable', false, 'SECRET raw provider body', undefined, {
      reason,
      statusCode,
      provider: 'gemini',
      model: 'private-model',
    });
    const diagnostic = failureDiagnostic(error, {
      stage: 'generation',
      startedAt: Date.now() - 100,
      receivedCharacters: 54,
      requestId: 'request-test',
    });
    expect(diagnostic).toMatchObject({
      reason: expected,
      stage: 'generation',
      receivedCharacters: 54,
      requestId: 'request-test',
    });
    expect(JSON.stringify(diagnostic)).not.toMatch(/SECRET|gemini|private-model/);
    const code = persistedFailureCode(diagnostic);
    expect(code).toMatch(/^[a-z][a-z0-9_]+$/);
    expect(code.length).toBeLessThanOrEqual(80);
    expect(storedFailureDiagnostic(code)).toMatchObject({
      reason: expected,
      stage: 'generation',
      ...(statusCode ? { upstreamStatus: statusCode } : {}),
    });
  });
  it('keeps unknown errors honest and records the failed database stage', () => {
    expect(
      failureDiagnostic(new Error('private DB connection string'), {
        stage: 'finalize',
        startedAt: Date.now(),
        requestId: 'ref',
        receivedCharacters: 0,
      }),
    ).toMatchObject({ reason: 'internal_error', stage: 'finalize' });
    expect(storedFailureDiagnostic('provider_unavailable')).toEqual({
      reason: 'unknown',
      stage: 'generation',
    });
    expect(storedFailureDiagnostic('secret_untrusted_code')).toBeUndefined();
  });
});
