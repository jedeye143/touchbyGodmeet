# AetherMeet - Production-Style Video Meetings

AetherMeet is a secure, low-latency, real-time video meeting platform inspired by Google Meet. It is built using standard Web APIs, WebRTC peer-to-peer mesh networking, and Socket.io signaling. The project is designed with a premium dark matte theme, glassmorphic accents, responsive grid mechanics, and hardware management.

---

## 📂 Project Structure

```text
googlemeet/
├── index.html        # Lobby & pre-join configuration page
├── meeting.html      # Active room video conference workspace
├── style.css         # Styling, CSS variables, glassmorphic rules, and animations
├── app.js            # Main UI orchestrator, bindings, and shortcuts
├── socket.js         # Client-side Socket.io signaling & state synchronizer
├── webrtc.js         # PeerConnection setup, Canvas background blur, and Audio Analyzers
├── server.js         # Node.js Express server & Socket.io backend
├── package.json      # Node.js server dependencies and run scripts
└── vercel.json       # Vercel deployment route mapping and header configurations
```

---

## ⚙️ Architecture & Core Systems

### 1. WebRTC Mesh Network (`webrtc.js`)
* **Peer-to-Peer Routing**: Because this application is designed to run without expensive media servers (SFUs/MCUs), it utilizes a fully-connected **Mesh topology**. Every participant establishes a direct `RTCPeerConnection` with every other participant in the room. 
* **Scalability**: Mesh networks operate efficiently for 2-6 participants. For larger meetings, an SFU (e.g., Mediasoup, Janus) would be needed, but a Mesh network is standard for zero-cost, high-performance MVPs.

### 2. Socket.io Signaling (`server.js` & `socket.js`)
* WebSockets are used strictly for **Signaling**. When a participant connects, they exchange room states, SDP (Session Description Protocol) offers, answers, and ICE candidates via Socket.io. Once the connection is established, the media streams flow directly peer-to-peer without putting weight on the server.

### 3. Canvas Bokeh Background Blur (`webrtc.js`)
* **Pure JS Overlay**: To run on any browser without heavy AI models, AetherMeet implements a custom canvas filter loop. It captures the webcam track, draws a heavily blurred frame onto a canvas, and overlays a sharp circular center mask of the speaker. The canvas stream is then exported at 30fps and fed directly into the WebRTC connections, enabling remote participants to see the blurred background.

### 4. Web Audio API Voice Analyzer (`webrtc.js`)
* **Mic Waveform**: Analyzing local and remote stream frequencies using `AnalyserNode`.
* **Speaking Detection**: Compares average microphone output levels against a noise threshold to trigger active-speaker highlight borders (`.active-speaker`) around the card of whoever is speaking.

---

## ⚡ Vercel Compatibility & Serverless Limitations

> [!WARNING]
> **Vercel Serverless WebSockets Constraint**
> Vercel is a serverless platform. Serverless Functions (APIs) are stateless and have maximum execution timeouts (e.g., 10-15s). Because Socket.io requires a **long-running, stateful, persistent WebSocket connection**, you cannot run the `server.js` signaling backend inside a Vercel Serverless Function.

### 🚀 Recommended Deployment Strategy
1. **Frontend (Vercel)**: Serve the static files (`index.html`, `meeting.html`, `style.css`, `app.js`, `socket.js`, `webrtc.js`) on Vercel. This provides fast, CDN-cached loading.
2. **Backend (Render / Railway / Heroku)**: Host the Node.js signaling server (`server.js`) on a free container service (like Render, Railway, or Fly.io) which supports persistent WebSocket listeners.

### 🔌 How to Connect Frontend to your Custom Backend
To connect your Vercel-hosted frontend to your deployed signaling backend, you have two flexible options:
* **Option A (LocalStorage Override)**: Open the browser console on the landing page and set:
  ```javascript
  localStorage.setItem('aethermeet_backend_url', 'https://your-aethermeet-backend.onrender.com');
  ```
  Refresh the page, and the application will connect to your custom server.
* **Option B (URL query parameter)**: Access the lobby using the `server` query param:
  ```text
  https://your-aethermeet-frontend.vercel.app/?server=https://your-backend.onrender.com
  ```

---

## 💻 Local Quick Start

Follow these steps to run the application locally (where the single Node server serves both static pages and runs Socket.io):

1. **Install Dependencies**:
   ```bash
   npm install
   ```
2. **Run Server**:
   ```bash
   npm start
   ```
3. **Open Browser**:
   Navigate to `http://localhost:3000` to start meeting instantly.

---

## 🛠️ Usage & Keyboard Shortcuts

Enhance your meeting experiences with premium workflows and device adjustments:

* **Keyboard Toggles**:
  * <kbd>M</kbd> : Mute/Unmute Microphone
  * <kbd>V</kbd> : Toggle Video Camera On/Off
  * <kbd>S</kbd> : Toggle Desktop Screen Share
  * <kbd>H</kbd> : Raise / Lower hand status indicator
* **Push-to-Talk**: Press and hold <kbd>Space</kbd> to unmute yourself temporarily. Releasing the Spacebar will re-mute your microphone.
* **Double-click Video Card**: Pins that user. The pinned card takes up the main view, and other users are placed in a responsive sidebar tray. Double-clicking again reverts to the standard grid view.
* **Host Capabilities Panel**: Visible under the "Participants" tab in the sidebar (only to the creator of the meeting):
  * **Mute**: Remotely silences a user.
  * **Disable Mic**: Revokes a participant's mic permission. The user cannot unmute until they request permission and are approved.
  * **Remove**: Kicks the user out of the call.
  * **Lock Room**: Toggle at the top of the tab to block all incoming knock requests.
