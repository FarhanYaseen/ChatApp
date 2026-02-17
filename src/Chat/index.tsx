import { useState, useCallback, useRef } from "react";
import "./index.css";

type Message = {
  text: string;
  timestamp: string;
  type: "sender" | "receiver";
};

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
  const [mode, setMode] = useState<"sender" | "receiver">("sender");

  const addMessage = (text: string) => {
    if (!text.trim()) return;
    const newMessage: Message = {
      text,
      timestamp: new Date().toLocaleTimeString(),
      type: mode,
    };
    setMessages((prev) => [...prev, newMessage]);
    setInput("");
  };

  const debouncedSend = useDebounce(addMessage, 300);

  const handleSend = () => {
    debouncedSend(input);
  };

  return (
    <div className="chat">
      <div className="chat-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.type === "sender" ? "sent" : "received"}`}>
            <p>{msg.text}</p>
            <span className="timestamp">{msg.timestamp}</span>
          </div>
        ))}
      </div>
      <div className="chat-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Type a message..."
        />
        <select value={mode} onChange={(e) => setMode(e.target.value as "sender" | "receiver")}>
          <option value="sender">Sender</option>
          <option value="receiver">Receiver</option>
        </select>
        <button onClick={handleSend}>Send</button>
      </div>
    </div>
  );
}

export default Chat;
