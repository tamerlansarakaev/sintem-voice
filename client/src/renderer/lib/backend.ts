import { getPref } from './prefs';

const HEALTH_TIMEOUT_MS = 4000;
const CONNECT_TIMEOUT_MS = 10_000;

// A server address typed on the connection screen wins over BACKEND_URL.
export async function backendUrl() {
  return getPref('backendUrl') || (await window.config.getBackendUrl());
}

// BACKEND_URL is http(s)://host[:port]; sockets use ws(s) on the same host.
export async function socketUrl(pathname: string, params: Record<string, string>) {
  const url = new URL(pathname, await backendUrl());
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  return url.href;
}

// Any HTTP answer means the server is up; no-cors skips the CORS check
// the server does not need for sockets.
export async function checkServer(url: string) {
  try {
    await fetch(url, {
      mode: 'no-cors',
      cache: 'no-store',
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return true;
  } catch {
    return false;
  }
}

export interface PendingSocket {
  socket: WebSocket;
  // Rejects when the socket closes before opening (an error or a cancel)
  // or does not open in time.
  opened: Promise<WebSocket>;
  cancelled: boolean;
}

export function connect(url: string): PendingSocket {
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  const opened = new Promise<WebSocket>((resolve, reject) => {
    const fail = () => {
      clearTimeout(timer);
      reject(new Error(`cannot reach ${url}`));
    };
    // A host that never answers would leave the socket connecting forever.
    const timer = setTimeout(() => {
      socket.close();
      fail();
    }, CONNECT_TIMEOUT_MS);
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timer);
        resolve(socket);
      },
      { once: true },
    );
    socket.addEventListener('close', fail, { once: true });
  });
  return { socket, opened, cancelled: false };
}
