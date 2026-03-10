import { useState, useCallback, useRef, useEffect } from "react";
import "./index.css";

type Message = {
  id: string;
  text: string;
  timestamp: string;
  senderId: string;
  senderName: string;
};

type ConnectionStatus = "connecting" | "connected" | "disconnected";

const WS_URL = "ws://localhost:8080";

function useDebounce(fn: (text: string) => void, delay: number) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return useCallback((text: string) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => fn(text), delay);
  }, [fn, delay]);
}

function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [clientId, setClientId] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [onlineCount, setOnlineCount] = useState(0);
  const [name, setName] = useState("");
  const [hasJoined, setHasJoined] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      nameInputRef.current?.focus();
    };

    ws.onmessage = (event: MessageEvent) => {
      const data = JSON.parse(event.data as string);
      if (data.type === "init") {
        setClientId(data.clientId as string);
      } else if (data.type === "message") {
        setMessages((prev) => [...prev, data as Message]);
      } else if (data.type === "users") {
        setOnlineCount(data.count as number);
      }
    };

    ws.onclose = () => setStatus("disconnected");
    ws.onerror = () => setStatus("disconnected");

    return () => ws.close();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleJoin = () => {
    const trimmed = name.trim();
    if (!trimmed || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "join", name: trimmed }));
    setHasJoined(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const sendMessage = useCallback((text: string) => {
    if (!text.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "message", text }));
    setInput("");
    inputRef.current?.focus();
  }, []);

  const debouncedSend = useDebounce(sendMessage, 300);
  const handleSend = () => debouncedSend(input);

  // ── Name entry screen ──────────────────────────────────────────
  if (!hasJoined) {
    return (
      <div className="chat" role="main">
        <div className="chat-header">
          <div className="chat-header-left">
            <div className="chat-avatar">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div>
              <div className="chat-title">ChatApp</div>
              <div className="chat-subtitle">Real-time messaging</div>
            </div>
          </div>
        </div>

        <div className="join-screen">
          <div className="join-card">
            <div className="join-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <h2 className="join-title">What's your name?</h2>
            <p className="join-subtitle">This is how others will see you in the chat.</p>
            <input
              ref={nameInputRef}
              className="join-input"
              type="text"
              placeholder="Enter your name..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              maxLength={30}
              autoComplete="off"
            />
            <button
              className="join-btn"
              onClick={handleJoin}
              disabled={!name.trim() || status !== "connected"}
            >
              {status === "connecting" ? "Connecting..." : "Join Chat"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Chat screen ────────────────────────────────────────────────
  return (
    <div className="chat" role="main">
      <div className="chat-header">
        <div className="chat-header-left">
          <div className="chat-avatar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div>
            <div className="chat-title">ChatApp</div>
            <div className="chat-subtitle">Chatting as <strong>{name}</strong></div>
          </div>
        </div>
        {status === "connected" && (
          <span className="online-count" aria-live="polite">
            <span className="online-dot" />
            {onlineCount} online
          </span>
        )}
      </div>

      <div className={`chat-status status-${status}`} aria-live="polite">
        {status === "connecting" && "Connecting to server..."}
        {status === "disconnected" && "Disconnected — please refresh"}
      </div>

      <div
        className="chat-messages"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {messages.length === 0 ? (
          <div className="chat-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <p>No messages yet. Say hello!</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isSent = msg.senderId === clientId;
            return (
              <div key={msg.id} className={`message ${isSent ? "sent" : "received"}`}>
                {!isSent && <span className="sender-name">{msg.senderName}</span>}
                <div className="message-bubble">{msg.text}</div>
                <span className="timestamp">{msg.timestamp}</span>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input" role="form" aria-label="Send a message">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Type a message..."
          aria-label="Message input"
          autoComplete="off"
          disabled={status !== "connected"}
        />
        <button
          className="send-btn"
          onClick={handleSend}
          aria-label="Send message"
          disabled={status !== "connected"}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default Chat;
