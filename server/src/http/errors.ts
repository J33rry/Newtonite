import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../domain/types.js';

/**
 * One error shape for the whole API: { error: { code, message, details? } }.
 * The UI switches on `code` (e.g. VERSION_CONFLICT, ALREADY_CLAIMED), never on message text.
 */
export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof AppError) {
    return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Some fields are invalid',
        details: { issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      },
    });
  }
  const fe = err as FastifyError;
  if (fe.statusCode && fe.statusCode < 500) {
    return reply.code(fe.statusCode).send({ error: { code: fe.code ?? 'BAD_REQUEST', message: fe.message } });
  }
  // Postgres: invalid uuid text etc. are client errors, not 500s.
  const pgCode = (err as { code?: string }).code;
  if (pgCode === '22P02') {
    return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'Malformed identifier' } });
  }
  if (pgCode === '40P01' || pgCode === '40001') {
    return reply.code(503).header('Retry-After', '1').send({ error: { code: 'RETRY', message: 'Please retry' } });
  }
  req.log.error({ err }, 'unhandled error');
  return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
}
