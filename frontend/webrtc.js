// webrtc.js - WebRTC Mesh Network & Media Stream Management

const iceConfiguration = {
  iceServers: [
    // Google STUN servers
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    
    // Free public TURN servers (Numb)
    {
      urls: ['turn:numb.viagenie.ca'],
      username: 'webrtc@live.com',
      credential: 'muazkh'
    },
    
    // Free TURN servers (Metered with multiple transports)
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:80?transport=tcp',
        'turn:openrelay.metered.ca:443',
        'turns:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceCandidatePoolSize: 10,
  iceTransportPolicy: 'all', // Try all candidates (relay and direct)
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require'
};

// Local Media States
let localStream = null;
let screenStream = null;
let localAudioTrack = null;
let localVideoTrack = null;
let isAudioMuted = false;
let isVideoMuted = false;
let isScreenSharing = false;
let isMicDisabledByHost = false;

// Background Blur Canvas variables
let isBlurActive = false;
let blurCanvasLoopId = null;
let blurCanvasElement = null;
let blurCanvasCtx = null;
let blurSourceVideo = null;
let processedLocalStream = null; // Stream exported from the blur canvas

// WebRTC Peer Connections Map: remoteSocketId -> { pc, stream, nickname, localVolumeSource, analyser }
const peers = new Map();

// Web Audio API contexts for speaking detection
let audioContext = null;
let localAnalyser = null;
let localAudioSource = null;
let localAudioLevelLoopId = null;

// Active Speaker Tracking
let activeSpeakerId = 'local';
let speakingThreshold = 18; // Threshold out of 255
let activeSpeakerTimer = null;

/**
 * Request user permissions and retrieve audio/video streams.
 */
async function getLocalMedia(constraints = null) {
  try {
    // If we have existing streams, stop them first
    stopLocalMedia();

    let stream;
    if (constraints) {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } else {
      const storedCameraId = localStorage.getItem('aethermeet_selected_camera_id');
      const storedMicId = localStorage.getItem('aethermeet_selected_mic_id');

      // Optimized video constraints to reduce CPU/GPU usage and heat
      const videoConstraints = storedCameraId 
        ? { 
            deviceId: { exact: storedCameraId },
            width: { ideal: 1280, max: 1280 },
            height: { ideal: 720, max: 720 },
            frameRate: { ideal: 30, max: 30 }
          }
        : {
            width: { ideal: 1280, max: 1280 },
            height: { ideal: 720, max: 720 },
            frameRate: { ideal: 30, max: 30 }
          };
          
      const audioConstraints = {
        echoCancellation: { ideal: true, exact: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true },
        sampleRate: 48000,
        sampleSize: 16
      };
      if (storedMicId) {
        audioConstraints.deviceId = { exact: storedMicId };
      }

      const customConstraints = {
        video: videoConstraints,
        audio: audioConstraints
      };

      try {
        stream = await navigator.mediaDevices.getUserMedia(customConstraints);
      } catch (err) {
        console.warn("Failed to get media with stored device IDs, falling back to default constraints...", err);
        // Fallback to defaults with audio processing enabled
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280, max: 1280 },
            height: { ideal: 720, max: 720 },
            frameRate: { ideal: 30, max: 30 }
          },
          audio: {
            echoCancellation: { ideal: true, exact: true },
            noiseSuppression: { ideal: true },
            autoGainControl: { ideal: true },
            sampleRate: 48000,
            sampleSize: 16
          }
        });
      }
    }

    localStream = stream;
    localAudioTrack = stream.getAudioTracks()[0];
    localVideoTrack = stream.getVideoTracks()[0];

    // Check if initial tracks are muted based on lobby controls
    if (localAudioTrack) localAudioTrack.enabled = !isAudioMuted;
    if (localVideoTrack) localVideoTrack.enabled = !isVideoMuted;

    // Set up canvas blur capture if enabled
    if (isBlurActive) {
      setupBlurCanvas();
    }

    // Set up audio analyzer for speaking levels
    setupAudioAnalysis();

    return isBlurActive ? processedLocalStream : localStream;
  } catch (error) {
    console.error('Error gaining media access:', error);
    throw error;
  }
}

/**
 * Release webcam/microphone.
 */
function stopLocalMedia() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;
  }
  if (blurCanvasLoopId) {
    cancelAnimationFrame(blurCanvasLoopId);
    blurCanvasLoopId = null;
  }
  if (localAudioLevelLoopId) {
    cancelAnimationFrame(localAudioLevelLoopId);
    localAudioLevelLoopId = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
}

/**
 * Sets up Canvas background blur vignette.
 * Grabs the webcam video, draws the background blurred,
 * overlays a clean vignette cropped version of the user in the center,
 * and exports the canvas as a media track for WebRTC.
 */
function setupBlurCanvas() {
  blurCanvasElement = document.getElementById('local-blur-canvas') || document.getElementById('blur-canvas');
  blurSourceVideo = document.getElementById('local-video') || document.getElementById('preview-video');
  
  if (!blurCanvasElement || !blurSourceVideo || !localVideoTrack) return;

  blurCanvasCtx = blurCanvasElement.getContext('2d', { 
    alpha: false,
    desynchronized: true // Better performance
  });
  blurCanvasElement.classList.remove('hidden');

  // Set canvas resolution - reduced for better performance
  // Use lower resolution to reduce GPU/CPU load
  const settings = localVideoTrack.getSettings();
  const targetWidth = Math.min(settings.width || 640, 960); // Max 960px width
  const targetHeight = Math.min(settings.height || 480, 540); // Max 540px height
  blurCanvasElement.width = targetWidth;
  blurCanvasElement.height = targetHeight;

  // Start processing loop
  isBlurActive = true;
  processBlurFrame();

  // Capture canvas stream at 24fps (reduced from 30fps for better performance)
  const canvasStream = blurCanvasElement.captureStream(24);
  
  // Replace the processedLocalStream video track
  processedLocalStream = new MediaStream([
    canvasStream.getVideoTracks()[0],
    ...(localStream ? localStream.getAudioTracks() : [])
  ]);
}

/**
 * Processing frame loop for camera Bokeh/vignette blur.
 * Optimized to reduce CPU usage and heat generation.
 */
let lastBlurFrameTime = 0;
const blurFrameInterval = 1000 / 20; // 20fps instead of 30fps (further reduced)

function processBlurFrame(currentTime) {
  if (!isBlurActive || !blurCanvasCtx || !blurSourceVideo || blurSourceVideo.paused || blurSourceVideo.ended) {
    if (isBlurActive) {
      blurCanvasLoopId = requestAnimationFrame(processBlurFrame);
    }
    return;
  }

  // Throttle to 20fps to reduce CPU usage (reduced from 30fps)
  if (currentTime - lastBlurFrameTime < blurFrameInterval) {
    blurCanvasLoopId = requestAnimationFrame(processBlurFrame);
    return;
  }
  lastBlurFrameTime = currentTime;

  const w = blurCanvasElement.width;
  const h = blurCanvasElement.height;

  // Clear canvas
  blurCanvasCtx.clearRect(0, 0, w, h);

  // 1. Draw background: blurred video (reduced blur for performance)
  blurCanvasCtx.filter = 'blur(12px)'; // Reduced from 16px
  blurCanvasCtx.drawImage(blurSourceVideo, 0, 0, w, h);
  blurCanvasCtx.filter = 'none';

  // 2. Draw user center foreground: Draw webcam unblurred inside a radial vignetted mask
  blurCanvasCtx.save();
  
  // Create circular/oval path in the center of the frame
  const gradient = blurCanvasCtx.createRadialGradient(
    w / 2, h / 2, Math.min(w, h) * 0.15, // Inner circle
    w / 2, h / 2, Math.min(w, h) * 0.45  // Outer circle boundary
  );
  gradient.addColorStop(0, 'rgba(0,0,0,1)');   // Fully opaque (fully sharp center)
  gradient.addColorStop(0.7, 'rgba(0,0,0,0.85)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');   // Transparent (fully blurred edges)

  blurCanvasCtx.fillStyle = gradient;
  blurCanvasCtx.beginPath();
  blurCanvasCtx.arc(w / 2, h / 2, Math.min(w, h) * 0.5, 0, Math.PI * 2);
  blurCanvasCtx.fill();

  // Apply compositing to mask next drawing operations
  blurCanvasCtx.globalCompositeOperation = 'source-in';
  
  // Draw the unblurred video (masked by the gradient)
  blurCanvasCtx.drawImage(blurSourceVideo, 0, 0, w, h);
  
  blurCanvasCtx.restore();

  // Loop
  blurCanvasLoopId = requestAnimationFrame(processBlurFrame);
}

/**
 * Toggle background blur filter.
 */
function toggleBackgroundBlur(enabled) {
  isBlurActive = enabled;
  const blurCanvas = document.getElementById('local-blur-canvas') || document.getElementById('blur-canvas');
  
  if (enabled) {
    setupBlurCanvas();
    if (processedLocalStream) {
      // Hot swap the video track in local video display
      const localVideo = document.getElementById('local-video');
      if (localVideo) {
        localVideo.srcObject = processedLocalStream;
      }
      
      // Hot swap in all peer connections
      const canvasVideoTrack = processedLocalStream.getVideoTracks()[0];
      peers.forEach(peer => {
        const senders = peer.pc.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender) {
          videoSender.replaceTrack(canvasVideoTrack);
        }
      });
    }
  } else {
    // Disable blur
    if (blurCanvasLoopId) cancelAnimationFrame(blurCanvasLoopId);
    if (blurCanvas) blurCanvas.classList.add('hidden');
    
    // Restore normal stream
    const localVideo = document.getElementById('local-video') || document.getElementById('preview-video');
    if (localVideo && localStream) {
      localVideo.srcObject = localStream;
    }

    if (localStream && localVideoTrack) {
      peers.forEach(peer => {
        const senders = peer.pc.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender) {
          videoSender.replaceTrack(localVideoTrack);
        }
      });
    }
  }
}

/**
 * Hot-swap local device tracks without reconnecting peers.
 */
async function changeDevice(kind, deviceId) {
  if (!localStream) return;

  // Persist the selection so it survives redirects/refreshes
  if (kind === 'video') {
    localStorage.setItem('aethermeet_selected_camera_id', deviceId);
  } else if (kind === 'audio') {
    localStorage.setItem('aethermeet_selected_mic_id', deviceId);
  }

  const constraints = {
    audio: kind === 'audio' 
      ? { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
      : (localAudioTrack ? { deviceId: { exact: localAudioTrack.getSettings().deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true } : { echoCancellation: true, noiseSuppression: true, autoGainControl: true }),
    video: kind === 'video' 
      ? { deviceId: { exact: deviceId } } 
      : (localVideoTrack ? { deviceId: { exact: localVideoTrack.getSettings().deviceId } } : true)
  };

  try {
    const newStream = await navigator.mediaDevices.getUserMedia(constraints);
    
    if (kind === 'video') {
      const oldTrack = localVideoTrack;
      localVideoTrack = newStream.getVideoTracks()[0];
      
      // Stop old video track
      if (oldTrack) oldTrack.stop();
      
      // Check mute state
      localVideoTrack.enabled = !isVideoMuted;

      // Update the local video stream object
      const audioTracks = localStream.getAudioTracks();
      localStream = new MediaStream([localVideoTrack, ...audioTracks]);

      // If background blur is on, re-initialize blur canvas
      if (isBlurActive) {
        setupBlurCanvas();
        const localVideo = document.getElementById('local-video') || document.getElementById('preview-video');
        if (localVideo) localVideo.srcObject = processedLocalStream;
        
        // Swap track in peers
        const canvasVideoTrack = processedLocalStream.getVideoTracks()[0];
        peers.forEach(peer => {
          const videoSender = peer.pc.getSenders().find(s => s.track && s.track.kind === 'video');
          if (videoSender) videoSender.replaceTrack(canvasVideoTrack);
        });
      } else {
        const localVideo = document.getElementById('local-video') || document.getElementById('preview-video');
        if (localVideo) localVideo.srcObject = localStream;
        
        // Swap track in peers
        peers.forEach(peer => {
          const videoSender = peer.pc.getSenders().find(s => s.track && s.track.kind === 'video');
          if (videoSender) videoSender.replaceTrack(localVideoTrack);
        });
      }
    } else if (kind === 'audio') {
      const oldTrack = localAudioTrack;
      localAudioTrack = newStream.getAudioTracks()[0];
      
      // Stop old audio track
      if (oldTrack) oldTrack.stop();
      
      // Check mute states
      localAudioTrack.enabled = !isAudioMuted;

      const videoTracks = localStream.getVideoTracks();
      localStream = new MediaStream([localAudioTrack, ...videoTracks]);

      // Refresh audio analyser with new stream source
      setupAudioAnalysis();

      // Swap track in peers
      peers.forEach(peer => {
        const audioSender = peer.pc.getSenders().find(s => s.track && s.track.kind === 'audio');
        if (audioSender) audioSender.replaceTrack(localAudioTrack);
      });
    }

    console.log(`Successfully changed local ${kind} hardware source.`);
  } catch (error) {
    console.error('Error swapping hardware sources:', error);
    showNotificationToast(`Could not swap hardware: ${error.message}`);
  }
}

/**
 * Handle screen sharing toggle.
 */
async function toggleScreenShareState() {
  if (isScreenSharing) {
    // Stop Screen share
    stopScreenShare();
  } else {
    // Start Screen share
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: "always"
        },
        audio: true
      });

      const screenVideoTrack = screenStream.getVideoTracks()[0];
      isScreenSharing = true;

      // Handle user stopping screen share via browser popup bar
      screenVideoTrack.onended = () => {
        stopScreenShare();
      };

      // Set UI button active
      updateScreenShareUIButton(true);

      // Render local screen share locally in video element
      const localVideo = document.getElementById('local-video');
      if (localVideo) {
        localVideo.srcObject = screenStream;
        localVideo.classList.remove('scale-x-[-1]'); // Remove mirror on screen share
      }
      document.getElementById('local-screen-status').classList.remove('hidden');

      // Swap video track in all WebRTC peers
      peers.forEach(peer => {
        const senders = peer.pc.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender) {
          videoSender.replaceTrack(screenVideoTrack);
        }
      });

      // Broadcast screen share state to room
      if (socket) socket.emit('toggle-screen-share', true);

    } catch (error) {
      console.error('Screen sharing cancelled or failed:', error);
      isScreenSharing = false;
      updateScreenShareUIButton(false);
    }
  }
}

function stopScreenShare() {
  if (!isScreenSharing) return;
  isScreenSharing = false;

  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;
  }

  // Update UI buttons
  updateScreenShareUIButton(false);
  document.getElementById('local-screen-status').classList.add('hidden');

  // Restore camera stream locally
  const localVideo = document.getElementById('local-video');
  if (localVideo) {
    localVideo.classList.add('scale-x-[-1]');
    localVideo.srcObject = isBlurActive ? processedLocalStream : localStream;
  }

  // Restore camera track to all WebRTC peers
  const cameraTrack = isBlurActive ? processedLocalStream.getVideoTracks()[0] : localVideoTrack;
  if (cameraTrack) {
    peers.forEach(peer => {
      const senders = peer.pc.getSenders();
      const videoSender = senders.find(s => s.track && s.track.kind === 'video');
      if (videoSender) {
        videoSender.replaceTrack(cameraTrack);
      }
    });
  }

  if (socket) socket.emit('toggle-screen-share', false);
}

/**
 * Sets up Web Audio API nodes to capture microphone volumes.
 */
function setupAudioAnalysis() {
  try {
    if (localAudioLevelLoopId) cancelAnimationFrame(localAudioLevelLoopId);
    if (audioContext) audioContext.close();

    if (!localStream || localStream.getAudioTracks().length === 0) return;

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    localAnalyser = audioContext.createAnalyser();
    localAnalyser.fftSize = 64;

    localAudioSource = audioContext.createMediaStreamSource(localStream);
    localAudioSource.connect(localAnalyser);

    analyzeLocalAudioVolume();
  } catch (e) {
    console.warn('Web Audio Context initialization blocked or failed:', e);
  }
}

/**
 * Loop running volume frequency checks.
 * Optimized to reduce CPU usage by throttling to 10fps and pausing when muted.
 */
let lastAudioAnalysisTime = 0;
const audioAnalysisInterval = 1000 / 10; // 10fps instead of 20fps

function analyzeLocalAudioVolume(currentTime) {
  // STOP analysis loop completely when muted to save CPU
  if (!localAnalyser || isAudioMuted) {
    resetMicLevelUI();
    // DO NOT continue the loop when muted
    return;
  }

  // Throttle to 10fps to reduce CPU usage
  if (currentTime - lastAudioAnalysisTime < audioAnalysisInterval) {
    localAudioLevelLoopId = requestAnimationFrame(analyzeLocalAudioVolume);
    return;
  }
  lastAudioAnalysisTime = currentTime;

  const dataArray = new Uint8Array(localAnalyser.frequencyBinCount);
  localAnalyser.getByteFrequencyData(dataArray);

  // Compute average volume level
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    sum += dataArray[i];
  }
  const average = sum / dataArray.length;

  // Animate mic indicators in lobby or meeting controls
  updateMicLevelUI(average);

  // Active speaker detection locally
  if (average > speakingThreshold) {
    highlightSpeakingStatus('local', true);
  } else {
    highlightSpeakingStatus('local', false);
  }

  localAudioLevelLoopId = requestAnimationFrame(analyzeLocalAudioVolume);
}

/**
 * Dynamic adjustments to HTML audio volume bars.
 */
function updateMicLevelUI(volume) {
  // Normalize volume value to heights (typically scale up to 10px-24px)
  const normalizedHeight = Math.min(24, Math.max(2, (volume / 255) * 45));

  const bars = document.querySelectorAll('.mic-wave-bar');
  bars.forEach((bar, idx) => {
    // Add minor staggered height variance for wave aesthetics
    const heightFactor = [1, 1.4, 1.8, 1.3, 0.9][idx] || 1;
    bar.style.height = `${Math.min(24, normalizedHeight * heightFactor)}px`;
  });
}

function resetMicLevelUI() {
  const bars = document.querySelectorAll('.mic-wave-bar');
  bars.forEach(bar => {
    bar.style.height = `3px`;
  });
}

/**
 * WebRTC: Creates a PeerConnection for a remote participant.
 */
function createPeerConnection(remoteSocketId, nickname, isInitiator, isHost) {
  console.log(`Creating PeerConnection for socket ID: ${remoteSocketId} (${nickname})`);

  const pc = new RTCPeerConnection(iceConfiguration);

  // Store peer record
  peers.set(remoteSocketId, {
    pc,
    nickname,
    stream: null,
    remoteAudioMuted: false,
    remoteVideoMuted: false,
    isHost,
    iceCandidatesQueue: []
  });

  // Send local media tracks to peer
  const mediaStream = isBlurActive ? processedLocalStream : localStream;
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => {
      pc.addTrack(track, mediaStream);
    });
  }

  // Ice candidates gathering callback
  pc.onicecandidate = (event) => {
    if (event.candidate && socket) {
      const candidateType = event.candidate.type || 'unknown';
      const candidateProtocol = event.candidate.protocol || 'unknown';
      console.log(`Sending ICE candidate to ${nickname}: type=${candidateType}, protocol=${candidateProtocol}, address=${event.candidate.address || 'N/A'}`);
      socket.emit('signal', {
        to: remoteSocketId,
        signal: { candidate: event.candidate }
      });
    } else if (!event.candidate) {
      console.log(`ICE gathering complete for ${nickname}`);
    }
  };

  // ICE connection state monitoring with improved recovery
  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    console.log(`ICE connection state for ${nickname}: ${state}`);
    
    if (state === 'failed' || state === 'disconnected') {
      console.warn(`ICE connection ${state} for ${nickname} - attempting recovery`);
      
      // Try ICE restart after a delay
      setTimeout(() => {
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
          console.log(`Attempting ICE restart for ${nickname}`);
          pc.restartIce();
        }
      }, 2000);
    } else if (state === 'connected' || state === 'completed') {
      console.log(`✅ ICE connection successful with ${nickname}`);
    }
  };

  // Connection health changes
  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    console.log(`Connection state change for ${nickname}: ${state}`);
    
    if (state === 'connected') {
      console.log(`✅ Peer connection established with ${nickname}`);
    } else if (state === 'failed') {
      console.error(`❌ Connection failed for ${nickname} - this might be a firewall/NAT issue`);
      showNotificationToast(`Unable to connect with ${nickname}. Network/firewall issue.`);
      
      // Only destroy after confirmed failure
      setTimeout(() => {
        if (pc.connectionState === 'failed') {
          console.log(`Destroying failed connection with ${nickname}`);
          destroyPeerConnection(remoteSocketId);
          updateParticipantsList();
        }
      }, 5000);
    } else if (state === 'disconnected') {
      console.warn(`⚠️ Connection disconnected from ${nickname}, waiting for reconnection...`);
      
      // Wait before destroying - might reconnect
      setTimeout(() => {
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          console.log(`Connection with ${nickname} did not recover, cleaning up`);
          destroyPeerConnection(remoteSocketId);
          updateParticipantsList();
        }
      }, 10000); // Wait 10 seconds for reconnection
    }
  };

  // Remote tracks received: create video tile in grid
  pc.ontrack = (event) => {
    console.log(`Received remote track from ${nickname}: kind=${event.track.kind}`);
    const remoteStream = event.streams[0];
    
    // Update stored stream
    const peerRecord = peers.get(remoteSocketId);
    if (peerRecord) {
      peerRecord.stream = remoteStream;
    }

    // Add video tile to grid
    renderRemoteVideoTile(remoteSocketId, nickname, remoteStream, isHost);
    
    // If audio track, setup speaker detection for this peer
    if (event.track.kind === 'audio') {
      setupRemoteAudioAnalysis(remoteSocketId, remoteStream);
    }
  };

  // If we are initiating, create and send WebRTC SDP offer immediately
  if (isInitiator) {
    // Create offer immediately after peer connection is set up
    // Don't rely on onnegotiationneeded as it can cause glare (both sides offering)
    (async () => {
      try {
        console.log(`🚀 Creating and sending offer to ${nickname} (we are initiator)`);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.log(`📤 Sending offer to ${nickname}`);
        socket.emit('signal', {
          to: remoteSocketId,
          signal: { sdp: pc.localDescription }
        });
      } catch (err) {
        console.error(`Error creating initial offer for ${nickname}:`, err);
      }
    })();
  } else {
    console.log(`⏳ Waiting for offer from ${nickname} (they are initiator)`);
  }
}

/**
 * Handle incoming SDP offers, answers, and ICE candidates.
 */
async function handleSignalingData(fromSocketId, signal) {
  const peerRecord = peers.get(fromSocketId);
  if (!peerRecord) {
    console.warn(`⚠️ Received signal from unknown peer: ${fromSocketId}`);
    return;
  }

  const pc = peerRecord.pc;
  const signalingState = pc.signalingState;

  try {
    if (signal.sdp) {
      const sdpType = signal.sdp.type;
      console.log(`📥 Received ${sdpType} from ${peerRecord.nickname} (our state: ${signalingState})`);
      
      // Handle offer
      if (sdpType === 'offer') {
        // If we're in a bad state, rollback first
        if (signalingState !== 'stable' && signalingState !== 'have-remote-offer') {
          console.warn(`⚠️ Received offer in state ${signalingState}, attempting rollback`);
          try {
            await pc.setLocalDescription({ type: 'rollback' });
          } catch (e) {
            console.warn('Rollback failed:', e);
          }
        }
        
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        console.log(`✅ Set remote description (offer) from ${peerRecord.nickname}`);
        
        // Create and send answer
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log(`📤 Sending answer to ${peerRecord.nickname}`);
        socket.emit('signal', {
          to: fromSocketId,
          signal: { sdp: pc.localDescription }
        });
      } 
      // Handle answer
      else if (sdpType === 'answer') {
        if (signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          console.log(`✅ Set remote description (answer) from ${peerRecord.nickname}`);
        } else {
          console.warn(`⚠️ Received answer in unexpected state: ${signalingState}`);
        }
      }

      // Process queued ICE candidates after SDP is set
      if (peerRecord.iceCandidatesQueue && peerRecord.iceCandidatesQueue.length > 0) {
        console.log(`📦 Processing ${peerRecord.iceCandidatesQueue.length} queued ICE candidates for ${peerRecord.nickname}`);
        for (const candidate of peerRecord.iceCandidatesQueue) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.warn("Error adding queued ICE candidate:", e);
          }
        }
        peerRecord.iceCandidatesQueue = [];
      }
    } 
    // Handle ICE candidate
    else if (signal.candidate) {
      const candidateType = signal.candidate.type || 'unknown';
      const candidateProtocol = signal.candidate.protocol || 'unknown';
      
      if (pc.remoteDescription && pc.remoteDescription.type) {
        console.log(`📥 Adding ICE candidate from ${peerRecord.nickname}: type=${candidateType}, protocol=${candidateProtocol}`);
        try {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          console.log(`✅ ICE candidate added successfully`);
        } catch (e) {
          console.error(`❌ Failed to add ICE candidate:`, e);
        }
      } else {
        console.log(`📦 Queueing ICE candidate from ${peerRecord.nickname} (no remote description yet, type=${candidateType})`);
        if (!peerRecord.iceCandidatesQueue) {
          peerRecord.iceCandidatesQueue = [];
        }
        peerRecord.iceCandidatesQueue.push(signal.candidate);
      }
    }
  } catch (err) {
    console.error(`❌ Error processing signaling from ${peerRecord.nickname}:`, err);
  }
}

/**
 * Cleans up a specific participant's connection when they leave.
 */
function destroyPeerConnection(socketId) {
  const peerRecord = peers.get(socketId);
  if (!peerRecord) return;

  console.log(`Closing connection for peer: ${peerRecord.nickname}`);
  
  // Close Web Audio Nodes
  if (peerRecord.analyserLoopId) {
    cancelAnimationFrame(peerRecord.analyserLoopId);
  }

  // Close connection
  peerRecord.pc.close();
  
  // Remove UI Video tile
  const tile = document.getElementById(`card-${socketId}`);
  if (tile) tile.remove();

  peers.delete(socketId);
  reorganizeGrid();
}

/**
 * Audio analysis for speaking detection of remote users.
 * Optimized to reduce CPU usage with throttling and pause when muted.
 */
function setupRemoteAudioAnalysis(remoteSocketId, remoteStream) {
  try {
    const peerRecord = peers.get(remoteSocketId);
    if (!peerRecord || !audioContext) return;

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 64; // Keep small for performance

    const source = audioContext.createMediaStreamSource(remoteStream);
    source.connect(analyser);

    peerRecord.analyser = analyser;
    
    let lastRemoteAnalysisTime = 0;
    const remoteAnalysisInterval = 1000 / 10; // 10fps for remote audio (reduced from 15fps)
    
    // Start analysis loop for this peer
    const loop = (currentTime) => {
      const currentPeer = peers.get(remoteSocketId);
      if (!currentPeer) return; // Peer was removed

      // PAUSE analysis if remote user is muted to save CPU
      if (currentPeer.remoteAudioMuted) {
        highlightSpeakingStatus(remoteSocketId, false);
        currentPeer.analyserLoopId = requestAnimationFrame(loop);
        return;
      }

      // Throttle remote audio analysis
      if (currentTime - lastRemoteAnalysisTime < remoteAnalysisInterval) {
        currentPeer.analyserLoopId = requestAnimationFrame(loop);
        return;
      }
      lastRemoteAnalysisTime = currentTime;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;

      // Remote user speaking highlight
      if (average > speakingThreshold) {
        highlightSpeakingStatus(remoteSocketId, true);
      } else {
        highlightSpeakingStatus(remoteSocketId, false);
      }

      currentPeer.analyserLoopId = requestAnimationFrame(loop);
    };

    peerRecord.analyserLoopId = requestAnimationFrame(loop);

  } catch (e) {
    console.warn(`Remote audio analyzer setup skipped:`, e);
  }
}

/**
 * Highlight speaking users with CSS classes.
 */
// Keep track of active speaking timers to avoid animation frame spam
const speakingTimers = new Map();

function highlightSpeakingStatus(userId, isSpeaking) {
  const cardId = userId === 'local' ? 'local-video-card' : `card-${userId}`;
  const videoCard = document.getElementById(cardId);
  if (!videoCard) return;

  if (isSpeaking) {
    // Clear any existing silence timer
    if (speakingTimers.has(userId)) {
      clearTimeout(speakingTimers.get(userId));
      speakingTimers.delete(userId);
    }
    
    videoCard.classList.add('active-speaker');
    
    // Highlight speaker indicator in local UI
    if (userId !== activeSpeakerId) {
      if (activeSpeakerTimer) clearTimeout(activeSpeakerTimer);
      
      activeSpeakerTimer = setTimeout(() => {
        activeSpeakerId = userId;
        if (typeof reorganizeGrid === 'function') {
          reorganizeGrid();
        }
      }, 50);
    }
  } else {
    // Only set a timeout to remove if there isn't one already running and card has class
    if (!speakingTimers.has(userId) && videoCard.classList.contains('active-speaker')) {
      const timer = setTimeout(() => {
        videoCard.classList.remove('active-speaker');
        speakingTimers.delete(userId);
      }, 1000); // 1 second natural breathing space
      speakingTimers.set(userId, timer);
    }
  }
}
