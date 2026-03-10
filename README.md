# ChatApp

A real-time chat application built with React, TypeScript, and WebSockets. Messages are broadcast instantly to all connected clients, with each user's messages visually distinguished from others.

## Features

- Real-time messaging via WebSocket
- Live online user count
- Sent vs. received message distinction (per session)
- Connection status indicator
- Debounced send to prevent spam
- Auto-scroll to latest message
- Accessible (ARIA roles, live regions)

## Tech Stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Frontend | React 19, TypeScript, Vite          |
| Backend  | Node.js, TypeScript, `ws`           |
| Protocol | WebSocket (RFC 6455)                |
| Styling  | Plain CSS (no framework)            |

## Project Structure

```
ChatApp/
├── chat-client/          # React frontend
│   ├── src/
│   │   ├── Chat/
│   │   │   ├── index.tsx   # Chat component + WebSocket client logic
│   │   │   └── index.css   # Component styles
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.css       # Global styles
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
│
└── chat-server/          # Node.js WebSocket server
    ├── src/
    │   └── index.ts        # WebSocket server
    ├── tsconfig.json
    └── package.json
```

## Prerequisites

- Node.js >= 18
- npm >= 9

## Getting Started

**1. Install dependencies for both packages:**

```bash
cd chat-server && npm install
cd ../chat-client && npm install
```

**2. Run the server:**

```bash
cd chat-server
npm run dev        # development (hot reload via tsx watch)
```

**3. Run the client (separate terminal):**

```bash
cd chat-client
npm run dev
```

Open `http://localhost:5173`. Open multiple tabs to chat between them.

## Scripts

### chat-server

| Command         | Description                                |
|-----------------|--------------------------------------------|
| `npm run dev`   | Start server with hot reload (`tsx watch`) |
| `npm run build` | Compile TypeScript to `dist/`              |
| `npm run start` | Run compiled server (`node dist/index.js`) |

### chat-client

| Command           | Description                        |
|-------------------|------------------------------------|
| `npm run dev`     | Start Vite dev server              |
| `npm run build`   | Type-check + production build      |
| `npm run preview` | Preview production build locally   |
| `npm run lint`    | Run ESLint                         |

## WebSocket Message Protocol

All messages are JSON. The server never exposes raw client IDs to other users — the client only uses its own `clientId` locally to distinguish sent vs. received.

### Server → Client

| Type      | Payload                                    | When                        |
|-----------|--------------------------------------------|-----------------------------|
| `init`    | `{ clientId: string }`                     | On connection               |
| `message` | `{ id, text, timestamp, senderId }`        | Broadcast on new message    |
| `users`   | `{ count: number }`                        | On any connect / disconnect |

### Client → Server

| Type      | Payload            |
|-----------|--------------------|
| `message` | `{ text: string }` |

## Production Deployment

### Server

```bash
cd chat-server
npm run build
npm run start      # runs dist/index.js on port 8080
```

Set the `PORT` environment variable to override the default (`8080`).

### Client

```bash
cd chat-client
npm run build      # outputs to chat-client/dist/
```

Serve the `dist/` folder with any static host (Vercel, Netlify, Nginx, etc.).

Update `WS_URL` in `chat-client/src/Chat/index.tsx` to point to your deployed server before building.

## Environment

The WebSocket server port defaults to `8080`. To change it:

```bash
PORT=9000 npm run start
```

The client WebSocket URL is hardcoded in `chat-client/src/Chat/index.tsx`:

```ts
const WS_URL = "ws://localhost:8080";
```

Update this to your production server URL before deploying the client.
