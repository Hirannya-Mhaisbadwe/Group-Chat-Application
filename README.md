# NexChat

**NexChat** is a modern, real-time group messaging application designed for instant communication. It features a sleek, responsive UI with automatic dark/light modes, seamless WebSocket connections for zero-latency messaging, and intelligent browser session management to prevent duplicate connections and retain chat history.

## ✨ Features

- **Real-Time Messaging**: Lightning-fast communication powered by native WebSockets.
- **Smart Session Management**: Disconnects safely on tab close and perfectly syncs if you switch tabs or reconnect within 5 minutes.
- **Tab Deduplication**: Prevents ghost connections. If you open a new tab, the old one goes inactive.
- **Modern UI/UX**: Custom-built design system featuring glassmorphism, fluid micro-animations, and responsive layouts.
- **Dark/Light Mode**: User-toggled themes that are persisted in `localStorage`.
- **Live User Roster**: See exactly who is online with real-time connection status indicators.

## 🛠️ Tech Stack

### Frontend
- **Framework**: React 18
- **Build Tool**: Vite
- **Styling**: Vanilla CSS3 (Custom Design System, CSS Variables)
- **Networking**: Native WebSockets (`useWebSocket` hook)
- **State/Persistence**: React Hooks + Browser `localStorage`

### Backend
- **Framework**: Python 3 & FastAPI
- **Server**: Uvicorn (ASGI)
- **Real-Time Protocol**: WebSockets
- **State Management**: In-Memory Python Dictionaries

## 🚀 Running Locally

### 1. Start the Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```
*The backend will run on `http://127.0.0.1:8000`.*

### 2. Start the Frontend
```bash
cd frontend
npm install
npm run dev
```
*Open `http://localhost:5173` in your browser to start chatting!*

---

## 🖥️ SSH Deployment Guide (University / Lab Setup)

This section documents how to host NexChat across multiple SSH virtual machines on the same server, with one machine acting as the central host and all others connecting to it.

### 🔧 Step 1 — On the HOST Machine (One person only)

The host machine is the one that runs the backend and serves the frontend. All others connect to it.

**1a. Clone the repository:**
```bash
git clone https://github.com/Aj1359/Group-Chat-Application.git
cd Group-Chat-Application/backend
```

**1b. Install Python dependencies:**
```bash
pip install -r requirements.txt
```

**1c. Start the backend permanently in the background:**
```bash
nohup python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 > backend.log 2>&1 &
```

**1d. Build the frontend on your local computer** (run this on your own Windows/Mac laptop, not the SSH):
```bash
cd frontend
echo "VITE_WS_URL=ws://localhost:8000/ws" > .env.production
npm run build
```

**1e. Copy the built frontend to your SSH machine** (run on your local laptop):
```bash
scp -P <YOUR_PORT> -r dist student@10.1.75.51:~/dist
```

**1f. Serve the frontend permanently in the background:**
```bash
nohup python3 -m http.server 5173 --directory ~/dist > frontend.log 2>&1 &
```

✅ Your machine is now hosting both the backend (port 8000) and the frontend (port 5173).

---

### 👥 Step 2 — On Every Other Machine (All other users)

Each other group member does the following **on their own personal laptop** (not inside an SSH window):

**2a. Open a terminal (Command Prompt or PowerShell) and run:**
```bash
ssh -p <YOUR_OWN_SSH_PORT> -L 5173:localhost:5173 -L 8000:localhost:8000 student@10.1.75.51
```
> Replace `<YOUR_OWN_SSH_PORT>` with your personal SSH port (e.g., 2229, 2225, 2221).
> Enter your password when prompted. **Keep this terminal window open.**

**2b. Open your browser and navigate to:**
```
http://localhost:5173
```

The SSH tunnel forwards your `localhost:5173` and `localhost:8000` directly through your VM to the host machine. You will automatically join the same chat room as everyone else!

---

### 📋 Quick Reference: Port Numbers

| Person | SSH Port | Role |
|--------|----------|------|
| Aditya | 2217 | Host (Backend + Frontend) |
| Hirannya | 2229 | Connect via tunnel |
| Sarah | 2225 | Connect via tunnel |
| Sanjani | 2221 | Connect via tunnel |

---

## 🌐 Public Deployment

- **Frontend**: Deployed on [Vercel](https://group-chat-application-beta.vercel.app)
- **Backend**: Deployed on [Render](https://render.com)
