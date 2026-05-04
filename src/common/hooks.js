import { AppError } from './errors.js';

/**
 * Global error handler for Fastify.
 * Maps AppError instances to structured JSON responses.
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export function registerErrorHandler(fastify) {
  fastify.setErrorHandler((error, request, reply) => {
    // Handle our custom errors
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    // Handle Fastify validation errors
    if (error.validation) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: error.validation,
        },
      });
    }

    // Unexpected errors
    request.log.error(error);
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message:
          fastify.config?.env === 'production'
            ? 'An unexpected error occurred'
            : error.message,
      },
    });
  });
}

/**
 * Register a request ID hook for tracing.
 * @param {import('fastify').FastifyInstance} fastify
 */
export function registerRequestHooks(fastify) {
  fastify.addHook('onRequest', async (request) => {
    request.startTime = Date.now();
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const duration = Date.now() - request.startTime;
    request.log.info(
      { method: request.method, url: request.url, statusCode: reply.statusCode, duration },
      'request completed'
    );
  });
}
