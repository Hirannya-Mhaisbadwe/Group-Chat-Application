import { useState, useEffect, useRef, useCallback } from 'react';
import { useWebSocket, WS_STATUS } from '../hooks/useWebSocket';
import UsersList from './UsersList';
import Message from './Message';
import { refreshSession } from '../hooks/useSession';

export default function ChatRoom({ username, onLeave, theme, onToggleTheme }) {
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [userCount, setUserCount] = useState(0);
  const [inputVal, setInputVal] = useState('');
  const [isReplaced, setIsReplaced] = useState(false);

  const messagesEndRef = useRef(null);
  const handleMessage = useCallback((data) => {
    if (data.type === 'message' || data.type === 'system') {
      setMessages((prev) => [...prev, data]);
    } else if (data.type === 'users') {
      setUsers(data.users);
      setUserCount(data.count);
    }
  }, []);

  const handleReplaced = useCallback(() => {
    setIsReplaced(true);
  }, []);

  const { status, sendMessage, leaveChat } = useWebSocket(username, {
    onMessage: handleMessage,
    onReplaced: handleReplaced,
    onDisconnected: () => {
      setMessages((prev) => [
        ...prev,
        { type: 'system', message: 'Connection lost. Please refresh.' },
      ]);
    },
  });
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  useEffect(() => {
    const interval = setInterval(refreshSession, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, []);
  function handleSend() {
    const text = inputVal.trim();
    if (!text || status !== WS_STATUS.CONNECTED) return;
    sendMessage(text);
    setInputVal('');
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }
  function handleLeave() {
    leaveChat();
    onLeave();
  }
  if (isReplaced) {
    return (
      <div className="replaced-screen">
        <div className="replaced-card">
          <div className="replaced-icon">🔄</div>
          <h2>Tab replaced</h2>
          <p>You opened this chat in another tab. Switch to that tab or reload here to reconnect.</p>
          <button
            id="reload-btn"
            className="btn btn--primary"
            onClick={() => window.location.reload()}
          >
            Reconnect here
          </button>
        </div>
      </div>
    );
  }

  const isConnected = status === WS_STATUS.CONNECTED;

  return (
    <div className="app-layout">
      <UsersList users={users} count={userCount} />

      <main className="chat-panel">
        {/* Header */}
        <header className="chat-header">
          <div className="chat-header__left">
            <h2 className="chat-header__title">NexChat</h2>
            <span className={`status-badge ${isConnected ? 'status-badge--connected' : 'status-badge--disconnected'}`}>
              {isConnected ? '● Connected' : '● Disconnected'}
            </span>
          </div>
          <div className="chat-header__actions">
            <button
              id="theme-toggle-chat"
              className="btn--theme"
              onClick={onToggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <button
              id="leave-btn"
              className="btn btn--danger"
              onClick={handleLeave}
            >
              Leave Chat
            </button>
          </div>
        </header>


        {/* Messages */}
        <section className="messages" id="messages-container" aria-live="polite">
          {messages.length === 0 && (
            <div className="messages__empty">
              <span>👋</span>
              <p>You just joined. Say hello!</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <Message key={i} msg={msg} currentUser={username} />
          ))}
          <div ref={messagesEndRef} />
        </section>

        {/* Input */}
        <div className="message-bar">
          <input
            id="message-input"
            className="message-bar__input"
            type="text"
            placeholder="Type a message…"
            value={inputVal}
            maxLength={500}
            autoComplete="off"
            disabled={!isConnected}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={handleKey}
          />
          <button
            id="send-btn"
            className="btn btn--primary"
            disabled={!isConnected || !inputVal.trim()}
            onClick={handleSend}
          >
            Send
          </button>
        </div>
      </main>
    </div>
  );
}
