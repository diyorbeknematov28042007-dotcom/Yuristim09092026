import { describe, expect, it } from 'vitest';
import { AI_FAILURE_REASONS, formatAiFailure, parseAiFailure } from './ai-diagnostics.js';

describe('public diagnostic contract', () => {
  it('rejects unknown reasons and strips sensitive fields', () => {
    expect(parseAiFailure({ reason: 'raw_secret', stage: 'generation' })).toBeUndefined();
    expect(
      parseAiFailure({
        reason: 'missing_finish',
        stage: 'generation',
        model: 'private',
        token: 'SECRET',
        requestId: 'invalid id',
      }),
    ).toEqual({ reason: 'missing_finish', stage: 'generation' });
  });
  it.each(AI_FAILURE_REASONS)('localizes %s without provider names', (reason) => {
    for (const language of ['uz', 'ru', 'en'] as const) {
      const text = formatAiFailure(language, {
        reason,
        stage: 'generation',
        receivedCharacters: 54,
        requestId: 'request-ref',
      });
      expect(text).toContain(reason.toUpperCase());
      expect(text).toContain('request-ref');
      expect(text).not.toMatch(/gemini|openai|anthropic|secret/i);
    }
  });
});
