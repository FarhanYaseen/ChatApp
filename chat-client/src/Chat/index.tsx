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

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8080";

const TYPING_TIMEOUT_MS = 1500;

function useDebounce(fn: (text: string) => void, delay: number) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return useCallback((text: string) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => fn(text), delay);
  }, [fn, delay]);
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
  const onlineListRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  useEffect(() => {
    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      inputRef.current?.focus();
    };

    ws.onmessage = (event: MessageEvent) => {
      const data = JSON.parse(event.data as string);
      if (data.type === "init") {
        setClientId(data.clientId as string);
      } else if (data.type === "message") {
        setMessages((prev) => [...prev, data as Message]);
      } else if (data.type === "users") {
        setOnlineCount(data.count as number);
        setOnlineNames(data.names as string[]);
      } else if (data.type === "typing") {
        const { username: typingUser, isTyping } = data as { username: string; isTyping: boolean };
        setTypingUsers((prev) =>
          isTyping ? (prev.includes(typingUser) ? prev : [...prev, typingUser]) : prev.filter((u) => u !== typingUser)
        );
      }
    };

    ws.onclose = (event) => {
      setStatus(event.code === 4001 ? "kicked" : "disconnected");
    };
    ws.onerror = () => setStatus("disconnected");

    return () => ws.close();
  }, [token]);

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
          {status === "connected" && (
            <div className="online-count-wrapper" ref={onlineListRef}>
              <button
                className="online-count"
                onClick={() => setShowOnlineList((v) => !v)}
                aria-label="Show online users"
              >
                <Users size={13} strokeWidth={2.5} />
                {onlineCount} online
              </button>
              {showOnlineList && (
                <div className="online-list">
                  {onlineNames.map((name) => (
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

      <div className={`chat-status status-${status}`} aria-live="polite">
        {status === "connecting" && "Connecting to server..."}
        {status === "disconnected" && "Disconnected — please refresh"}
        {status === "kicked" && "Signed in from another device — please refresh to reconnect"}
      </div>

      <div
        className="chat-messages"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {messages.length === 0 ? (
          <div className="chat-empty">
            <MessageSquare size={48} strokeWidth={1.5} />
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
