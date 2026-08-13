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
Open a terminal and navigate to the `backend` directory:
```bash
cd backend
```
Install the requirements and start the Uvicorn server:
```bash
pip install -r requirements.txt
uvicorn main:app --reload
```
*The backend will run on `http://127.0.0.1:8000` (WebSocket on `ws://127.0.0.1:8000/ws`).*

### 2. Start the Frontend
Open a **new** terminal and navigate to the `frontend` directory:
```bash
cd frontend
```
Install dependencies and start the Vite dev server:
```bash
npm install
npm run dev
```
*The frontend will run on `http://localhost:5173`. Open this in your browser to start chatting!*

## 🌐 Deployment
- **Frontend** is configured for 1-click deployment on [Vercel](https://vercel.com).
- **Backend** is configured for easy deployment on [Render](https://render.com). Ensure the environment variable `VITE_WS_URL` is set in Vercel to point to your secure Render websocket URL (`wss://.../ws`).
