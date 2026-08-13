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

  // States for mentions & replies
  const [suggestions, setSuggestions] = useState([]);
  const [replyingTo, setReplyingTo] = useState(null);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [mentionSearchStart, setMentionSearchStart] = useState(-1);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
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
  const updateSuggestions = useCallback((val, selectionStart) => {
    const lastAtIndex = val.lastIndexOf('@', selectionStart - 1);
    if (lastAtIndex !== -1) {
      const textAfterAt = val.slice(lastAtIndex + 1, selectionStart);
      const hasSpace = /\s/.test(textAfterAt);
      const charBeforeAt = lastAtIndex > 0 ? val[lastAtIndex - 1] : '';
      const isPrecededByWordChar = /[a-zA-Z0-9_-]/.test(charBeforeAt);

      if (!hasSpace && !isPrecededByWordChar) {
        const query = textAfterAt.toLowerCase();
        const filtered = users.filter(
          (u) => u.toLowerCase().startsWith(query) && u.toLowerCase() !== username.toLowerCase()
        );
        if (filtered.length > 0) {
          setSuggestions(filtered);
          setMentionSearchStart(lastAtIndex);
          setShowSuggestions(true);
          setActiveSuggestionIndex(0);
          return;
        }
      }
    }
    setShowSuggestions(false);
    setSuggestions([]);
  }, [users, username]);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputVal(val);
    updateSuggestions(val, e.target.selectionStart);
  };

  const handleInputKeyUp = (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Backspace') {
      updateSuggestions(e.target.value, e.target.selectionStart);
    }
  };

  const insertMention = useCallback((targetUser) => {
    if (mentionSearchStart === -1) return;

    const textBeforeAt = inputVal.slice(0, mentionSearchStart);
    const textAfterCursor = inputVal.slice(inputRef.current?.selectionEnd || 0);
    const newVal = `${textBeforeAt}@${targetUser} ${textAfterCursor}`;
    setInputVal(newVal);
    setShowSuggestions(false);
    setSuggestions([]);

    const newCursorPos = textBeforeAt.length + targetUser.length + 2; // @ + name + space
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.selectionStart = inputRef.current.selectionEnd = newCursorPos;
      }
    }, 0);
  }, [inputVal, mentionSearchStart]);

  const handleRosterClick = useCallback((targetUser) => {
    const space = inputVal.endsWith(' ') || inputVal === '' ? '' : ' ';
    const newVal = `${inputVal}${space}@${targetUser} `;
    setInputVal(newVal);
    setShowSuggestions(false);
    setSuggestions([]);
    setMentionSearchStart(-1);
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.selectionStart = inputRef.current.selectionEnd = newVal.length;
      }
    }, 0);
  }, [inputVal]);

  function handleSend() {
    const text = inputVal.trim();
    if (!text || status !== WS_STATUS.CONNECTED) return;
    sendMessage(text, replyingTo);
    setInputVal('');
    setShowSuggestions(false);
    setSuggestions([]);
    setReplyingTo(null);
  }

  function handleKey(e) {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveSuggestionIndex((prev) => (prev + 1) % suggestions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveSuggestionIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(suggestions[activeSuggestionIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggestions(false);
        setSuggestions([]);
      }
      return;
    }

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
      <UsersList users={users} count={userCount} onUserClick={handleRosterClick} />

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
            <Message key={i} msg={msg} currentUser={username} onReply={setReplyingTo} />
          ))}
          <div ref={messagesEndRef} />
        </section>

        {/* Input */}
        <div className="message-bar-container">
          {replyingTo && (
            <div className="reply-preview-bar">
              <div className="reply-preview-bar__content">
                <span className="reply-preview-bar__label">Replying to @{replyingTo.username}</span>
                <span className="reply-preview-bar__text">{replyingTo.message}</span>
              </div>
              <button 
                className="reply-preview-bar__close" 
                onClick={() => setReplyingTo(null)}
                aria-label="Cancel reply"
              >
                ✕
              </button>
            </div>
          )}
          {showSuggestions && suggestions.length > 0 && (
            <ul className="mention-suggestions" role="listbox" aria-label="User suggestions">
              {suggestions.map((user, idx) => (
                <li
                  key={user}
                  className={`suggestion-item ${idx === activeSuggestionIndex ? 'suggestion-item--active' : ''}`}
                  onClick={() => insertMention(user)}
                  role="option"
                  aria-selected={idx === activeSuggestionIndex}
                >
                  <span className="user-dot" />
                  <span className="user-name">{user}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="message-bar">
            <input
              ref={inputRef}
              id="message-input"
              className="message-bar__input"
              type="text"
              placeholder="Type a message…"
              value={inputVal}
              maxLength={500}
              autoComplete="off"
              disabled={!isConnected}
              onChange={handleInputChange}
              onKeyDown={handleKey}
              onKeyUp={handleInputKeyUp}
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
        </div>
      </main>
    </div>
  );
}
