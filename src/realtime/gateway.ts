import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { redis } from '../lib/redis';
import { verifyAccessToken } from '../modules/auth/tokens';

const CHANNEL = 'realtime:notifications';

interface RealtimePublish {
  userId: string;
  payload: unknown;
}

export interface RealtimeGateway {
  stop: () => Promise<void>;
}

/**
 * A WebSocket server for pushing notifications live, fronted by REDIS PUB/SUB
 * so it's correct across MULTIPLE API replicas: a client's socket is open on
 * exactly ONE replica, but the notification that should reach it can be
 * triggered by a request handled by ANY replica, or by the worker process,
 * which holds no sockets at all. Every replica subscribes to one channel;
 * whichever replica actually has that user's socket open is the one that
 * forwards the message. No sticky sessions, no shared socket registry.
 *
 * Behind the `REALTIME_ENABLED` flag (Task 8.3's course lesson) — this scaffold
 * exists so the *shape* of realtime is in place, but it costs nothing (no WS
 * server, no extra Redis connection) until a feature actually needs it.
 */
export function startRealtimeGateway(server: HttpServer): RealtimeGateway {
  const wss = new WebSocketServer({ server, path: '/realtime' });
  const socketsByUser = new Map<string, Set<WebSocket>>();

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '', 'http://internal');
    const token = url.searchParams.get('token') ?? '';

    let userId: string;
    try {
      userId = verifyAccessToken(token).sub; // same stateless JWT check as requireAuth — no DB hit
    } catch {
      ws.close(4001, 'unauthorized');
      return;
    }

    let sockets = socketsByUser.get(userId);
    if (!sockets) {
      sockets = new Set();
      socketsByUser.set(userId, sockets);
    }
    sockets.add(ws);

    ws.on('close', () => {
      sockets?.delete(ws);
      if (sockets && sockets.size === 0) socketsByUser.delete(userId);
    });
  });

  // A DEDICATED Redis connection: once a connection issues SUBSCRIBE, ioredis
  // puts it into subscriber mode and it can no longer run ordinary commands —
  // it must never be the same client used for caching/locks.
  const subscriber = redis.duplicate();
  void subscriber.subscribe(CHANNEL);
  subscriber.on('message', (_channel: string, raw: string) => {
    let message: RealtimePublish;
    try {
      message = JSON.parse(raw) as RealtimePublish;
    } catch {
      return; // malformed message on the channel — drop it, don't crash the gateway
    }
    const sockets = socketsByUser.get(message.userId);
    if (!sockets) return; // this replica just doesn't hold that user's socket — normal, not an error
    const data = JSON.stringify(message.payload);
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  });

  return {
    stop: async () => {
      await subscriber.unsubscribe(CHANNEL);
      await subscriber.quit();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}

/** Publish to whichever replica (if any) currently holds this user's socket. */
export async function publishRealtime(userId: string, payload: unknown): Promise<void> {
  await redis.publish(CHANNEL, JSON.stringify({ userId, payload }));
}
