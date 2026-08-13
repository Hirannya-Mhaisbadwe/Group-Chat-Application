import { useState, useEffect } from 'react';
import Login from './components/Login';
import ChatRoom from './components/ChatRoom';
import { getSavedSession, saveSession, clearSession } from './hooks/useSession';

// App states
const VIEW = {
  LOADING: 'loading',
  LOGIN: 'login',
  CHAT: 'chat',
};

export default function App() {
  const [view, setView] = useState(VIEW.LOADING);
  const [username, setUsername] = useState(null);
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('chat_theme') || 'dark';
  });

  // Apply data-theme attribute to <html> whenever theme changes
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('chat_theme', theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }
  useEffect(() => {
    const saved = getSavedSession();
    if (saved) {
      setUsername(saved.username);
      setView(VIEW.CHAT);
    } else {
      setView(VIEW.LOGIN);
    }
  }, []);
  function handleJoin(name) {
    saveSession(name);
    setUsername(name);
    setView(VIEW.CHAT);
  }
  function handleLeave() {
    clearSession();
    setUsername(null);
    setView(VIEW.LOGIN);
  }

  if (view === VIEW.LOADING) {
    return (
      <div className="splash">
        <div className="spinner" />
      </div>
    );
  }

  if (view === VIEW.LOGIN) {
    return <Login onJoin={handleJoin} theme={theme} onToggleTheme={toggleTheme} />;
  }

  return (
    <ChatRoom
      username={username}
      onLeave={handleLeave}
      theme={theme}
      onToggleTheme={toggleTheme}
    />
  );
}

