import { useState, useRef } from 'react';
import { login, register } from '../hooks/useAuth';

export default function Login({ onJoin, theme, onToggleTheme }) {
  const [tab, setTab] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const usernameRef = useRef(null);

  function resetForm() {
    setUsername('');
    setPassword('');
    setConfirmPassword('');
    setError('');
  }

  function switchTab(t) {
    setTab(t);
    resetForm();
    setTimeout(() => usernameRef.current?.focus(), 50);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmedUser = username.trim();

    if (!trimmedUser) return setError('Username is required.');
    if (trimmedUser.length > 20) return setError('Username must be 20 characters or fewer.');
    if (!password) return setError('Password is required.');
    if (password.length < 6) return setError('Password must be at least 6 characters.');

    if (tab === 'register') {
      if (password !== confirmPassword) return setError('Passwords do not match.');
    }

    setLoading(true);
    setError('');

    try {
      if (tab === 'register') {
        await register(trimmedUser, password);
        // Auto-login after register
        const { username: loggedInUser } = await login(trimmedUser, password);
        onJoin(loggedInUser);
      } else {
        const { username: loggedInUser } = await login(trimmedUser, password);
        onJoin(loggedInUser);
      }
    } catch (err) {
      setError(err.message || 'An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrapper">
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
        <p className="login-subtitle">End-to-end encrypted, real-time messaging.</p>

        {/* Tab switcher */}
        <div className="auth-tabs">
          <button
            id="tab-login"
            className={`auth-tab ${tab === 'login' ? 'auth-tab--active' : ''}`}
            onClick={() => switchTab('login')}
            type="button"
          >
            Login
          </button>
          <button
            id="tab-register"
            className={`auth-tab ${tab === 'register' ? 'auth-tab--active' : ''}`}
            onClick={() => switchTab('register')}
            type="button"
          >
            Register
          </button>
        </div>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <input
            id="username-input"
            ref={usernameRef}
            className={`login-input ${error ? 'login-input--error' : ''}`}
            type="text"
            placeholder="Username"
            value={username}
            maxLength={20}
            autoComplete="username"
            autoFocus
            onChange={(e) => { setUsername(e.target.value); setError(''); }}
          />

          <input
            id="password-input"
            className={`login-input ${error ? 'login-input--error' : ''}`}
            type="password"
            placeholder="Password"
            value={password}
            autoComplete={tab === 'register' ? 'new-password' : 'current-password'}
            onChange={(e) => { setPassword(e.target.value); setError(''); }}
          />

          {tab === 'register' && (
            <input
              id="confirm-password-input"
              className={`login-input ${error ? 'login-input--error' : ''}`}
              type="password"
              placeholder="Confirm Password"
              value={confirmPassword}
              autoComplete="new-password"
              onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
            />
          )}

          {error && <p className="login-error">{error}</p>}

          <button
            id="submit-btn"
            className="btn btn--primary btn--full"
            type="submit"
            disabled={loading}
          >
            {loading ? 'Please wait…' : tab === 'login' ? 'Login' : 'Register & Join'}
          </button>
        </form>

        <p className="login-hint">
          {tab === 'login'
            ? "Don't have an account? Click Register above."
            : 'Already have an account? Click Login above.'}
        </p>
      </div>
    </div>
  );
}
