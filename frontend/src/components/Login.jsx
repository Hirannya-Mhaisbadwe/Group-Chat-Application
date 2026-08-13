import { useState, useRef } from 'react';

export default function Login({ onJoin, theme, onToggleTheme }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please enter a username.');
      inputRef.current?.focus();
      return;
    }
    if (trimmed.length > 20) {
      setError('Username must be 20 characters or fewer.');
      return;
    }
    onJoin(trimmed);
  }

  return (
    <div className="login-wrapper">
      {/* Theme toggle — top-right */}
      <button
        id="theme-toggle-login"
        className="btn--theme login-theme-toggle"
        onClick={onToggleTheme}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-label="Toggle theme"
      >
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>

      <div className="login-card">
        <img src="/logo.png" alt="NexChat Logo" className="login-logo" />
        <h1 className="login-title">Welcome to NexChat</h1>
        <p className="login-subtitle">Real-time messaging, instantly.</p>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <input
            id="username-input"
            ref={inputRef}
            className={`login-input ${error ? 'login-input--error' : ''}`}
            type="text"
            placeholder="Choose a username…"
            value={name}
            maxLength={20}
            autoComplete="off"
            autoFocus
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError('');
            }}
          />
          {error && <p className="login-error">{error}</p>}

          <button id="join-btn" className="btn btn--primary btn--full" type="submit">
            Join Chat
          </button>
        </form>

        <p className="login-hint">Your session stays active for 5 minutes after you close the tab.</p>
      </div>
    </div>
  );
}

