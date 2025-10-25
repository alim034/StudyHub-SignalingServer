import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:5173",
      "http://localhost:3000",
      "https://studyhub.live" // production frontend
    ],
    methods: ["GET", "POST"],
    credentials: true
  },
});

const rooms = new Map(); // roomId -> Map(socketId => { id, name })

// ✅ Add your backend URL from environment variables
const BACKEND_URL = process.env.BACKEND_URL || "http://study-hub-backend-iota.vercel.app";

io.on('connection', (socket) => {
  console.log('🟢 User connected:', socket.id);

  socket.on('join-room', async ({ roomId, name, token }) => {
    console.log(`🪩 ${name} attempting to join room ${roomId}`);

    // ✅ Verify token via backend API
    try {
      if (token) {
        const response = await axios.get(`${BACKEND_URL}/api/auth/verify-token`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.data.valid) {
          socket.emit('auth-error', { message: "Invalid or expired token" });
          return socket.disconnect();
        }
      }
    } catch (err) {
      console.error('❌ Token verification failed:', err.message);
      socket.emit('auth-error', { message: "Authentication failed" });
      return socket.disconnect();
    }

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    const r = rooms.get(roomId);
    r.set(socket.id, { id: socket.id, name });
    socket.join(roomId);

    const existingUsers = [...r.values()].filter(u => u.id !== socket.id);
    socket.emit('users-in-room', existingUsers);

    socket.to(roomId).emit('user-joined', { id: socket.id, name });
    console.log(`✅ ${name} joined ${roomId}. Total users: ${r.size}`);
  });

  socket.on('offer', ({ to, sdp, name }) => io.to(to).emit('offer', { from: socket.id, sdp, name }));
  socket.on('answer', ({ to, sdp }) => io.to(to).emit('answer', { from: socket.id, sdp }));
  socket.on('ice-candidate', ({ to, candidate }) => io.to(to).emit('ice-candidate', { from: socket.id, candidate }));

  socket.on('peer-state', ({ roomId, muted, videoOff, hand }) =>
    socket.to(roomId).emit('peer-state', { id: socket.id, muted, videoOff, hand })
  );

  socket.on('chat-message', (msg) => {
    socket.to(msg.roomId).emit('chat-message', msg);
  });

  socket.on('leave-room', ({ roomId }) => handleUserLeave(socket, roomId));

  socket.on('disconnect', () => {
    console.log('🔴 Disconnected:', socket.id);
    for (const [roomId, r] of rooms) {
      if (r.has(socket.id)) handleUserLeave(socket, roomId);
    }
  });

  function handleUserLeave(socket, roomId) {
    const r = rooms.get(roomId);
    if (r && r.has(socket.id)) {
      const left = r.get(socket.id);
      r.delete(socket.id);
      socket.leave(roomId);
      socket.to(roomId).emit('user-left', { id: socket.id, name: left?.name });

      if (r.size === 0) rooms.delete(roomId);
      console.log(`👋 ${left?.name} left room ${roomId}`);
    }
  }
});

app.get('/', (_, res) => res.send('✅ StudyHub Signaling Server running'));
app.get('/health', (_, res) => res.json({
  status: 'ok',
  rooms: rooms.size,
  timestamp: new Date().toISOString()
}));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Signaling server live at http://localhost:${PORT}`);
  console.log(`🌐 Backend connected: ${BACKEND_URL}`);
});
