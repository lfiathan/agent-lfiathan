import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from './errors.js';

interface FastifyValidationError extends Error {
  validation?: unknown[];
}

/**
 * Global error handler for Fastify.
 * Maps AppError instances to structured JSON responses.
 */
export function registerErrorHandler(fastify: FastifyInstance): void {
  fastify.setErrorHandler((error: FastifyValidationError, request: FastifyRequest, reply: FastifyReply) => {
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
 * Register request timing hooks.
 */
export function registerRequestHooks(fastify: FastifyInstance): void {
  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    request.startTime = Date.now();
  });

  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const duration = Date.now() - request.startTime;
    request.log.info(
      { method: request.method, url: request.url, statusCode: reply.statusCode, duration },
      'request completed'
    );
  });
}
