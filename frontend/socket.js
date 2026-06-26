// socket.js - Socket.io Client Signaling Orchestrator

let socket = null;
let roomName = '';
let myParticipantId = '';
let isLocalHost = false;
let roomMode = 'meeting';

// Latency tracking variables
let lastPingTime = 0;
let latencyInterval = null;

// Typing indicator timeouts
let typingTimeout = null;

/**
 * Initializes the Socket connection to the signaling server.
 */
// Deployed Render signaling backend URL (Change to your actual Render URL after deployment!)
const PROD_BACKEND_URL = "https://touchbygodmeetserver.onrender.com";

function initSocket(onConnectedCallback) {
  // Check if we have a custom backend URL saved, otherwise deduce it
  const savedBackendUrl = localStorage.getItem('aethermeet_backend_url');
  let socketUrl = '';

  if (savedBackendUrl) {
    socketUrl = savedBackendUrl;
  } else {
    // If we're on localhost, we connect to local server port 3000
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host.includes('192.168.')) {
      socketUrl = `${window.location.protocol}//${window.location.hostname}:3000`;
    } else {
      // Production deployed state on Vercel
      const urlParams = new URLSearchParams(window.location.search);
      const serverParam = urlParams.get('server');
      socketUrl = serverParam || PROD_BACKEND_URL;
    }
  }

  console.log(`Connecting to signaling server at: ${socketUrl}`);

  // Initialize socket.io client
  // If socketUrl is empty, it connects to same origin
  socket = io(socketUrl, {
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 2000,
    timeout: 10000
  });

  setupSocketEvents();

  socket.on('connect', () => {
    console.log(`Connected to signaling server. Socket ID: ${socket.id}`);
    myParticipantId = socket.id;
    hideReconnectIndicator();
    startLatencyCheck();
    if (onConnectedCallback) onConnectedCallback();
  });

  socket.on('disconnect', (reason) => {
    console.warn(`Disconnected from signaling server: ${reason}`);
    showReconnectIndicator();
    stopLatencyCheck();
  });

  socket.on('connect_error', (error) => {
    console.error('Socket connection error:', error);
    showReconnectIndicator();
  });
}

/**
 * Attaches the necessary event listeners for WebRTC signaling and UI events.
 */
function setupSocketEvents() {
  if (!socket) return;

  // Server response when local client successfully joins the room
  socket.on('room-joined', ({ roomId, myId, isHost, participants, isLocked, roomType, presentation }) => {
    console.log(`Room joined! ID: ${roomId}, I am host: ${isHost}, mode: ${roomType}`);
    myParticipantId = myId;
    isLocalHost = isHost;
    roomMode = roomType || 'meeting';
    
    // Update local UI state
    document.getElementById('meeting-id-display').textContent = `Room ID: ${roomId}`;
    
    // Show host badge and enable lock switch if host
    if (isHost) {
      document.getElementById('local-host-badge').classList.remove('hidden');
      const lockToggle = document.getElementById('lock-room-toggle');
      if (lockToggle) {
        lockToggle.removeAttribute('disabled');
        lockToggle.checked = isLocked;
      }
    }

    // Set share links in elements
    const inviteLink = `${window.location.origin}/meeting.html?room=${roomId}`;
    document.getElementById('invite-link-input').value = inviteLink;

    // Trigger room mode UI setup
    if (typeof handleRoomModeSetup === 'function') {
      handleRoomModeSetup(roomMode);
    }

    // Trigger ongoing presentation setup
    if (presentation && typeof handlePresentationStarted === 'function') {
      handlePresentationStarted(presentation);
    }

    // Trigger local WebRTC connection setup
    handleRoomJoined(participants);
  });

  // A remote user has connected: we need to establish WebRTC connection with them
  socket.on('user-connected', (participantData) => {
    console.log(`Remote participant joined room:`, participantData);
    playNotificationSound('join');
    showNotificationToast(`${participantData.nickname} joined the meeting`);
    
    // Instantiate new Peer Connection (WebRTC)
    // WE are the existing user, so WE initiate the connection (isInitiator=TRUE)
    createPeerConnection(participantData.socketId, participantData.nickname, true, participantData.isHost);
    
    // Update participants list and badge
    updateParticipantsList();
  });

  // A remote user has disconnected: clean up their WebRTC peer connection
  socket.on('user-disconnected', (socketId) => {
    console.log(`Remote participant disconnected: ${socketId}`);
    playNotificationSound('leave');
    
    // Clean up WebRTC peer
    destroyPeerConnection(socketId);
    
    // Update participants list and badge
    updateParticipantsList();
  });

  // Relayed WebRTC signaling message
  socket.on('signal', ({ from, signal }) => {
    handleSignalingData(from, signal);
  });

  // Chat message received
  socket.on('chat-message', (chatData) => {
    appendChatMessage(chatData);
  });

  // Remote user is typing
  socket.on('user-typing', ({ userId, nickname, isTyping }) => {
    const typingIndicator = document.getElementById('typing-indicator');
    const typingText = document.getElementById('typing-text');
    if (!typingIndicator || !typingText) return;

    if (isTyping) {
      typingText.textContent = `${nickname} is typing`;
      typingIndicator.style.opacity = '1';
    } else {
      typingIndicator.style.opacity = '0';
    }
  });

  // Remote user toggled microphone
  socket.on('user-audio-toggled', ({ userId, isMuted }) => {
    updateRemoteAudioState(userId, isMuted);
  });

  // Remote user toggled camera
  socket.on('user-video-toggled', ({ userId, isCameraOff }) => {
    updateRemoteVideoState(userId, isCameraOff);
  });

  // Remote user toggled screen share
  socket.on('user-screen-toggled', ({ userId, isScreenSharing }) => {
    updateRemoteScreenState(userId, isScreenSharing);
  });

  // Remote user raised hand
  socket.on('user-hand-raised', ({ userId, isRaised, nickname }) => {
    const peerRecord = peers.get(userId);
    if (peerRecord) {
      peerRecord.isHandRaised = isRaised;
    }
    updateRemoteHandState(userId, isRaised);
    if (isRaised) {
      showNotificationToast(`${nickname} raised their hand ✋`);
    }
    updateParticipantsList();
  });

  // Host remote control: lowered our hand
  socket.on('host-lowered-your-hand', () => {
    showNotificationToast(`Your hand was lowered by the host ✋`);
    localHandRaised = false;
    const btnHand = document.getElementById('btn-hand');
    if (btnHand) {
      btnHand.classList.remove('bg-amber-500/10', 'border-amber-500/20', 'text-amber-400');
      btnHand.classList.add('bg-slate-900', 'border-slate-800', 'text-slate-300');
    }
    updateRemoteHandState('local', false);
    updateParticipantsList();
  });

  // Remote user sent reaction
  socket.on('reaction-received', ({ userId, emoji }) => {
    const senderName = getParticipantNickname(userId);
    spawnReactionEmoji(emoji);
    showNotificationToast(`${senderName} reacted with ${emoji}`);
  });

  // Host locked/unlocked room
  socket.on('room-lock-toggled', (locked) => {
    showNotificationToast(`The room was ${locked ? 'locked' : 'unlocked'} by the host.`);
    const lockIcon = document.getElementById('lock-icon-sidebar');
    const lockToggle = document.getElementById('lock-room-toggle');
    
    if (lockIcon) {
      if (locked) {
        lockIcon.setAttribute('data-lucide', 'lock');
        lockIcon.classList.add('text-brand-400');
      } else {
        lockIcon.setAttribute('data-lucide', 'unlock');
        lockIcon.classList.remove('text-brand-400');
      }
      lucide.createIcons();
    }

    if (lockToggle && !isLocalHost) {
      lockToggle.checked = locked;
    }
  });

  // Host promoted a new user to host
  socket.on('host-changed', ({ hostId, nickname }) => {
    showNotificationToast(`${nickname} is now the host of the meeting`);
    
    if (hostId === socket.id) {
      isLocalHost = true;
      document.getElementById('local-host-badge').classList.remove('hidden');
      const lockToggle = document.getElementById('lock-room-toggle');
      if (lockToggle) {
        lockToggle.removeAttribute('disabled');
      }
    } else {
      isLocalHost = false;
      document.getElementById('local-host-badge').classList.add('hidden');
      const lockToggle = document.getElementById('lock-room-toggle');
      if (lockToggle) {
        lockToggle.setAttribute('disabled', 'true');
      }
    }
    updateParticipantsList();
  });

  // Host remote control: muted us
  socket.on('host-muted-you', () => {
    showNotificationToast(`You have been muted by the host 🎙️`);
    muteLocalAudio(true);
  });

  // Host remote control: microphone capability revoked/granted
  socket.on('host-mic-disabled', (disabled) => {
    isMicDisabledByHost = disabled;
    const micButton = document.getElementById('btn-mic');
    
    if (disabled) {
      showNotificationToast(`The host has disabled your microphone 🚫`);
      muteLocalAudio(true);
      if (micButton) {
        micButton.classList.add('bg-red-500/10', 'border-red-500/20', 'text-red-400');
        micButton.classList.remove('bg-emerald-500/10', 'border-emerald-500/20', 'text-emerald-400');
      }
    } else {
      showNotificationToast(`The host has enabled your microphone access ✅`);
      if (micButton) {
        micButton.classList.remove('bg-red-500/10', 'border-red-500/20', 'text-red-400');
        micButton.classList.add('bg-emerald-500/10', 'border-emerald-500/20', 'text-emerald-400');
      }
    }
  });

  // Remote mic disable status synced for rendering
  socket.on('user-mic-disabled-changed', ({ userId, disable }) => {
    const statusIcon = document.getElementById(`mic-status-${userId}`);
    if (statusIcon) {
      if (disable) {
        statusIcon.innerHTML = `<i data-lucide="mic-off" class="w-3.5 h-3.5 text-red-500"></i>`;
      } else {
        // Fallback to current mute state
        const peerConn = peers.get(userId);
        const isMuted = peerConn ? peerConn.remoteAudioMuted : false;
        statusIcon.innerHTML = `<i data-lucide="${isMuted ? 'mic-off' : 'mic'}" class="w-3.5 h-3.5 ${isMuted ? 'text-red-400' : 'text-emerald-400'}"></i>`;
      }
      lucide.createIcons();
    }
    updateParticipantsList();
  });

  // Host remote control: kicked us
  socket.on('host-kicked-you', () => {
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        title: 'Removed from Meeting',
        text: 'You have been removed from this meeting by the host.',
        icon: 'error',
        confirmButtonText: 'OK',
        background: '#070a13',
        color: '#f1f5f9',
        confirmButtonColor: '#ef4444',
        customClass: {
          popup: 'border border-slate-800 rounded-2xl shadow-2xl backdrop-blur-md',
          title: 'font-bold text-white',
          htmlContainer: 'text-slate-400 text-xs'
        }
      }).then(() => {
        window.location.href = 'index.html?reason=kicked';
      });
    } else {
      alert('You have been removed from this meeting by the host.');
      window.location.href = 'index.html?reason=kicked';
    }
  });

  // Host ended meeting for everyone
  socket.on('room-ended-by-host', () => {
    if (isLocalHost) return;
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        title: 'Meeting Ended',
        text: 'The host has ended this meeting for everyone.',
        icon: 'info',
        confirmButtonText: 'Back to Home',
        background: '#070a13',
        color: '#f1f5f9',
        confirmButtonColor: '#7c3aed',
        customClass: {
          popup: 'border border-slate-800 rounded-2xl shadow-2xl backdrop-blur-md',
          title: 'font-bold text-white',
          htmlContainer: 'text-slate-400 text-xs'
        }
      }).then(() => {
        window.location.href = 'index.html?reason=ended';
      });
    } else {
      alert('The host has ended this meeting for everyone.');
      window.location.href = 'index.html?reason=ended';
    }
  });

  // Host only: join request received from a knocking participant
  socket.on('join-request-received', ({ socketId, nickname }) => {
    if (!isLocalHost) return;
    
    // Play knock sound
    playNotificationSound('join');

    // Display knock banner modal
    const approvalModal = document.getElementById('approval-modal');
    const approvalNickname = document.getElementById('approval-nickname');
    const acceptBtn = document.getElementById('approval-accept-btn');
    const rejectBtn = document.getElementById('approval-reject-btn');

    if (approvalModal && approvalNickname) {
      approvalNickname.textContent = nickname;
      approvalModal.classList.remove('opacity-0', '-translate-y-4', 'pointer-events-none');
      
      // Bind approval buttons
      acceptBtn.onclick = () => {
        socket.emit('respond-join-request', { roomId: roomName, participantId: socketId, approved: true });
        approvalModal.classList.add('opacity-0', '-translate-y-4', 'pointer-events-none');
      };
      
      rejectBtn.onclick = () => {
        socket.emit('respond-join-request', { roomId: roomName, participantId: socketId, approved: false });
        approvalModal.classList.add('opacity-0', '-translate-y-4', 'pointer-events-none');
      };
    }
  });

  // Host only: knock joiner cancelled their knock or disconnected before approval
  socket.on('join-request-cancelled', (socketId) => {
    const approvalModal = document.getElementById('approval-modal');
    if (approvalModal) {
      approvalModal.classList.add('opacity-0', '-translate-y-4', 'pointer-events-none');
    }
  });

  // Host only: participant requesting to unmute (notifies host)
  socket.on('unmute-request-received', ({ userId, nickname }) => {
    if (!isLocalHost) return;

    const modal = document.getElementById('unmute-request-modal');
    const namePlaceholder = document.getElementById('unmute-request-nickname');
    const allowBtn = document.getElementById('unmute-request-allow-btn');
    const denyBtn = document.getElementById('unmute-request-deny-btn');

    if (modal && namePlaceholder) {
      namePlaceholder.textContent = nickname;
      modal.classList.remove('opacity-0', '-translate-y-4', 'pointer-events-none');

      allowBtn.onclick = () => {
        socket.emit('host-disable-mic', { userId, disable: false });
        modal.classList.add('opacity-0', '-translate-y-4', 'pointer-events-none');
      };

      denyBtn.onclick = () => {
        modal.classList.add('opacity-0', '-translate-y-4', 'pointer-events-none');
      };
    }
  });

  // Heartbeat pong for network speed
  socket.on('pong-heartbeat', (sentTime) => {
    const latency = Date.now() - sentTime;
    const latencyDisplay = document.getElementById('network-latency');
    const networkIcon = document.getElementById('network-icon');
    
    if (latencyDisplay) {
      latencyDisplay.textContent = `${latency} ms`;
    }

    if (networkIcon) {
      networkIcon.className = 'w-3.5 h-3.5';
      if (latency < 80) {
        networkIcon.classList.add('text-emerald-400'); // Excellent
      } else if (latency < 200) {
        networkIcon.classList.add('text-amber-400'); // Moderate
      } else {
        networkIcon.classList.add('text-red-400'); // Poor
      }
    }
  });

  // Bible Verse Broadcasted
  socket.on('verse-broadcasted', ({ reference, text, translation }) => {
    if (typeof displayBroadcastedVerse === 'function') {
      displayBroadcastedVerse({ reference, text, translation });
    }
  });

  // Clear Broadcasted Verse
  socket.on('broadcast-cleared', () => {
    if (typeof clearBroadcastedVerse === 'function') {
      clearBroadcastedVerse();
    }
  });

  // Presentation Started
  socket.on('presentation-started', (presData) => {
    if (typeof handlePresentationStarted === 'function') {
      handlePresentationStarted(presData);
    }
  });

  // Presentation Stopped
  socket.on('presentation-stopped', () => {
    if (typeof handlePresentationStopped === 'function') {
      handlePresentationStopped();
    }
  });

  // Whiteboard: real-time draw sync
  socket.on('draw-whiteboard', (drawData) => {
    if (typeof handleWhiteboardDraw === 'function') {
      handleWhiteboardDraw(drawData);
    }
  });

  // Whiteboard: clear canvas
  socket.on('whiteboard-cleared', () => {
    if (typeof clearWhiteboardCanvas === 'function') {
      clearWhiteboardCanvas(true); // true = local draw clear
    }
  });

  // Screen share drawing toggle (from host)
  socket.on('screen-drawing-toggled', (data) => {
    if (typeof window.isDrawingEnabled !== 'undefined') {
      window.isDrawingEnabled = data.enabled;
      
      // Update UI for participants
      const canvas = document.getElementById('screen-draw-canvas');
      const drawingTools = document.getElementById('wb-drawing-tools');
      
      if (canvas) {
        canvas.style.cursor = data.enabled ? 'crosshair' : 'default';
      }
      
      // Show/hide tools for participants
      if (drawingTools && !window.isLocalHost) {
        if (data.enabled) {
          drawingTools.classList.remove('hidden');
        } else {
          drawingTools.classList.add('hidden');
        }
      }
    }
  });
}

/**
 * Periodic ping server to calculate network latency.
 */
function startLatencyCheck() {
  if (latencyInterval) clearInterval(latencyInterval);
  latencyInterval = setInterval(() => {
    if (socket && socket.connected) {
      socket.emit('ping-heartbeat');
    }
  }, 5000);
}

function stopLatencyCheck() {
  if (latencyInterval) {
    clearInterval(latencyInterval);
    latencyInterval = null;
  }
}

/**
 * Show a warning banner when websocket connection is dropped.
 */
function showReconnectIndicator() {
  const panel = document.getElementById('reconnect-panel');
  if (panel) {
    panel.classList.remove('opacity-0', 'translate-y-2', 'pointer-events-none');
  }
}

function hideReconnectIndicator() {
  const panel = document.getElementById('reconnect-panel');
  if (panel) {
    panel.classList.add('opacity-0', 'translate-y-2', 'pointer-events-none');
  }
}

/**
 * Play room audio cues.
 */
function playNotificationSound(type) {
  const soundJoin = document.getElementById('sound-join');
  const soundLeave = document.getElementById('sound-leave');
  
  if (type === 'join' && soundJoin) {
    soundJoin.currentTime = 0;
    soundJoin.play().catch(err => {
      console.warn('Audio playback blocked by browser security policy until interaction.', err);
    });
  } else if (type === 'leave' && soundLeave) {
    soundLeave.currentTime = 0;
    soundLeave.play().catch(err => {
      console.warn('Audio playback blocked by browser security policy until interaction.', err);
    });
  }
}

/**
 * Emit local typing status to the server with typing timeout bounce.
 */
function sendLocalTypingState(isTyping) {
  if (!socket) return;
  socket.emit('typing', isTyping);
}

function triggerLocalTypingDebounce() {
  sendLocalTypingState(true);
  if (typingTimeout) clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    sendLocalTypingState(false);
  }, 2000);
}
