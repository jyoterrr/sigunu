import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, Ack } from '@sigunu/shared';

const BASE = import.meta.env.VITE_API_URL || '';

export type SigunuSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function connectSocket(): SigunuSocket {
  return io(BASE, { transports: ['websocket'], autoConnect: true });
}

/** Promisified socket emit for the request/ack events. */
export function emitAck<T>(
  socket: SigunuSocket,
  event: keyof ClientToServerEvents,
  payload: unknown
): Promise<T> {
  return new Promise((resolve, reject) => {
    (socket.emit as any)(event, payload, (res: Ack<T>) => {
      if (res.ok) resolve(res.data);
      else reject(new Error(res.error));
    });
  });
}
