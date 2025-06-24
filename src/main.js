import './style.css'

const backendUrl = 'https://cross-x-server.onrender.com';

function showRoomSelection() {
  clearAllIntervals();
  document.querySelector('#app').innerHTML = `
    <h1>Cross-X: Share Images & Text</h1>
    <div class="room-section">
      <button id="createRoom">Create Room</button>
      <div style="margin:1em 0;">or</div>
      <input id="roomInput" placeholder="Enter Room Code" maxlength="6" style="width:120px;text-align:center;" />
      <button id="joinRoom">Enter Room</button>
    </div>
    <div id="status"></div>
  `;

  document.getElementById('createRoom').onclick = async () => {
    const res = await fetch(`${backendUrl}/api/create-room`, { method: 'POST' });
    const data = await res.json();
    window.location.hash = `#room/${data.roomId}`;
    showRoom(data.roomId, true, data.expiresAt);
  };
  document.getElementById('joinRoom').onclick = async () => {
    const roomId = document.getElementById('roomInput').value.trim();
    if (roomId.length >= 4 && roomId.length <= 6) {
      // Validate room
      const res = await fetch(`${backendUrl}/api/validate-room/${roomId}`);
      const data = await res.json();
      if (data.valid) {
        window.location.hash = `#room/${roomId}`;
        showRoom(roomId, false, data.expiresAt);
      } else {
        document.getElementById('status').textContent = 'Room not found or expired.';
      }
    } else {
      document.getElementById('status').textContent = 'Enter a valid 4-6 digit room code.';
    }
  };
}

let globalIntervals = [];
function clearAllIntervals() {
  globalIntervals.forEach(clearInterval);
  globalIntervals = [];
}

function showRoom(roomId, isCreator, expiresAt) {
  clearAllIntervals();
  let timeLeft = Math.floor((new Date(expiresAt) - Date.now()) / 1000);
  let timerInterval;
  let connected = false;
  let sessionActive = true;

  function updateStatus() {
    // Always fetch the latest expiry from the backend for real-time updates
    fetch(`${backendUrl}/api/validate-room/${roomId}`)
      .then(res => res.json())
      .then(data => {
        if (!data.valid) {
          clearRoomUI();
          return;
        }
        timeLeft = Math.floor((new Date(data.expiresAt) - Date.now()) / 1000);
        const min = Math.floor(timeLeft / 60);
        const sec = (timeLeft % 60).toString().padStart(2, '0');
        let status = '';
        if (!sessionActive) {
          status = 'Room expired. Please create or join a new room.';
        } else if (isCreator) {
          status = connected ? `Connected! Room ID: ${roomId}` : `Waiting for another user to join Room ID: ${roomId}`;
        } else {
          status = connected ? `Connected to Room ID: ${roomId}` : `Waiting for room to be active...`;
        }
        document.getElementById('status').innerHTML = `${status}<br>Time left: ${min}:${sec}`;
      });
  }

  function clearRoomUI() {
    sessionActive = false;
    document.querySelector('#app').innerHTML = `
      <h1>Room Expired</h1>
      <div class="room-section">
        <button id="backToRooms">Back to Room Selection</button>
      </div>
    `;
    document.getElementById('backToRooms').onclick = () => {
      window.location.hash = '';
      showRoomSelection();
    };
  }

  document.querySelector('#app').innerHTML = `
    <h1>Cross-X: Room ${roomId}</h1>
    <div id="status"></div>
    <button id="closeRoom" style="margin-bottom:1em;">Close Room</button>
    <div class="share-section">
      <h2>Share Text</h2>
      <textarea id="textInput" rows="3" placeholder="Type or paste text here..."></textarea>
      <button id="sendText">Share Text</button>
      <button id="copyText">Copy Shared Text</button>
      <div id="sharedText" class="shared-box"></div>
    </div>
    <div class="share-section">
      <h2>Share Image</h2>
      <input type="file" id="imageInput" accept="image/*" />
      <button id="uploadImage">Upload Image</button>
      <div id="images" class="image-list"></div>
    </div>
  `;

  document.getElementById('closeRoom').onclick = async () => {
    await fetch(`${backendUrl}/api/close-room`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId })
    });
    window.location.hash = '';
    showRoomSelection();
  };

  // Text sharing logic
  const textInput = document.getElementById('textInput');
  const sendText = document.getElementById('sendText');
  const copyText = document.getElementById('copyText');
  const sharedTextDiv = document.getElementById('sharedText');

  async function fetchSharedText() {
    const res = await fetch(`${backendUrl}/api/text?roomId=${roomId}`);
    const data = await res.json();
    sharedTextDiv.textContent = data.text || '(No text shared yet)';
  }

  sendText.onclick = async () => {
    await fetch(`${backendUrl}/api/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: textInput.value, roomId })
    });
    fetchSharedText();
  };

  copyText.onclick = async () => {
    const text = sharedTextDiv.textContent;
    if (text) await navigator.clipboard.writeText(text);
  };

  fetchSharedText();
  globalIntervals.push(setInterval(fetchSharedText, 3000));

  // Image sharing logic
  const imageInput = document.getElementById('imageInput');
  const uploadImage = document.getElementById('uploadImage');
  const imagesDiv = document.getElementById('images');

  async function fetchImages() {
    const res = await fetch(`${backendUrl}/api/images?roomId=${roomId}`);
    const files = await res.json();
    imagesDiv.innerHTML = files.map(url => `
      <div class="img-container">
        <img src="${url}" class="shared-img" />
        <a href="${url}" download="shared-image.jpg" class="download-btn">Download</a>
      </div>
    `).join('');
  }

  uploadImage.onclick = async () => {
    if (!imageInput.files.length) return;
    const formData = new FormData();
    formData.append('image', imageInput.files[0]);
    formData.append('roomId', roomId);
    await fetch(`${backendUrl}/api/upload`, { method: 'POST', body: formData });
    fetchImages();
  };

  fetchImages();
  globalIntervals.push(setInterval(fetchImages, 5000));

  // Room connection logic (simulate connection by polling for activity)
  let lastText = '', lastImages = '';
  function checkConnection() {
    fetch(`${backendUrl}/api/text?roomId=${roomId}`)
      .then(res => res.json())
      .then(data => {
        if (data.text && (!lastText || data.text !== lastText)) {
          connected = true;
          lastText = data.text;
        }
      });
    fetch(`${backendUrl}/api/images?roomId=${roomId}`)
      .then(res => res.json())
      .then(files => {
        const filesStr = files.join(',');
        if (files.length && (!lastImages || filesStr !== lastImages)) {
          connected = true;
          lastImages = filesStr;
        }
      });
    updateStatus();
  }
  globalIntervals.push(setInterval(checkConnection, 2000));

  // Timer logic
  timerInterval = setInterval(() => {
    timeLeft--;
    updateStatus();
    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      clearRoomUI();
    }
  }, 1000);
  globalIntervals.push(timerInterval);

  updateStatus();
}

// On load, check hash for room
window.addEventListener('DOMContentLoaded', () => {
  const hash = window.location.hash;
  if (hash.startsWith('#room/')) {
    const roomId = hash.replace('#room/', '');
    fetch(`${backendUrl}/api/validate-room/${roomId}`)
      .then(res => res.json())
      .then(data => {
        if (data.valid) {
          showRoom(roomId, false, data.expiresAt);
        } else {
          window.location.hash = '';
          showRoomSelection();
        }
      });
  } else {
    showRoomSelection();
  }
});
