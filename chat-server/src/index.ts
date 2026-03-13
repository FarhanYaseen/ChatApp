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

db.exec(`
  CREATE TABLE IF NOT EXISTS reactions (
    message_id TEXT NOT NULL,
    username TEXT NOT NULL,
    emoji TEXT NOT NULL,
    PRIMARY KEY (message_id, username)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    room TEXT NOT NULL DEFAULT 'general',
    text TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const stmtInsert = db.prepare<[string, string]>(
  'INSERT INTO users (username, password_hash) VALUES (?, ?)'
);
const stmtFindByUsername = db.prepare<[string]>(
  'SELECT id, username, password_hash FROM users WHERE username = ?'
);
const stmtInsertMessage = db.prepare<[string, string, string, string, string, string]>(
  'INSERT INTO messages (id, room, text, sender_id, sender_name, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
);
const stmtFetchMessages = db.prepare<[string]>(
  'SELECT id, room, text, sender_id, sender_name, timestamp FROM messages WHERE room = ? ORDER BY created_at DESC LIMIT 50'
);
const stmtGetReaction = db.prepare<[string, string]>(
  'SELECT emoji FROM reactions WHERE message_id = ? AND username = ?'
);
const stmtUpsertReaction = db.prepare<[string, string, string]>(
  'INSERT OR REPLACE INTO reactions (message_id, username, emoji) VALUES (?, ?, ?)'
);
const stmtDeleteReaction = db.prepare<[string, string]>(
  'DELETE FROM reactions WHERE message_id = ? AND username = ?'
);
const stmtFetchMessageReactions = db.prepare<[string]>(
  'SELECT username, emoji FROM reactions WHERE message_id = ?'
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
  room: string;
}

interface IncomingJoin {
  type: 'join';
  room: string;
}

interface IncomingMessage2 {
  type: 'message';
  text: string;
}

interface IncomingTyping {
  type: 'typing';
  isTyping: boolean;
}

interface IncomingReaction {
  type: 'reaction';
  messageId: string;
  emoji: string;
}

interface ReactionPayload {
  type: 'reaction';
  messageId: string;
  reactions: Record<string, string>;
}

interface RoomViewersPayload {
  type: 'room_viewers';
  room: string;
  viewers: string[];
}

type IncomingPayload = IncomingJoin | IncomingMessage2 | IncomingTyping | IncomingReaction;

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

interface HistoryPayload {
  type: 'history';
  messages: BroadcastPayload[];
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

interface DbMessage {
  id: string;
  room: string;
  text: string;
  sender_id: string;
  sender_name: string;
  timestamp: string;
}

interface DbReaction {
  username: string;
  emoji: string;
}

function fetchReactionsBulk(messageIds: string[]): Record<string, Record<string, string>> {
  if (messageIds.length === 0) return {};
  const placeholders = messageIds.map(() => '?').join(', ');
  const rows = db.prepare(
    `SELECT message_id, username, emoji FROM reactions WHERE message_id IN (${placeholders})`
  ).all(...messageIds) as Array<{ message_id: string; username: string; emoji: string }>;
  const result: Record<string, Record<string, string>> = {};
  rows.forEach((r) => {
    if (!result[r.message_id]) result[r.message_id] = {};
    result[r.message_id][r.username] = r.emoji;
  });
  return result;
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

// GET /health
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    connections: clients.size,
  });
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
    } catch (err) {
      const isExpired = err instanceof Error && err.name === 'TokenExpiredError';
      callback(false, isExpired ? 4002 : 401, isExpired ? 'Token expired' : 'Unauthorized');
    }
  },
});

const clients = new Map<WebSocket, ClientInfo>();
const userSockets = new Map<number, WebSocket>(); // userId -> active socket
const clientAlive = new Map<WebSocket, boolean>();

// room -> Set of usernames currently viewing that room
const roomViewers = new Map<string, Set<string>>();

function getRoomViewers(room: string): string[] {
  return Array.from(roomViewers.get(room) ?? []);
}

function addRoomViewer(room: string, username: string) {
  if (!roomViewers.has(room)) roomViewers.set(room, new Set());
  roomViewers.get(room)!.add(username);
}

function removeRoomViewer(room: string, username: string) {
  roomViewers.get(room)?.delete(username);
}

function broadcastRoomViewers(room: string) {
  const viewers = getRoomViewers(room);
  const payload = JSON.stringify({ type: 'room_viewers', room, viewers });
  clients.forEach((info, ws) => {
    if (info.room === room && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  });
}

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

  clients.set(ws, { clientId, name: username, room: 'general' });
  clientAlive.set(ws, true);

  addRoomViewer('general', username);
  broadcastRoomViewers('general');

  // Send message history before the init payload
  const rawMessages = stmtFetchMessages.all('general') as DbMessage[];
  const historyMessages: BroadcastPayload[] = rawMessages.reverse().map((m) => ({
    type: 'message',
    id: m.id,
    text: m.text,
    timestamp: m.timestamp,
    senderId: m.sender_id,
    senderName: m.sender_name,
  }));
  const historyPayload: HistoryPayload = { type: 'history', messages: historyMessages };
  ws.send(JSON.stringify(historyPayload));

  const reactionsBulk = fetchReactionsBulk(historyMessages.map((m) => m.id));
  if (Object.keys(reactionsBulk).length > 0) {
    ws.send(JSON.stringify({ type: 'reactions_bulk', reactions: reactionsBulk }));
  }

  const init: InitPayload = { type: 'init', clientId };
  ws.send(JSON.stringify(init));

  broadcastUserCount();

  ws.on('pong', () => {
    clientAlive.set(ws, true);
  });

  ws.on('close', () => {
    const room = clients.get(ws)?.room ?? 'general';
    clients.delete(ws);
    clientAlive.delete(ws);
    if (userId !== undefined && userSockets.get(userId) === ws) {
      userSockets.delete(userId);
    }
    removeRoomViewer(room, username);
    broadcastRoomViewers(room);
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
      const newRoom = parsed.room;
      const info = clients.get(ws);
      const oldRoom = info?.room ?? 'general';
      if (info) {
        info.room = newRoom;
        clients.set(ws, info);
      }
      // Update room viewers
      removeRoomViewer(oldRoom, username);
      broadcastRoomViewers(oldRoom);
      addRoomViewer(newRoom, username);

      const roomMessages = stmtFetchMessages.all(newRoom) as DbMessage[];
      const historyMessages: BroadcastPayload[] = roomMessages.reverse().map((m) => ({
        type: 'message',
        id: m.id,
        text: m.text,
        timestamp: m.timestamp,
        senderId: m.sender_id,
        senderName: m.sender_name,
      }));
      const historyPayload: HistoryPayload = { type: 'history', messages: historyMessages };
      ws.send(JSON.stringify(historyPayload));

      const reactionsBulk = fetchReactionsBulk(historyMessages.map((m) => m.id));
      ws.send(JSON.stringify({ type: 'reactions_bulk', reactions: reactionsBulk }));
      broadcastRoomViewers(newRoom);
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

      // Persist message to DB
      stmtInsertMessage.run(
        broadcast.id,
        info?.room ?? 'general',
        broadcast.text,
        broadcast.senderId,
        broadcast.senderName,
        broadcast.timestamp
      );

      clients.forEach((clientInfo, client) => {
        if (clientInfo.room === (info?.room ?? 'general') && client.readyState === WebSocket.OPEN) {
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
      clients.forEach((clientInfo, client) => {
        if (client !== ws && clientInfo.room === (info?.room ?? 'general') && client.readyState === WebSocket.OPEN) {
          client.send(msg);
        }
      });
    }

    if (parsed.type === 'reaction') {
      const { messageId, emoji } = parsed;
      const info = clients.get(ws);
      const uname = info?.name ?? 'Anonymous';

      const existing = stmtGetReaction.get(messageId, uname) as { emoji: string } | undefined;
      if (existing?.emoji === emoji) {
        stmtDeleteReaction.run(messageId, uname);
      } else {
        stmtUpsertReaction.run(messageId, uname, emoji);
      }

      const msgReactions = stmtFetchMessageReactions.all(messageId) as DbReaction[];
      const reactionsMap: Record<string, string> = {};
      msgReactions.forEach((r) => { reactionsMap[r.username] = r.emoji; });

      const payload: ReactionPayload = {
        type: 'reaction',
        messageId,
        reactions: reactionsMap,
      };
      clients.forEach((_, client) => {
        if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(payload));
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}`);
});

// ── WebSocket Heartbeat ───────────────────────────────────────────
setInterval(() => {
  clients.forEach((_, ws) => {
    if (clientAlive.get(ws) === false) {
      ws.terminate();
      return;
    }
    clientAlive.set(ws, false);
    ws.ping();
  });
}, 30000);
