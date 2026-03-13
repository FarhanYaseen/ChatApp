import { useState, useEffect } from "react";
import { Sun, Moon } from "lucide-react";
import Auth from "./Auth";
import Chat from "./Chat";

const TOKEN_KEY = "chat_token";
const USERNAME_KEY = "chat_username";

function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [username, setUsername] = useState<string | null>(() => localStorage.getItem(USERNAME_KEY));
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  const handleAuth = (newToken: string, newUsername: string) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USERNAME_KEY, newUsername);
    setToken(newToken);
    setUsername(newUsername);
  };

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USERNAME_KEY);
    setToken(null);
    setUsername(null);
  };

  if (!token || !username) {
    return (
      <>
        <Auth onAuth={handleAuth} />
        <button className="theme-toggle" onClick={() => setDark(d => !d)} aria-label="Toggle dark mode">
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </>
    );
  }

  return (
    <>
      <Chat token={token} username={username} onLogout={handleLogout} />
      <button className="theme-toggle" onClick={() => setDark(d => !d)} aria-label="Toggle dark mode">
        {dark ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    </>
  );
}

export default App;
