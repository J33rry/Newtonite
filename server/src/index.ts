import { buildApp } from './app.js';
import { config } from './config.js';
import { createDb } from './db.js';
import { migrate } from './migrate.js';
import { RealtimeHub } from './realtime.js';

const handle = createDb();
await migrate(handle);

const hub = new RealtimeHub(config.databaseUrl, {
  warn: (obj, msg) => console.warn(msg ?? '', obj),
  error: (obj, msg) => console.error(msg ?? '', obj),
});
await hub.start();

const app = await buildApp({ db: handle.db, hub, devLogin: process.env.DEV_LOGIN !== 'false' });
await app.listen({ port: config.port, host: '0.0.0.0' });

const shutdown = async () => {
  await hub.stop();
  await app.close();
  await handle.pool.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
