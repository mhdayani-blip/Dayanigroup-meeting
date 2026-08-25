const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const rooms = new Map();
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg'
};

function turnCredential() {
  const secret = process.env.TURN_SHARED_SECRET;
  if (!secret) return null;

  // TURN REST credentials expire, so the browser never receives the server's
  // long-lived shared secret.
  const username = `${Math.floor(Date.now() / 1000) + 3600}:dayani`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential };
}

function iceServers() {
  const servers = [];
  if (process.env.STUN_URL) servers.push({ urls: process.env.STUN_URL });
  const credential = turnCredential();
  if (process.env.TURN_URL && credential) {
    servers.push({
      urls: process.env.TURN_URL.split(',').map(url => url.trim()).filter(Boolean),
      username: credential.username,
      credential: credential.credential
    });
  }
  return servers;
}

function createRoom() {
  let code;
  do {
    code = crypto.randomBytes(12).toString('base64url');
  } while (rooms.has(code));

  const hostToken = crypto.randomBytes(32).toString('base64url');
  rooms.set(code, {
    host: null,
    guest: null,
    approved: false,
    hostToken,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  return { code, hostToken };
}

function removeExpiredRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    // Empty, never-joined rooms are only guest-link reservations. Expire them
    // quickly to prevent an unauthenticated public endpoint from growing RAM.
    const maxAge = room.host || room.guest ? 12 * 60 * 60 * 1000 : 30 * 60 * 1000;
    if (now - room.updatedAt > maxAge) rooms.delete(code);
  }
}

function hasValidHostToken(value, expected) {
  if (typeof value !== 'string' || !expected) return false;
  const supplied = Buffer.from(value);
  const saved = Buffer.from(expected);
  return supplied.length === saved.length && crypto.timingSafeEqual(supplied, saved);
}

function hasAllowedOrigin(headers) {
  // Browsers send Origin for fetch/WebSocket requests. Keep it optional for
  // local CLI health checks, but enforce the configured production origin.
  const origin = headers.origin;
  return !ALLOWED_ORIGIN || !origin || origin === ALLOWED_ORIGIN;
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/rooms') {
    if (!hasAllowedOrigin(req.headers)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 1024) req.destroy();
    });
    req.on('end', () => {
      removeExpiredRooms();
      const room = createRoom();
      res.writeHead(201, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      });
      res.end(JSON.stringify(room));
    });
    return;
  }

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

const wss = new WebSocketServer({
  server,
  path: '/signal',
  verifyClient: info => hasAllowedOrigin(info.req.headers)
});

function safeSend(client, payload) {
  if (client?.readyState === 1) client.send(JSON.stringify(payload));
}

function otherPeer(room, client) {
  if (!room) return null;
  return room.host === client ? room.guest : room.host;
}

function removeClient(client) {
  const code = client.room;
  if (!code || !rooms.has(code)) return;
  client.room = null;
  const room = rooms.get(code);
  const other = otherPeer(room, client);
  if (room.host === client) room.host = null;
  if (room.guest === client) room.guest = null;
  room.approved = false;
  room.updatedAt = Date.now();
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
      const room = rooms.get(code);
      if (!room) {
        safeSend(client, { type: 'room-not-ready' });
        return;
      }

      const requestedHost = message.role === 'host';
      if (requestedHost && !hasValidHostToken(message.hostToken, room.hostToken)) {
        safeSend(client, { type: 'host-auth-failed' });
        return;
      }

      if (client.room && client.room !== code) removeClient(client);
      client.room = code;
      client.role = requestedHost ? 'host' : 'guest';
      client.name = String(message.name || 'Guest').slice(0, 80);
      room.updatedAt = Date.now();
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
      room.updatedAt = Date.now();
      safeSend(room.host, { type: 'approved' });
      safeSend(room.guest, { type: 'approved' });
      return;
    }

    if (message.type === 'deny' && client === room.host && room.guest) {
      const deniedGuest = room.guest;
      safeSend(deniedGuest, { type: 'denied' });
      room.guest = null;
      deniedGuest.room = null;
      try { deniedGuest.close(); } catch {}
      room.approved = false;
      room.updatedAt = Date.now();
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

setInterval(removeExpiredRooms, 15 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`Dayani Meeting listening on :${PORT}`);
});
