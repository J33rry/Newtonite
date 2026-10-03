import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import type { Database } from './db.js';
import { authenticate } from './http/auth.js';
import { errorHandler } from './http/errors.js';
import type { RealtimeHub } from './realtime.js';
import { itemRoutes } from './routes/items.js';
import { publicRoutes, sessionRoutes } from './routes/misc.js';

export interface AppDeps {
  db: Database;
  hub: RealtimeHub;
  devLogin?: boolean;
  logger?: boolean;
}

export async function buildApp({ db, hub, devLogin = true, logger = true }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: logger ? { level: process.env.LOG_LEVEL ?? 'info' } : false });
  await app.register(cookie);
  app.setErrorHandler(errorHandler);

  publicRoutes(app, db, { devLogin });

  // Everything else requires a session; authorization is then checked per resource in the services.
  await app.register(async (secured) => {
    secured.addHook('preHandler', authenticate(db));
    sessionRoutes(secured, db, hub);
    itemRoutes(secured, db);
  });

  return app;
}
