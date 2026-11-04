import { WebSocket, type RawData } from 'ws';
import type { MetaTranscribeEvent } from './meta-transcribe.service.js';

export function send(client: WebSocket, payload: object) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(payload));
  }
}

// Meta's events stay on the server; the client only learns that recognition
// failed. The details are logged by MetaTranscribeSession.
export function sendMetaError(client: WebSocket, event: MetaTranscribeEvent) {
  if (event.type !== 'error') return;
  send(client, { type: 'error', message: 'Speech recognition failed' });
}

export function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

const HEARTBEAT_MS = 15_000;

// A client that vanished without a close frame (sleep, network loss) never
// fires 'close' on its own. Terminating it lets the gateway end the session.
export function keepAlive(client: WebSocket) {
  let alive = true;
  client.on('pong', () => (alive = true));
  const timer = setInterval(() => {
    if (!alive) {
      client.terminate();
      return;
    }
    alive = false;
    client.ping();
  }, HEARTBEAT_MS);
  client.on('close', () => clearInterval(timer));
}

// 1005/1006 are reserved and cannot be sent in a close frame.
export function closeCode(code: number): number {
  return code === 1005 || code === 1006 ? 1011 : code;
}
