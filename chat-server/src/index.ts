import { WebSocket, WebSocketServer } from 'ws';
import { createServer } from 'http';
import { randomUUID } from 'crypto';

const PORT = 8080;

interface IncomingJoin {
  type: 'join';
  name: string;
}

interface IncomingMessage {
  type: 'message';
  text: string;
}

type IncomingPayload = IncomingJoin | IncomingMessage;

interface InitPayload {
  type: 'init';
  clientId: string;
}

interface BroadcastPayload {
  type: 'message';
  id: string;
  text: string;
  timestamp: string;
  senderId: string;
  senderName: string;
}

interface UsersPayload {
  type: 'users';
  count: number;
}

interface ClientInfo {
  clientId: string;
  name: string;
}

const server = createServer();
const wss = new WebSocketServer({ server });
const clients = new Map<WebSocket, ClientInfo>();

function broadcastUserCount() {
  const payload: UsersPayload = { type: 'users', count: clients.size };
  const msg = JSON.stringify(payload);
  clients.forEach((_, ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

wss.on('connection', (ws: WebSocket) => {
  const clientId = randomUUID();
  clients.set(ws, { clientId, name: 'Anonymous' });

  const init: InitPayload = { type: 'init', clientId };
  ws.send(JSON.stringify(init));

  broadcastUserCount();

  ws.on('close', () => {
    clients.delete(ws);
    broadcastUserCount();
  });

  ws.on('message', (data: Buffer) => {
    let parsed: IncomingPayload;
    try {
      parsed = JSON.parse(data.toString()) as IncomingPayload;
    } catch {
      return;
    }

    if (parsed.type === 'join') {
      const name = parsed.name?.trim();
      if (typeof name === 'string' && name) {
        clients.set(ws, { clientId, name });
      }
      return;
    }

    if (parsed.type === 'message') {
      const { text } = parsed;
      if (typeof text !== 'string' || !text.trim()) return;

      const info = clients.get(ws);
      const broadcast: BroadcastPayload = {
        type: 'message',
        id: randomUUID(),
        text: text.trim(),
        timestamp: new Date().toLocaleTimeString(),
        senderId: clientId,
        senderName: info?.name ?? 'Anonymous',
      };

      clients.forEach((_, client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(broadcast));
        }
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`WebSocket server listening on ws://localhost:${PORT}`);
});
