import pg from 'pg';
import type { ServerResponse } from 'node:http';
import { canView } from './domain/policy.js';
import type { Actor } from './domain/types.js';
import type { AuthChangeSource } from './http/auth.js';
import { AUTH_CHANNEL, REALTIME_CHANNEL, type RealtimeMessage } from './services/events.js';

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
 *
 * The same connection also listens for auth changes (DB triggers on sessions/memberships/users).
 * Those evict cached identities (see ActorCache) and close the affected user's streams, so the
 * browser reconnects and is re-authorized with its new roles — or rejected if signed out.
 */
export class RealtimeHub implements AuthChangeSource {
  private connections = new Set<Connection>();
  private client: pg.Client | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private stopped = false;
  private authListeners: ((userId: string) => void)[] = [];
  private resetListeners: (() => void)[] = [];

  /** True only while the LISTEN connection is up, i.e. while no change notification can be missed. */
  get listening(): boolean {
    return this.client !== null;
  }

  onAuthChange(fn: (userId: string) => void): void {
    this.authListeners.push(fn);
  }

  onReset(fn: () => void): void {
    this.resetListeners.push(fn);
  }

  constructor(private readonly connectionString: string, private readonly log: HubLogger) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
    this.heartbeat = setInterval(() => this.broadcastRaw(': ping\n\n'), 25_000);
  }

  private async connect(): Promise<void> {
    const client = new pg.Client({ connectionString: this.connectionString });
    client.on('notification', (msg) => {
      if (msg.channel === AUTH_CHANNEL && msg.payload) return this.authChanged(msg.payload);
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
      this.resetListeners.forEach((fn) => fn());
      client.end().catch(() => {});
      if (!this.stopped) setTimeout(() => this.connect().catch((e) => this.log.error({ err: e }, 'realtime reconnect failed')), 1000);
    });
    await client.connect();
    await client.query(`LISTEN ${REALTIME_CHANNEL}; LISTEN ${AUTH_CHANNEL}`);
    this.client = client;
    this.resetListeners.forEach((fn) => fn()); // anything cached before this point may have missed changes
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

  private authChanged(userId: string): void {
    this.authListeners.forEach((fn) => fn(userId));
    for (const conn of this.connections) {
      if (conn.actor.id !== userId) continue;
      conn.res.end();
      this.connections.delete(conn);
    }
  }

  private dispatch(message: RealtimeMessage): void {
    const data = `event: ${message.kind}\ndata: ${JSON.stringify(message)}\n\n`;
    const recipients = message.kind === 'notification' ? new Set(message.userIds) : null;
    for (const conn of this.connections) {
      const visible =
        message.kind === 'notification'
          ? recipients!.has(conn.actor.id)
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
    const client = this.client;
    this.client = null;
    await client?.end().catch(() => {});
  }
}
