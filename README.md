# ChatApp

A full-stack real-time chat application built with React, TypeScript, Node.js, and WebSockets — featuring JWT authentication, multiple chat rooms, message reactions, read receipts, typing indicators, and dark mode.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-chat--app--lilac--iota.vercel.app-6366f1?style=for-the-badge&logo=vercel)](https://chat-app-lilac-iota.vercel.app/)
[![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript)](https://typescriptlang.org)
[![Node.js](https://img.shields.io/badge/Node.js-22-339933?style=flat-square&logo=node.js)](https://nodejs.org)

---

## Live Demo

**URL:** https://chat-app-lilac-iota.vercel.app/

> Open the app in **two different browser tabs or windows** to see real-time messaging in action.

**Demo credentials:**
- Username: `booker@salesman.com`
- Password: `booker@salesman.com`

---

## Screenshots

| Login Screen | Chat Interface |
|:---:|:---:|
| ![Login](docs/screenshots/login.png) | ![Chat](docs/screenshots/chat.png) |

---

## Video Demo

[![Watch Demo](https://img.shields.io/badge/Watch%20Demo-Loom-00C4C4?style=for-the-badge&logo=loom)](https://www.loom.com/share/6383040d3cd2439fb824263ac8c7102f)

---

## Features

### Messaging
- **Real-time messaging** — instant delivery via WebSocket (RFC 6455), no polling
- **Message history** — last 50 messages per room loaded on connect, persisted in SQLite
- **Multiple rooms** — switch between `#general`, `#random`, `#dev` with per-room history
- **Message reactions** — 👍 ❤️ 😂 😮 emoji reactions, persisted to DB, toggle on/off
- **Typing indicator** — live animated dots when others are composing
- **Unread activity badge** — red dot on room tabs when new messages arrive while away

### Users & Presence
- **Online presence** — live count and list of connected users (excludes yourself)
- **Read receipts** — "✓✓ Seen by" shows who is currently viewing the same room
- **User avatars** — colored initials avatar, deterministically generated per username
- **Single-session enforcement** — logging in from a new device logs out the old one automatically

### Auth & Security
- **JWT authentication** — register / login with bcrypt-hashed passwords
- **Token expiry handling** — auto-logout when JWT expires
- **Rate limiting** — auth endpoints protected against brute-force (10 req / 15 min)
- **Session persistence** — token stored in `localStorage`, auto-login on revisit

### UX & Polish
- **Dark mode** — toggle with persistent preference saved to `localStorage`
- **Reconnect with backoff** — auto-reconnects on disconnect, exponential backoff up to 30s
- **Browser notifications** — desktop notifications when tab is not focused
- **Scroll-to-bottom button** — appears when scrolled up, jumps to latest message
- **Connection status banners** — connecting / disconnected / kicked states

### Infrastructure
- **WebSocket heartbeat** — ping/pong every 30s, dead connections auto-terminated
- **Health check endpoint** — `GET /health` returns uptime and connection count
- **Docker** — multi-stage Dockerfile for lean production image
- **Deployed** — frontend on Vercel, backend on Railway

---

## Tech Stack

| Layer      | Technology                                          |
|------------|-----------------------------------------------------|
| Frontend   | React 19, TypeScript, Vite, Lucide React            |
| Backend    | Node.js, Express 5, TypeScript                      |
| Protocol   | WebSocket (`ws` library, RFC 6455)                  |
| Auth       | JWT (`jsonwebtoken`) + bcrypt (`bcryptjs`)           |
| Database   | SQLite (`better-sqlite3`)                           |
| Styling    | Plain CSS (no framework), CSS custom properties     |
| Deployment | Vercel (frontend) + Railway + Docker (backend)      |

---

## Project Structure

```
ChatApp/
├── chat-client/               # React + Vite frontend
│   ├── src/
│   │   ├── Auth/              # Login & register UI
│   │   ├── Chat/              # Chat UI + WebSocket client
│   │   ├── App.tsx            # Root — dark mode toggle
│   │   └── index.css          # Global styles & CSS variables
│   ├── public/
│   │   └── favicon.svg        # Custom SVG favicon
│   ├── vercel.json            # SPA rewrite rules
│   └── .env.example
│
└── chat-server/               # Node.js backend
    ├── src/
    │   └── index.ts           # Express + WebSocket server
    ├── Dockerfile             # Multi-stage production build
    └── .env.example
```

---

## WebSocket Message Protocol

All messages are JSON. The server never exposes raw client IDs to other users.

### Server → Client

| Type              | Payload                                                        | When                            |
|-------------------|----------------------------------------------------------------|---------------------------------|
| `history`         | `{ messages: Message[] }`                                      | On connect / room switch        |
| `init`            | `{ clientId: string }`                                         | After history on connect        |
| `message`         | `{ id, text, timestamp, senderId, senderName }`                | Broadcast to room               |
| `users`           | `{ count: number, names: string[] }`                           | On any connect / disconnect     |
| `typing`          | `{ username: string, isTyping: boolean }`                      | Broadcast to room               |
| `reaction`        | `{ messageId: string, reactions: Record<string, string> }`     | Broadcast to all                |
| `reactions_bulk`  | `{ reactions: Record<string, Record<string, string>> }`        | On connect / room switch        |
| `room_viewers`    | `{ room: string, viewers: string[] }`                          | On any room join / leave        |

### Client → Server

| Type       | Payload                              |
|------------|--------------------------------------|
| `message`  | `{ text: string }`                   |
| `typing`   | `{ isTyping: boolean }`              |
| `join`     | `{ room: string }`                   |
| `reaction` | `{ messageId: string, emoji: string }`|

### Custom WebSocket Close Codes

| Code   | Meaning                        |
|--------|--------------------------------|
| `4001` | Signed in from another device  |
| `4002` | JWT token expired              |

---

## Getting Started

### Prerequisites

- Node.js >= 18
- npm >= 9

### 1. Clone & install

```bash
git clone https://github.com/FarhanYaseen/ChatApp.git
cd ChatApp

cd chat-server && npm install
cd ../chat-client && npm install
```

### 2. Configure environment

```bash
# chat-server/.env
JWT_SECRET=your-secret-here
PORT=8080
NODE_ENV=development
ALLOWED_ORIGIN=http://localhost:5173
```

```bash
# chat-client/.env.local
VITE_API_URL=http://localhost:8080
VITE_WS_URL=ws://localhost:8080
```

### 3. Run

```bash
# Terminal 1 — backend
cd chat-server && npm run dev

# Terminal 2 — frontend
cd chat-client && npm run dev
```

Open `http://localhost:5173`. Open multiple tabs to chat between them.

---

## Deployment

| Part     | Platform | Notes                                           |
|----------|----------|-------------------------------------------------|
| Frontend | Vercel   | Root directory: `chat-client`                   |
| Backend  | Railway  | Root directory: `chat-server`, uses Dockerfile  |

### Environment variables

**Vercel (frontend):**
```
VITE_API_URL=https://your-backend.railway.app
VITE_WS_URL=wss://your-backend.railway.app
```

**Railway (backend):**
```
JWT_SECRET=<long random string>
NODE_ENV=production
ALLOWED_ORIGIN=https://your-app.vercel.app
```

---

## Author

**Farhan Yaseen**
- Portfolio: [farhanyaseen.netlify.app](https://farhanyaseen.netlify.app/)
- LinkedIn: [linkedin.com/in/Farhanyaseen](https://linkedin.com/in/Farhanyaseen)
- Email: farhan.yaseen.se@gmail.com
