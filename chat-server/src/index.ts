import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer } from 'http';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import type { IncomingMessage } from 'http';

const PORT = Number(process.env.PORT ?? 8080);
const NODE_ENV = process.env.NODE_ENV ?? 'development';
const JWT_SECRET = process.env.JWT_SECRET;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173';

if (!JWT_SECRET) {
  if (NODE_ENV === 'production') {
    console.error('FATAL: JWT_SECRET env var is required in production.');
    process.exit(1);
  }
  console.warn('WARNING: JWT_SECRET not set — using insecure default. Set it in .env for production.');
}

const SECRET = JWT_SECRET ?? 'dev-secret-change-in-production';

// ── Database ─────────────────────────────────────────────────────
const db = new Database('chat.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const stmtInsert = db.prepare<[string, string]>(
  'INSERT INTO users (username, password_hash) VALUES (?, ?)'
);
const stmtFindByUsername = db.prepare<[string]>(
  'SELECT id, username, password_hash FROM users WHERE username = ?'
);

// ── Types ─────────────────────────────────────────────────────────
interface DbUser {
  id: number;
  username: string;
  password_hash: string;
}

interface JwtPayload {
  userId: number;
  username: string;
}

interface ClientInfo {
  clientId: string;
  name: string;
}

interface IncomingJoin {
  type: 'join';
  name: string;
}

interface IncomingMessage2 {
  type: 'message';
  text: string;
}

interface IncomingTyping {
  type: 'typing';
  isTyping: boolean;
}

type IncomingPayload = IncomingJoin | IncomingMessage2 | IncomingTyping;

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
  names: string[];
}

interface TypingPayload {
  type: 'typing';
  username: string;
  isTyping: boolean;
}

// ── Express app ───────────────────────────────────────────────────
const app = express();
app.use(express.json());

// CORS
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

// Rate limiting for auth endpoints (max 10 requests per 15 minutes per IP)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});
app.use('/api/auth', authLimiter);

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username?.trim() || !password) {
    res.status(400).json({ error: 'Username and password are required.' });
    return;
  }
  const trimmed = username.trim();
  if (trimmed.length < 2 || trimmed.length > 30) {
    res.status(400).json({ error: 'Username must be 2–30 characters.' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters.' });
    return;
  }

  const existing = stmtFindByUsername.get(trimmed) as DbUser | undefined;
  if (existing) {
    res.status(409).json({ error: 'Username already taken.' });
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  const result = stmtInsert.run(trimmed, hash);
  const token = jwt.sign({ userId: result.lastInsertRowid, username: trimmed }, SECRET, {
    expiresIn: '7d',
  });

  res.status(201).json({ token, username: trimmed });
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username?.trim() || !password) {
    res.status(400).json({ error: 'Username and password are required.' });
    return;
  }

  const user = stmtFindByUsername.get(username.trim()) as DbUser | undefined;
  if (!user) {
    res.status(401).json({ error: 'Invalid username or password.' });
    return;
  }

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    res.status(401).json({ error: 'Invalid username or password.' });
    return;
  }

  const token = jwt.sign({ userId: user.id, username: user.username }, SECRET, {
    expiresIn: '7d',
  });

  res.json({ token, username: user.username });
});

// ── HTTP + WebSocket server ───────────────────────────────────────
const server = createServer(app);

const wss = new WebSocketServer({
  server,
  verifyClient: (
    { req }: { req: IncomingMessage },
    callback: (res: boolean, code?: number, message?: string) => void
  ) => {
    try {
      const urlStr = req.url ?? '/';
      const params = new URLSearchParams(urlStr.includes('?') ? urlStr.split('?')[1] : '');
      const token = params.get('token');
      if (!token) { callback(false, 401, 'Unauthorized'); return; }
      const payload = jwt.verify(token, SECRET) as JwtPayload;
      (req as IncomingMessage & { jwtPayload?: JwtPayload }).jwtPayload = payload;
      callback(true);
    } catch {
      callback(false, 401, 'Unauthorized');
    }
  },
});

const clients = new Map<WebSocket, ClientInfo>();
const userSockets = new Map<number, WebSocket>(); // userId -> active socket

function broadcastUserCount() {
  const names = [...new Set(Array.from(clients.values()).map((c) => c.name))];
  const payload: UsersPayload = { type: 'users', count: names.length, names };
  const msg = JSON.stringify(payload);
  clients.forEach((_, ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const jwtPayload = (req as IncomingMessage & { jwtPayload?: JwtPayload }).jwtPayload;
  const clientId = randomUUID();
  const username = jwtPayload?.username ?? 'Anonymous';
  const userId = jwtPayload?.userId;

  // Kick existing session for this user
  if (userId !== undefined) {
    const existing = userSockets.get(userId);
    if (existing && existing.readyState === WebSocket.OPEN) {
      existing.close(4001, 'Signed in from another device');
    }
    userSockets.set(userId, ws);
  }

  clients.set(ws, { clientId, name: username });

  const init: InitPayload = { type: 'init', clientId };
  ws.send(JSON.stringify(init));

  broadcastUserCount();

  ws.on('close', () => {
    clients.delete(ws);
    if (userId !== undefined && userSockets.get(userId) === ws) {
      userSockets.delete(userId);
    }
    broadcastUserCount();
  });

  ws.on('message', (data: Buffer) => {
    let parsed: IncomingPayload;
    try {
      parsed = JSON.parse(data.toString()) as IncomingPayload;
    } catch {
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

    if (parsed.type === 'typing') {
      const info = clients.get(ws);
      const payload: TypingPayload = {
        type: 'typing',
        username: info?.name ?? 'Anonymous',
        isTyping: parsed.isTyping,
      };
      const msg = JSON.stringify(payload);
      clients.forEach((_, client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(msg);
        }
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}`);
});
