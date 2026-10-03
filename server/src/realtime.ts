import pg from 'pg';
import type { ServerResponse } from 'node:http';
import { canView } from './domain/policy.js';
import type { Actor } from './domain/types.js';
import { REALTIME_CHANNEL, type RealtimeMessage } from './services/events.js';

export interface HubLogger {
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

interface Connection {
  actor: Actor;
  res: ServerResponse;
}

/**
 * Fans out database change notifications to browsers over Server-Sent Events.
 *
 * Each API instance holds ONE dedicated LISTEN connection, so this works unchanged with several
 * API instances behind a load balancer: Postgres broadcasts to all of them. Messages carry ids and
 * versions only — never item content — and are filtered by the same visibility rule as the API.
 * Clients refetch through the normal authorized endpoints. If a message is missed (reconnect,
 * network blip) the client simply refetches on reconnect, so delivery does not need to be reliable.
 */
export class RealtimeHub {
  private connections = new Set<Connection>();
  private client: pg.Client | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly connectionString: string, private readonly log: HubLogger) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
    this.heartbeat = setInterval(() => this.broadcastRaw(': ping\n\n'), 25_000);
  }

  private async connect(): Promise<void> {
    const client = new pg.Client({ connectionString: this.connectionString });
    client.on('notification', (msg) => {
      if (msg.channel !== REALTIME_CHANNEL || !msg.payload) return;
      try {
        this.dispatch(JSON.parse(msg.payload) as RealtimeMessage);
      } catch (err) {
        this.log.warn({ err }, 'bad realtime payload');
      }
    });
    client.on('error', (err) => {
      this.log.error({ err }, 'realtime LISTEN connection lost; reconnecting');
      this.client = null;
      client.end().catch(() => {});
      if (!this.stopped) setTimeout(() => this.connect().catch((e) => this.log.error({ err: e }, 'realtime reconnect failed')), 1000);
    });
    await client.connect();
    await client.query(`LISTEN ${REALTIME_CHANNEL}`);
    this.client = client;
    // Tell connected browsers to resync, in case they missed messages while we were disconnected.
    this.broadcastRaw(`event: resync\ndata: {}\n\n`);
  }

  add(actor: Actor, res: ServerResponse): () => void {
    const conn = { actor, res };
    this.connections.add(conn);
    return () => this.connections.delete(conn);
  }

  get size(): number {
    return this.connections.size;
  }

  private dispatch(message: RealtimeMessage): void {
    const data = `event: ${message.kind}\ndata: ${JSON.stringify(message)}\n\n`;
    for (const conn of this.connections) {
      const visible =
        message.kind === 'notification'
          ? message.userId === conn.actor.id
          : canView(conn.actor, { team_id: message.teamId, created_by: message.createdBy, assignee_id: message.assigneeId });
      if (visible) conn.res.write(data);
    }
  }

  private broadcastRaw(chunk: string): void {
    for (const conn of this.connections) conn.res.write(chunk);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const conn of this.connections) conn.res.end();
    this.connections.clear();
    await this.client?.end().catch(() => {});
  }
}
