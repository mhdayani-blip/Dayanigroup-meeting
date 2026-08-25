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
const subtitle = document.getElementById('subtitle');

let localStream;
let peer;
let socket;
let translationSocket;
let hostToken = '';
let audioContext;
let audioProcessor;
let audioSource;
let role = 'host';
let room = '';
let displayName = '';
let timerId;
let subtitleTimer;
let startedAt;
let rtcConfig = { iceServers: [] };
let pendingIceCandidates = [];
let isLeaving = false;
let reconnectAttempts = 0;
let reconnectTimer;

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

function hostTokenKey(roomCode) {
  return `dayani-host-token:${roomCode}`;
}

function updateJoinMode() {
  enterButton.textContent = role === 'host' ? 'Start meeting' : 'Request to join';
  copyInviteButton.hidden = role !== 'host';
  newRoomButton.hidden = role !== 'host';
  joinHint.textContent = role === 'guest' ? 'Guest link detected. Enter your name to request access.' : '';
}

async function provisionHostRoom() {
  if (role !== 'host') return;
  enterButton.disabled = true;
  copyInviteButton.disabled = true;
  newRoomButton.disabled = true;
  joinHint.textContent = 'Preparing a secure meeting link…';
  try {
    const response = await fetch('/rooms', { method: 'POST' });
    if (!response.ok) throw new Error('room creation failed');
    const created = await response.json();
    roomCodeInput.value = sanitizeRoom(created.code);
    hostToken = String(created.hostToken || '');
    if (!roomCodeInput.value || !hostToken) throw new Error('invalid room response');
    sessionStorage.setItem(hostTokenKey(roomCodeInput.value), hostToken);
    history.replaceState({}, '', hostUrl(roomCodeInput.value));
    joinHint.textContent = '';
    return true;
  } catch (error) {
    console.error(error);
    joinHint.textContent = 'A secure meeting link could not be prepared. Please retry.';
    return false;
  } finally {
    enterButton.disabled = false;
    copyInviteButton.disabled = false;
    newRoomButton.disabled = false;
  }
}

async function loadRtcConfig() {
  try {
    const response = await fetch('/rtc-config');
    if (response.ok) rtcConfig = await response.json();
  } catch {}
}

async function getMedia() {
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
  });
  localVideo.srcObject = localStream;
}

function openSocket() {
  return new Promise((resolve, reject) => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${location.host}/signal`);
    socket.addEventListener('open', () => {
      reconnectAttempts = 0;
      resolve();
    }, { once: true });
    socket.addEventListener('error', reject, { once: true });
    socket.addEventListener('message', onSignalMessage);
    socket.addEventListener('close', () => {
      setState('Disconnected');
      if (!isLeaving && room && localStream) scheduleReconnect();
    });
  });
}

function send(type, payload = {}) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, room, role, name: displayName, hostToken, ...payload }));
  }
}

function scheduleReconnect() {
  if (reconnectTimer || reconnectAttempts >= 5) return;
  const delay = Math.min(1000 * 2 ** reconnectAttempts, 8000);
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await openSocket();
      send('join');
    } catch {
      scheduleReconnect();
    }
  }, delay);
}

async function createPeer(isOfferer) {
  if (peer) peer.close();
  pendingIceCandidates = [];
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

  peer.oniceconnectionstatechange = () => {
    if (peer?.iceConnectionState === 'failed') peer.restartIce();
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
      startTranslation();
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
      await addPendingIceCandidates();
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      send('answer', { sdp: answer });
      break;
    case 'answer':
      await peer.setRemoteDescription(message.sdp);
      await addPendingIceCandidates();
      break;
    case 'ice':
      if (peer && message.candidate) {
        if (peer.remoteDescription) {
          try { await peer.addIceCandidate(message.candidate); } catch {}
        } else {
          pendingIceCandidates.push(message.candidate);
        }
      }
      break;
    case 'caption':
      showSubtitle(message.text || '');
      break;
    case 'peer-left':
      stopTranslation();
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
    case 'room-not-ready':
      setState('Room unavailable');
      remoteStatusTitle.textContent = 'Meeting not ready';
      remoteStatusText.textContent = 'Ask the host to start the meeting and send a fresh link.';
      break;
    case 'host-auth-failed':
      setState('Host verification failed');
      remoteStatusTitle.textContent = 'Host verification failed';
      remoteStatusText.textContent = 'Create a new secure meeting link and try again.';
      break;
  }
}

async function addPendingIceCandidates() {
  if (!peer?.remoteDescription) return;
  const candidates = pendingIceCandidates;
  pendingIceCandidates = [];
  for (const candidate of candidates) {
    try { await peer.addIceCandidate(candidate); } catch {}
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

function showSubtitle(text) {
  const clean = String(text || '').trim();
  if (!clean) return;
  subtitle.textContent = clean;
  subtitle.dir = role === 'host' ? 'rtl' : 'ltr';
  subtitle.lang = role === 'host' ? 'fa' : 'en';
  subtitle.hidden = false;
  clearTimeout(subtitleTimer);
  subtitleTimer = setTimeout(() => { subtitle.hidden = true; }, 6500);
}

function downsampleTo16k(input, sampleRate) {
  if (sampleRate === 16000) return input;
  const ratio = sampleRate / 16000;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    output[i] = sum / Math.max(1, end - start);
  }
  return output;
}

function floatToInt16(float32) {
  const output = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const value = Math.max(-1, Math.min(1, float32[i]));
    output[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  return output;
}

function startTranslation() {
  if (translationSocket || !localStream) return;
  const source = role === 'host' ? 'fa' : 'en';
  const target = role === 'host' ? 'en' : 'fa';
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  translationSocket = new WebSocket(`${protocol}//${location.host}/translate/ws?source=${source}&target=${target}`);
  translationSocket.binaryType = 'arraybuffer';

  translationSocket.addEventListener('open', () => {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioContext ||= new AudioCtx();
    audioSource = audioContext.createMediaStreamSource(localStream);
    audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);
    const silent = audioContext.createGain();
    silent.gain.value = 0;

    audioProcessor.onaudioprocess = event => {
      if (translationSocket?.readyState !== WebSocket.OPEN) return;
      const input = event.inputBuffer.getChannelData(0);
      const pcm = floatToInt16(downsampleTo16k(input, audioContext.sampleRate));
      translationSocket.send(pcm.buffer);
    };

    audioSource.connect(audioProcessor);
    audioProcessor.connect(silent);
    silent.connect(audioContext.destination);
    audioContext.resume().catch(() => {});
  });

  translationSocket.addEventListener('message', event => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'translation' && payload.text) send('caption', { text: payload.text });
    } catch {}
  });

  translationSocket.addEventListener('close', () => {
    translationSocket = null;
  });
}

function stopTranslation() {
  try { audioProcessor?.disconnect(); } catch {}
  try { audioSource?.disconnect(); } catch {}
  try { audioContext?.close(); } catch {}
  try { translationSocket?.close(); } catch {}
  audioProcessor = null;
  audioSource = null;
  audioContext = null;
  translationSocket = null;
}

async function enterMeeting() {
  displayName = displayNameInput.value.trim();
  room = sanitizeRoom(roomCodeInput.value);
  if (!displayName || !room) return;
  localStorage.setItem('dayani-display-name', displayName);
  joinHint.textContent = 'Opening camera and microphone…';
  try {
    if (role === 'host') {
      hostToken = sessionStorage.getItem(hostTokenKey(room)) || '';
      if (!hostToken) {
        const provisioned = await provisionHostRoom();
        if (!provisioned) throw new Error('room could not be provisioned');
        room = sanitizeRoom(roomCodeInput.value);
      }
    }
    await loadRtcConfig();
    await getMedia();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioCtx();
    await audioContext.resume();
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
  isLeaving = true;
  clearTimeout(reconnectTimer);
  clearInterval(timerId);
  timerId = null;
  stopTranslation();
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
  updateJoinMode();
  provisionHostRoom();
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

if (role === 'host') {
  hostToken = sessionStorage.getItem(hostTokenKey(roomCodeInput.value)) || '';
  if (!hostToken) provisionHostRoom();
}
