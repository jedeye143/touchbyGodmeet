const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Configure CORS to allow Vercel or other frontend clients
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
// Serve static files from frontend folder if running locally
const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));

app.get('/', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.get('/meeting', (req, res) => {
  res.sendFile(path.join(frontendPath, 'meeting.html'));
});

// Room states: roomId -> { id, hostId, isLocked, participants: Map(socketId -> data), pendingApproval: Map(socketId -> data) }
const rooms = new Map();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Heartbeat ping-pong for latency/quality calculations
  socket.on('ping-heartbeat', () => {
    socket.emit('pong-heartbeat', Date.now());
  });

  // Verify if a room exists, is locked, or if user is already in it
  socket.on('validate-room', ({ roomId, nickname }, callback) => {
    const room = rooms.get(roomId);
    if (!room) {
      // Room doesn't exist yet, can be created
      return callback({ valid: true, exists: false });
    }
    if (room.isLocked) {
      return callback({ valid: false, reason: 'Room is locked by the host.' });
    }
    // Check for duplicate names in the room
    let nameExists = false;
    room.participants.forEach((p) => {
      if (p.nickname.toLowerCase() === nickname.toLowerCase()) {
        nameExists = true;
      }
    });
    if (nameExists) {
      return callback({ valid: false, reason: 'Nickname is already taken in this meeting.' });
    }
    return callback({ valid: true, exists: true, hostName: rooms.get(roomId).participants.get(room.hostId)?.nickname || 'Host' });
  });

  // Ask to join (for locked rooms or rooms requiring host approval)
  socket.on('request-join', ({ roomId, nickname }) => {
    const room = rooms.get(roomId);
    if (!room) {
      // If room doesn't exist, create it and make this socket the host directly
      joinRoomDirectly(socket, roomId, nickname, true);
      return;
    }

    // If the socket is already a participant, just join
    if (room.participants.has(socket.id)) {
      joinRoomDirectly(socket, roomId, nickname, false);
      return;
    }

    // Add to pending approvals
    room.pendingApproval.set(socket.id, { socketId: socket.id, nickname });
    
    // Notify host of the join request
    io.to(room.hostId).emit('join-request-received', {
      socketId: socket.id,
      nickname
    });

    socket.emit('waiting-for-approval');
  });

  // Host approves/rejects a pending participant
  socket.on('respond-join-request', ({ roomId, participantId, approved }) => {
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;

    const pendingUser = room.pendingApproval.get(participantId);
    if (!pendingUser) return;

    room.pendingApproval.delete(participantId);

    if (approved) {
      io.to(participantId).emit('join-request-approved');
    } else {
      io.to(participantId).emit('join-request-rejected', 'The host declined your request to join.');
    }
  });

  // Join room directly after approval or if no approval needed
  socket.on('join-room', ({ roomId, nickname }) => {
    const room = rooms.get(roomId);
    const isFirst = !room || room.participants.size === 0;
    joinRoomDirectly(socket, roomId, nickname, isFirst);
  });

  function joinRoomDirectly(socket, roomId, nickname, isHost) {
    socket.join(roomId);

    let room = rooms.get(roomId);
    if (!room) {
      room = {
        id: roomId,
        hostId: socket.id,
        isLocked: false,
        participants: new Map(),
        pendingApproval: new Map()
      };
      rooms.set(roomId, room);
    }

    if (isHost) {
      room.hostId = socket.id;
    }

    const participantData = {
      socketId: socket.id,
      nickname,
      isHost,
      isMuted: false,
      isCameraOff: false,
      isScreenSharing: false,
      isHandRaised: false,
      isMicDisabled: false
    };

    room.participants.set(socket.id, participantData);
    socket.roomId = roomId;

    // Send room info to the newly joined client
    const otherParticipants = Array.from(room.participants.values())
      .filter(p => p.socketId !== socket.id);
    
    socket.emit('room-joined', {
      roomId,
      myId: socket.id,
      isHost,
      participants: otherParticipants,
      isLocked: room.isLocked
    });

    // Notify other users in the room
    socket.to(roomId).emit('user-connected', participantData);
    console.log(`User ${nickname} (${socket.id}) joined room ${roomId}. Host: ${isHost}`);
  }

  // Relay WebRTC signaling messages
  socket.on('signal', ({ to, signal }) => {
    io.to(to).emit('signal', {
      from: socket.id,
      signal
    });
  });

  // Chat message broadcasting
  socket.on('send-chat', (messageText) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    const sender = room.participants.get(socket.id);
    if (!sender) return;

    // Sanitize basic HTML entities to prevent XSS
    const sanitizedText = messageText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    const chatData = {
      senderId: socket.id,
      senderName: sender.nickname,
      message: sanitizedText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    io.to(roomId).emit('chat-message', chatData);
  });

  // Typing indicator
  socket.on('typing', (isTyping) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    const sender = room.participants.get(socket.id);
    if (!sender) return;

    socket.to(roomId).emit('user-typing', {
      userId: socket.id,
      nickname: sender.nickname,
      isTyping
    });
  });

  // Track state changes: mic toggle
  socket.on('toggle-audio', (isMuted) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    const participant = room.participants.get(socket.id);
    if (participant) {
      participant.isMuted = isMuted;
      socket.to(roomId).emit('user-audio-toggled', { userId: socket.id, isMuted });
    }
  });

  // Track state changes: camera toggle
  socket.on('toggle-video', (isCameraOff) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    const participant = room.participants.get(socket.id);
    if (participant) {
      participant.isCameraOff = isCameraOff;
      socket.to(roomId).emit('user-video-toggled', { userId: socket.id, isCameraOff });
    }
  });

  // Track screen sharing
  socket.on('toggle-screen-share', (isScreenSharing) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    const participant = room.participants.get(socket.id);
    if (participant) {
      participant.isScreenSharing = isScreenSharing;
      socket.to(roomId).emit('user-screen-toggled', { userId: socket.id, isScreenSharing });
    }
  });

  // Raise hand
  socket.on('raise-hand', (isRaised) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    const participant = room.participants.get(socket.id);
    if (participant) {
      participant.isHandRaised = isRaised;
      io.to(roomId).emit('user-hand-raised', { userId: socket.id, isRaised, nickname: participant.nickname });
    }
  });

  // Emojis reaction
  socket.on('send-reaction', (emoji) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    io.to(roomId).emit('reaction-received', { userId: socket.id, emoji });
  });

  // Host Controls: Lock room
  socket.on('toggle-lock-room', (locked) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;

    room.isLocked = locked;
    io.to(roomId).emit('room-lock-toggled', locked);
  });

  // Host Controls: Mute a user remotely
  socket.on('host-mute-user', (userId) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;

    io.to(userId).emit('host-muted-you');
  });

  // Host Controls: Disable a user's microphone permission temporarily
  socket.on('host-disable-mic', ({ userId, disable }) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;

    const participant = room.participants.get(userId);
    if (participant) {
      participant.isMicDisabled = disable;
    }
    io.to(userId).emit('host-mic-disabled', disable);
    io.to(roomId).emit('user-mic-disabled-changed', { userId, disable });
  });

  // Host Controls: Lower a user's hand remotely
  socket.on('host-lower-hand', (userId) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;

    const participant = room.participants.get(userId);
    if (participant) {
      participant.isHandRaised = false;
    }
    io.to(userId).emit('host-lowered-your-hand');
    io.to(roomId).emit('user-hand-raised', { userId, isRaised: false, nickname: participant ? participant.nickname : '' });
  });

  // Host Controls: Kick user
  socket.on('host-kick-user', (userId) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;

    io.to(userId).emit('host-kicked-you');
  });

  // Host Controls: End room for everyone
  socket.on('host-end-room', () => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;

    io.to(roomId).emit('room-ended-by-host');
    rooms.delete(roomId);
  });

  // Request unmute (participant requests host for permission)
  socket.on('request-unmute-permission', () => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    const requester = room.participants.get(socket.id);
    if (!requester) return;

    io.to(room.hostId).emit('unmute-request-received', {
      userId: socket.id,
      nickname: requester.nickname
    });
  });

  // Disconnection handler
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    const roomId = socket.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    // Remove from pending approvals
    if (room.pendingApproval.has(socket.id)) {
      room.pendingApproval.delete(socket.id);
      io.to(room.hostId).emit('join-request-cancelled', socket.id);
    }

    // Remove from participants
    if (room.participants.has(socket.id)) {
      const pData = room.participants.get(socket.id);
      room.participants.delete(socket.id);
      socket.to(roomId).emit('user-disconnected', socket.id);
      console.log(`User ${pData.nickname} left room ${roomId}`);

      // If room is now empty, delete it
      if (room.participants.size === 0) {
        rooms.delete(roomId);
        console.log(`Room ${roomId} is empty and deleted.`);
        return;
      }

      // If host disconnected, assign host to next user
      if (room.hostId === socket.id) {
        const nextHostId = room.participants.keys().next().value;
        if (nextHostId) {
          room.hostId = nextHostId;
          const nextHost = room.participants.get(nextHostId);
          if (nextHost) {
            nextHost.isHost = true;
          }
          io.to(roomId).emit('host-changed', {
            hostId: nextHostId,
            nickname: nextHost?.nickname || 'New Host'
          });
          console.log(`New host assigned to room ${roomId}: ${nextHostId}`);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
