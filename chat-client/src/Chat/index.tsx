import { useState, useCallback, useRef, useEffect } from "react";
import { MessageSquare, LogOut, Send, Users } from "lucide-react";
import "./index.css";

type Message = {
  id: string;
  text: string;
  timestamp: string;
  senderId: string;
  senderName: string;
};

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "kicked";

type Reactions = Record<string, Record<string, string>>; // messageId -> username -> emoji

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8080";

const TYPING_TIMEOUT_MS = 1500;

const ROOMS = ['general', 'random', 'dev'] as const;
type Room = typeof ROOMS[number];

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

function useDebounce(fn: (text: string) => void, delay: number) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return useCallback((text: string) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => fn(text), delay);
  }, [fn, delay]);
}

function getAvatarColor(name: string): string {
  const colors = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#14b8a6'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function getInitials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

interface ChatProps {
  token: string;
  username: string;
  onLogout: () => void;
}

function Chat({ token, username, onLogout }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [clientId, setClientId] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [onlineCount, setOnlineCount] = useState(0);
  const [onlineNames, setOnlineNames] = useState<string[]>([]);
  const [showOnlineList, setShowOnlineList] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [currentRoom, setCurrentRoom] = useState<Room>('general');
  const [reactions, setReactions] = useState<Reactions>({});
  const [hoveredMsg, setHoveredMsg] = useState<string | null>(null);
  const [roomActivity, setRoomActivity] = useState<Record<Room, boolean>>({ general: false, random: false, dev: false });
  const [roomViewers, setRoomViewers] = useState<string[]>([]);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const currentRoomRef = useRef<Room>('general');
  const onlineListRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualClose = useRef(false);

  const notify = useCallback((title: string, body: string) => {
    if (Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
    new Notification(title, { body, icon: '/favicon.svg' });
  }, []);

  const connect = useCallback(() => {
    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      reconnectAttempts.current = 0;
      inputRef.current?.focus();
      // Re-join current room if not general (server defaults to general)
      if (currentRoomRef.current !== 'general') {
        ws.send(JSON.stringify({ type: 'join', room: currentRoomRef.current }));
      }
    };

    ws.onmessage = (event: MessageEvent) => {
      const data = JSON.parse(event.data as string);
      if (data.type === "history") {
        setMessages(data.messages as Message[]);
      } else if (data.type === "init") {
        setClientId(data.clientId as string);
      } else if (data.type === "message") {
        const msg = data as Message;
        setMessages((prev) => [...prev, msg]);
        notify(msg.senderName, msg.text);
        if (document.hidden) {
          setRoomActivity(prev => ({ ...prev, [currentRoomRef.current]: true }));
        }
      } else if (data.type === "room_viewers") {
        const { room, viewers } = data as { room: string; viewers: string[] };
        if (room === currentRoomRef.current) {
          setRoomViewers(viewers);
        }
      } else if (data.type === "users") {
        setOnlineCount(data.count as number);
        setOnlineNames(data.names as string[]);
      } else if (data.type === "typing") {
        const { username: typingUser, isTyping } = data as { username: string; isTyping: boolean };
        setTypingUsers((prev) =>
          isTyping ? (prev.includes(typingUser) ? prev : [...prev, typingUser]) : prev.filter((u) => u !== typingUser)
        );
      } else if (data.type === "reactions_bulk") {
        setReactions(data.reactions as Reactions);
      } else if (data.type === "reaction") {
        const { messageId, reactions: msgReactions } = data as { messageId: string; reactions: Record<string, string> };
        setReactions((prev) => ({ ...prev, [messageId]: msgReactions }));
      }
    };

    ws.onclose = (event) => {
      if (wsRef.current !== ws) return; // superseded connection, ignore
      if (manualClose.current) return;
      if (event.code === 4001) { setTimeout(onLogout, 1500); setStatus("kicked"); return; }
      if (event.code === 4002) { onLogout(); return; } // token expired
      setStatus("disconnected");
      const delay = Math.min(1000 * 2 ** reconnectAttempts.current, 30000);
      reconnectAttempts.current += 1;
      reconnectTimer.current = setTimeout(connect, delay);
    };

    ws.onerror = () => { ws.close(); };
  }, [token, notify, onLogout]);

  useEffect(() => {
    if (isTokenExpired(token)) {
      onLogout();
      return;
    }
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
    manualClose.current = false;
    connect();
    return () => {
      manualClose.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect, token, onLogout]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!showOnlineList) return;
    const handler = (e: MouseEvent) => {
      if (onlineListRef.current && !onlineListRef.current.contains(e.target as Node)) {
        setShowOnlineList(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showOnlineList]);

  const sendTyping = useCallback((isTyping: boolean) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "typing", isTyping }));
    }
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      sendTyping(true);
    }
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      isTypingRef.current = false;
      sendTyping(false);
    }, TYPING_TIMEOUT_MS);
  }, [sendTyping]);

  const sendMessage = useCallback((text: string) => {
    if (!text.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    if (isTypingRef.current) {
      isTypingRef.current = false;
      sendTyping(false);
    }
    wsRef.current.send(JSON.stringify({ type: "message", text }));
    setInput("");
    inputRef.current?.focus();
  }, [sendTyping]);

  const switchRoom = useCallback((room: Room) => {
    setCurrentRoom(room);
    currentRoomRef.current = room;
    setMessages([]);
    setTypingUsers([]);
    setReactions({});
    setRoomViewers([]);
    setRoomActivity(prev => ({ ...prev, [room]: false }));
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'join', room }));
    }
  }, []);

  const sendReaction = useCallback((messageId: string, emoji: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'reaction', messageId, emoji }));
    }
  }, []);

  const debouncedSend = useDebounce(sendMessage, 300);
  const handleSend = () => debouncedSend(input);

  return (
    <div className="chat" role="main">
      <div className="chat-header">
        <div className="chat-header-left">
          <div className="chat-avatar">
            <MessageSquare size={20} strokeWidth={2} />
          </div>
          <div>
            <div className="chat-title">ChatApp</div>
            <div className="chat-subtitle">Chatting as <strong>{username}</strong></div>
          </div>
        </div>
        <div className="chat-header-right">
          {status === "connected" && onlineCount > 1 && (
            <div className="online-count-wrapper" ref={onlineListRef}>
              <button
                className="online-count"
                onClick={() => setShowOnlineList((v) => !v)}
                aria-label="Show online users"
              >
                <Users size={13} strokeWidth={2.5} />
                {onlineCount > 1 ? `${onlineCount - 1} online` : "Just you"}
              </button>
              {showOnlineList && (
                <div className="online-list">
                  {onlineNames.filter((name) => name !== username).map((name) => (
                    <div key={name} className="online-list-item">
                      <span className="online-list-dot" />
                      {name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <button className="logout-btn" onClick={onLogout} aria-label="Sign out" title="Sign out">
            <LogOut size={16} strokeWidth={2} />
          </button>
        </div>
      </div>

      <div className="room-tabs">
        {ROOMS.map((room) => (
          <button
            key={room}
            className={`room-tab ${currentRoom === room ? 'active' : ''}`}
            onClick={() => switchRoom(room)}
          >
            # {room}
            {roomActivity[room] && <span className="room-badge" />}
          </button>
        ))}
      </div>

      <div className={`chat-status status-${status}`} aria-live="polite">
        {status === "connecting" && "Connecting to server..."}
        {status === "disconnected" && `Disconnected — reconnecting...`}
        {status === "kicked" && "Signed in from another device — please refresh to reconnect"}
      </div>

      <div
        className="chat-messages"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
        onScroll={(e) => {
          const el = e.currentTarget;
          const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
          setShowScrollBtn(distFromBottom > 150);
        }}
      >
        {messages.length === 0 ? (
          <div className="chat-empty">
            <MessageSquare size={48} strokeWidth={1.5} />
            <p>No messages yet. Say hello!</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isSent = msg.senderId === clientId || msg.senderName === username;
            const msgReactions = reactions[msg.id] ?? {};
            // Group reactions: emoji -> count
            const reactionGroups: Record<string, number> = {};
            Object.values(msgReactions).forEach((emoji) => {
              reactionGroups[emoji] = (reactionGroups[emoji] ?? 0) + 1;
            });
            const myReaction = msgReactions[username];

            return (
              <div
                key={msg.id}
                className={`message ${isSent ? "sent" : "received"}`}
                onMouseEnter={() => setHoveredMsg(msg.id)}
                onMouseLeave={() => setHoveredMsg(null)}
              >
                {!isSent && (
                  <div className="message-with-avatar">
                    <div className="avatar" style={{ background: getAvatarColor(msg.senderName) }}>
                      {getInitials(msg.senderName)}
                    </div>
                    <div>
                      <span className="sender-name">{msg.senderName}</span>
                      <div className="message-bubble">{msg.text}</div>
                      <span className="timestamp">{msg.timestamp}</span>
                    </div>
                  </div>
                )}
                {isSent && (
                  <>
                    <div className="message-bubble">{msg.text}</div>
                    <span className="timestamp">{msg.timestamp}</span>
                  </>
                )}
                {/* Reaction picker — shown on hover */}
                {hoveredMsg === msg.id && (
                  <div className={`reaction-picker ${isSent ? 'sent' : 'received'}`}>
                    {['👍', '❤️', '😂', '😮'].map((emoji) => (
                      <button
                        key={emoji}
                        className={`reaction-emoji ${myReaction === emoji ? 'active' : ''}`}
                        onClick={() => sendReaction(msg.id, emoji)}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
                {/* Reaction counts */}
                {Object.keys(reactionGroups).length > 0 && (
                  <div className={`reaction-counts ${isSent ? 'sent' : 'received'}`}>
                    {Object.entries(reactionGroups).map(([emoji, count]) => (
                      <button
                        key={emoji}
                        className={`reaction-count ${myReaction === emoji ? 'active' : ''}`}
                        onClick={() => sendReaction(msg.id, emoji)}
                      >
                        {emoji} {count}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
        {roomViewers.filter(v => v !== username).length > 0 && messages.length > 0 && (
          <div className="seen-by">
            <span className="seen-icon">✓✓</span>
            Seen by {roomViewers.filter(v => v !== username).join(', ')}
          </div>
        )}
        <div ref={messagesEndRef} />
        {showScrollBtn && (
          <button
            className="scroll-btn"
            onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
            aria-label="Scroll to bottom"
          >
            ↓
          </button>
        )}
      </div>

      {typingUsers.length > 0 && (
        <div className="typing-indicator" aria-live="polite">
          <span className="typing-dots"><span/><span/><span/></span>
          <span className="typing-text">
            {typingUsers.length === 1
              ? `${typingUsers[0]} is typing…`
              : `${typingUsers.slice(0, -1).join(", ")} and ${typingUsers[typingUsers.length - 1]} are typing…`}
          </span>
        </div>
      )}

      <div className="chat-input" role="form" aria-label="Send a message">
        <input
          ref={inputRef}
          value={input}
          onChange={handleInputChange}
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
          <Send size={18} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}

export default Chat;
