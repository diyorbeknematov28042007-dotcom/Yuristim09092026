import { z } from 'zod';

export const nodeEnvSchema = z.enum(['development', 'test', 'production']).default('development');

export class EnvironmentValidationError extends Error {
  readonly variables: readonly string[];

  constructor(variables: readonly string[]) {
    super(`Environment validation failed for: ${variables.join(', ')}`);
    this.name = 'EnvironmentValidationError';
    this.variables = variables;
  }
}

export function parseEnv<TSchema extends z.ZodType>(
  schema: TSchema,
  source: Record<string, string | undefined>,
): z.output<TSchema> {
  const result = schema.safeParse(source);

  if (!result.success) {
    const variables = [
      ...new Set(
        result.error.issues.map((issue) => {
          const [variable = 'environment'] = issue.path;
          return String(variable);
        }),
      ),
    ];

    throw new EnvironmentValidationError(variables);
  }

  return result.data;
}
