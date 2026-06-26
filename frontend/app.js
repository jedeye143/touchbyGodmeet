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
  
  // Save device config preferences to localStorage (persists across browser restarts)
  localStorage.setItem('aethermeet_audio_muted', isAudioMuted);
  localStorage.setItem('aethermeet_video_muted', isVideoMuted);
  localStorage.setItem('aethermeet_blur_bg', isBlurActive);

  return true;
}

function handleCreateMeeting() {
  if (!saveNicknameLocally()) return;

  const roomTypeSelect = document.getElementById('room-type-select');
  const roomMode = roomTypeSelect ? roomTypeSelect.value : 'meeting';

  // Generate 9 character room ID: xxx-xxxx-xxx
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let randRoom = '';
  for (let i = 0; i < 9; i++) {
    if (i === 3 || i === 7) randRoom += '-';
    randRoom += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  // Redirect to call page
  window.location.href = `meeting.html?room=${randRoom}&mode=${roomMode}`;
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
          const roomTypeSelect = document.getElementById('room-type-select');
          const roomMode = roomTypeSelect ? roomTypeSelect.value : 'meeting';
          window.location.href = `meeting.html?room=${roomVal}&mode=${roomMode}`;
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

  // Load configured media preferences from localStorage (persists across refreshes)
  isAudioMuted = localStorage.getItem('aethermeet_audio_muted') === 'true';
  isVideoMuted = localStorage.getItem('aethermeet_video_muted') === 'true';
  
  // Check performance mode - if enabled, disable blur
  const perfModeEnabled = localStorage.getItem('aethermeet_performance_mode') === 'true';
  if (perfModeEnabled) {
    isBlurActive = false;
    localStorage.setItem('aethermeet_blur_bg', 'false');
  } else {
    isBlurActive = localStorage.getItem('aethermeet_blur_bg') === 'true';
  }

  // Setup history state for back-button minimize/leave hijacking
  history.pushState({ inMeeting: true }, null, location.href);
  window.addEventListener('popstate', handleBackButton);

  // Bind footer controls UI events
  document.getElementById('btn-mic').addEventListener('click', toggleCallMic);
  document.getElementById('btn-video').addEventListener('click', toggleCallVideo);
  document.getElementById('btn-screen').addEventListener('click', toggleScreenShareState);
  document.getElementById('btn-hand').addEventListener('click', toggleHandRaise);
  document.getElementById('btn-leave').addEventListener('click', handleLeaveCall);
  
  const btnPip = document.getElementById('btn-pip');
  if (btnPip) {
    btnPip.addEventListener('click', enterPictureInPicture);
  }
  
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

  // Bible search button binding
  const bibleSearchBtn = document.getElementById('bible-search-btn');
  if (bibleSearchBtn) {
    bibleSearchBtn.addEventListener('click', searchBibleScripture);
  }

  // Dismiss broadcast overlay button binding
  const dismissBroadcastBtn = document.getElementById('dismiss-broadcast-btn');
  if (dismissBroadcastBtn) {
    dismissBroadcastBtn.addEventListener('click', clearBibleBroadcast);
  }

  // Bible toggle sidebar binding
  const btnToggleBible = document.getElementById('btn-toggle-bible');
  if (btnToggleBible) {
    btnToggleBible.addEventListener('click', () => toggleSidebarTab('bible'));
  }
  const tabBibleBtn = document.getElementById('tab-bible-btn');
  if (tabBibleBtn) {
    tabBibleBtn.addEventListener('click', () => switchSidebarTab('bible'));
  }

  // Presentation modal opening binding using SweetAlert2
// REPLACE lines 560-796 in app.js with this code:

  // Presentation modal opening binding using SweetAlert2 - USER FRIENDLY VERSION
  const btnPresentation = document.getElementById('btn-presentation');
  if (btnPresentation) {
    btnPresentation.addEventListener('click', async (e) => {
      const { value } = await Swal.fire({
        title: '<div style="font-size:1.5rem; font-weight:900; color:#fff;">🎯 Start Presentation</div>',
        html: `
          <p style="font-size:1rem; color:#cbd5e1; margin-bottom:2rem;">Choose how you want to present:</p>
          <div style="display:grid; gap:1.25rem;">
            <button id="swal-screen" style="padding:1.5rem; border:3px solid #f59e0b; background:#f59e0b22; border-radius:1rem; cursor:pointer; display:flex; align-items:center; gap:1.25rem; transition:0.2s;" onmouseover="this.style.background='#f59e0b44'" onmouseout="this.style.background='#f59e0b22'">
              <div style="width:4rem; height:4rem; background:#f59e0b; border-radius:1rem; display:flex; align-items:center; justify-content:center; font-size:2rem;">🖥️</div>
              <div style="text-align:left;">
                <h4 style="font-size:1.25rem; font-weight:800; color:#fff; margin:0 0 0.5rem 0;">Share Screen</h4>
                <p style="font-size:1rem; color:#cbd5e1; margin:0;">Stream your desktop or window</p>
              </div>
            </button>
            <button id="swal-pdf" style="padding:1.5rem; border:3px solid #ef4444; background:#ef444422; border-radius:1rem; cursor:pointer; display:flex; align-items:center; gap:1.25rem; transition:0.2s;" onmouseover="this.style.background='#ef444444'" onmouseout="this.style.background='#ef444422'">
              <div style="width:4rem; height:4rem; background:#ef4444; border-radius:1rem; display:flex; align-items:center; justify-content:center; font-size:2rem;">📄</div>
              <div style="text-align:left;">
                <h4 style="font-size:1.25rem; font-weight:800; color:#fff; margin:0 0 0.5rem 0;">PDF Document</h4>
                <p style="font-size:1rem; color:#cbd5e1; margin:0;">Display a PDF presentation</p>
              </div>
            </button>
            <button id="swal-whiteboard" style="padding:1.5rem; border:3px solid #10b981; background:#10b98122; border-radius:1rem; cursor:pointer; display:flex; align-items:center; gap:1.25rem; transition:0.2s;" onmouseover="this.style.background='#10b98144'" onmouseout="this.style.background='#10b98122'">
              <div style="width:4rem; height:4rem; background:#10b981; border-radius:1rem; display:flex; align-items:center; justify-content:center; font-size:2rem;">✏️</div>
              <div style="text-align:left;">
                <h4 style="font-size:1.25rem; font-weight:800; color:#fff; margin:0 0 0.5rem 0;">Whiteboard</h4>
                <p style="font-size:1rem; color:#cbd5e1; margin:0;">Draw on a collaborative canvas</p>
              </div>
            </button>
          </div>
        `,
        background: '#1e293b',
        width: '40rem',
        padding: '2.5rem',
        showConfirmButton: false,
        showCloseButton: true,
        didOpen: () => {
          document.getElementById('swal-screen').onclick = async () => {
            Swal.close();
            try {
              if (!isScreenSharing) await toggleScreenShareState();
              if (socket && isScreenSharing) socket.emit('start-presentation', { type: 'screen' });
            } catch (err) {
              Swal.fire({ icon: 'error', title: 'Failed', text: 'Could not start screen share', background: '#1e293b' });
            }
          };
          document.getElementById('swal-pdf').onclick = async () => {
            const { value: url } = await Swal.fire({
              title: '📄 Enter PDF URL',
              input: 'url',
              inputPlaceholder: 'https://example.com/slides.pdf',
              background: '#1e293b',
              showCancelButton: true,
              confirmButtonText: 'Load',
              confirmButtonColor: '#f59e0b'
            });
            if (url && socket) socket.emit('start-presentation', { type: 'pdf', url });
          };
          document.getElementById('swal-whiteboard').onclick = () => {
            Swal.close();
            if (socket) socket.emit('start-presentation', { type: 'whiteboard' });
          };
        }
      });
    });
  }


  // Presentation fullscreen toggle trigger
  const btnPresFullscreen = document.getElementById('btn-pres-fullscreen');
  if (btnPresFullscreen) {
    btnPresFullscreen.addEventListener('click', () => {
      const viewport = document.getElementById('presentation-viewport');
      if (viewport) {
        if (!document.fullscreenElement) {
          viewport.requestFullscreen().catch(err => {
            console.error(`Error enabling full-screen presentation mode: ${err.message}`);
          });
        } else {
          document.exitFullscreen();
        }
      }
    });
  }

  // Presentation Stop trigger
  const btnStopPres = document.getElementById('btn-stop-pres');
  if (btnStopPres) {
    btnStopPres.addEventListener('click', () => {
      if (socket) socket.emit('stop-presentation');
    });
  }

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
      const urlParams = new URLSearchParams(window.location.search);
      const roomMode = urlParams.get('mode') || 'meeting';
      socket.emit('join-room', { roomId, nickname, roomType: roomMode });

      // Show echo prevention tip if mic is unmuted
      if (!isAudioMuted) {
        setTimeout(() => {
          showNotificationToast("💡 Tip: Use headphones to prevent echo/feedback");
        }, 2000);
      }

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

  // Automatically adjust grid layout when container element sizes change (e.g. sidebar toggle or initial stream load)
  if (typeof ResizeObserver !== 'undefined') {
    const gridEl = document.getElementById('video-grid');
    if (gridEl) {
      const resizeObserver = new ResizeObserver(() => {
        reorganizeGrid();
      });
      resizeObserver.observe(gridEl);
    }
  }
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
  
  // Save preference to localStorage so it persists across refreshes
  localStorage.setItem('aethermeet_audio_muted', isAudioMuted.toString());
  
  if (localAudioTrack) {
    localAudioTrack.enabled = !isAudioMuted;
  }
  
  // Restart or stop audio analysis loop based on mute state (performance optimization)
  if (!isAudioMuted && localAnalyser) {
    // Restart audio analysis when unmuting
    if (!localAudioLevelLoopId) {
      analyzeLocalAudioVolume();
    }
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
  
  // Save preference to localStorage so it persists across refreshes
  localStorage.setItem('aethermeet_video_muted', isVideoMuted.toString());
  
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
  card.className = "relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 aspect-video w-auto h-auto shadow-lg group max-w-full max-h-full transition-all duration-300 cursor-pointer justify-self-center self-center";
  
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
    <div class="absolute bottom-1.5 left-1.5 right-1.5 sm:bottom-3 sm:left-3 sm:right-3 z-30 flex items-center justify-between pointer-events-none">
      <!-- Tag Name -->
      <div class="bg-slate-950/80 border border-slate-800/80 backdrop-blur-md rounded-lg px-1.5 py-0.5 sm:px-2.5 sm:py-1 text-[10px] sm:text-xs font-semibold text-slate-200 flex items-center space-x-1.5 pointer-events-auto">
        <span>${nickname}</span>
        ${isHost ? `<span class="bg-brand-500/20 border border-brand-500/30 text-brand-400 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider ml-1">Host</span>` : ''}
      </div>
      
      <!-- Status Icons -->
      <div class="flex items-center space-x-1.5 pointer-events-auto">
        <!-- Mic -->
        <div id="mic-status-${remoteSocketId}" class="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-slate-950/80 border border-slate-800/80 backdrop-blur-md flex items-center justify-center text-slate-200">
          <i data-lucide="mic" class="w-3 h-3 sm:w-3.5 sm:h-3.5 text-emerald-400"></i>
        </div>
        
        <!-- Screen Sharing -->
        <div id="screen-status-${remoteSocketId}" class="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-slate-950/80 border border-slate-800/80 backdrop-blur-md flex items-center justify-center text-indigo-400 hidden">
          <i data-lucide="monitor" class="w-3 h-3 sm:w-3.5 sm:h-3.5"></i>
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
 * Optimized with debouncing to reduce excessive calls.
 */
let reorganizeGridTimeout = null;

function reorganizeGrid() {
  // Debounce to prevent excessive calls
  if (reorganizeGridTimeout) {
    clearTimeout(reorganizeGridTimeout);
  }
  
  reorganizeGridTimeout = setTimeout(_reorganizeGridInternal, 50);
}

function _reorganizeGridInternal() {
  const grid = document.getElementById('video-grid');
  if (!grid) return;

  // Calculate total tiles including tray children if layout is split
  const tray = document.getElementById('pinned-layout-tray');
  const trayCount = tray ? tray.children.length : 0;
  const mainCount = Array.from(grid.children).filter(c => c.id !== 'pinned-layout-tray').length;
  const totalTiles = mainCount + trayCount;

  if (totalTiles === 0) return;

  // If a presentation is active, layout video grid as a vertical sidebar of aspect-video tiles
  if (activePresentation) {
    destroyPinnedLayoutUI();

    grid.classList.remove('grid', 'flex-row');
    grid.classList.add('flex', 'flex-col', 'gap-3', 'overflow-y-auto', 'h-full', 'w-full', 'lg:w-1/4', 'shrink-0');
    grid.style.gridTemplateColumns = '';
    grid.style.gridTemplateRows = '';
    grid.style.flexDirection = 'column';

    const cards = grid.querySelectorAll('.relative');
    cards.forEach(card => {
      card.style.maxWidth = '100%';
      card.style.maxHeight = '100%';
      card.style.width = '100%';
      card.style.height = '';
      card.style.aspectRatio = '16/9';
      
      // Force smaller layout classes
      if (card.id === 'local-video-card') {
        card.className = "relative rounded-xl overflow-hidden bg-slate-950 border border-slate-800 aspect-video w-full shrink-0 shadow-md group transition-all duration-300";
      } else {
        card.className = "relative rounded-xl overflow-hidden bg-slate-950 border border-slate-800 aspect-video w-full shrink-0 shadow-md group transition-all duration-300 cursor-pointer";
      }
    });
    return;
  }

  // The spotlight participant can be a manually pinned user, or the active speaker if layout mode is 'spotlight'
  const spotlightId = pinnedParticipantId || (currentLayoutMode === 'spotlight' && totalTiles > 1 && activeSpeakerId ? activeSpeakerId : null);

  if (spotlightId) {
    setupPinnedLayout(spotlightId);
    return;
  }

  // Restore defaults from pinned layout styles (destroys tray and resets classes)
  destroyPinnedLayoutUI();

  grid.classList.remove('flex', 'flex-col', 'lg:flex-row', 'gap-3', 'overflow-y-auto', 'lg:w-1/4', 'shrink-0');
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
  
  // Calculate dynamic dimensions to fill as much space as possible without overflow
  const gap = 16; // gap-4 is 16px
  const availWidth = (containerWidth - (cols - 1) * gap) / cols;
  const availHeight = (containerHeight - (rows - 1) * gap) / rows;
  
  let cardWidth, cardHeight;
  if (availWidth / availHeight > 16 / 9) {
    // Limited by height
    cardHeight = availHeight;
    cardWidth = cardHeight * (16 / 9);
  } else {
    // Limited by width
    cardWidth = availWidth;
    cardHeight = cardWidth * (9 / 16);
  }

  cards.forEach(card => {
    card.style.maxWidth = '100%';
    card.style.maxHeight = '100%';
    card.style.width = `${cardWidth}px`;
    card.style.height = `${cardHeight}px`;
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
          card.className = "relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 aspect-video w-auto h-auto shadow-lg group max-w-full max-h-full transition-all duration-300 justify-self-center self-center";
        } else {
          card.className = "relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 aspect-video w-auto h-auto shadow-lg group max-w-full max-h-full transition-all duration-300 cursor-pointer justify-self-center self-center";
        }
      }
    }
    tray.remove();
  }

  // Also restore classes for the pinned card which remained in the main grid
  const localCard = document.getElementById('local-video-card');
  if (localCard) {
    localCard.className = "relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 aspect-video w-auto h-auto shadow-lg group max-w-full max-h-full transition-all duration-300 justify-self-center self-center";
  }
  peers.forEach((peer, socketId) => {
    const card = document.getElementById(`card-${socketId}`);
    if (card) {
      card.className = "relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 aspect-video w-auto h-auto shadow-lg group max-w-full max-h-full transition-all duration-300 cursor-pointer justify-self-center self-center";
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
  const bibleTab = document.getElementById('tab-bible');
  const bibleBtn = document.getElementById('tab-bible-btn');

  const activeClass = "flex-grow py-2 text-xs font-semibold rounded-lg bg-slate-900 border border-slate-800 text-white transition-all flex items-center justify-center space-x-1.5";
  const inactiveClass = "flex-grow py-2 text-xs font-semibold rounded-lg text-slate-400 hover:text-slate-200 transition-all flex items-center justify-center space-x-1.5";

  if (chatTab) chatTab.classList.add('hidden');
  if (participantsTab) participantsTab.classList.add('hidden');
  if (bibleTab) bibleTab.classList.add('hidden');

  if (chatBtn) chatBtn.className = inactiveClass;
  if (participantsBtn) participantsBtn.className = inactiveClass;
  if (bibleBtn) bibleBtn.className = inactiveClass;

  if (tabName === 'chat') {
    if (chatTab) chatTab.classList.remove('hidden');
    if (chatBtn) chatBtn.className = activeClass;
    
    // Clear chat count badge
    unreadMessagesCount = 0;
    const badge = document.getElementById('chat-badge');
    const badgeDot = document.getElementById('chat-notification-dot');
    if (badge) badge.classList.add('hidden');
    if (badgeDot) badgeDot.classList.add('hidden');

  } else if (tabName === 'participants') {
    if (participantsTab) participantsTab.classList.remove('hidden');
    if (participantsBtn) participantsBtn.className = activeClass;

    updateParticipantsList();
  } else if (tabName === 'bible') {
    if (bibleTab) bibleTab.classList.remove('hidden');
    if (bibleBtn) bibleBtn.className = activeClass;
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
  const perfModeCheck = document.getElementById('performance-mode-toggle');

  if (camSelect) camSelect.innerHTML = '';
  if (micSelect) micSelect.innerHTML = '';
  if (speakerSelect) speakerSelect.innerHTML = '';
  if (blurCheck) blurCheck.checked = isBlurActive;
  
  // Load performance mode state
  const perfModeEnabled = localStorage.getItem('aethermeet_performance_mode') === 'true';
  if (perfModeCheck) {
    perfModeCheck.checked = perfModeEnabled;
  }
  // Disable blur toggle if performance mode is on
  if (blurCheck && perfModeEnabled) {
    blurCheck.disabled = true;
  } else if (blurCheck) {
    blurCheck.disabled = false;
  }

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
  const perfModeCheck = document.getElementById('performance-mode-toggle');

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

  // Performance Mode toggle (overrides blur setting)
  if (perfModeCheck) {
    const perfModeEnabled = perfModeCheck.checked;
    localStorage.setItem('aethermeet_performance_mode', perfModeEnabled.toString());
    
    if (perfModeEnabled) {
      // Disable blur if performance mode is on
      if (isBlurActive) {
        toggleBackgroundBlur(false);
      }
      // Disable blur toggle when performance mode is on
      if (blurCheck) {
        blurCheck.checked = false;
        blurCheck.disabled = true;
      }
      showNotificationToast("⚡ Performance Mode enabled - blur disabled, frame rates reduced");
    } else {
      // Re-enable blur toggle
      if (blurCheck) {
        blurCheck.disabled = false;
      }
      showNotificationToast("Performance Mode disabled - normal operation restored");
    }
  }

  // Blur canvas toggle (only if performance mode is off)
  const perfModeEnabled = localStorage.getItem('aethermeet_performance_mode') === 'true';
  if (blurCheck && blurCheck.checked !== isBlurActive && !perfModeEnabled) {
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

/**
 * Request Chrome/Safari/Firefox Picture-in-Picture window on active video feed.
 */
function enterPictureInPicture() {
  let videoEl = null;

  // 1. Try to find the pinned video card's video element
  const pinnedCard = document.querySelector('.video-card-pinned video');
  if (pinnedCard) {
    videoEl = pinnedCard;
  } else {
    // 2. Try to find the first remote video element
    const remoteVideos = Array.from(document.querySelectorAll('video[id^="video-"]'));
    if (remoteVideos.length > 0) {
      videoEl = remoteVideos[0];
    } else {
      // 3. Fallback to local video
      videoEl = document.getElementById('local-video');
    }
  }

  if (videoEl) {
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture()
        .then(() => console.log('Exited Picture-in-Picture.'))
        .catch(err => console.error('Error exiting Picture-in-Picture:', err));
    } else if (typeof videoEl.requestPictureInPicture === 'function') {
      videoEl.requestPictureInPicture()
        .then(() => console.log('Entered Picture-in-Picture successfully!'))
        .catch(err => {
          console.warn('Failed to enter Picture-in-Picture:', err);
          showNotificationToast("Failed to minimize video. Make sure video stream is active.");
        });
    } else {
      showNotificationToast("Your browser does not support Picture-in-Picture.");
    }
  } else {
    showNotificationToast("No active video feed to minimize.");
  }
}

/**
 * Hijacks the browser back button state to prompt the user to minimize.
 */
function handleBackButton(event) {
  if (typeof Swal !== 'undefined') {
    Swal.fire({
      title: 'Leaving Meeting?',
      text: 'Would you like to minimize this meeting to a floating window or leave the call entirely?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Minimize (Floating Window)',
      cancelButtonText: 'Leave Call',
      background: '#070a13',
      color: '#f1f5f9',
      confirmButtonColor: '#7c3aed',
      cancelButtonColor: '#ef4444',
      customClass: {
        popup: 'border border-slate-800 rounded-2xl shadow-2xl backdrop-blur-md',
        title: 'font-bold text-white',
        htmlContainer: 'text-slate-400 text-xs'
      }
    }).then((result) => {
      if (result.isConfirmed) {
        // User clicked "Minimize" - trigger Picture-in-Picture!
        enterPictureInPicture();
        // Push state back so next back button click prompts again
        history.pushState({ inMeeting: true }, null, location.href);
      } else {
        // User clicked "Leave" or clicked outside
        leaveCallDirectly();
      }
    });
  } else {
    const minimize = confirm("Would you like to minimize this meeting to a floating window? Click Cancel to leave the call.");
    if (minimize) {
      enterPictureInPicture();
      history.pushState({ inMeeting: true }, null, location.href);
    } else {
      leaveCallDirectly();
    }
  }
}

/**
 * Clean up connection and exit without double-confirming for participants.
 */
function leaveCallDirectly() {
  if (isLocalHost) {
    handleLeaveCall();
  } else {
    stopLocalMedia();
    if (socket) socket.disconnect();
    window.location.href = 'index.html';
  }
}


/* ==========================================================================
   CHURCH MODE & PRESENTATION SYSTEM (Whiteboard, Bible API, Broadcasts)
   ========================================================================== */

let activePresentation = null;
let whiteboardCanvas = null;
let whiteboardCtx = null;
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let wbColor = '#8b5cf6';
let wbTool = 'pencil';
let whiteboardHistory = [];

/**
 * Configure UI based on the selected Room Mode on initial join.
 */
function handleRoomModeSetup(roomType) {
  const badge = document.getElementById('room-mode-badge');
  if (badge) {
    badge.classList.remove('hidden');
    if (roomType === 'church') {
      badge.textContent = 'Church Mode';
      badge.className = 'px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded-full border bg-amber-500/10 border-amber-500/20 text-amber-400 flex items-center space-x-1 backdrop-blur-md shadow-md';
      
      // Show Bible buttons
      const toggleBible = document.getElementById('btn-toggle-bible');
      const tabBible = document.getElementById('tab-bible-btn');
      if (toggleBible) toggleBible.classList.remove('hidden');
      if (tabBible) tabBible.classList.remove('hidden');
    } else {
      badge.textContent = 'Meeting Mode';
      badge.className = 'px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded-full border bg-brand-500/10 border-brand-500/20 text-brand-400 flex items-center space-x-1 backdrop-blur-md shadow-md';
      
      // Hide Bible buttons
      const toggleBible = document.getElementById('btn-toggle-bible');
      const tabBible = document.getElementById('tab-bible-btn');
      if (toggleBible) toggleBible.classList.add('hidden');
      if (tabBible) tabBible.classList.add('hidden');
    }
  }

  // Sync presentation button visibility (only for host)
  const presBtn = document.getElementById('btn-presentation');
  if (presBtn) {
    if (isLocalHost) {
      presBtn.classList.remove('hidden');
    } else {
      presBtn.classList.add('hidden');
    }
  }
}

/**
 * Handle starting of presentation viewports on all clients.
 */
function handlePresentationStarted(presData) {
  activePresentation = presData;
  console.log("Presentation started globally:", presData);

  // Ensure video-grid is visible (it will be resized to sidebar by reorganizeGrid)
  const videoGrid = document.getElementById('video-grid');
  if (videoGrid) {
    videoGrid.classList.remove('hidden');
  }

  // Show presentation viewport
  const viewport = document.getElementById('presentation-viewport');
  if (viewport) viewport.classList.remove('hidden');

  // Clear previous presentation content
  const content = document.getElementById('presentation-content');
  if (content) content.innerHTML = '';

  // Show stop button only if local user is host or the presenter
  const stopBtn = document.getElementById('btn-stop-pres');
  if (stopBtn) {
    if (isLocalHost || presData.presenterId === socket.id) {
      stopBtn.classList.remove('hidden');
    } else {
      stopBtn.classList.add('hidden');
    }
  }

  // Toggle whiteboard toolbar controls
  const wbControls = document.getElementById('whiteboard-controls');
  if (wbControls) {
    // Show controls for both whiteboard AND screen share (so you can draw on screen share)
    if (presData.type === 'whiteboard' || presData.type === 'screen') {
      wbControls.classList.remove('hidden');
      wbControls.classList.add('flex');
      
      // For screen share, show toggle button (only for host) and hide tools initially
      if (presData.type === 'screen') {
        const toggleBtn = document.getElementById('wb-toggle-drawing');
        const drawingTools = document.getElementById('wb-drawing-tools');
        
        if (isLocalHost) {
          // Host can see the toggle button
          if (toggleBtn) toggleBtn.classList.remove('hidden');
        } else {
          // Participants cannot see toggle button
          if (toggleBtn) toggleBtn.classList.add('hidden');
        }
        
        // Hide drawing tools initially for screen share
        if (drawingTools) drawingTools.classList.add('hidden');
      } else {
        // For whiteboard, hide toggle and show tools always
        const toggleBtn = document.getElementById('wb-toggle-drawing');
        const drawingTools = document.getElementById('wb-drawing-tools');
        if (toggleBtn) toggleBtn.classList.add('hidden');
        if (drawingTools) drawingTools.classList.remove('hidden');
      }
    } else {
      wbControls.classList.add('hidden');
      wbControls.classList.remove('flex');
    }
  }

  // Setup specific presentation mode
  if (presData.type === 'whiteboard') {
    initWhiteboard();
    if (socket) {
      socket.emit('get-whiteboard-history', (history) => {
        whiteboardHistory = history || [];
        redrawWhiteboard();
      });
    }
  } else if (presData.type === 'pdf') {
    if (content) {
      content.innerHTML = `<iframe src="${presData.url}" class="w-full h-full border-0 bg-slate-900 rounded-xl" allow="fullscreen"></iframe>`;
    }
  } else if (presData.type === 'screen') {
    if (content) {
      // Create container with video and overlay canvas for drawing
      content.innerHTML = `
        <div style="position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
          <video id="presentation-video" autoplay playsinline class="w-full h-auto object-contain bg-slate-950 rounded-xl" style="position: absolute; max-width: 100%; max-height: 100%;"></video>
          <canvas id="screen-draw-canvas" class="cursor-crosshair" style="position: absolute; width: 100%; height: 100%; z-index: 10; pointer-events: auto;"></canvas>
        </div>
      `;
      
      const presVideo = document.getElementById('presentation-video');
      
      if (presData.presenterId === socket.id) {
        if (screenStream) {
          presVideo.srcObject = screenStream;
        }
      } else {
        const peer = peers.get(presData.presenterId);
        if (peer && peer.stream) {
          presVideo.srcObject = peer.stream;
        }
      }
      
      // Initialize drawing on the overlay canvas
      initScreenDrawCanvas();
    }
  }

  // Re-organize layouts split
  reorganizeGrid();
}

/**
 * Handle stopping presentation viewports on all clients.
 */
function handlePresentationStopped() {
  console.log('Presentation stopped - cleaning up');
  activePresentation = null;

  // Stop screen stream if we were presenting screen
  if (isScreenSharing) {
    stopScreenShare();
  }

  // Hide presentation viewport
  const viewport = document.getElementById('presentation-viewport');
  if (viewport) viewport.classList.add('hidden');

  // Clear presentation content
  const content = document.getElementById('presentation-content');
  if (content) content.innerHTML = '';

  // Hide whiteboard controls
  const wbControls = document.getElementById('whiteboard-controls');
  if (wbControls) {
    wbControls.classList.add('hidden');
    wbControls.classList.remove('flex');
  }

  // Ensure video-grid is visible
  const videoGrid = document.getElementById('video-grid');
  if (videoGrid) {
    videoGrid.classList.remove('hidden');
    console.log('Video grid restored to visible');
  }

  // Re-enable the presentation button for host
  const presBtn = document.getElementById('btn-presentation');
  if (presBtn && isLocalHost) {
    presBtn.disabled = false;
    presBtn.style.pointerEvents = 'auto';
    presBtn.style.opacity = '1';
    presBtn.classList.remove('opacity-50', 'cursor-not-allowed', 'pointer-events-none');
    console.log('Presentation button re-enabled for host');
  }

  // Reorganize standard grid layouts
  reorganizeGrid();
  console.log('Grid reorganized after presentation stop');
}

/**
 * Search Bible API using server proxy backend route.
 */
async function searchBibleScripture() {
  const transSelect = document.getElementById('bible-translation');
  const bookSelect = document.getElementById('bible-book');
  const chapterInput = document.getElementById('bible-chapter');
  const verseInput = document.getElementById('bible-verse');
  const verseEndInput = document.getElementById('bible-verse-end');
  const resultsDiv = document.getElementById('bible-results');

  if (!transSelect || !bookSelect || !chapterInput || !resultsDiv) return;

  const translation = transSelect.value;
  const book = bookSelect.value;
  const chapter = chapterInput.value.trim();
  const verseStart = verseInput ? verseInput.value.trim() : '';
  const verseEnd = verseEndInput ? verseEndInput.value.trim() : '';

  if (!chapter) {
    showNotificationToast("Please enter a chapter number.");
    return;
  }

  // Build verse parameter - support ranges like "16-19"
  let verse = '';
  if (verseStart && verseEnd && parseInt(verseEnd) > parseInt(verseStart)) {
    verse = `${verseStart}-${verseEnd}`;
  } else if (verseStart) {
    verse = verseStart;
  }

  resultsDiv.innerHTML = `
    <div class="flex flex-col items-center justify-center py-8 space-y-2">
      <div class="w-6 h-6 border-2 border-t-transparent border-amber-500 rounded-full animate-spin"></div>
      <p class="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Searching Scriptures...</p>
    </div>
  `;

  try {
    // Determine backend URL (same logic as socket connection)
    const savedBackendUrl = localStorage.getItem('aethermeet_backend_url');
    let backendUrl = '';
    
    if (savedBackendUrl) {
      backendUrl = savedBackendUrl;
    } else {
      const host = window.location.hostname;
      if (host === 'localhost' || host === '127.0.0.1' || host.includes('192.168.')) {
        backendUrl = `${window.location.protocol}//${window.location.hostname}:3000`;
      } else {
        backendUrl = 'https://touchbygodmeetserver.onrender.com';
      }
    }
    
    const url = `${backendUrl}/api/bible?translation=${encodeURIComponent(translation)}&book=${encodeURIComponent(book)}&chapter=${encodeURIComponent(chapter)}&verse=${encodeURIComponent(verse)}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok || data.error) {
      resultsDiv.innerHTML = `
        <div class="p-4 border border-red-500/10 bg-red-500/5 rounded-xl text-center">
          <i data-lucide="alert-triangle" class="w-5 h-5 text-red-400 mx-auto mb-1"></i>
          <p class="text-xs font-semibold text-red-400">Search Failed</p>
          <p class="text-[10px] text-slate-500 mt-1">${data.error || 'Check details and try again.'}</p>
        </div>
      `;
      lucide.createIcons();
      return;
    }

    // Handle single verse response format
    if (data.text && data.verse) {
      const verseRef = `${data.book} ${data.chapter}:${data.verse}`;
      
      resultsDiv.innerHTML = '';
      
      // Add action buttons for single verse if host
      if (isLocalHost) {
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'flex items-center space-x-2 mb-3 bg-slate-900/60 p-2 border border-slate-850 rounded-xl';
        actionsDiv.innerHTML = `
          <span class="text-[9px] font-bold text-slate-400 flex-grow">Search Result</span>
          <button onclick="shareBibleVerseToChat(\`${data.text.replace(/"/g, '&quot;')}\`, \`${verseRef}\`)" class="px-2 py-1 bg-slate-950 border border-slate-800 hover:border-slate-700 text-[9px] font-semibold rounded-md text-slate-300 hover:text-white flex items-center space-x-1 transition-all">
            <i data-lucide="message-square" class="w-3 h-3"></i>
            <span>Share to Chat</span>
          </button>
          <button onclick="broadcastBibleVerse(\`${data.text.replace(/"/g, '&quot;')}\`, \`${verseRef}\`, \`${data.translation}\`)" class="px-2 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 border border-amber-600/10 text-[9px] font-bold rounded-md flex items-center space-x-1 transition-all shadow-md">
            <i data-lucide="radio" class="w-3 h-3"></i>
            <span>Broadcast</span>
          </button>
        `;
        resultsDiv.appendChild(actionsDiv);
      }
      
      const verseDiv = document.createElement('div');
      verseDiv.className = 'p-3 bg-slate-900/30 border border-slate-850/60 rounded-xl space-y-2';
      
      let hostControls = '';
      if (isLocalHost) {
        hostControls = `
          <button onclick="broadcastBibleVerse(\`${data.text.replace(/"/g, '&quot;')}\`, \`${verseRef}\`, \`${data.translation}\`)" class="p-1 hover:bg-amber-500/20 text-amber-400 rounded-md transition-colors" title="Broadcast to screen">
            <i data-lucide="radio" class="w-3.5 h-3.5"></i>
          </button>
        `;
      }

      verseDiv.innerHTML = `
        <div class="flex items-start justify-between gap-2">
          <span class="text-[10px] font-black text-amber-500 tracking-wider uppercase">${verseRef} (${data.translation})</span>
          <div class="flex items-center space-x-1 shrink-0">
            <button onclick="shareBibleVerseToChat(\`${data.text.replace(/"/g, '&quot;')}\`, \`${verseRef}\`)" class="p-1 hover:bg-slate-800 text-slate-400 hover:text-white rounded-md transition-colors" title="Post to chat">
              <i data-lucide="message-square" class="w-3.5 h-3.5"></i>
            </button>
            ${hostControls}
          </div>
        </div>
        <p class="text-xs text-slate-300 leading-relaxed font-serif">${data.text}</p>
      `;
      resultsDiv.appendChild(verseDiv);
      lucide.createIcons();
      return;
    }

    // Handle multiple verses response format
    if (!data.verses || data.verses.length === 0) {
      resultsDiv.innerHTML = `
        <div class="p-4 border border-slate-800 bg-slate-900/30 rounded-xl text-center">
          <p class="text-xs font-semibold text-slate-300">No results found</p>
          <p class="text-[10px] text-slate-500 mt-1">Make sure the chapter or verse exists.</p>
        </div>
      `;
      return;
    }

    // Format and render search results
    resultsDiv.innerHTML = '';
    
    // Group all text for full chapter
    const fullChapterText = data.verses.map(v => `${v.verse} ${v.text}`).join(' ');
    const reference = `${data.book} ${data.chapter}:${verse || '1-' + data.verses.length}`;

    // Add Broadcast and Share buttons for the whole section if host
    if (isLocalHost) {
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'flex items-center space-x-2 mb-3 bg-slate-900/60 p-2 border border-slate-850 rounded-xl';
      actionsDiv.innerHTML = `
        <span class="text-[9px] font-bold text-slate-400 flex-grow">All Search Results</span>
        <button onclick="shareBibleVerseToChat(\`${fullChapterText.replace(/"/g, '&quot;')}\`, \`${reference}\`)" class="px-2 py-1 bg-slate-950 border border-slate-800 hover:border-slate-700 text-[9px] font-semibold rounded-md text-slate-300 hover:text-white flex items-center space-x-1 transition-all">
          <i data-lucide="message-square" class="w-3 h-3"></i>
          <span>Share to Chat</span>
        </button>
        <button onclick="broadcastBibleVerse(\`${fullChapterText.replace(/"/g, '&quot;')}\`, \`${reference}\`, \`${data.translation}\`)" class="px-2 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 border border-amber-600/10 text-[9px] font-bold rounded-md flex items-center space-x-1 transition-all shadow-md">
          <i data-lucide="radio" class="w-3 h-3"></i>
          <span>Broadcast</span>
        </button>
      `;
      resultsDiv.appendChild(actionsDiv);
    }

    data.verses.forEach(v => {
      const verseRef = `${data.book} ${data.chapter}:${v.verse}`;
      const verseDiv = document.createElement('div');
      verseDiv.className = 'p-3 bg-slate-900/30 border border-slate-850/60 rounded-xl space-y-2';
      
      let hostControls = '';
      if (isLocalHost) {
        hostControls = `
          <button onclick="broadcastBibleVerse(\`${v.text.replace(/"/g, '&quot;')}\`, \`${verseRef}\`, \`${data.translation}\`)" class="p-1 hover:bg-amber-500/20 text-amber-400 rounded-md transition-colors" title="Broadcast to screen">
            <i data-lucide="radio" class="w-3.5 h-3.5"></i>
          </button>
        `;
      }

      verseDiv.innerHTML = `
        <div class="flex items-start justify-between gap-2">
          <span class="text-[10px] font-black text-amber-500 tracking-wider uppercase">${verseRef} (${data.translation})</span>
          <div class="flex items-center space-x-1 shrink-0">
            <button onclick="shareBibleVerseToChat(\`${v.text.replace(/"/g, '&quot;')}\`, \`${verseRef}\`)" class="p-1 hover:bg-slate-800 text-slate-400 hover:text-white rounded-md transition-colors" title="Post to chat">
              <i data-lucide="message-square" class="w-3.5 h-3.5"></i>
            </button>
            ${hostControls}
          </div>
        </div>
        <p class="text-xs text-slate-300 leading-relaxed font-serif">${v.text}</p>
      `;
      resultsDiv.appendChild(verseDiv);
    });

    lucide.createIcons();

  } catch (err) {
    console.error("Bible search error:", err);
    resultsDiv.innerHTML = `
      <div class="p-4 border border-red-500/10 bg-red-500/5 rounded-xl text-center">
        <i data-lucide="alert-triangle" class="w-5 h-5 text-red-400 mx-auto mb-1"></i>
        <p class="text-xs font-semibold text-red-400">Search Error</p>
        <p class="text-[10px] text-slate-500 mt-1">Check console or network and try again.</p>
      </div>
    `;
    lucide.createIcons();
  }
}

/**
 * Post a scripture verse directly to the active meeting room chat.
 */
function shareBibleVerseToChat(text, reference) {
  const message = `📖 **${reference}**\n"${text}"`;
  if (socket) {
    socket.emit('send-chat', message);
    showNotificationToast("Scripture shared in chat!");
  }
}

/**
 * Host only: Broadcasts verse prominently to everyone's screen.
 */
function broadcastBibleVerse(text, reference, translation) {
  if (socket && isLocalHost) {
    socket.emit('broadcast-verse', { text, reference, translation });
  }
}

/**
 * Host only: Clears current broadcasted overlay for everyone.
 */
function clearBibleBroadcast() {
  if (socket && isLocalHost) {
    socket.emit('clear-broadcast');
  }
}

/**
 * Display screen-wide broadcast overlay.
 */
function displayBroadcastedVerse(data) {
  const overlay = document.getElementById('broadcast-overlay');
  const textEl = document.getElementById('broadcast-text');
  const refEl = document.getElementById('broadcast-reference');
  const dismissBtn = document.getElementById('dismiss-broadcast-btn');

  if (overlay && textEl && refEl) {
    textEl.textContent = `“${data.text}”`;
    refEl.textContent = `${data.reference} (${data.translation})`;
    
    overlay.classList.remove('hidden', 'opacity-0', 'pointer-events-none');
    overlay.classList.add('flex', 'opacity-100');

    // Show host controls
    if (dismissBtn) {
      if (isLocalHost) {
        dismissBtn.classList.remove('hidden');
      } else {
        dismissBtn.classList.add('hidden');
      }
    }
    
    // Reset to expanded state and setup minimize button
    overlay.setAttribute('data-minimized', 'false');
    setupBroadcastMinimizeButton();
  }
}

/**
 * Clear broadcast overlay.
 */
function clearBroadcastedVerse() {
  const overlay = document.getElementById('broadcast-overlay');
  if (overlay) {
    overlay.classList.add('hidden', 'opacity-0', 'pointer-events-none');
    overlay.classList.remove('flex', 'opacity-100');
    
    // Remove minimize button
    const minimizeBtn = document.getElementById('minimize-broadcast-btn');
    if (minimizeBtn) minimizeBtn.remove();
  }
}

/**
 * Setup minimize/restore button for broadcast (all users can use this)
 */
function setupBroadcastMinimizeButton() {
  const overlay = document.getElementById('broadcast-overlay');
  
  // Remove old minimize button if exists
  let minimizeBtn = document.getElementById('minimize-broadcast-btn');
  if (minimizeBtn) {
    minimizeBtn.remove();
  }
  
  // Create minimize button
  minimizeBtn = document.createElement('button');
  minimizeBtn.id = 'minimize-broadcast-btn';
  minimizeBtn.className = 'absolute top-2 left-2 text-slate-400 hover:text-slate-200 transition-colors flex items-center space-x-1 bg-slate-800/60 hover:bg-slate-700 border border-slate-700/80 rounded-lg px-2 py-1 text-[9px] font-black uppercase tracking-wider z-10';
  minimizeBtn.title = 'Minimize broadcast';
  minimizeBtn.innerHTML = '<i data-lucide="chevron-down" class="w-3 h-3"></i><span>Hide</span>';
  
  minimizeBtn.onclick = () => {
    const isMinimized = overlay.getAttribute('data-minimized') === 'true';
    
    if (isMinimized) {
      // Restore - show full broadcast
      overlay.classList.remove('bottom-2');
      overlay.classList.add('bottom-20');
      overlay.setAttribute('data-minimized', 'false');
      minimizeBtn.innerHTML = '<i data-lucide="chevron-down" class="w-3 h-3"></i><span>Hide</span>';
      minimizeBtn.title = 'Minimize broadcast';
      
      // Show content
      const content = document.getElementById('broadcast-text');
      const badge = document.getElementById('broadcast-badge');
      if (content) content.classList.remove('hidden');
      if (badge) badge.classList.remove('hidden');
      
    } else {
      // Minimize - show only reference bar
      overlay.classList.remove('bottom-20');
      overlay.classList.add('bottom-2');
      overlay.setAttribute('data-minimized', 'true');
      minimizeBtn.innerHTML = '<i data-lucide="chevron-up" class="w-3 h-3"></i><span>Show</span>';
      minimizeBtn.title = 'Restore broadcast';
      
      // Hide content, show only reference
      const content = document.getElementById('broadcast-text');
      const badge = document.getElementById('broadcast-badge');
      if (content) content.classList.add('hidden');
      if (badge) badge.classList.add('hidden');
    }
    
    lucide.createIcons();
  };
  
  // Insert into container
  const container = overlay.querySelector('div > div');
  if (container) {
    container.insertBefore(minimizeBtn, container.firstChild);
  }
  
  lucide.createIcons();
}


/* ==========================================================================
   INTERACTIVE CANVAS WHITEBOARD FUNCTIONS
   ========================================================================== */

function initWhiteboard() {
  const container = document.getElementById('presentation-content');
  if (!container) return;

  container.innerHTML = `<canvas id="whiteboard-canvas" class="w-full h-full bg-[#0d111d] cursor-crosshair rounded-xl shadow-inner"></canvas>`;
  whiteboardCanvas = document.getElementById('whiteboard-canvas');
  whiteboardCtx = whiteboardCanvas.getContext('2d');

  resizeWhiteboardCanvas();

  // Mouse Handlers
  whiteboardCanvas.addEventListener('mousedown', startDrawing);
  whiteboardCanvas.addEventListener('mousemove', draw);
  whiteboardCanvas.addEventListener('mouseup', stopDrawing);
  whiteboardCanvas.addEventListener('mouseout', stopDrawing);

  // Touch Handlers (Mobiles/Tablets)
  whiteboardCanvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const mouseEvent = new MouseEvent('mousedown', {
        clientX: touch.clientX,
        clientY: touch.clientY
      });
      whiteboardCanvas.dispatchEvent(mouseEvent);
    }
  }, { passive: true });

  whiteboardCanvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const mouseEvent = new MouseEvent('mousemove', {
        clientX: touch.clientX,
        clientY: touch.clientY
      });
      whiteboardCanvas.dispatchEvent(mouseEvent);
    }
  }, { passive: true });

  whiteboardCanvas.addEventListener('touchend', () => {
    const mouseEvent = new MouseEvent('mouseup', {});
    whiteboardCanvas.dispatchEvent(mouseEvent);
  });

  // Watch resize to prevent drawing clears
  window.addEventListener('resize', resizeWhiteboardCanvas);

  // Color selection
  const picker = document.getElementById('wb-color');
  if (picker) {
    picker.addEventListener('change', (e) => {
      wbColor = e.target.value;
      selectWhiteboardTool('pencil');
    });
  }

  // Controls triggers
  const btnPencil = document.getElementById('wb-tool-pencil');
  if (btnPencil) btnPencil.onclick = () => selectWhiteboardTool('pencil');
  
  const btnEraser = document.getElementById('wb-tool-eraser');
  if (btnEraser) btnEraser.onclick = () => selectWhiteboardTool('eraser');

  const btnClear = document.getElementById('wb-clear');
  if (btnClear) {
    btnClear.onclick = () => {
      clearWhiteboardCanvas(false);
    };
  }
}

function selectWhiteboardTool(tool) {
  wbTool = tool;
  const pBtn = document.getElementById('wb-tool-pencil');
  const eBtn = document.getElementById('wb-tool-eraser');

  if (!pBtn || !eBtn) return;

  if (tool === 'pencil') {
    pBtn.className = "w-8 h-8 rounded-lg bg-brand-600 text-white flex items-center justify-center transition-all shadow-md";
    eBtn.className = "w-8 h-8 rounded-lg bg-slate-900 border border-slate-850 text-slate-400 hover:text-white flex items-center justify-center transition-all";
  } else {
    eBtn.className = "w-8 h-8 rounded-lg bg-brand-600 text-white flex items-center justify-center transition-all shadow-md";
    pBtn.className = "w-8 h-8 rounded-lg bg-slate-900 border border-slate-850 text-slate-400 hover:text-white flex items-center justify-center transition-all";
  }
}

function resizeWhiteboardCanvas() {
  if (!whiteboardCanvas) return;
  
  // Get the actual displayed size of the canvas
  const rect = whiteboardCanvas.getBoundingClientRect();
  
  // Store the current drawing if exists
  const tempHistory = [...whiteboardHistory];
  
  // Set canvas internal dimensions to match displayed dimensions exactly
  // This ensures 1:1 pixel mapping between mouse coords and canvas coords
  whiteboardCanvas.width = rect.width;
  whiteboardCanvas.height = rect.height;
  
  // Also set CSS dimensions to match (prevents scaling)
  whiteboardCanvas.style.width = rect.width + 'px';
  whiteboardCanvas.style.height = rect.height + 'px';

  // Redraw after resize
  redrawWhiteboard();
}

function startDrawing(e) {
  e.preventDefault();
  isDrawing = true;
  const rect = whiteboardCanvas.getBoundingClientRect();
  
  // Calculate scale factors in case CSS and canvas dimensions differ
  const scaleX = whiteboardCanvas.width / rect.width;
  const scaleY = whiteboardCanvas.height / rect.height;
  
  lastX = (e.clientX - rect.left) * scaleX;
  lastY = (e.clientY - rect.top) * scaleY;
}

function draw(e) {
  if (!isDrawing || !whiteboardCanvas) return;
  e.preventDefault();

  const rect = whiteboardCanvas.getBoundingClientRect();
  
  // Calculate scale factors to handle any CSS vs canvas size mismatch
  const scaleX = whiteboardCanvas.width / rect.width;
  const scaleY = whiteboardCanvas.height / rect.height;
  
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;

  const color = wbTool === 'eraser' ? '#0d111d' : wbColor;
  const size = wbTool === 'eraser' ? 24 : 3;

  drawSegment(lastX, lastY, x, y, color, size);

  // Sync to socket using relative percentages (guarantees cross-screen consistency)
  if (socket) {
    socket.emit('draw-whiteboard', {
      x0: lastX / whiteboardCanvas.width,
      y0: lastY / whiteboardCanvas.height,
      x1: x / whiteboardCanvas.width,
      y1: y / whiteboardCanvas.height,
      color,
      size
    });
  }

  lastX = x;
  lastY = y;
}

function drawSegment(x0, y0, x1, y1, color, size) {
  if (!whiteboardCtx) return;
  whiteboardCtx.beginPath();
  whiteboardCtx.moveTo(x0, y0);
  whiteboardCtx.lineTo(x1, y1);
  whiteboardCtx.strokeStyle = color;
  whiteboardCtx.lineWidth = size;
  whiteboardCtx.lineCap = 'round';
  whiteboardCtx.stroke();
}

function stopDrawing() {
  isDrawing = false;
}

function handleWhiteboardDraw(data) {
  if (!whiteboardCanvas) return;

  const x0 = data.x0 * whiteboardCanvas.width;
  const y0 = data.y0 * whiteboardCanvas.height;
  const x1 = data.x1 * whiteboardCanvas.width;
  const y1 = data.y1 * whiteboardCanvas.height;

  // Check if this is screen share mode (has screen-draw-canvas)
  const isScreenDraw = document.getElementById('screen-draw-canvas') === whiteboardCanvas;
  
  if (isScreenDraw) {
    // For screen draw overlay, draw directly on canvas
    const ctx = whiteboardCtx;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = data.color;
    ctx.lineWidth = data.size;
    ctx.lineCap = 'round';
    
    if (data.color === 'rgba(0,0,0,0)') {
      ctx.globalCompositeOperation = 'destination-out';
    } else {
      ctx.globalCompositeOperation = 'source-over';
    }
    
    ctx.stroke();
  } else {
    // For regular whiteboard, use history-based drawing
    whiteboardHistory.push(data);
    drawSegment(x0, y0, x1, y1, data.color, data.size);
  }
}

function clearWhiteboardCanvas(isRemote = false) {
  whiteboardHistory = [];
  if (whiteboardCtx && whiteboardCanvas) {
    whiteboardCtx.clearRect(0, 0, whiteboardCanvas.width, whiteboardCanvas.height);
  }
  if (!isRemote && socket) {
    socket.emit('clear-whiteboard');
  }
}

function redrawWhiteboard() {
  if (!whiteboardCanvas || whiteboardHistory.length === 0) return;
  whiteboardHistory.forEach(data => {
    const x0 = data.x0 * whiteboardCanvas.width;
    const y0 = data.y0 * whiteboardCanvas.height;
    const x1 = data.x1 * whiteboardCanvas.width;
    const y1 = data.y1 * whiteboardCanvas.height;
    drawSegment(x0, y0, x1, y1, data.color, data.size);
  });
}

/* ==========================================================================
   SCREEN SHARE DRAWING OVERLAY FUNCTIONS
   ========================================================================== */

window.isDrawingEnabled = false; // Track if drawing is enabled for screen share (global for socket access)

function initScreenDrawCanvas() {
  const canvas = document.getElementById('screen-draw-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let isDrawing = false;
  let lastX = 0;
  let lastY = 0;

  // Set canvas size to match container
  const resizeCanvas = () => {
    const container = canvas.parentElement;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
  };
  
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Drawing functions for screen overlay
  const startDraw = (e) => {
    if (!window.isDrawingEnabled) return; // Only draw if enabled
    e.preventDefault();
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    lastX = (e.clientX - rect.left) * scaleX;
    lastY = (e.clientY - rect.top) * scaleY;
  };

  const draw = (e) => {
    if (!isDrawing || !window.isDrawingEnabled) return; // Only draw if enabled
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // Use same tool/color as whiteboard
    const color = wbTool === 'eraser' ? 'rgba(0,0,0,0)' : wbColor;
    const size = wbTool === 'eraser' ? 24 : 3;

    // Draw on local canvas
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    
    if (wbTool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
    } else {
      ctx.globalCompositeOperation = 'source-over';
    }
    
    ctx.stroke();

    // Sync to other participants
    if (socket) {
      socket.emit('draw-whiteboard', {
        x0: lastX / canvas.width,
        y0: lastY / canvas.height,
        x1: x / canvas.width,
        y1: y / canvas.height,
        color,
        size
      });
    }

    lastX = x;
    lastY = y;
  };

  const stopDraw = () => {
    isDrawing = false;
  };

  // Mouse events
  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stopDraw);
  canvas.addEventListener('mouseout', stopDraw);

  // Touch events
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1 && window.isDrawingEnabled) {
      const touch = e.touches[0];
      const mouseEvent = new MouseEvent('mousedown', {
        clientX: touch.clientX,
        clientY: touch.clientY
      });
      canvas.dispatchEvent(mouseEvent);
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1 && window.isDrawingEnabled) {
      const touch = e.touches[0];
      const mouseEvent = new MouseEvent('mousemove', {
        clientX: touch.clientX,
        clientY: touch.clientY
      });
      canvas.dispatchEvent(mouseEvent);
    }
  }, { passive: false });

  canvas.addEventListener('touchend', () => {
    if (window.isDrawingEnabled) {
      const mouseEvent = new MouseEvent('mouseup', {});
      canvas.dispatchEvent(mouseEvent);
    }
  });

  // Clear button functionality for screen draw
  const btnClear = document.getElementById('wb-clear');
  if (btnClear) {
    btnClear.onclick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (socket) {
        socket.emit('clear-whiteboard');
      }
    };
  }

  // Toggle drawing button (host only)
  const toggleBtn = document.getElementById('wb-toggle-drawing');
  const toggleText = document.getElementById('wb-toggle-text');
  const drawingTools = document.getElementById('wb-drawing-tools');
  
  if (toggleBtn && isLocalHost) {
    toggleBtn.onclick = () => {
      window.isDrawingEnabled = !window.isDrawingEnabled;
      
      // Update button appearance and text
      if (window.isDrawingEnabled) {
        toggleBtn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500', 'border-emerald-500');
        toggleBtn.classList.add('bg-red-600', 'hover:bg-red-500', 'border-red-500');
        if (toggleText) toggleText.textContent = 'Disable Drawing';
        if (drawingTools) drawingTools.classList.remove('hidden');
        
        // Update cursor style
        canvas.style.cursor = 'crosshair';
        
        // Broadcast to participants
        if (socket) {
          socket.emit('toggle-screen-drawing', { enabled: true });
        }
      } else {
        toggleBtn.classList.remove('bg-red-600', 'hover:bg-red-500', 'border-red-500');
        toggleBtn.classList.add('bg-emerald-600', 'hover:bg-emerald-500', 'border-emerald-500');
        if (toggleText) toggleText.textContent = 'Enable Drawing';
        if (drawingTools) drawingTools.classList.add('hidden');
        
        // Update cursor style
        canvas.style.cursor = 'default';
        
        // Broadcast to participants
        if (socket) {
          socket.emit('toggle-screen-drawing', { enabled: false });
        }
      }
      
      lucide.createIcons();
    };
  }

  // Store reference for later cleanup
  whiteboardCanvas = canvas;
  whiteboardCtx = ctx;
}

