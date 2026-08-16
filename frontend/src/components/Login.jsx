import { useState, useRef, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

export default function Login({ onJoin, theme, onToggleTheme }) {
  const [mode, setMode]       = useState('login');   // 'login' | 'register'
  const [userId, setUserId]   = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  
  // Realtime check state
  const [isAvailable, setIsAvailable] = useState(null); // true, false, or null
  const [checkingUsername, setCheckingUsername] = useState(false);
  const debounceRef = useRef(null);

  const inputRef = useRef(null);

  function clearError() { if (error) setError(''); }

  // Check username availability when typing in register mode
  useEffect(() => {
    if (mode !== 'register' || !userId) {
      setIsAvailable(null);
      return;
    }

    setCheckingUsername(true);
    setIsAvailable(null);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/check-user/${encodeURIComponent(userId)}`);
        if (res.ok) {
          const data = await res.json();
          setIsAvailable(data.available);
        }
      } catch (e) {
        setIsAvailable(null);
      } finally {
        setCheckingUsername(false);
      }
    }, 500);

    return () => clearTimeout(debounceRef.current);
  }, [userId, mode]);

  async function handleSubmit(e) {
    e.preventDefault();
    const uid = userId.trim();
    const dname = displayName.trim();
    const pwd = password.trim();

    if (!uid) { setError('Please enter a User ID.'); inputRef.current?.focus(); return; }
    if (uid.length > 20) { setError('User ID must be 20 characters or fewer.'); return; }
    
    if (mode === 'register') {
      if (isAvailable === false) { setError('User ID is already taken.'); return; }
      if (!dname) { setError('Please enter a Display Name.'); return; }
      if (dname.length > 30) { setError('Display Name must be 30 characters or fewer.'); return; }
      if (pwd.length < 6) { setError('Password must be at least 6 characters.'); return; }
      if (!/\d/.test(pwd)) { setError('Password must contain at least one number.'); return; }
    } else {
      if (!pwd) { setError('Please enter your password.'); return; }
    }

    setLoading(true);
    setError('');

    try {
      const endpoint = mode === 'register' ? '/register' : '/login';
      const bodyPayload = mode === 'register' 
        ? { user_id: uid, display_name: dname, password: pwd }
        : { user_id: uid, password: pwd };

      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.detail || 'Something went wrong. Please try again.');
        return;
      }

      onJoin(data.user_id, data.display_name, data.token);
    } catch {
      setError('Could not connect to server. Make sure the backend is running.');
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
        <p className="login-subtitle">Real-time messaging, instantly.</p>

        <div className="auth-tabs">
          <button
            id="tab-login"
            className={`auth-tab ${mode === 'login' ? 'auth-tab--active' : ''}`}
            onClick={() => { setMode('login'); setError(''); setIsAvailable(null); }}
            type="button"
          >
            Login
          </button>
          <button
            id="tab-register"
            className={`auth-tab ${mode === 'register' ? 'auth-tab--active' : ''}`}
            onClick={() => { setMode('register'); setError(''); setIsAvailable(null); }}
            type="button"
          >
            Register
          </button>
        </div>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="input-group">
            <input
              id="userid-input"
              ref={inputRef}
              className={`login-input ${error || isAvailable === false ? 'login-input--error' : ''}`}
              type="text"
              placeholder="User ID (e.g. aditya123)"
              value={userId}
              maxLength={20}
              autoComplete="username"
              autoFocus
              onChange={(e) => { setUserId(e.target.value.toLowerCase().replace(/\s/g, '')); clearError(); }}
            />
            {mode === 'register' && (
              <span className="input-hint">
                {checkingUsername ? (
                  'Checking availability...'
                ) : isAvailable === true ? (
                  <span className="text-success">✔ Username available!</span>
                ) : isAvailable === false ? (
                  <span className="text-danger">✖ Username is taken.</span>
                ) : (
                  'Unique identifier used for logging in (no spaces).'
                )}
              </span>
            )}
          </div>

          {mode === 'register' && (
            <div className="input-group">
              <input
                id="displayname-input"
                className={`login-input ${error ? 'login-input--error' : ''}`}
                type="text"
                placeholder="Display Name (e.g. Aditya)"
                value={displayName}
                maxLength={30}
                onChange={(e) => { setDisplayName(e.target.value); clearError(); }}
              />
              <span className="input-hint">The name everyone else will see in chat.</span>
            </div>
          )}

          <div className="input-group">
            <input
              id="password-input"
              className={`login-input ${error ? 'login-input--error' : ''}`}
              type="password"
              placeholder="Password"
              value={password}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              onChange={(e) => { setPassword(e.target.value); clearError(); }}
            />
            {mode === 'register' && <span className="input-hint">Min 6 chars. Must contain 1 number.</span>}
          </div>

          {error && <p className="login-error">{error}</p>}

          <button
            id="auth-submit-btn"
            className="btn btn--primary btn--full"
            type="submit"
            disabled={loading || (mode === 'register' && isAvailable === false)}
          >
            {loading ? 'Please wait…' : mode === 'register' ? 'Create Account' : 'Login'}
          </button>
        </form>

        <p className="login-hint">
          {mode === 'login'
            ? "Don't have an account? Click Register above."
            : 'Already have an account? Click Login above.'}
        </p>
      </div>
    </div>
  );
}
