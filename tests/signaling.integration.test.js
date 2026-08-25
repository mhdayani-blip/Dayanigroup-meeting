const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const test = require('node:test');
const WebSocket = require('ws');

const port = 3200 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
let server;

function connect() {
  return new WebSocket(`ws://127.0.0.1:${port}/signal`);
}

function nextMessage(socket, expectedType) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${expectedType}`)), 3000);
    socket.on('message', function onMessage(raw) {
      const message = JSON.parse(raw);
      if (message.type !== expectedType) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(message);
    });
  });
}

test.before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      ALLOWED_ORIGIN: 'https://meet.dayanigroup.com',
      TURN_SHARED_SECRET: 'test-shared-secret',
      STUN_URL: 'stun:example.org:3478',
      TURN_URL: 'turn:example.org:3478?transport=udp,turn:example.org:3478?transport=tcp'
    }
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Signaling server did not start')), 3000);
    server.stdout.on('data', data => {
      if (data.toString().includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once('error', reject);
  });
});

test.after(() => {
  server?.kill();
});

test('authorizes the host, requires approval, relays captions, and limits a room to two people', async () => {
  const blockedOrigin = await fetch(`${baseUrl}/rooms`, {
    method: 'POST',
    headers: { Origin: 'https://untrusted.example' }
  });
  assert.equal(blockedOrigin.status, 403);

  const created = await (await fetch(`${baseUrl}/rooms`, { method: 'POST' })).json();
  assert.match(created.code, /^[A-Za-z0-9_-]{16}$/);
  assert.match(created.hostToken, /^[A-Za-z0-9_-]{43}$/);

  const rtcConfig = await (await fetch(`${baseUrl}/rtc-config`)).json();
  assert.equal(rtcConfig.iceServers.length, 2);
  assert.equal(rtcConfig.iceServers[1].urls.length, 2);
  assert.notEqual(rtcConfig.iceServers[1].credential, 'test-shared-secret');

  const intruder = connect();
  await once(intruder, 'open');
  const intruderRejected = nextMessage(intruder, 'host-auth-failed');
  intruder.send(JSON.stringify({ type: 'join', room: created.code, role: 'host', hostToken: 'invalid', name: 'Intruder' }));
  await intruderRejected;

  const host = connect();
  await once(host, 'open');
  const hostJoined = nextMessage(host, 'joined');
  host.send(JSON.stringify({ type: 'join', room: created.code, role: 'host', hostToken: created.hostToken, name: 'Mohammad' }));
  await hostJoined;

  const guest = connect();
  await once(guest, 'open');
  const guestJoined = nextMessage(guest, 'joined');
  const joinRequest = nextMessage(host, 'join-request');
  guest.send(JSON.stringify({ type: 'join', room: created.code, role: 'guest', name: 'Guest' }));
  await guestJoined;
  assert.equal((await joinRequest).name, 'Guest');

  const hostApproved = nextMessage(host, 'approved');
  const guestApproved = nextMessage(guest, 'approved');
  host.send(JSON.stringify({ type: 'approve', room: created.code }));
  await Promise.all([hostApproved, guestApproved]);

  const caption = nextMessage(guest, 'caption');
  host.send(JSON.stringify({ type: 'caption', room: created.code, text: 'Translated subtitle' }));
  assert.equal((await caption).text, 'Translated subtitle');

  const third = connect();
  await once(third, 'open');
  const roomFull = nextMessage(third, 'room-full');
  third.send(JSON.stringify({ type: 'join', room: created.code, role: 'guest', name: 'Third' }));
  await roomFull;

  for (const socket of [intruder, host, guest, third]) socket.close();
});
