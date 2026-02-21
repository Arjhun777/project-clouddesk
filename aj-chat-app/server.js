const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// In-memory state
const usersBySocket = new Map(); // socketId -> username
const socketsByUser = new Map(); // username -> socketId
const conversations = new Map(); // key(userA,userB) -> [{from,to,text,timestamp}]
const inCallWith = new Map(); // username -> peer username

function convoKey(a, b) {
  return [a, b].sort().join('::');
}

function onlineUsers() {
  return Array.from(socketsByUser.keys()).sort((a, b) => a.localeCompare(b));
}

function emitUsers() {
  io.emit('users:list', onlineUsers());
}

function clearCallForUser(user, notifyPeer = true) {
  const peer = inCallWith.get(user);
  inCallWith.delete(user);
  if (peer && inCallWith.get(peer) === user) {
    inCallWith.delete(peer);
    if (notifyPeer) {
      const peerSocketId = socketsByUser.get(peer);
      if (peerSocketId) {
        io.to(peerSocketId).emit('call:ended', { from: user, reason: 'peer_left' });
      }
    }
  }
}

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  socket.on('user:join', (usernameRaw, cb) => {
    const username = String(usernameRaw || '').trim();

    if (!username) return cb?.({ ok: false, error: 'Username is required.' });

    // Allow quick refresh/rejoin by reclaiming the username from stale socket.
    const existingSocketId = socketsByUser.get(username);
    if (existingSocketId && existingSocketId !== socket.id) {
      const existingSocket = io.sockets.sockets.get(existingSocketId);
      clearCallForUser(username, true);
      usersBySocket.delete(existingSocketId);
      socketsByUser.delete(username);
      if (existingSocket) {
        existingSocket.emit('session:replaced');
        existingSocket.disconnect(true);
      }
    }

    usersBySocket.set(socket.id, username);
    socketsByUser.set(username, socket.id);

    cb?.({ ok: true, username, users: onlineUsers() });
    emitUsers();
  });

  socket.on('chat:history', (peerRaw, cb) => {
    const me = usersBySocket.get(socket.id);
    const peer = String(peerRaw || '').trim();
    if (!me || !peer) return cb?.({ ok: false, error: 'Invalid users.' });

    const key = convoKey(me, peer);
    const msgs = conversations.get(key) || [];
    cb?.({ ok: true, messages: msgs });
  });

  socket.on('chat:send', ({ to, text } = {}, cb) => {
    const from = usersBySocket.get(socket.id);
    const target = String(to || '').trim();
    const body = String(text || '').trim();

    if (!from) return cb?.({ ok: false, error: 'Join first.' });
    if (!target || !body) return cb?.({ ok: false, error: 'Recipient and message are required.' });
    if (!socketsByUser.has(target)) return cb?.({ ok: false, error: `${target} is offline.` });

    const message = { from, to: target, text: body, timestamp: Date.now() };

    const key = convoKey(from, target);
    const arr = conversations.get(key) || [];
    arr.push(message);
    conversations.set(key, arr);

    socket.emit('chat:message', { with: target, message });
    const targetSocketId = socketsByUser.get(target);
    io.to(targetSocketId).emit('chat:message', { with: from, message });

    cb?.({ ok: true });
  });

  // WebRTC signaling relay
  socket.on('call:offer', ({ to, offer } = {}, cb) => {
    const from = usersBySocket.get(socket.id);
    const target = String(to || '').trim();
    if (!from || !target || !offer) return cb?.({ ok: false, error: 'Invalid offer payload.' });

    const targetSocketId = socketsByUser.get(target);
    if (!targetSocketId) return cb?.({ ok: false, error: `${target} is offline.` });

    // Busy checks
    if (inCallWith.has(from) || inCallWith.has(target)) {
      io.to(socket.id).emit('call:busy', { from: target });
      return cb?.({ ok: false, error: `${target} is busy in another call.` });
    }

    io.to(targetSocketId).emit('call:incoming', { from, offer });
    cb?.({ ok: true });
  });

  socket.on('call:answer', ({ to, answer } = {}, cb) => {
    const from = usersBySocket.get(socket.id);
    const target = String(to || '').trim();
    if (!from || !target || !answer) return cb?.({ ok: false, error: 'Invalid answer payload.' });

    const targetSocketId = socketsByUser.get(target);
    if (!targetSocketId) return cb?.({ ok: false, error: `${target} is offline.` });

    inCallWith.set(from, target);
    inCallWith.set(target, from);

    io.to(targetSocketId).emit('call:answered', { from, answer });
    cb?.({ ok: true });
  });

  socket.on('call:ice', ({ to, candidate } = {}, cb) => {
    const from = usersBySocket.get(socket.id);
    const target = String(to || '').trim();
    if (!from || !target || !candidate) return cb?.({ ok: false, error: 'Invalid ICE payload.' });

    const targetSocketId = socketsByUser.get(target);
    if (!targetSocketId) return cb?.({ ok: false, error: `${target} is offline.` });

    io.to(targetSocketId).emit('call:ice', { from, candidate });
    cb?.({ ok: true });
  });

  socket.on('call:reject', ({ to } = {}, cb) => {
    const from = usersBySocket.get(socket.id);
    const target = String(to || '').trim();
    if (!from || !target) return cb?.({ ok: false, error: 'Invalid reject payload.' });

    const targetSocketId = socketsByUser.get(target);
    if (!targetSocketId) return cb?.({ ok: false, error: `${target} is offline.` });

    io.to(targetSocketId).emit('call:rejected', { from });
    cb?.({ ok: true });
  });

  socket.on('call:end', ({ to } = {}, cb) => {
    const from = usersBySocket.get(socket.id);
    const target = String(to || '').trim();
    if (!from || !target) return cb?.({ ok: false, error: 'Invalid end payload.' });

    const targetSocketId = socketsByUser.get(target);
    if (!targetSocketId) return cb?.({ ok: false, error: `${target} is offline.` });

    clearCallForUser(from, false);
    io.to(targetSocketId).emit('call:ended', { from, reason: 'hangup' });
    cb?.({ ok: true });
  });

  socket.on('disconnect', () => {
    const username = usersBySocket.get(socket.id);
    if (username) {
      clearCallForUser(username, true);
      usersBySocket.delete(socket.id);
      socketsByUser.delete(username);
      emitUsers();
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Chat app running at http://${HOST}:${PORT}`);
});
