import type { ApiErrorCode, AiFailureDiagnostic } from '@yuristim/types';
import type { FastifyInstance } from 'fastify';

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly diagnostic?: AiFailureDiagnostic,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: 'Resource not found' },
      requestId: request.id,
    }),
  );

  app.setErrorHandler((error, request, reply) => {
    const knownError = error instanceof AppError;
    const parserCode = (error as { code?: string }).code;
    const parserStatus =
      parserCode === 'FST_ERR_CTP_BODY_TOO_LARGE'
        ? 413
        : parserCode === 'FST_ERR_CTP_INVALID_MEDIA_TYPE'
          ? 415
          : parserCode === 'FST_ERR_CTP_INVALID_JSON_BODY'
            ? 400
            : 500;
    const statusCode = knownError ? error.statusCode : parserStatus;
    const code = knownError
      ? error.code
      : parserStatus < 500
        ? 'VALIDATION_ERROR'
        : 'INTERNAL_ERROR';
    const message = knownError
      ? error.message
      : parserStatus < 500
        ? 'Invalid request body'
        : 'Internal server error';

    if (statusCode >= 500) {
      request.log.error(
        {
          code,
          statusCode,
          errorType: knownError ? 'AppError' : 'InternalError',
          ...(knownError && error.diagnostic ? { diagnostic: error.diagnostic } : {}),
        },
        'Request failed',
      );
    } else {
      request.log.warn({ code, statusCode }, 'Request rejected');
    }

    return reply.status(statusCode).send({
      error: {
        code,
        message,
        ...(knownError && error.diagnostic ? { diagnostic: error.diagnostic } : {}),
      },
      requestId: request.id,
    });
  });
}
