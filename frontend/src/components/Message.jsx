// Format an ISO 8601 UTC timestamp string to local "h:mm AM/PM"
function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function renderMessageText(text, currentUser) {
  if (!text) return '';
  // Split on @username matches where @ is not preceded by a word character
  const parts = text.split(/(\B@[a-zA-Z0-9_-]+)/);
  return parts.map((part, index) => {
    if (part.startsWith('@')) {
      const username = part.slice(1);
      const isMe = username.toLowerCase() === currentUser?.toLowerCase();
      return (
        <span key={index} className={`mention ${isMe ? 'mention--me' : ''}`}>
          {part}
        </span>
      );
    }
    return part;
  });
}

export default function Message({ msg, currentUser, onReply }) {
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
  
  // Check if current user is tagged in this message
  const hasMentionMe = msg.message && msg.message.split(/(\B@[a-zA-Z0-9_-]+)/).some(part => {
    return part.startsWith('@') && part.slice(1).toLowerCase() === currentUser?.toLowerCase();
  });

  return (
    <div className={`msg-container ${isOwn ? 'msg-container--own' : 'msg-container--other'}`}>
      <div className={`msg ${isOwn ? 'msg--own' : 'msg--other'} ${hasMentionMe ? 'msg--mentioned' : ''}`}>
        {!isOwn && <span className="msg__sender">{msg.username}</span>}
        {msg.reply_to && (
          <div className="msg__reply-quote">
            <span className="msg__reply-quote-sender">@{msg.reply_to.username}</span>
            <span className="msg__reply-quote-text">{msg.reply_to.message}</span>
          </div>
        )}
        <span className="msg__text">{renderMessageText(msg.message, currentUser)}</span>
        {time && <span className="msg__time">{time}</span>}
      </div>
      <button
        className="msg-action-btn msg-action-btn--reply"
        onClick={() => onReply && onReply({ username: msg.username, message: msg.message })}
        title="Reply to message"
        aria-label="Reply to message"
      >
        ↩
      </button>
    </div>
  );
}
