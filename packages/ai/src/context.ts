import { estimateTokens } from './pricing.js';
import type { AiContextMessage } from './types.js';

export interface ContextBuildResult {
  messages: Array<Pick<AiContextMessage, 'role' | 'content'>>;
  truncated: boolean;
  estimatedTokens: number;
}

export function buildConversationContext(
  history: AiContextMessage[],
  tokenBudget: number,
): ContextBuildResult {
  const selected: AiContextMessage[] = [];
  let estimatedTokens = 0;
  let truncated = false;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (!message) continue;
    const tokens = estimateTokens(message.content) + 4;
    if (selected.length > 0 && estimatedTokens + tokens > tokenBudget) {
      truncated = true;
      continue;
    }
    selected.push(message);
    estimatedTokens += tokens;
  }

  selected.reverse();
  return {
    estimatedTokens,
    messages: selected.map(({ content, role }) => ({ content, role })),
    truncated,
  };
}

export function deriveConversationTitle(prompt: string, maxCharacters = 60): string {
  const normalized = prompt.trim().replace(/\s+/g, ' ');
  const characters = Array.from(normalized);
  if (characters.length <= maxCharacters) return normalized;
  return `${characters.slice(0, Math.max(1, maxCharacters - 1)).join('')}…`;
}
