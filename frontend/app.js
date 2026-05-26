// app.js - AetherMeet Main Orchestrator and UI Interactions

// Global State
let nickname = '';
let roomId = '';
let meetingTimerInterval = null;
let meetingStartTime = null;
let unreadMessagesCount = 0;
let pinnedParticipantId = null;
let currentLayoutMode = 'spotlight'; // 'grid' or 'spotlight'

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide Icons
  if (window.lucide) {
    lucide.createIcons();
  }

  // Detect which page we are on
  const isLobby = document.getElementById('create-btn') !== null;
  const isMeeting = document.getElementById('video-grid') !== null;

  if (isLobby) {
    initLobby();
  } else if (isMeeting) {
    initMeeting();
  }
});

/* ==========================================
   LOBBY / SETUP SCREEN CODE (index.html)
   ========================================== */

function initLobby() {
  console.log("Initializing Lobby setup...");
  
  // Load saved nickname and checkbox state
  const savedName = localStorage.getItem('aethermeet_nickname');
  const rememberName = localStorage.getItem('aethermeet_remember');
  const nicknameInput = document.getElementById('nickname');
  const rememberCheckbox = document.getElementById('remember-name');

  if (savedName && nicknameInput) {
    nicknameInput.value = savedName;
  }
  if (rememberCheckbox) {
    rememberCheckbox.checked = rememberName === 'true';
  }

  // Bind forms & buttons
  document.getElementById('create-btn').addEventListener('click', handleCreateMeeting);
  document.getElementById('join-btn').addEventListener('click', handleJoinMeeting);
  
  // Enter key support for join
  document.getElementById('room-code').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleJoinMeeting();
  });

  // Media preview toggles
  document.getElementById('toggle-mic-btn').addEventListener('click', toggleLobbyMic);
  document.getElementById('toggle-video-btn').addEventListener('click', toggleLobbyVideo);
  document.getElementById('blur-bg-toggle').addEventListener('change', (e) => {
    toggleBackgroundBlur(e.target.checked);
  });

  // Load hardware media devices
  setupHardwareDevices();
  
  // Initialize WebSocket connection to signaling server
  initSocket(() => {
    console.log("Socket connection established in Lobby.");
    // Read room query parameter if they visited via a shared meeting link
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room') || urlParams.get('join');
    if (roomParam) {
      document.getElementById('room-code').value = roomParam;
    }

    // Display error messages from URL redirects (like kick/end)
    const reasonParam = urlParams.get('reason');
    if (reasonParam === 'kicked') {
      showToastAlert('You were removed from the meeting by the host.');
    } else if (reasonParam === 'ended') {
      showToastAlert('The meeting was ended by the host.');
    }
  });
}

/**
 * Capture camera/microphone permissions and fill HTML dropdown menus.
 */
async function setupHardwareDevices() {
  const loader = document.getElementById('preview-loader');
  
  try {
    // Check for saved device selections from localStorage
    const storedCameraId = localStorage.getItem('aethermeet_selected_camera_id');
    const storedMicId = localStorage.getItem('aethermeet_selected_mic_id');
    const storedSpeakerId = localStorage.getItem('aethermeet_selected_speaker_id');

    // Initial permission request with stored device constraints
    const stream = await getLocalMedia();
    
    // Bind stream to video element
    const previewVideo = document.getElementById('preview-video');
    if (previewVideo) {
      previewVideo.srcObject = stream;
    }

    if (loader) loader.classList.add('opacity-0', 'pointer-events-none');

    // Enumerate devices
    const devices = await navigator.mediaDevices.enumerateDevices();
    
    const camSelect = document.getElementById('camera-select');
    const micSelect = document.getElementById('mic-select');
    const speakerSelect = document.getElementById('speaker-select');

    // Clear old options
    if (camSelect) camSelect.innerHTML = '';
    if (micSelect) micSelect.innerHTML = '';
    if (speakerSelect) speakerSelect.innerHTML = '';

    devices.forEach(device => {
      const option = document.createElement('option');
      option.value = device.deviceId;

      if (device.kind === 'videoinput') {
        option.textContent = device.label || `Camera ${camSelect.length + 1}`;
        if (storedCameraId === device.deviceId) {
          option.selected = true;
        }
        if (camSelect) camSelect.appendChild(option);
      } else if (device.kind === 'audioinput') {
        option.textContent = device.label || `Microphone ${micSelect.length + 1}`;
        if (storedMicId === device.deviceId) {
          option.selected = true;
        }
        if (micSelect) micSelect.appendChild(option);
      } else if (device.kind === 'audiooutput') {
        option.textContent = device.label || `Speaker ${speakerSelect.length + 1}`;
        if (storedSpeakerId === device.deviceId) {
          option.selected = true;
        }
        if (speakerSelect) speakerSelect.appendChild(option);
      }
    });

    // Apply initial speaker output selection if available
    if (storedSpeakerId && previewVideo && typeof previewVideo.setSinkId === 'function') {
      previewVideo.setSinkId(storedSpeakerId)
        .then(() => console.log(`Audio output initially directed to: ${storedSpeakerId}`))
        .catch(err => console.warn('Could not set initial speaker sink ID:', err));
    }

    // Listen for device changes
    if (camSelect) {
      camSelect.addEventListener('change', (e) => changeDevice('video', e.target.value));
    }
    if (micSelect) {
      micSelect.addEventListener('change', (e) => changeDevice('audio', e.target.value));
    }
    if (speakerSelect) {
      speakerSelect.addEventListener('change', (e) => {
        // Persist speaker selection
        localStorage.setItem('aethermeet_selected_speaker_id', e.target.value);
        // Output device sink (requires Chrome/Edge, fallback otherwise)
        const videoEl = document.getElementById('preview-video');
        if (videoEl && typeof videoEl.setSinkId === 'function') {
          videoEl.setSinkId(e.target.value)
            .then(() => console.log(`Audio output directed to: ${e.target.value}`))
            .catch(err => console.warn('Could not set speaker sink ID:', err));
        }
      });
    }

  } catch (err) {
    console.error('Camera/Mic permission access denied:', err);
    if (loader) {
      loader.innerHTML = `
        <i data-lucide="camera-off" class="w-10 h-10 text-red-500 mb-2"></i>
        <span class="text-xs text-red-400 font-semibold text-center px-4">Camera/Microphone Blocked.<br>Please allow permissions in your address bar.</span>
      `;
      lucide.createIcons();
    }
    showToastAlert('Media permissions are required to preview devices and enter call.');
  }
}

function toggleLobbyMic() {
  isAudioMuted = !isAudioMuted;
  const micBtn = document.getElementById('toggle-mic-btn');
  const micIcon = document.getElementById('mic-icon');
  const statusLabel = document.getElementById('mic-status-label');

  if (localAudioTrack) {
    localAudioTrack.enabled = !isAudioMuted;
  }

  if (isAudioMuted) {
    micBtn.classList.add('text-red-500');
    micBtn.classList.remove('text-emerald-400');
    if (micIcon) {
      micIcon.setAttribute('data-lucide', 'mic-off');
    }
    if (statusLabel) {
      statusLabel.textContent = 'Muted';
      statusLabel.classList.add('text-red-400');
      statusLabel.classList.remove('text-slate-400');
    }
  } else {
    micBtn.classList.remove('text-red-500');
    micBtn.classList.add('text-emerald-400');
    if (micIcon) {
      micIcon.setAttribute('data-lucide', 'mic');
    }
    if (statusLabel) {
      statusLabel.textContent = 'Mic Active';
      statusLabel.classList.remove('text-red-400');
      statusLabel.classList.add('text-slate-400');
    }
  }
  lucide.createIcons();
}

function toggleLobbyVideo() {
  isVideoMuted = !isVideoMuted;
  const videoBtn = document.getElementById('toggle-video-btn');
  const videoIcon = document.getElementById('video-icon');
  const mutedOverlay = document.getElementById('camera-muted-overlay');

  if (localVideoTrack) {
    localVideoTrack.enabled = !isVideoMuted;
  }

  if (isVideoMuted) {
    videoBtn.classList.add('text-red-500');
    videoBtn.classList.remove('text-indigo-400');
    if (videoIcon) {
      videoIcon.setAttribute('data-lucide', 'video-off');
    }
    if (mutedOverlay) {
      mutedOverlay.classList.remove('hidden');
    }
  } else {
    videoBtn.classList.remove('text-red-500');
    videoBtn.classList.add('text-indigo-400');
    if (videoIcon) {
      videoIcon.setAttribute('data-lucide', 'video');
    }
    if (mutedOverlay) {
      mutedOverlay.classList.add('hidden');
    }
  }
  lucide.createIcons();
}

function saveNicknameLocally() {
  const nicknameInput = document.getElementById('nickname');
  const rememberCheckbox = document.getElementById('remember-name');
  
  if (!nicknameInput) return false;
  nickname = nicknameInput.value.trim();

  if (!nickname) {
    showToastAlert('Please enter a nickname before continuing.');
    return false;
  }

  const remember = rememberCheckbox ? rememberCheckbox.checked : false;
  localStorage.setItem('aethermeet_remember', remember);
  if (remember) {
    localStorage.setItem('aethermeet_nickname', nickname);
  } else {
    localStorage.removeItem('aethermeet_nickname');
  }

  // Keep nickname in session cache for room loading
  sessionStorage.setItem('aethermeet_temp_nickname', nickname);
  
  // Save device config preferences
  sessionStorage.setItem('aethermeet_audio_muted', isAudioMuted);
  sessionStorage.setItem('aethermeet_video_muted', isVideoMuted);
  sessionStorage.setItem('aethermeet_blur_bg', isBlurActive);

  return true;
}

function handleCreateMeeting() {
  if (!saveNicknameLocally()) return;

  // Generate 9 character room ID: xxx-xxxx-xxx
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let randRoom = '';
  for (let i = 0; i < 9; i++) {
    if (i === 3 || i === 7) randRoom += '-';
    randRoom += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  // Redirect to call page
  window.location.href = `meeting.html?room=${randRoom}`;
}

function handleJoinMeeting() {
  if (!saveNicknameLocally()) return;

  let roomVal = document.getElementById('room-code').value.trim();
  
  // Support pasting full meeting URLs
  if (roomVal.includes('/meeting.html?room=')) {
    const url = new URL(roomVal);
    roomVal = url.searchParams.get('room');
  } else if (roomVal.includes('/meeting?room=')) {
    const url = new URL(roomVal);
    roomVal = url.searchParams.get('room');
  }

  // Clean room code
  roomVal = roomVal.toLowerCase().replace(/[^a-z0-9-]/g, '');

  if (!roomVal) {
    showToastAlert('Please enter a valid room ID or paste a meeting link.');
    return;
  }

  roomId = roomVal;

  // Validate room status with socket server before loading page
  if (socket && socket.connected) {
    socket.emit('validate-room', { roomId: roomVal, nickname }, (response) => {
      if (response.valid) {
        if (response.exists) {
          // Room exists and is open. Wait, does it require approval?
          // For security, if room is locked or host has knock on, we do a knock.
          // Let's request join
          socket.emit('request-join', { roomId: roomVal, nickname });
          
          socket.on('waiting-for-approval', () => {
            const modal = document.getElementById('knock-modal');
            const hostNamePlaceholder = document.getElementById('host-name-placeholder');
            if (hostNamePlaceholder) hostNamePlaceholder.textContent = response.hostName;
            if (modal) modal.classList.remove('opacity-0', 'pointer-events-none');
            
            // Cancel button
            document.getElementById('cancel-knock-btn').onclick = () => {
              window.location.reload();
            };
          });

          socket.on('join-request-approved', () => {
            window.location.href = `meeting.html?room=${roomVal}`;
          });

          socket.on('join-request-rejected', (reason) => {
            const modal = document.getElementById('knock-modal');
            if (modal) modal.classList.add('opacity-0', 'pointer-events-none');
            showToastAlert(reason || 'Host rejected your join request.');
          });

        } else {
          // Room doesn't exist, we will create it and become host
          window.location.href = `meeting.html?room=${roomVal}`;
        }
      } else {
        showToastAlert(response.reason || 'Cannot join this room.');
      }
    });
  } else {
    showToastAlert('Signaling server is unreachable. Please try again.');
  }
}

function showToastAlert(message) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-message');
  
  if (toast && toastMsg) {
    toastMsg.textContent = message;
    toast.classList.remove('opacity-0', 'translate-y-2', 'pointer-events-none');
    
    // Hide toast after 4s
    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-2', 'pointer-events-none');
    }, 4000);
  }
}


/* ==========================================
   MEETING CALL SCREEN CODE (meeting.html)
   ========================================== */

function initMeeting() {
  console.log("Initializing Active Meeting room...");

  // Parse room query param
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');

  if (!roomParam) {
    alert("Invalid Meeting Link. Redirecting to Lobby.");
    window.location.href = 'index.html';
    return;
  }

  roomId = roomParam;
  roomName = roomParam;

  // Retrieve temporary nickname
  nickname = sessionStorage.getItem('aethermeet_temp_nickname');
  if (!nickname) {
    // If no nickname, redirect back to lobby with room code preserved
    window.location.href = `index.html?room=${roomId}`;
    return;
  }

  // Load configured media preferences from lobby
  isAudioMuted = sessionStorage.getItem('aethermeet_audio_muted') === 'true';
  isVideoMuted = sessionStorage.getItem('aethermeet_video_muted') === 'true';
  isBlurActive = sessionStorage.getItem('aethermeet_blur_bg') === 'true';

  // Bind footer controls UI events
  document.getElementById('btn-mic').addEventListener('click', toggleCallMic);
  document.getElementById('btn-video').addEventListener('click', toggleCallVideo);
  document.getElementById('btn-screen').addEventListener('click', toggleScreenShareState);
  document.getElementById('btn-hand').addEventListener('click', toggleHandRaise);
  document.getElementById('btn-leave').addEventListener('click', handleLeaveCall);
  
  // Emoji triggers
  const reactionBtn = document.getElementById('btn-reaction');
  const reactionSubBar = document.getElementById('reaction-sub-bar');
  if (reactionBtn && reactionSubBar) {
    reactionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      reactionSubBar.classList.toggle('active');
    });
    // Click outside to close emoji popup
    document.addEventListener('click', () => {
      reactionSubBar.classList.remove('active');
    });
  }

  const emojiButtons = document.querySelectorAll('.reaction-emoji-btn');
  emojiButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const emoji = btn.getAttribute('data-emoji');
      if (socket) {
        socket.emit('send-reaction', emoji);
      }
      reactionSubBar.classList.remove('active');
    });
  });

  // Settings modals
  document.getElementById('btn-settings').addEventListener('click', openSettingsModal);
  document.getElementById('close-settings-btn').addEventListener('click', closeSettingsModal);
  document.getElementById('save-settings-btn').addEventListener('click', applySettingsChanges);

  // Layout switcher listener
  const btnLayout = document.getElementById('btn-layout');
  if (btnLayout) {
    btnLayout.addEventListener('click', () => {
      currentLayoutMode = currentLayoutMode === 'spotlight' ? 'grid' : 'spotlight';
      showNotificationToast(`Layout changed to ${currentLayoutMode === 'spotlight' ? 'Speaker Spotlight' : 'Standard Grid'}`);
      
      const btnLayoutIcon = document.getElementById('btn-layout-icon');
      if (btnLayoutIcon) {
        btnLayoutIcon.setAttribute('data-lucide', currentLayoutMode === 'spotlight' ? 'layout-grid' : 'layout');
        lucide.createIcons();
      }
      
      if (currentLayoutMode === 'grid') {
        destroyPinnedLayoutUI();
      }
      reorganizeGrid();
    });
  }

  // Chat/Participants Sidebar toggles
  document.getElementById('btn-toggle-chat').addEventListener('click', () => toggleSidebarTab('chat'));
  document.getElementById('btn-toggle-participants').addEventListener('click', () => toggleSidebarTab('participants'));
  document.getElementById('tab-chat-btn').addEventListener('click', () => switchSidebarTab('chat'));
  document.getElementById('tab-participants-btn').addEventListener('click', () => switchSidebarTab('participants'));
  document.getElementById('close-sidebar-btn').addEventListener('click', closeSidebar);

  // Send Chat Message Form
  document.getElementById('chat-form').addEventListener('submit', handleSendChatMessage);
  
  // Chat typing indicator hook
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.addEventListener('input', triggerLocalTypingDebounce);
  }

  // Copy invitation link
  document.getElementById('copy-invite-btn').addEventListener('click', copyInviteMeetingLink);

  // Room host lock toggle
  const lockToggle = document.getElementById('lock-room-toggle');
  if (lockToggle) {
    lockToggle.addEventListener('change', (e) => {
      if (socket && isLocalHost) {
        socket.emit('toggle-lock-room', e.target.checked);
      }
    });
  }

  // Set local user UI defaults
  document.getElementById('local-name-tag').textContent = `${nickname} (You)`;
  document.getElementById('room-display-name').textContent = `Room ID: ${roomId}`;
  
  // Double-click to pin local user video card
  const localCard = document.getElementById('local-video-card');
  if (localCard) {
    localCard.addEventListener('dblclick', () => pinParticipantVideo('local'));
  }
  
  // Sync buttons visual active states
  syncControlButtonsUI();

  // Setup Hotkeys
  setupKeyboardShortcuts();

  // Initialize socket client
  initSocket(async () => {
    console.log("Socket connected on call screen. Requesting hardware devices...");
    
    try {
      // 1. Capture camera/microphone
      const stream = await getLocalMedia();
      
      // 2. Display local stream
      const localVideo = document.getElementById('local-video');
      if (localVideo) {
        localVideo.srcObject = stream;
      }
      
      // If camera was disabled from lobby, sync overlay
      if (isVideoMuted) {
        const localMutedOverlay = document.querySelector('.local-cam-muted');
        if (localMutedOverlay) {
          localMutedOverlay.querySelector('p').textContent = `${nickname} (Camera Muted)`;
          localMutedOverlay.classList.remove('hidden');
        }
      }

      // Sync initial local audio indicator icon
      const micStatus = document.getElementById('local-mic-status');
      if (micStatus) {
        micStatus.innerHTML = `<i data-lucide="${isAudioMuted ? 'mic-off' : 'mic'}" class="w-3.5 h-3.5 ${isAudioMuted ? 'text-red-400' : 'text-emerald-400'}"></i>`;
        lucide.createIcons();
      }

      // 3. Emit join-room to server
      socket.emit('join-room', { roomId, nickname });

      // Start meeting clock
      startMeetingTimer();

    } catch (e) {
      console.error('Call initialization media failure:', e);
      alert('Could not start meeting. Verify your camera/microphone are connected and permissions are allowed.');
      window.location.href = 'index.html';
    }
  });

  // Re-adjust video grid tiles when window is resized
  window.addEventListener('resize', reorganizeGrid);
}

/**
 * Sync bottom dock button styles to match active toggle states.
 */
function syncControlButtonsUI() {
  const btnMic = document.getElementById('btn-mic');
  const btnMicIcon = document.getElementById('btn-mic-icon');
  const btnVideo = document.getElementById('btn-video');
  const btnVideoIcon = document.getElementById('btn-video-icon');

  if (isAudioMuted) {
    btnMic.classList.add('bg-red-500/10', 'border-red-500/20', 'text-red-400');
    btnMic.classList.remove('bg-emerald-500/10', 'border-emerald-500/20', 'text-emerald-400');
    btnMicIcon.setAttribute('data-lucide', 'mic-off');
  } else {
    btnMic.classList.remove('bg-red-500/10', 'border-red-500/20', 'text-red-400');
    btnMic.classList.add('bg-emerald-500/10', 'border-emerald-500/20', 'text-emerald-400');
    btnMicIcon.setAttribute('data-lucide', 'mic');
  }

  if (isVideoMuted) {
    btnVideo.classList.add('bg-red-500/10', 'border-red-500/20', 'text-red-400');
    btnVideo.classList.remove('bg-indigo-500/10', 'border-indigo-500/20', 'text-indigo-400');
    btnVideoIcon.setAttribute('data-lucide', 'video-off');
  } else {
    btnVideo.classList.remove('bg-red-500/10', 'border-red-500/20', 'text-red-400');
    btnVideo.classList.add('bg-indigo-500/10', 'border-indigo-500/20', 'text-indigo-400');
    btnVideoIcon.setAttribute('data-lucide', 'video');
  }

  lucide.createIcons();
}

function updateScreenShareUIButton(active) {
  const btnScreen = document.getElementById('btn-screen');
  const btnScreenIcon = document.getElementById('btn-screen-icon');
  
  if (active) {
    btnScreen.classList.add('bg-indigo-500/10', 'border-indigo-500/20', 'text-indigo-400');
    btnScreen.classList.remove('bg-slate-900', 'border-slate-800', 'text-slate-300');
  } else {
    btnScreen.classList.remove('bg-indigo-500/10', 'border-indigo-500/20', 'text-indigo-400');
    btnScreen.classList.add('bg-slate-900', 'border-slate-800', 'text-slate-300');
  }
}

/**
 * Handle initial list load and WebRTC peer connection creation for all pre-existing room users.
 */
function handleRoomJoined(existingParticipants) {
  console.log("Setting up connections to pre-existing participants...", existingParticipants);
  
  // Set up peer connections
  existingParticipants.forEach(participant => {
    // We are the initiator (joining later), so we create the connection and offer
    createPeerConnection(participant.socketId, participant.nickname, true, participant.isHost);
  });

  updateParticipantsList();
}

/**
 * Toggles microphone mute state during meeting.
 */
function toggleCallMic() {
  if (isMicDisabledByHost) {
    showNotificationToast("Microphone disabled by host. Requesting unmute permission...");
    if (socket) socket.emit('request-unmute-permission');
    return;
  }

  muteLocalAudio(!isAudioMuted);
}

function muteLocalAudio(mutedState) {
  isAudioMuted = mutedState;
  
  if (localAudioTrack) {
    localAudioTrack.enabled = !isAudioMuted;
  }
  
  // Update local video element indicators
  const micStatus = document.getElementById('local-mic-status');
  if (micStatus) {
    micStatus.innerHTML = `<i data-lucide="${isAudioMuted ? 'mic-off' : 'mic'}" class="w-3.5 h-3.5 ${isAudioMuted ? 'text-red-400' : 'text-emerald-400'}"></i>`;
    lucide.createIcons();
  }

  // Update button visual state
  syncControlButtonsUI();

  // Notify server/other users
  if (socket) socket.emit('toggle-audio', isAudioMuted);
  updateParticipantsList();
}

/**
 * Toggles camera mute state during meeting.
 */
function toggleCallVideo() {
  isVideoMuted = !isVideoMuted;
  
  if (localVideoTrack) {
    localVideoTrack.enabled = !isVideoMuted;
  }

  // Sync Overlay inside local video card
  const localMutedOverlay = document.querySelector('.local-cam-muted');
  if (localMutedOverlay) {
    if (isVideoMuted) {
      localMutedOverlay.classList.remove('hidden');
    } else {
      localMutedOverlay.classList.add('hidden');
    }
  }

  // Update button visual state
  syncControlButtonsUI();

  // Notify server/other users
  if (socket) socket.emit('toggle-video', isVideoMuted);
  updateParticipantsList();
}

/**
 * Hand raise notification.
 */
let localHandRaised = false;
function toggleHandRaise() {
  localHandRaised = !localHandRaised;
  const btnHand = document.getElementById('btn-hand');
  
  if (localHandRaised) {
    btnHand.classList.add('bg-amber-500/10', 'border-amber-500/20', 'text-amber-400');
    btnHand.classList.remove('bg-slate-900', 'border-slate-800', 'text-slate-300');
    showNotificationToast("You raised your hand ✋");
  } else {
    btnHand.classList.remove('bg-amber-500/10', 'border-amber-500/20', 'text-amber-400');
    btnHand.classList.add('bg-slate-900', 'border-slate-800', 'text-slate-300');
  }

  if (socket) socket.emit('raise-hand', localHandRaised);
}

/**
 * Remote peer trackers updates.
 */
function updateRemoteAudioState(userId, isMuted) {
  const peerRecord = peers.get(userId);
  if (peerRecord) {
    peerRecord.remoteAudioMuted = isMuted;
  }

  const micId = (userId === myParticipantId || userId === 'local' || userId === (socket ? socket.id : null)) ? 'local-mic-status' : `mic-status-${userId}`;
  const micStatus = document.getElementById(micId);
  if (micStatus) {
    micStatus.innerHTML = `<i data-lucide="${isMuted ? 'mic-off' : 'mic'}" class="w-3.5 h-3.5 ${isMuted ? 'text-red-400' : 'text-emerald-400'}"></i>`;
    lucide.createIcons();
  }
  updateParticipantsList();
}

function updateRemoteVideoState(userId, isCameraOff) {
  const peerRecord = peers.get(userId);
  if (peerRecord) {
    peerRecord.remoteVideoMuted = isCameraOff;
  }

  const overlayId = (userId === myParticipantId || userId === 'local' || userId === (socket ? socket.id : null)) ? 'local-cam-muted' : `muted-overlay-${userId}`;
  const mutedOverlay = document.getElementById(overlayId);
  if (mutedOverlay) {
    if (isCameraOff) {
      mutedOverlay.classList.remove('hidden');
    } else {
      mutedOverlay.classList.add('hidden');
    }
  }
  updateParticipantsList();
}

function updateRemoteScreenState(userId, isScreenSharing) {
  const screenId = (userId === myParticipantId || userId === 'local' || userId === (socket ? socket.id : null)) ? 'local-screen-status' : `screen-status-${userId}`;
  const screenStatus = document.getElementById(screenId);
  const videoId = (userId === myParticipantId || userId === 'local' || userId === (socket ? socket.id : null)) ? 'local-video' : `video-${userId}`;
  const remoteVideo = document.getElementById(videoId);
  const peerRecord = peers.get(userId);

  if (screenStatus) {
    if (isScreenSharing) {
      screenStatus.classList.remove('hidden');
      if (remoteVideo) remoteVideo.classList.remove('scale-x-[-1]'); // Don't mirror screen shares
    } else {
      screenStatus.classList.add('hidden');
      if (remoteVideo) remoteVideo.classList.add('scale-x-[-1]'); // Mirror standard feeds
    }
  }
  
  // Re-run source binder if stream needs refresh
  if (peerRecord && peerRecord.stream && remoteVideo) {
    remoteVideo.srcObject = peerRecord.stream;
  }
}

function updateRemoteHandState(userId, isRaised) {
  const handId = (userId === myParticipantId || userId === 'local' || userId === (socket ? socket.id : null)) ? 'hand-status-local' : `hand-status-${userId}`;
  const handBadge = document.getElementById(handId);
  if (handBadge) {
    if (isRaised) {
      handBadge.classList.remove('hidden');
    } else {
      handBadge.classList.add('hidden');
    }
  }
}

/**
 * Copy invitation code.
 */
function copyInviteMeetingLink() {
  const inviteInput = document.getElementById('invite-link-input');
  const copyBtn = document.getElementById('copy-invite-btn');
  
  if (inviteInput) {
    inviteInput.select();
    inviteInput.setSelectionRange(0, 99999);
    
    // Copy clipboard
    navigator.clipboard.writeText(inviteInput.value)
      .then(() => {
        if (copyBtn) {
          copyBtn.innerHTML = `<i data-lucide="check" class="w-3.5 h-3.5"></i><span class="hidden sm:inline">Copied!</span>`;
          copyBtn.classList.replace('bg-brand-600', 'bg-emerald-600');
          lucide.createIcons();
          
          setTimeout(() => {
            copyBtn.innerHTML = `<i data-lucide="copy" class="w-3.5 h-3.5"></i><span class="hidden sm:inline">Copy</span>`;
            copyBtn.classList.replace('bg-emerald-600', 'bg-brand-600');
            lucide.createIcons();
          }, 2000);
        }
        showNotificationToast("Invitation link copied to clipboard.");
      })
      .catch(err => {
        console.warn('Failed to copy link using clipboard API:', err);
      });
  }
}

/**
 * Exit Meeting Room.
 */
function handleLeaveCall() {
  if (typeof Swal === 'undefined') {
    // Fallback if SweetAlert2 is not loaded yet
    const confirmation = confirm("Are you sure you want to leave this meeting?");
    if (confirmation) {
      if (isLocalHost) {
        const endForAll = confirm("Do you want to end this meeting for all participants?");
        if (endForAll && socket) {
          let redirected = false;
          const doRedirect = () => {
            if (redirected) return;
            redirected = true;
            stopLocalMedia();
            socket.disconnect();
            window.location.href = 'index.html?reason=ended';
          };
          socket.emit('host-end-room', () => {
            doRedirect();
          });
          setTimeout(doRedirect, 500);
          return;
        }
      }
      stopLocalMedia();
      if (socket) socket.disconnect();
      window.location.href = 'index.html';
    }
    return;
  }

  // Host SweetAlert2 Dialog
  if (isLocalHost) {
    Swal.fire({
      title: 'Exit Meeting Options',
      text: 'Since you are the host, would you like to end the meeting for everyone or just leave quietly?',
      icon: 'warning',
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: 'End Meeting for All',
      denyButtonText: 'Leave Quietly',
      cancelButtonText: 'Cancel',
      background: '#070a13',
      color: '#f1f5f9',
      confirmButtonColor: '#ef4444', // Red for ending call
      denyButtonColor: '#7c3aed', // Purple brand color to leave quietly
      cancelButtonColor: '#1e293b', // Slate-800
      customClass: {
        popup: 'border border-slate-800 rounded-2xl shadow-2xl backdrop-blur-md',
        title: 'font-bold text-white tracking-wide',
        htmlContainer: 'text-slate-400 text-xs mt-2'
      }
    }).then((result) => {
      if (result.isConfirmed) {
        // End for everyone
        let redirected = false;
        const doRedirect = () => {
          if (redirected) return;
          redirected = true;
          stopLocalMedia();
          socket.disconnect();
          window.location.href = 'index.html?reason=ended';
        };
        socket.emit('host-end-room', () => {
          doRedirect();
        });
        setTimeout(doRedirect, 500);
      } else if (result.isDenied) {
        // Leave quietly
        stopLocalMedia();
        if (socket) socket.disconnect();
        window.location.href = 'index.html';
      }
    });
  } else {
    // Normal Participant SweetAlert2 Dialog
    Swal.fire({
      title: 'Leave Meeting?',
      text: 'Are you sure you want to disconnect from this call?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Yes, Leave',
      cancelButtonText: 'Cancel',
      background: '#070a13',
      color: '#f1f5f9',
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#1e293b',
      customClass: {
        popup: 'border border-slate-800 rounded-2xl shadow-2xl backdrop-blur-md',
        title: 'font-bold text-white tracking-wide',
        htmlContainer: 'text-slate-400 text-xs mt-2'
      }
    }).then((result) => {
      if (result.isConfirmed) {
        stopLocalMedia();
        if (socket) socket.disconnect();
        window.location.href = 'index.html';
      }
    });
  }
}

/* ==========================================
   DYNAMIC VIDEO GRID RESIZER CODE
   ========================================== */

/**
 * Creates and renders a new HTML video frame for remote connections.
 */
function renderRemoteVideoTile(remoteSocketId, nickname, stream, isHost) {
  const existingCard = document.getElementById(`card-${remoteSocketId}`);
  if (existingCard) return;

  const grid = document.getElementById('video-grid');
  if (!grid) return;

  // Build card wrapper HTML structure
  const card = document.createElement('div');
  card.id = `card-${remoteSocketId}`;
  card.className = "relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 aspect-video w-full h-full shadow-lg group max-w-full max-h-full transition-all duration-300 cursor-pointer";
  
  // Double-click to pin participant video
  card.addEventListener('dblclick', () => pinParticipantVideo(remoteSocketId));

  card.innerHTML = `
    <!-- Video Element -->
    <video id="video-${remoteSocketId}" class="w-full h-full object-cover transform scale-x-[-1]" autoplay playsinline></video>

    <!-- Muted Overlay -->
    <div id="muted-overlay-${remoteSocketId}" class="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center z-20 hidden">
      <div class="w-16 h-16 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-500 mb-2">
        <i data-lucide="user" class="w-8 h-8"></i>
      </div>
      <p class="text-xs text-slate-400 font-semibold">${nickname} (Camera Muted)</p>
    </div>

    <!-- Pinned Indicator overlay -->
    <button onclick="event.stopPropagation(); unpinParticipantVideo();" id="pin-indicator-${remoteSocketId}" class="absolute top-3 left-3 z-30 w-7 h-7 rounded-lg bg-slate-950/80 border border-slate-800/80 backdrop-blur-md flex items-center justify-center text-brand-400 hover:text-white hover:bg-brand-600 transition-all hidden" title="Unpin Video">
      <i data-lucide="pin-off" class="w-3.5 h-3.5"></i>
    </button>

    <!-- Hand Raised overlay indicator -->
    <div id="hand-status-${remoteSocketId}" class="absolute top-3 right-12 z-30 w-7 h-7 rounded-lg bg-amber-500/90 border border-amber-400/80 backdrop-blur-md flex items-center justify-center text-slate-950 hidden">
      <i data-lucide="hand" class="w-3.5 h-3.5"></i>
    </div>

    <!-- Bottom bar overlay info -->
    <div class="absolute bottom-3 left-3 right-3 z-30 flex items-center justify-between pointer-events-none">
      <!-- Tag Name -->
      <div class="bg-slate-950/80 border border-slate-800/80 backdrop-blur-md rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-200 flex items-center space-x-1.5 pointer-events-auto">
        <span>${nickname}</span>
        ${isHost ? `<span class="bg-brand-500/20 border border-brand-500/30 text-brand-400 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider">Host</span>` : ''}
      </div>
      
      <!-- Status Icons -->
      <div class="flex items-center space-x-1.5 pointer-events-auto">
        <!-- Mic -->
        <div id="mic-status-${remoteSocketId}" class="w-7 h-7 rounded-lg bg-slate-950/80 border border-slate-800/80 backdrop-blur-md flex items-center justify-center text-slate-200">
          <i data-lucide="mic" class="w-3.5 h-3.5 text-emerald-400"></i>
        </div>
        
        <!-- Screen Sharing -->
        <div id="screen-status-${remoteSocketId}" class="w-7 h-7 rounded-lg bg-slate-950/80 border border-slate-800/80 backdrop-blur-md flex items-center justify-center text-indigo-400 hidden">
          <i data-lucide="monitor" class="w-3.5 h-3.5"></i>
        </div>
      </div>
    </div>
  `;

  grid.appendChild(card);
  
  // Set video source
  const remoteVideo = document.getElementById(`video-${remoteSocketId}`);
  if (remoteVideo) {
    remoteVideo.srcObject = stream;
    
    // Apply stored speaker output destination if supported
    const storedSpeakerId = localStorage.getItem('aethermeet_selected_speaker_id');
    if (storedSpeakerId && typeof remoteVideo.setSinkId === 'function') {
      remoteVideo.setSinkId(storedSpeakerId)
        .catch(err => console.warn(`Could not set speaker sink ID on remote video:`, err));
    }

    // Autoplay policy fallback: explicitly invoke play
    remoteVideo.play().catch(err => {
      console.warn(`Autoplay blocked for peer: ${nickname}. Retrying on user interaction.`, err);
      remoteVideo.addEventListener('click', () => {
        remoteVideo.play();
      }, { once: true });
    });
  }

  // Force icon creation
  lucide.createIcons();

  // Reorganize Layout
  reorganizeGrid();
}

/**
 * Custom math layout logic to size grids nicely according to aspect ratio and tile counts.
 */
function reorganizeGrid() {
  const grid = document.getElementById('video-grid');
  if (!grid) return;

  // Calculate total tiles including tray children if layout is split
  const tray = document.getElementById('pinned-layout-tray');
  const trayCount = tray ? tray.children.length : 0;
  const mainCount = Array.from(grid.children).filter(c => c.id !== 'pinned-layout-tray').length;
  const totalTiles = mainCount + trayCount;

  if (totalTiles === 0) return;

  // The spotlight participant can be a manually pinned user, or the active speaker if layout mode is 'spotlight'
  const spotlightId = pinnedParticipantId || (currentLayoutMode === 'spotlight' && totalTiles > 1 && activeSpeakerId ? activeSpeakerId : null);

  if (spotlightId) {
    setupPinnedLayout(spotlightId);
    return;
  }

  // Restore defaults from pinned layout styles (destroys tray and resets classes)
  destroyPinnedLayoutUI();

  grid.classList.remove('flex', 'flex-col', 'lg:flex-row');
  grid.classList.add('grid');
  grid.style.flexDirection = '';

  const containerWidth = grid.offsetWidth;
  const containerHeight = grid.offsetHeight;
  
  // Calculate grid columns and rows based on tile density
  let cols = 1;
  let rows = 1;

  if (totalTiles <= 1) {
    cols = 1; rows = 1;
  } else if (totalTiles <= 2) {
    cols = containerWidth > containerHeight ? 2 : 1;
    rows = containerWidth > containerHeight ? 1 : 2;
  } else if (totalTiles <= 4) {
    cols = 2; rows = 2;
  } else if (totalTiles <= 6) {
    cols = 3; rows = 2;
  } else if (totalTiles <= 9) {
    cols = 3; rows = 3;
  } else {
    cols = 4; rows = Math.ceil(totalTiles / 4);
  }

  grid.className = `flex-grow grid gap-4 items-center justify-center content-center transition-all duration-300`;
  grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;

  // Scale height of tiles to fit appropriately within grid height bounds
  const cards = grid.querySelectorAll('.relative');
  cards.forEach(card => {
    card.style.maxWidth = '100%';
    card.style.maxHeight = '100%';
    card.style.width = '100%';
    card.style.height = '100%';
    card.style.aspectRatio = '16/9';
  });
}

/**
 * Custom layout displaying a pinned user large, with remaining participants in a right/bottom tray.
 */
function pinParticipantVideo(participantId) {
  // If clicking on already pinned user, unpin
  if (pinnedParticipantId === participantId) {
    unpinParticipantVideo();
    return;
  }

  // Remove indicator from old pinned participant
  if (pinnedParticipantId) {
    const oldIndicator = document.getElementById(`pin-indicator-${pinnedParticipantId}`);
    if (oldIndicator) oldIndicator.classList.add('hidden');
  }

  pinnedParticipantId = participantId;
  console.log(`Pinning video stream for: ${participantId}`);

  // Display indicator on pinned card
  const newIndicator = document.getElementById(`pin-indicator-${participantId}`);
  if (newIndicator) newIndicator.classList.remove('hidden');

  reorganizeGrid();
}

function unpinParticipantVideo() {
  if (!pinnedParticipantId) return;

  const indicator = document.getElementById(`pin-indicator-${pinnedParticipantId}`);
  if (indicator) indicator.classList.add('hidden');

  pinnedParticipantId = null;
  console.log("Unpinning video stream");
  destroyPinnedLayoutUI();
  reorganizeGrid();
}

function setupPinnedLayout(spotlightId) {
  const grid = document.getElementById('video-grid');
  if (!grid) return;

  // Reset all card parents to grid before splitting to avoid parent hierarchy bugs
  destroyPinnedLayoutUI();

  // If total tiles is 1 or less, we don't need a split layout
  const totalTiles = grid.children.length;
  if (totalTiles <= 1) {
    return;
  }

  // Separate pinned element card from others
  const pinnedCardId = spotlightId === 'local' ? 'local-video-card' : `card-${spotlightId}`;
  const pinnedCard = document.getElementById(pinnedCardId);
  
  if (!pinnedCard) {
    // Fallback if target left
    if (pinnedParticipantId === spotlightId) pinnedParticipantId = null;
    if (activeSpeakerId === spotlightId) activeSpeakerId = null;
    reorganizeGrid();
    return;
  }

  // Redraw layout: Split grid container to Flex row (large video left, panel tray right)
  grid.classList.remove('grid');
  grid.classList.add('flex', 'flex-col', 'lg:flex-row', 'gap-4', 'w-full', 'h-full');
  grid.style.gridTemplateColumns = '';
  grid.style.gridTemplateRows = '';

  // Create a Tray Container
  const tray = document.createElement('div');
  tray.id = 'pinned-layout-tray';
  tray.className = 'flex flex-row lg:flex-col gap-3 overflow-x-auto lg:overflow-y-auto lg:overflow-x-hidden w-full lg:w-64 h-32 lg:h-full shrink-0 items-start align-top';
  grid.appendChild(tray);

  // Place pinned card as primary occupant
  pinnedCard.style.width = '';
  pinnedCard.style.height = '';
  pinnedCard.className = "relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 aspect-video flex-grow shadow-lg group max-w-full max-h-full transition-all duration-300 cursor-pointer order-first";

  // Move other cards to tray
  const allCards = Array.from(grid.children).filter(c => c.id !== pinnedCardId && c.id !== 'pinned-layout-tray');
  
  allCards.forEach(card => {
    tray.appendChild(card);
    card.className = "relative rounded-xl overflow-hidden bg-slate-950 border border-slate-850 aspect-video w-36 lg:w-full shrink-0 shadow-md group transition-all duration-300 cursor-pointer";
    card.style.width = '';
    card.style.height = '';
  });
}

/**
 * Handle deletion of tray and restore elements before rearranging.
 */
function destroyPinnedLayoutUI() {
  const tray = document.getElementById('pinned-layout-tray');
  if (tray) {
    const grid = document.getElementById('video-grid');
    if (grid) {
      // Move all children back to grid
      while (tray.firstChild) {
        const card = tray.firstChild;
        grid.appendChild(card);
        
        // Restore standard grid classes
        if (card.id === 'local-video-card') {
          card.className = "relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 aspect-video w-full h-full shadow-lg group max-w-full max-h-full transition-all duration-300";
        } else {
          card.className = "relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 aspect-video w-full h-full shadow-lg group max-w-full max-h-full transition-all duration-300 cursor-pointer";
        }
      }
    }
    tray.remove();
  }

  // Also restore classes for the pinned card which remained in the main grid
  const localCard = document.getElementById('local-video-card');
  if (localCard) {
    localCard.className = "relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 aspect-video w-full h-full shadow-lg group max-w-full max-h-full transition-all duration-300";
  }
  peers.forEach((peer, socketId) => {
    const card = document.getElementById(`card-${socketId}`);
    if (card) {
      card.className = "relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 aspect-video w-full h-full shadow-lg group max-w-full max-h-full transition-all duration-300 cursor-pointer";
    }
  });
}

// Override destroy peer logic to safely handle pinned deletions
const baseDestroyPeerConnection = destroyPeerConnection;
destroyPeerConnection = (socketId) => {
  if (pinnedParticipantId === socketId) {
    pinnedParticipantId = null;
  }
  
  // Cleanup tray elements if they are about to be destroyed
  const card = document.getElementById(`card-${socketId}`);
  if (card && card.parentElement && card.parentElement.id === 'pinned-layout-tray') {
    card.remove();
  }

  baseDestroyPeerConnection(socketId);
  destroyPinnedLayoutUI();
  reorganizeGrid();
};


/* ==========================================
   SIDEBAR TABS PANEL CODE (Chat & Users)
   ========================================== */

function toggleSidebarTab(tabName) {
  const sidebar = document.getElementById('sidebar');
  const isCurrentlyOpen = !sidebar.classList.contains('translate-x-full');
  
  // If sidebar is open and they click the active tab button, close it
  const activeTab = document.getElementById(`tab-${tabName}`).classList.contains('hidden') ? '' : tabName;

  if (isCurrentlyOpen && activeTab === tabName) {
    closeSidebar();
  } else {
    // Open sidebar and load tab
    sidebar.classList.remove('translate-x-full');
    switchSidebarTab(tabName);
  }
}

function closeSidebar() {
  document.getElementById('sidebar').classList.add('translate-x-full');
}

function switchSidebarTab(tabName) {
  const chatTab = document.getElementById('tab-chat');
  const chatBtn = document.getElementById('tab-chat-btn');
  const participantsTab = document.getElementById('tab-participants');
  const participantsBtn = document.getElementById('tab-participants-btn');

  if (tabName === 'chat') {
    chatTab.classList.remove('hidden');
    participantsTab.classList.add('hidden');
    
    // Buttons styling
    chatBtn.className = "flex-grow py-2 text-xs font-semibold rounded-lg bg-slate-900 border border-slate-800 text-white transition-all flex items-center justify-center space-x-1.5";
    participantsBtn.className = "flex-grow py-2 text-xs font-semibold rounded-lg text-slate-400 hover:text-slate-200 transition-all flex items-center justify-center space-x-1.5";

    // Clear chat count badge
    unreadMessagesCount = 0;
    const badge = document.getElementById('chat-badge');
    const badgeDot = document.getElementById('chat-notification-dot');
    if (badge) badge.classList.add('hidden');
    if (badgeDot) badgeDot.classList.add('hidden');

  } else if (tabName === 'participants') {
    chatTab.classList.add('hidden');
    participantsTab.classList.remove('hidden');

    chatBtn.className = "flex-grow py-2 text-xs font-semibold rounded-lg text-slate-400 hover:text-slate-200 transition-all flex items-center justify-center space-x-1.5";
    participantsBtn.className = "flex-grow py-2 text-xs font-semibold rounded-lg bg-slate-900 border border-slate-800 text-white transition-all flex items-center justify-center space-x-1.5";

    updateParticipantsList();
  }
}

/**
 * Sends a chat message.
 */
function handleSendChatMessage(e) {
  e.preventDefault();
  const input = document.getElementById('chat-input');
  if (!input) return;

  const msgText = input.value.trim();
  if (!msgText) return;

  // Send message via socket
  if (socket) {
    socket.emit('send-chat', msgText);
    socket.emit('typing', false); // Stop typing indicator
  }

  input.value = '';
}

/**
 * Appends messages to HTML bubble wall.
 */
function appendChatMessage(chatData) {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  const isSelf = chatData.senderId === socket.id;
  
  const msgBubble = document.createElement('div');
  msgBubble.className = `flex flex-col max-w-[85%] ${isSelf ? 'ml-auto items-end' : 'mr-auto items-start'} space-y-1`;

  msgBubble.innerHTML = `
    <span class="text-[10px] text-slate-500 font-semibold px-1">${isSelf ? 'You' : chatData.senderName} • ${chatData.timestamp}</span>
    <div class="px-3.5 py-2.5 rounded-2xl text-xs font-medium ${isSelf ? 'bg-gradient-to-tr from-brand-600 to-indigo-500 text-white rounded-tr-none' : 'bg-slate-900 text-slate-200 border border-slate-850 rounded-tl-none'} break-all shadow-md">
      ${chatData.message}
    </div>
  `;

  container.appendChild(msgBubble);
  
  // Scroll to bottom
  container.scrollTop = container.scrollHeight;

  // Increment unread count badge if chat sidebar is currently closed
  const sidebar = document.getElementById('sidebar');
  const isChatOpen = !sidebar.classList.contains('translate-x-full') && !document.getElementById('tab-chat').classList.contains('hidden');
  
  if (!isChatOpen) {
    unreadMessagesCount++;
    const badge = document.getElementById('chat-badge');
    const badgeDot = document.getElementById('chat-notification-dot');
    
    if (badge) badge.classList.remove('hidden');
    if (badgeDot) badgeDot.classList.remove('hidden');
  }
}

/**
 * Reload list of participants in participants panel with Host Control items.
 */
function updateParticipantsList() {
  const container = document.getElementById('participants-list');
  const countBadge = document.getElementById('participant-count-badge');
  if (!container) return;

  // Sync count badge
  const totalCount = peers.size + 1; // peers + self
  if (countBadge) countBadge.textContent = totalCount;

  container.innerHTML = '';

  // 1. Add Local user first
  const selfDiv = document.createElement('div');
  selfDiv.className = "flex items-center justify-between p-2.5 bg-slate-900/60 border border-slate-850 rounded-xl";
  selfDiv.innerHTML = `
    <div class="flex items-center space-x-2.5">
      <div class="w-8 h-8 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-400 flex items-center justify-center text-xs font-bold">
        Y
      </div>
      <div class="text-left">
        <span class="text-xs font-bold block text-slate-200">${nickname} (You)</span>
        <span class="text-[9px] text-slate-500 block uppercase font-medium">Local Client ${isLocalHost ? '• Host' : ''}</span>
      </div>
    </div>
    <div class="flex items-center space-x-1.5">
      <button onclick="pinParticipantVideo('local')" class="w-7 h-7 rounded-md bg-slate-950 border border-slate-850 flex items-center justify-center text-slate-400 hover:text-white transition-colors" title="Pin Feed">
        <i data-lucide="pin" class="w-3.5 h-3.5 ${pinnedParticipantId === 'local' ? 'text-brand-400 fill-brand-400' : ''}"></i>
      </button>
      <div class="w-7 h-7 rounded-md bg-slate-950 border border-slate-850 flex items-center justify-center">
        <i data-lucide="${isAudioMuted ? 'mic-off' : 'mic'}" class="w-3.5 h-3.5 ${isAudioMuted ? 'text-red-400' : 'text-emerald-400'}"></i>
      </div>
    </div>
  `;
  container.appendChild(selfDiv);

  // 2. Add remote peers
  peers.forEach((peer, socketId) => {
    const peerDiv = document.createElement('div');
    peerDiv.className = "flex flex-col p-2.5 bg-slate-900/40 border border-slate-850/60 rounded-xl space-y-2";
    
    // Base details
    let innerHTML = `
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-2.5">
          <div class="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-bold">
            ${peer.nickname.charAt(0).toUpperCase()}
          </div>
          <div class="text-left">
            <span class="text-xs font-bold block text-slate-200">${peer.nickname}</span>
            <span class="text-[9px] text-slate-500 block uppercase font-medium">Remote Participant ${peer.isHost ? '• Host' : ''}</span>
          </div>
        </div>
        
        <!-- Controls row -->
        <div class="flex items-center space-x-1.5">
          <!-- Pin button -->
          <button onclick="pinParticipantVideo('${socketId}')" class="w-7 h-7 rounded-md bg-slate-950 border border-slate-850 flex items-center justify-center text-slate-400 hover:text-white transition-colors" title="Pin Video">
            <i data-lucide="pin" class="w-3.5 h-3.5 ${pinnedParticipantId === socketId ? 'text-brand-400 fill-brand-400' : ''}"></i>
          </button>
          
          <!-- Audio State indicator -->
          <div class="w-7 h-7 rounded-md bg-slate-950 border border-slate-850 flex items-center justify-center">
            <i data-lucide="${peer.remoteAudioMuted ? 'mic-off' : 'mic'}" class="w-3.5 h-3.5 ${peer.remoteAudioMuted ? 'text-red-400' : 'text-emerald-400'}"></i>
          </div>
        </div>
      </div>
    `;

    // 3. Add Host moderation actions (If current local client is room host)
    if (isLocalHost && socketId !== socket.id) {
      const isHandRaised = peer.isHandRaised || false;
      innerHTML += `
        <div class="h-px bg-slate-950"></div>
        <div class="flex flex-wrap items-center gap-1.5 bg-slate-950/40 p-1.5 rounded-lg">
          <!-- Mute remotely -->
          <button onclick="hostRemoteMute('${socketId}')" class="flex-1 py-1 px-1 bg-slate-950 border border-slate-850 hover:bg-slate-900 text-slate-400 hover:text-slate-200 rounded text-[10px] flex items-center justify-center space-x-1 transition-colors" title="Mute Remotely">
            <i data-lucide="mic-off" class="w-3 h-3 text-red-400"></i>
            <span>Mute</span>
          </button>
          
          <!-- Temp disable mic capability completely -->
          <button onclick="hostRemoteLockMic('${socketId}', ${!peer.isMicDisabled})" class="flex-1 py-1 px-1 bg-slate-950 border border-slate-850 hover:bg-slate-900 text-slate-400 hover:text-slate-200 rounded text-[10px] flex items-center justify-center space-x-1 transition-colors">
            <i data-lucide="ban" class="w-3 h-3 text-amber-500"></i>
            <span>Disable Mic</span>
          </button>

          <!-- Lower Hand Remotely -->
          ${isHandRaised ? `
          <button onclick="hostRemoteLowerHand('${socketId}')" class="flex-1 py-1 px-1 bg-amber-950/40 border border-amber-900/30 hover:bg-amber-900/20 text-amber-400 rounded text-[10px] flex items-center justify-center space-x-1 transition-all">
            <i data-lucide="hand" class="w-3 h-3"></i>
            <span>Lower Hand</span>
          </button>
          ` : ''}

          <!-- Kick out of room -->
          <button onclick="hostRemoteKick('${socketId}')" class="flex-1 py-1 px-1 bg-red-950/20 hover:bg-red-900/20 border border-red-900/30 text-red-400 rounded text-[10px] flex items-center justify-center space-x-1 transition-all" title="Remove Participant">
            <i data-lucide="user-x" class="w-3 h-3"></i>
            <span>Remove</span>
          </button>
        </div>
      `;
    }

    peerDiv.innerHTML = innerHTML;
    container.appendChild(peerDiv);
  });

  lucide.createIcons();
}

/**
 * Host controls logic invocations.
 */
function hostRemoteMute(userId) {
  if (socket && isLocalHost) {
    socket.emit('host-mute-user', userId);
    showNotificationToast(`Requested mute on participant`);
  }
}

function hostRemoteLockMic(userId, disable) {
  if (socket && isLocalHost) {
    socket.emit('host-disable-mic', { userId, disable });
    showNotificationToast(`Microphone permissions modified`);
  }
}

function hostRemoteKick(userId) {
  const confirmKick = confirm("Are you sure you want to kick this participant?");
  if (confirmKick && socket && isLocalHost) {
    socket.emit('host-kick-user', userId);
  }
}

function hostRemoteLowerHand(userId) {
  if (socket && isLocalHost) {
    socket.emit('host-lower-hand', userId);
    showNotificationToast(`Requested to lower participant's hand`);
  }
}

/* ==========================================
   LIVE CONFIG/DEVICES MODALS CODE
   ========================================== */

async function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;

  modal.classList.remove('opacity-0', 'pointer-events-none');

  // Enumerate hardware to fill options
  const devices = await navigator.mediaDevices.enumerateDevices();
  const camSelect = document.getElementById('call-camera-select');
  const micSelect = document.getElementById('call-mic-select');
  const speakerSelect = document.getElementById('call-speaker-select');
  const blurCheck = document.getElementById('call-blur-bg-toggle');

  if (camSelect) camSelect.innerHTML = '';
  if (micSelect) micSelect.innerHTML = '';
  if (speakerSelect) speakerSelect.innerHTML = '';
  if (blurCheck) blurCheck.checked = isBlurActive;

  devices.forEach(device => {
    const option = document.createElement('option');
    option.value = device.deviceId;

    if (device.kind === 'videoinput') {
      option.textContent = device.label || `Camera`;
      if (localVideoTrack && localVideoTrack.getSettings().deviceId === device.deviceId) {
        option.selected = true;
      }
      camSelect.appendChild(option);
    } else if (device.kind === 'audioinput') {
      option.textContent = device.label || `Mic`;
      if (localAudioTrack && localAudioTrack.getSettings().deviceId === device.deviceId) {
        option.selected = true;
      }
      micSelect.appendChild(option);
    } else if (device.kind === 'audiooutput') {
      option.textContent = device.label || `Speaker`;
      const storedSpeakerId = localStorage.getItem('aethermeet_selected_speaker_id');
      if (storedSpeakerId === device.deviceId) {
        option.selected = true;
      }
      speakerSelect.appendChild(option);
    }
  });
}

function closeSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (modal) modal.classList.add('opacity-0', 'pointer-events-none');
}

async function applySettingsChanges() {
  const camSelect = document.getElementById('call-camera-select');
  const micSelect = document.getElementById('call-mic-select');
  const speakerSelect = document.getElementById('call-speaker-select');
  const blurCheck = document.getElementById('call-blur-bg-toggle');

  // Check if camera source changed
  if (camSelect && camSelect.value && (!localVideoTrack || localVideoTrack.getSettings().deviceId !== camSelect.value)) {
    await changeDevice('video', camSelect.value);
  }

  // Check if mic source changed
  if (micSelect && micSelect.value && (!localAudioTrack || localAudioTrack.getSettings().deviceId !== micSelect.value)) {
    await changeDevice('audio', micSelect.value);
  }

  // Check if speaker source changed
  if (speakerSelect && speakerSelect.value) {
    localStorage.setItem('aethermeet_selected_speaker_id', speakerSelect.value);
    
    // Apply speaker selection to all audio/video elements on the page
    const mediaElements = document.querySelectorAll('video, audio');
    mediaElements.forEach(el => {
      if (typeof el.setSinkId === 'function') {
        el.setSinkId(speakerSelect.value)
          .catch(err => console.warn('Could not set speaker sink ID on element:', err));
      }
    });
  }

  // Blur canvas toggle
  if (blurCheck && blurCheck.checked !== isBlurActive) {
    toggleBackgroundBlur(blurCheck.checked);
  }

  closeSettingsModal();
  showNotificationToast("Audio and video settings updated.");
}


/* ==========================================
   SMART UTILITY SYSTEMS (Timer, Reactions, Hotkeys)
   ========================================== */

/**
 * Incrementing call stopwatch clock: 00:00:00.
 */
function startMeetingTimer() {
  meetingStartTime = Date.now();
  const timerDisplay = document.getElementById('meeting-timer');
  
  if (meetingTimerInterval) clearInterval(meetingTimerInterval);
  
  meetingTimerInterval = setInterval(() => {
    const elapsed = Date.now() - meetingStartTime;
    
    const sec = Math.floor((elapsed / 1000) % 60);
    const min = Math.floor((elapsed / 1000 / 60) % 60);
    const hour = Math.floor((elapsed / 1000 / 60 / 60));

    const fSec = sec.toString().padStart(2, '0');
    const fMin = min.toString().padStart(2, '0');
    const fHour = hour.toString().padStart(2, '0');

    if (timerDisplay) {
      timerDisplay.textContent = `${fHour}:${fMin}:${fSec}`;
    }
  }, 1000);
}

/**
 * Spawns an emoji that floats upwards on the screen.
 */
function spawnReactionEmoji(emoji) {
  const container = document.getElementById('emoji-container');
  if (!container) return;

  const emojiEl = document.createElement('div');
  emojiEl.className = 'floating-emoji';
  emojiEl.textContent = emoji;

  // Randomize initial horizontal position and float sway drift
  const randomX = Math.floor(Math.random() * 60) + 20; // 20% to 80% viewport width
  emojiEl.style.left = `${randomX}%`;
  emojiEl.style.bottom = `12%`;
  
  const drift = (Math.random() * 80 - 40); // -40px to +40px drift
  emojiEl.style.setProperty('--drift', `${drift}px`);

  container.appendChild(emojiEl);

  // Remove element after animation finishes
  setTimeout(() => {
    emojiEl.remove();
  }, 3000);
}

/**
 * Global toast alerts in Meeting Call layout.
 */
function showNotificationToast(msg) {
  const toast = document.getElementById('meeting-toast');
  const toastMsg = document.getElementById('meeting-toast-message');
  
  if (toast && toastMsg) {
    toastMsg.textContent = msg;
    toast.classList.remove('opacity-0', 'translate-y-2', 'pointer-events-none');
    
    // Hide toast after 3s
    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-2', 'pointer-events-none');
    }, 3000);
  }
}

/**
 * Returns string nickname of socketId stored.
 */
function getParticipantNickname(socketId) {
  if (socketId === socket.id) return nickname;
  const peer = peers.get(socketId);
  return peer ? peer.nickname : 'Someone';
}

/**
 * Setup keyboard hotkeys.
 */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // If user is focused inside Chat input, do not trigger hotkeys!
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
      return;
    }

    const key = e.key.toLowerCase();
    
    if (key === 'm') {
      e.preventDefault();
      toggleCallMic();
    } else if (key === 'v') {
      e.preventDefault();
      toggleCallVideo();
    } else if (key === 's') {
      e.preventDefault();
      toggleScreenShareState();
    } else if (key === 'h') {
      e.preventDefault();
      toggleHandRaise();
    } else if (e.key === ' ' || e.code === 'Space') {
      // Spacebar Push-to-Talk functionality:
      // Pressing Space unmutes local mic temporarily if muted.
      if (isAudioMuted && !isMicDisabledByHost) {
        e.preventDefault();
        muteLocalAudio(false);
        showNotificationToast("🎙️ Space Push-to-Talk (Unmuted)");
      }
    }
  });

  document.addEventListener('keyup', (e) => {
    // If focused in input, skip
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
      return;
    }

    if (e.key === ' ' || e.code === 'Space') {
      // Re-mute microphone on Space keyup
      if (!isAudioMuted && !isMicDisabledByHost) {
        e.preventDefault();
        muteLocalAudio(true);
        showNotificationToast("🎙️ Space Muted");
      }
    }
  });
}
