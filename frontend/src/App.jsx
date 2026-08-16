import { useState, useEffect } from 'react';
import Login from './components/Login';
import ChatRoom from './components/ChatRoom';
import { getSavedSession, saveSession, clearSession } from './hooks/useSession';

const VIEW = { LOADING: 'loading', LOGIN: 'login', CHAT: 'chat' };

export default function App() {
  const [view, setView]         = useState(VIEW.LOADING);
  const [userId, setUserId]     = useState(null);
  const [displayName, setDisplayName] = useState(null);
  const [authToken, setAuthToken] = useState(null);
  const [theme, setTheme]       = useState(() => localStorage.getItem('chat_theme') || 'dark');

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
      setUserId(saved.userId);
      setDisplayName(saved.displayName);
      setAuthToken(saved.authToken);
      setView(VIEW.CHAT);
    } else {
      setView(VIEW.LOGIN);
    }
  }, []);

  function handleJoin(uid, dname, token) {
    saveSession(uid, dname, token);
    setUserId(uid);
    setDisplayName(dname);
    setAuthToken(token);
    setView(VIEW.CHAT);
  }

  function handleLeave() {
    clearSession();
    setUserId(null);
    setDisplayName(null);
    setAuthToken(null);
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
      username={displayName || userId} // display name preferred for chat
      authToken={authToken}
      onLeave={handleLeave}
      theme={theme}
      onToggleTheme={toggleTheme}
    />
  );
}
