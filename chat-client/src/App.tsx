import { useState } from "react";
import Auth from "./Auth";
import Chat from "./Chat";

const TOKEN_KEY = "chat_token";
const USERNAME_KEY = "chat_username";

function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [username, setUsername] = useState<string | null>(() => localStorage.getItem(USERNAME_KEY));

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
    return <Auth onAuth={handleAuth} />;
  }

  return <Chat token={token} username={username} onLogout={handleLogout} />;
}

export default App;
