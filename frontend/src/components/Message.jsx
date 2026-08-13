// Format an ISO 8601 UTC timestamp string to local "h:mm AM/PM"
function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function Message({ msg, currentUser }) {
  const time = formatTime(msg.timestamp);

  if (msg.type === 'system') {
    return (
      <div className="msg msg--system" role="status">
        <span className="msg__body">{msg.message}</span>
        {time && <span className="msg__time msg__time--system">{time}</span>}
      </div>
    );
  }

  const isOwn = msg.username === currentUser;

  return (
    <div className={`msg ${isOwn ? 'msg--own' : 'msg--other'}`}>
      {!isOwn && <span className="msg__sender">{msg.username}</span>}
      <span className="msg__text">{msg.message}</span>
      {time && <span className="msg__time">{time}</span>}
    </div>
  );
}
