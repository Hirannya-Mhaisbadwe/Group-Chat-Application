export default function UsersList({ users, count }) {
  return (
    <aside className="users-panel">
      <div className="users-panel__header">
        <img src="/logo.png" alt="Logo" className="brand-icon" style={{ width: '32px', height: '32px', objectFit: 'contain' }} />
        <h2 className="brand-title">NexChat</h2>
      </div>

      <div className="online-badge">
        <span className="pulse-dot" />
        <span id="user-count">
          {count === 1 ? '1 user online' : `${count} users online`}
        </span>
      </div>

      <p className="section-label">Online</p>

      <ul className="users-list" aria-label="Online users">
        {users.map((user) => (
          <li key={user} className="user-item">
            <span className="user-dot" />
            <span className="user-name">{user}</span>
          </li>
        ))}
        {users.length === 0 && (
          <li className="user-item user-item--empty">No one here yet…</li>
        )}
      </ul>
    </aside>
  );
}
