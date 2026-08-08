const joinScreen = document.getElementById('joinScreen');
const meetingScreen = document.getElementById('meetingScreen');
const joinForm = document.getElementById('joinForm');
const displayNameInput = document.getElementById('displayName');
const roomCodeInput = document.getElementById('roomCode');
const randomRoomButton = document.getElementById('randomRoom');
const copyInviteButton = document.getElementById('copyInvite');
const copyInviteTopButton = document.getElementById('copyInviteTop');
const joinHint = document.getElementById('joinHint');
const elapsed = document.getElementById('elapsed');
const workspace = document.querySelector('.workspace');
const togglePanelButton = document.getElementById('togglePanel');
const jitsiContainer = document.getElementById('jitsiContainer');

let api = null;
let timerId = null;
let startedAt = null;

const params = new URLSearchParams(window.location.search);
const incomingRoom = sanitizeRoom(params.get('room'));
const incomingName = params.get('name')?.trim();

if (incomingRoom) roomCodeInput.value = incomingRoom;
else roomCodeInput.value = createRoomCode();
if (incomingName) displayNameInput.value = incomingName;
else displayNameInput.value = localStorage.getItem('dayani-display-name') || 'Mohammad';

function sanitizeRoom(value) {
  if (!value) return '';
  return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
}

function createRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  crypto.getRandomValues(new Uint32Array(6)).forEach((value) => {
    result += alphabet[value % alphabet.length];
  });
  return result;
}

function inviteUrl() {
  const room = sanitizeRoom(roomCodeInput.value);
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('room', room);
  return url.toString();
}

async function copyInvite() {
  try {
    await navigator.clipboard.writeText(inviteUrl());
    joinHint.textContent = 'Invitation link copied.';
  } catch {
    joinHint.textContent = inviteUrl();
  }
}

function startTimer() {
  startedAt = Date.now();
  clearInterval(timerId);
  timerId = setInterval(() => {
    const total = Math.floor((Date.now() - startedAt) / 1000);
    const minutes = String(Math.floor(total / 60)).padStart(2, '0');
    const seconds = String(total % 60).padStart(2, '0');
    elapsed.textContent = `${minutes}:${seconds}`;
  }, 1000);
}

function enterMeeting(name, room) {
  if (!window.JitsiMeetExternalAPI) {
    joinHint.textContent = 'Video service is not available. Check your connection and try again.';
    return;
  }

  localStorage.setItem('dayani-display-name', name);
  joinScreen.hidden = true;
  meetingScreen.hidden = false;

  const roomName = `DayaniGroup-${room}`;
  const mobile = window.matchMedia('(max-width: 900px)').matches;

  api = new JitsiMeetExternalAPI('meet.jit.si', {
    roomName,
    parentNode: jitsiContainer,
    width: '100%',
    height: '100%',
    userInfo: { displayName: name },
    configOverwrite: {
      prejoinConfig: { enabled: false },
      prejoinPageEnabled: false,
      disableDeepLinking: true,
      startWithAudioMuted: false,
      startWithVideoMuted: false,
      enableWelcomePage: false,
      toolbarButtons: [
        'microphone',
        'camera',
        'desktop',
        'fullscreen',
        'hangup',
        'select-background',
        'settings',
        'tileview'
      ]
    },
    interfaceConfigOverwrite: {
      MOBILE_APP_PROMO: false,
      SHOW_JITSI_WATERMARK: false,
      SHOW_WATERMARK_FOR_GUESTS: false,
      HIDE_INVITE_MORE_HEADER: true,
      TOOLBAR_ALWAYS_VISIBLE: mobile
    }
  });

  api.addListener('videoConferenceJoined', () => {
    startTimer();
    history.replaceState({}, '', inviteUrl());
  });

  api.addListener('readyToClose', () => leaveMeeting());
  api.addListener('videoConferenceLeft', () => leaveMeeting());
}

function leaveMeeting() {
  clearInterval(timerId);
  if (api) {
    try { api.dispose(); } catch {}
    api = null;
  }
  jitsiContainer.innerHTML = '';
  meetingScreen.hidden = true;
  joinScreen.hidden = false;
  elapsed.textContent = '00:00';
}

randomRoomButton.addEventListener('click', () => {
  roomCodeInput.value = createRoomCode();
  joinHint.textContent = '';
});

copyInviteButton.addEventListener('click', copyInvite);
copyInviteTopButton.addEventListener('click', copyInvite);

joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = displayNameInput.value.trim();
  const room = sanitizeRoom(roomCodeInput.value);
  if (!name || !room) return;
  roomCodeInput.value = room;
  enterMeeting(name, room);
});

togglePanelButton.addEventListener('click', () => {
  const mobile = window.matchMedia('(max-width: 900px)').matches;
  if (mobile) {
    workspace.classList.toggle('mobile-panel-open');
    togglePanelButton.textContent = workspace.classList.contains('mobile-panel-open') ? 'Close panel' : 'Show panel';
  } else {
    workspace.classList.toggle('panel-hidden');
    togglePanelButton.textContent = workspace.classList.contains('panel-hidden') ? 'Show panel' : 'Hide panel';
  }
});

if (incomingRoom) {
  joinHint.textContent = 'Meeting link detected. Enter your name and join.';
}
