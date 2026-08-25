const joinScreen = document.getElementById('joinScreen');
const meetingScreen = document.getElementById('meetingScreen');
const joinForm = document.getElementById('joinForm');
const displayNameInput = document.getElementById('displayName');
const roomCodeInput = document.getElementById('roomCode');
const newRoomButton = document.getElementById('newRoom');
const copyInviteButton = document.getElementById('copyInvite');
const copyInviteTopButton = document.getElementById('copyInviteTop');
const joinHint = document.getElementById('joinHint');
const enterButton = document.getElementById('enterButton');
const elapsed = document.getElementById('elapsed');
const connectionState = document.getElementById('connectionState');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const remoteEmpty = document.getElementById('remoteEmpty');
const remoteStatusTitle = document.getElementById('remoteStatusTitle');
const remoteStatusText = document.getElementById('remoteStatusText');
const approvalCard = document.getElementById('approvalCard');
const guestName = document.getElementById('guestName');
const approveGuest = document.getElementById('approveGuest');
const denyGuest = document.getElementById('denyGuest');
const micButton = document.getElementById('micButton');
const cameraButton = document.getElementById('cameraButton');
const endCallButton = document.getElementById('endCall');

let localStream;
let peer;
let socket;
let role = 'host';
let room = '';
let displayName = '';
let timerId;
let startedAt;
let rtcConfig = { iceServers: [] };

const params = new URLSearchParams(location.search);
const incomingRoom = sanitizeRoom(params.get('room'));
role = params.get('role') === 'host' ? 'host' : (incomingRoom ? 'guest' : 'host');
roomCodeInput.value = incomingRoom || createRoomCode();
displayNameInput.value = localStorage.getItem('dayani-display-name') || (role === 'host' ? 'Mohammad' : 'Guest');
updateJoinMode();

function sanitizeRoom(value) {
  return (value || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
}

function createRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const values = new Uint32Array(6);
  crypto.getRandomValues(values);
  return Array.from(values, n => alphabet[n % alphabet.length]).join('');
}

function guestUrl() {
  const url = new URL(location.origin + location.pathname);
  url.searchParams.set('room', sanitizeRoom(roomCodeInput.value));
  return url.toString();
}

function hostUrl(roomCode) {
  const url = new URL(location.origin + location.pathname);
  url.searchParams.set('room', roomCode);
  url.searchParams.set('role', 'host');
  return url.toString();
}

function updateJoinMode() {
  enterButton.textContent = role === 'host' ? 'Start meeting' : 'Request to join';
  copyInviteButton.hidden = role !== 'host';
  joinHint.textContent = role === 'guest' ? 'Guest link detected. Enter your name to request access.' : '';
}

async function loadRtcConfig() {
  try {
    const response = await fetch('/rtc-config');
    if (response.ok) rtcConfig = await response.json();
  } catch {}
}

async function getMedia() {
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
  });
  localVideo.srcObject = localStream;
}

function openSocket() {
  return new Promise((resolve, reject) => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${location.host}/signal`);
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
    socket.addEventListener('message', onSignalMessage);
    socket.addEventListener('close', () => setState('Disconnected'));
  });
}

function send(type, payload = {}) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, room, role, name: displayName, ...payload }));
  }
}

async function createPeer(isOfferer) {
  if (peer) peer.close();
  peer = new RTCPeerConnection(rtcConfig);
  localStream.getTracks().forEach(track => peer.addTrack(track, localStream));

  peer.ontrack = event => {
    remoteVideo.srcObject = event.streams[0];
    remoteEmpty.hidden = true;
    remoteVideo.hidden = false;
    startTimer();
  };

  peer.onicecandidate = event => {
    if (event.candidate) send('ice', { candidate: event.candidate });
  };

  peer.onconnectionstatechange = () => {
    const state = peer.connectionState;
    if (state === 'connected') setState('Live', true);
    else if (['failed', 'disconnected', 'closed'].includes(state)) setState('Disconnected');
  };

  if (isOfferer) {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    send('offer', { sdp: offer });
  }
}

async function onSignalMessage(event) {
  const message = JSON.parse(event.data);
  switch (message.type) {
    case 'joined':
      if (role === 'host') {
        setState('Waiting');
        remoteStatusTitle.textContent = 'Waiting for guest';
        remoteStatusText.textContent = 'Share the meeting link to begin.';
      } else {
        setState('Waiting approval');
        remoteStatusTitle.textContent = 'Waiting for approval';
        remoteStatusText.textContent = 'The host will let you in shortly.';
      }
      break;
    case 'join-request':
      if (role === 'host') {
        guestName.textContent = message.name || 'Guest';
        approvalCard.hidden = false;
      }
      break;
    case 'approved':
      approvalCard.hidden = true;
      setState('Connecting');
      if (role === 'host') await createPeer(true);
      break;
    case 'denied':
      setState('Denied');
      remoteStatusTitle.textContent = 'Request declined';
      remoteStatusText.textContent = 'The host did not allow this connection.';
      break;
    case 'offer':
      await createPeer(false);
      await peer.setRemoteDescription(message.sdp);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      send('answer', { sdp: answer });
      break;
    case 'answer':
      await peer.setRemoteDescription(message.sdp);
      break;
    case 'ice':
      if (peer && message.candidate) {
        try { await peer.addIceCandidate(message.candidate); } catch {}
      }
      break;
    case 'peer-left':
      if (peer) peer.close();
      peer = null;
      remoteVideo.srcObject = null;
      remoteVideo.hidden = true;
      remoteEmpty.hidden = false;
      remoteStatusTitle.textContent = 'Call ended';
      remoteStatusText.textContent = 'The other participant left the meeting.';
      setState('Ended');
      break;
    case 'room-full':
      setState('Room full');
      remoteStatusTitle.textContent = 'Room is full';
      remoteStatusText.textContent = 'This meeting already has two participants.';
      break;
  }
}

function setState(text, live = false) {
  connectionState.textContent = text;
  connectionState.classList.toggle('live', live);
}

function startTimer() {
  if (timerId) return;
  startedAt = Date.now();
  timerId = setInterval(() => {
    const total = Math.floor((Date.now() - startedAt) / 1000);
    const minutes = String(Math.floor(total / 60)).padStart(2, '0');
    const seconds = String(total % 60).padStart(2, '0');
    elapsed.textContent = `${minutes}:${seconds}`;
  }, 1000);
}

async function enterMeeting() {
  displayName = displayNameInput.value.trim();
  room = sanitizeRoom(roomCodeInput.value);
  if (!displayName || !room) return;
  localStorage.setItem('dayani-display-name', displayName);
  joinHint.textContent = 'Opening camera and microphone…';
  try {
    await loadRtcConfig();
    await getMedia();
    await openSocket();
    joinScreen.hidden = true;
    meetingScreen.hidden = false;
    history.replaceState({}, '', role === 'host' ? hostUrl(room) : guestUrl());
    send('join');
  } catch (error) {
    joinHint.textContent = 'Camera/microphone or connection could not be opened.';
    console.error(error);
  }
}

function leaveMeeting() {
  clearInterval(timerId);
  timerId = null;
  send('leave');
  socket?.close();
  peer?.close();
  localStream?.getTracks().forEach(track => track.stop());
  location.href = location.pathname;
}

function toggleTrack(kind, button) {
  const track = localStream?.getTracks().find(item => item.kind === kind);
  if (!track) return;
  track.enabled = !track.enabled;
  button.classList.toggle('active', track.enabled);
  button.textContent = kind === 'audio' ? (track.enabled ? 'Mic' : 'Mic off') : (track.enabled ? 'Camera' : 'Camera off');
}

joinForm.addEventListener('submit', event => {
  event.preventDefault();
  enterMeeting();
});

newRoomButton.addEventListener('click', () => {
  role = 'host';
  roomCodeInput.value = createRoomCode();
  history.replaceState({}, '', hostUrl(roomCodeInput.value));
  updateJoinMode();
});

copyInviteButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(guestUrl());
  joinHint.textContent = 'Guest link copied.';
});

copyInviteTopButton.addEventListener('click', () => navigator.clipboard.writeText(guestUrl()));
approveGuest.addEventListener('click', () => send('approve'));
denyGuest.addEventListener('click', () => { send('deny'); approvalCard.hidden = true; });
micButton.addEventListener('click', () => toggleTrack('audio', micButton));
cameraButton.addEventListener('click', () => toggleTrack('video', cameraButton));
endCallButton.addEventListener('click', leaveMeeting);
