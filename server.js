const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const rooms = new Map();

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg'
};

function iceServers() {
  const servers = [];
  if (process.env.STUN_URL) servers.push({ urls: process.env.STUN_URL });
  if (process.env.TURN_URL) {
    servers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_PASSWORD || ''
    });
  }
  return servers;
}

const server = http.createServer((req, res) => {
  if (req.url === '/rtc-config') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ iceServers: iceServers() }));
    return;
  }

  const clean = decodeURIComponent((req.url || '/').split('?')[0]);
  const requested = clean === '/' ? '/index.html' : clean;
  const filePath = path.normalize(path.join(ROOT, requested));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      fs.readFile(path.join(ROOT, 'index.html'), (fallbackError, fallback) => {
        if (fallbackError) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(fallback);
      });
      return;
    }
    res.writeHead(200, { 'content-type': mime[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/signal' });

function safeSend(client, payload) {
  if (client?.readyState === 1) client.send(JSON.stringify(payload));
}

function getRoom(code) {
  if (!rooms.has(code)) rooms.set(code, { host: null, guest: null, approved: false });
  return rooms.get(code);
}

function otherPeer(room, client) {
  if (!room) return null;
  return room.host === client ? room.guest : room.host;
}

function removeClient(client) {
  const code = client.room;
  if (!code || !rooms.has(code)) return;
  const room = rooms.get(code);
  const other = otherPeer(room, client);
  if (room.host === client) room.host = null;
  if (room.guest === client) room.guest = null;
  room.approved = false;
  safeSend(other, { type: 'peer-left' });
  if (!room.host && !room.guest) rooms.delete(code);
}

wss.on('connection', client => {
  client.on('message', raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    const code = String(message.room || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    if (!code) return;

    if (message.type === 'join') {
      const room = getRoom(code);
      client.room = code;
      client.role = message.role === 'host' ? 'host' : 'guest';
      client.name = String(message.name || 'Guest').slice(0, 80);

      if (client.role === 'host') {
        if (room.host && room.host !== client) { safeSend(client, { type: 'room-full' }); return; }
        room.host = client;
        safeSend(client, { type: 'joined' });
        if (room.guest) safeSend(client, { type: 'join-request', name: room.guest.name });
      } else {
        if (room.guest && room.guest !== client) { safeSend(client, { type: 'room-full' }); return; }
        room.guest = client;
        safeSend(client, { type: 'joined' });
        if (room.host) safeSend(room.host, { type: 'join-request', name: client.name });
      }
      return;
    }

    const room = rooms.get(code);
    if (!room) return;

    if (message.type === 'approve' && client === room.host && room.guest) {
      room.approved = true;
      safeSend(room.host, { type: 'approved' });
      safeSend(room.guest, { type: 'approved' });
      return;
    }

    if (message.type === 'deny' && client === room.host && room.guest) {
      safeSend(room.guest, { type: 'denied' });
      try { room.guest.close(); } catch {}
      room.guest = null;
      room.approved = false;
      return;
    }

    if (['offer', 'answer', 'ice'].includes(message.type) && room.approved) {
      safeSend(otherPeer(room, client), message);
      return;
    }

    if (message.type === 'caption' && room.approved) {
      const text = String(message.text || '').trim().slice(0, 1200);
      if (text) safeSend(otherPeer(room, client), { type: 'caption', text });
      return;
    }

    if (message.type === 'leave') removeClient(client);
  });

  client.on('close', () => removeClient(client));
});

server.listen(PORT, () => {
  console.log(`Dayani Meeting listening on :${PORT}`);
});
