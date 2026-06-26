const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

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
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
  
  app.get('/', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });

  app.get('/meeting', (req, res) => {
    res.sendFile(path.join(frontendPath, 'meeting.html'));
  });
} else {
  // Deployed API server (Render)
  app.get('/', (req, res) => {
    res.send('Touch by God Signaling Server is running smoothly! 🚀');
  });
}

// Bible API Router
const BIBLE_BOOKS = [
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth",
  "1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah",
  "Esther", "Job", "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah",
  "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah",
  "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi",
  "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians", "2 Corinthians",
  "Galatians", "Ephesians", "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians",
  "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James", "1 Peter", "2 Peter",
  "1 John", "2 John", "3 John", "Jude", "Revelation"
];

const BOOK_NORMALIZATION = {
  "genesis": "Genesis", "exodo": "Genesis", "exodus": "Exodus", "levitico": "Leviticus", "leviticus": "Leviticus",
  "mga bilang": "Numbers", "bilang": "Numbers", "numbers": "Numbers", "deuteronomio": "Deuteronomy", "deuteronomy": "Deuteronomy",
  "josue": "Joshua", "joshua": "Joshua", "hukom": "Judges", "mga hukom": "Judges", "judges": "Judges", "rut": "Ruth", "ruth": "Ruth",
  "1 samuel": "1 Samuel", "2 samuel": "2 Samuel", "1 mga hari": "1 Kings", "1 hari": "1 Kings", "1 kings": "1 Kings",
  "2 mga hari": "2 Kings", "2 hari": "2 Kings", "2 kings": "2 Kings", "1 mga kasaysayan": "1 Chronicles", "1 kasaysayan": "1 Chronicles",
  "1 chronicles": "1 Chronicles", "2 mga kasaysayan": "2 Chronicles", "2 kasaysayan": "2 Chronicles", "2 chronicles": "2 Chronicles",
  "esdras": "Ezra", "ezra": "Ezra", "nehemias": "Nehemiah", "nehemiah": "Nehemiah", "ester": "Esther", "esther": "Esther",
  "job": "Job", "mga awit": "Psalms", "salmo": "Psalms", "awit": "Psalms", "psalms": "Psalms", "mga kawikaan": "Proverbs",
  "kawikaan": "Proverbs", "proverbs": "Proverbs", "mangangaral": "Ecclesiastes", "ecclesiastes": "Ecclesiastes",
  "awit ni solomon": "Song of Solomon", "song of solomon": "Song of Solomon", "isaias": "Isaiah", "isaiah": "Isaiah",
  "jeremias": "Jeremiah", "jeremiah": "Jeremiah", "mga panaghoy": "Lamentations", "panaghoy": "Lamentations", "lamentations": "Lamentations",
  "ezequiel": "Ezekiel", "ezekiel": "Ezekiel", "daniel": "Daniel", "oseas": "Hosea", "hosea": "Hosea", "joel": "Joel",
  "amos": "Amos", "abdias": "Obadiah", "obadiah": "Obadiah", "jonas": "Jonah", "jonah": "Jonah", "mikas": "Micah",
  "micah": "Micah", "nahum": "Nahum", "habacuc": "Habakkuk", "habakkuk": "Habakkuk", "sofonias": "Zephaniah", "zephaniah": "Zephaniah",
  "hageo": "Haggai", "haggai": "Haggai", "zacarias": "Zechariah", "zechariah": "Zechariah", "malakias": "Malachi", "malachi": "Malachi",
  "mateo": "Matthew", "matthew": "Matthew", "marcos": "Mark", "mark": "Mark", "lucas": "Luke", "luke": "Luke",
  "juan": "John", "john": "John", "mga gawa": "Acts", "gawa": "Acts", "acts": "Acts", "taga-roma": "Romans",
  "roma": "Romans", "romans": "Romans", "1 taga-corinto": "1 Corinthians", "1 corinto": "1 Corinthians", "1 corinthians": "1 Corinthians",
  "2 taga-corinto": "2 Corinthians", "2 corinto": "2 Corinthians", "2 corinthians": "2 Corinthians", "taga-galacia": "Galatians",
  "galacia": "Galatians", "galatians": "Galatians", "taga-efeso": "Ephesians", "efeso": "Ephesians", "ephesians": "Ephesians",
  "taga-filipos": "Philippians", "filipos": "Philippians", "philippians": "Philippians", "taga-colosas": "Colossians",
  "colosas": "Colossians", "colossians": "Colossians", "1 taga-tesalonica": "1 Thessalonians", "1 tesalonica": "1 Thessalonians",
  "1 thessalonians": "1 Thessalonians", "2 taga-tesalonica": "2 Thessalonians", "2 tesalonica": "2 Thessalonians", "2 thessalonians": "2 Thessalonians",
  "1 timoteo": "1 Timothy", "1 timothy": "1 Timothy", "2 timoteo": "2 Timothy", "2 timothy": "2 Timothy",
  "tito": "Titus", "titus": "Titus", "filemon": "Philemon", "philemon": "Philemon", "mga hebreo": "Hebrews",
  "hebreo": "Hebrews", "hebrews": "Hebrews", "santiago": "James", "james": "James", "1 pedro": "1 Peter",
  "1 peter": "1 Peter", "2 pedro": "2 Peter", "2 peter": "2 Peter", "1 juan": "1 John", "1 john": "1 John",
  "2 juan": "2 John", "2 john": "2 John", "3 juan": "3 John", "3 john": "3 John", "juda": "Jude",
  "jude": "Jude", "pahayag": "Revelation", "apocalipsis": "Revelation", "revelation": "Revelation"
};

function normalizeBookName(name) {
  const cleanName = name.toLowerCase().trim();
  return BOOK_NORMALIZATION[cleanName] || name;
}

function getBookId(bookName) {
  const norm = normalizeBookName(bookName);
  const index = BIBLE_BOOKS.findIndex(b => b.toLowerCase() === norm.toLowerCase());
  return index !== -1 ? index + 1 : 1;
}

app.get('/api/bible', async (req, res) => {
  const { translation, book, chapter, verse } = req.query;
  if (!book || !chapter) {
    return res.status(400).json({ error: 'Missing required parameters (book, chapter)' });
  }

  try {
    const normalizedBook = normalizeBookName(book);
    
    // Construct the verse reference (e.g., "John 3:16" or "John 3" for entire chapter)
    const reference = verse ? `${normalizedBook} ${chapter}:${verse}` : `${normalizedBook} ${chapter}`;
    
    // bible-api.com supports translation parameter
    // Available translations: kjv, bbe, web, oeb-cw, webbe, clementine, almeida, rccv
    const translationMap = {
      'kjv': 'kjv',
      'tagalog': 'web', // Fallback to World English Bible
      'hiligaynon': 'web', // Fallback to World English Bible
      'web': 'web',
      'bbe': 'bbe',
      'clementine': 'clementine',
      'almeida': 'almeida',
      'rccv': 'rccv'
    };
    
    const apiTranslation = translationMap[translation?.toLowerCase()] || 'kjv';
    const url = `https://bible-api.com/${encodeURIComponent(reference)}?translation=${apiTranslation}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(404).json({ error: 'Scripture not found' });
    }
    
    const data = await response.json();
    
    // bible-api.com returns:
    // { reference, verses: [{book_id, book_name, chapter, verse, text}], text, translation_id, translation_name, translation_note }
    
    if (!data.verses || data.verses.length === 0) {
      return res.status(404).json({ error: 'No verses found' });
    }
    
    // If single verse was requested, return single verse format
    if (verse && data.verses.length === 1) {
      return res.json({
        translation: data.translation_name || apiTranslation.toUpperCase(),
        book: data.verses[0].book_name,
        chapter: data.verses[0].chapter,
        verse: data.verses[0].verse.toString(),
        text: data.verses[0].text.trim()
      });
    }
    
    // Format verses to match frontend expectations (multiple verses or full chapter)
    const verses = data.verses.map(v => ({
      verse: v.verse.toString(),
      text: v.text.trim()
    }));
    
    return res.json({
      translation: data.translation_name || apiTranslation.toUpperCase(),
      book: data.verses[0].book_name,
      chapter: data.verses[0].chapter,
      verses: verses
    });

  } catch (error) {
    console.error('Bible lookup error:', error);
    res.status(500).json({ error: 'Failed to retrieve scripture' });
  }
});

// Room states: roomId -> { id, originalHostNickname, hostId, isLocked, participants: Map(socketId -> data), pendingApproval: Map(socketId -> data), roomType }
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
  socket.on('request-join', ({ roomId, nickname, roomType }) => {
    const room = rooms.get(roomId);
    if (!room) {
      // If room doesn't exist, create it and make this socket the host directly
      joinRoomDirectly(socket, roomId, nickname, true, roomType);
      return;
    }

    // Check if this is the original host rejoining
    if (room.originalHostNickname === nickname) {
      joinRoomDirectly(socket, roomId, nickname, true, room.roomType);
      return;
    }

    // If the socket is already a participant, just join
    if (room.participants.has(socket.id)) {
      joinRoomDirectly(socket, roomId, nickname, false, room.roomType);
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
  socket.on('join-room', ({ roomId, nickname, roomType }) => {
    const room = rooms.get(roomId);
    // Only the first person to create the room becomes host
    // OR if rejoining as the original host
    const isFirst = !room;
    joinRoomDirectly(socket, roomId, nickname, isFirst, roomType);
  });

  function joinRoomDirectly(socket, roomId, nickname, isHost, roomType) {
    socket.join(roomId);

    let room = rooms.get(roomId);
    console.log(`[JOIN] ${nickname} joining room ${roomId}. Room exists: ${!!room}, isHost parameter: ${isHost}`);
    
    if (!room) {
      room = {
        id: roomId,
        originalHostNickname: nickname, // Track original host by nickname
        hostId: socket.id,
        isLocked: false,
        participants: new Map(),
        pendingApproval: new Map(),
        roomType: roomType || 'meeting',
        whiteboardHistory: [],
        deleteTimeout: null
      };
      rooms.set(roomId, room);
      console.log(`[JOIN] Created new room ${roomId} with host: ${nickname}`);
    } else {
      // Clear any pending delete timeout since someone joined
      if (room.deleteTimeout) {
        clearTimeout(room.deleteTimeout);
        room.deleteTimeout = null;
        console.log(`[JOIN] Room ${roomId} delete timeout cleared - someone rejoined.`);
      }
      console.log(`[JOIN] Room ${roomId} already exists. Original host: ${room.originalHostNickname}`);
    }

    // Check if this user is the original host rejoining
    if (room.originalHostNickname === nickname) {
      console.log(`[JOIN] ${nickname} is the original host! Granting host rights.`);
      isHost = true;
      room.hostId = socket.id; // Update host socket ID for returning host
    } else {
      console.log(`[JOIN] ${nickname} is NOT the original host (${room.originalHostNickname}). isHost: ${isHost}`);
    }

    if (isHost) {
      room.hostId = socket.id;
      console.log(`[JOIN] ${nickname} is now the host of room ${roomId}`);
    } else {
      console.log(`[JOIN] ${nickname} joined as participant in room ${roomId}`);
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
      isLocked: room.isLocked,
      roomType: room.roomType || 'meeting',
      presentation: room.presentation || null
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
  socket.on('host-end-room', (callback) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;

    io.to(roomId).emit('room-ended-by-host');
    rooms.delete(roomId);

    if (typeof callback === 'function') {
      callback();
    }
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

  // Broadcast a Bible verse to all participants (Host only)
  socket.on('broadcast-verse', ({ reference, text, translation }) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;

    io.to(roomId).emit('verse-broadcasted', { reference, text, translation });
  });

  // Clear the broadcasted verse (Host only)
  socket.on('clear-broadcast', () => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;

    io.to(roomId).emit('broadcast-cleared');
  });

  // Presentation Mode: Start Presentation (Host only)
  socket.on('start-presentation', ({ type, url }) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;

    room.presentation = {
      type,
      url,
      active: true,
      presenterId: socket.id
    };
    room.whiteboardHistory = [];

    // Mute all other participants automatically
    room.participants.forEach((p, pSocketId) => {
      if (pSocketId !== socket.id) {
        p.isMicDisabled = true;
        io.to(pSocketId).emit('host-mic-disabled', true);
        io.to(roomId).emit('user-mic-disabled-changed', { userId: pSocketId, disable: true });
      }
    });

    io.to(roomId).emit('presentation-started', room.presentation);
  });

  // Presentation Mode: Stop Presentation (Host only)
  socket.on('stop-presentation', () => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;

    room.presentation = null;
    room.whiteboardHistory = [];

    // Restore mic permissions for participants
    room.participants.forEach((p, pSocketId) => {
      if (pSocketId !== socket.id) {
        p.isMicDisabled = false;
        io.to(pSocketId).emit('host-mic-disabled', false);
        io.to(roomId).emit('user-mic-disabled-changed', { userId: pSocketId, disable: false });
      }
    });

    io.to(roomId).emit('presentation-stopped');
  });

  // Whiteboard: real-time draw synchronization
  socket.on('draw-whiteboard', (drawData) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (room && room.presentation && room.presentation.type === 'whiteboard') {
      if (!room.whiteboardHistory) room.whiteboardHistory = [];
      room.whiteboardHistory.push(drawData);
      socket.to(roomId).emit('draw-whiteboard', drawData);
    }
  });

  // Whiteboard: clear whiteboard drawing (Host only)
  socket.on('clear-whiteboard', () => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;

    room.whiteboardHistory = [];
    io.to(roomId).emit('whiteboard-cleared');
  });

  // Screen share: toggle drawing overlay (Host only)
  socket.on('toggle-screen-drawing', (data) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;

    // Broadcast to all participants in the room
    io.to(roomId).emit('screen-drawing-toggled', { enabled: data.enabled });
  });

  // Whiteboard: get canvas drawing history (e.g. for mid-meeting joiners)
  socket.on('get-whiteboard-history', (callback) => {
    const roomId = socket.roomId;
    if (!roomId) return callback([]);
    const room = rooms.get(roomId);
    if (room && room.whiteboardHistory) {
      callback(room.whiteboardHistory);
    } else {
      callback([]);
    }
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

      // If room is now empty, set a timeout to delete it (allows host to rejoin)
      if (room.participants.size === 0) {
        if (!room.deleteTimeout) {
          console.log(`Room ${roomId} is empty. Will delete in 5 minutes if no one rejoins.`);
          room.deleteTimeout = setTimeout(() => {
            const currentRoom = rooms.get(roomId);
            if (currentRoom && currentRoom.participants.size === 0) {
              rooms.delete(roomId);
              console.log(`Room ${roomId} was empty for 5 minutes and has been deleted.`);
            }
          }, 5 * 60 * 1000); // 5 minutes
        }
        return;
      } else {
        // Someone is still in the room, clear any delete timeout
        if (room.deleteTimeout) {
          clearTimeout(room.deleteTimeout);
          room.deleteTimeout = null;
        }
      }

      // Host disconnected - room continues without host reassignment
      if (room.hostId === socket.id) {
        console.log(`Host left room ${roomId}. Room will continue without host.`);
        // Notify participants that host left (they can still continue the meeting)
        io.to(roomId).emit('host-left', {
          message: 'The host has left the meeting.'
        });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
