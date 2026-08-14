import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import * as store from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;

const APP_PASSWORD = process.env.APP_PASSWORD || 'esfiha';
if (!process.env.APP_PASSWORD) {
  console.warn(
    '[rashid] APP_PASSWORD não definido — usando a senha padrão "esfiha". ' +
      'Defina APP_PASSWORD no ambiente antes de expor o app.'
  );
}

// Sem default: o painel admin apaga racha de qualquer um, então fica desligado
// até alguém definir a senha explicitamente.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
if (!ADMIN_PASSWORD)
  console.warn(
    '[rashid] ADMIN_PASSWORD não definido — painel admin desativado. ' +
      'Defina ADMIN_PASSWORD no ambiente para habilitá-lo.'
  );

/** Comparação em tempo constante — a senha admin é o único segredo forte aqui. */
function samePassword(candidate, expected) {
  if (!expected || typeof candidate !== 'string') return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ------------------------------------------------------------------ HTTP

const app = express();
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Pré-tela de senha: valida a senha compartilhada antes de conectar o socket.
app.post('/api/gate', (req, res) => {
  res.json({ ok: req.body?.password === APP_PASSWORD });
});

const dist = path.join(__dirname, '../client/dist');
app.use(express.static(dist));
app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => {
  res.sendFile(path.join(dist, 'index.html'), (err) => {
    if (err) res.status(404).send('Rode "npm run build" para gerar o client.');
  });
});

// ---------------------------------------------------------------- Socket

const server = http.createServer(app);
const io = new Server(server);

const ROOM = (rachaId) => `r:${rachaId}`;

io.use((socket, next) => {
  const { password, clientKey } = socket.handshake.auth ?? {};
  if (password !== APP_PASSWORD) return next(new Error('unauthorized'));
  if (typeof clientKey !== 'string' || clientKey.length < 8 || clientKey.length > 64)
    return next(new Error('bad client key'));
  socket.data.clientKey = clientKey;
  next();
});

// Token bucket por socket: 5 mensagens de folga, repõe 1 a cada 2s. Segura o
// dedo-preso sem atrapalhar quem só está conversando rápido.
const CHAT_BURST = 5;
const CHAT_REFILL_MS = 2000;

function allowChat(socket) {
  const now = Date.now();
  const bucket = (socket.data.chat ??= { tokens: CHAT_BURST, at: now });
  bucket.tokens = Math.min(
    CHAT_BURST,
    bucket.tokens + (now - bucket.at) / CHAT_REFILL_MS
  );
  bucket.at = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

function broadcast(rachaId) {
  const state = store.getRachaState(rachaId);
  if (state) io.to(ROOM(rachaId)).emit('racha:state', state);
  io.emit('lobby:update', store.getLobby());
}

io.on('connection', (socket) => {
  const clientKey = socket.data.clientKey;

  /** Registra um handler com ack {ok, ...} e tratamento de DomainError. */
  const on = (event, fn) =>
    socket.on(event, async (payload, ack) => {
      if (typeof ack !== 'function') ack = () => {};
      try {
        ack({ ok: true, ...((await fn(payload ?? {})) ?? {}) });
      } catch (err) {
        if (err instanceof store.DomainError)
          return ack({ ok: false, error: err.message });
        console.error(`[rashid] erro em ${event}:`, err);
        ack({ ok: false, error: 'Erro interno.' });
      }
    });

  on('lobby:list', () => ({ rachas: store.getLobby() }));

  on('racha:create', ({ name, totalCents, pixKey, organizerName }) => {
    const { rachaId, participantId } = store.createRacha({
      name,
      totalCents,
      pixKey,
      organizerName,
      clientKey,
    });
    socket.join(ROOM(rachaId));
    broadcast(rachaId);
    return { rachaId, participantId };
  });

  on('racha:join', ({ rachaId, name }) => {
    const res = store.joinRacha({ rachaId, clientKey, name });
    // `needsName` é só uma pergunta de volta ao cliente: nada entrou no racha.
    if (res.needsName) return res;
    socket.join(ROOM(rachaId));
    broadcast(rachaId);
    return res;
  });

  on('racha:leave', ({ rachaId }) => {
    store.leaveRacha({ rachaId, clientKey });
    socket.leave(ROOM(rachaId));
    broadcast(rachaId);
  });

  on('racha:confirm', ({ rachaId, confirmed }) => {
    store.setConfirmed({ rachaId, clientKey, confirmed });
    broadcast(rachaId);
  });

  on('racha:update', ({ rachaId, patch }) => {
    store.updateRacha({ rachaId, clientKey, patch: patch ?? {} });
    broadcast(rachaId);
  });

  on('racha:kick', ({ rachaId, participantId }) => {
    store.kickParticipant({ rachaId, clientKey, participantId });
    broadcast(rachaId);
  });

  on('racha:close', async ({ rachaId }) => {
    await store.closeRacha({ rachaId, clientKey });
    broadcast(rachaId);
  });

  on('racha:drawRunner', ({ rachaId }) => {
    const res = store.drawRunner({ rachaId, clientKey });
    broadcast(rachaId);
    return res;
  });

  on('racha:reopen', ({ rachaId }) => {
    store.reopenRacha({ rachaId, clientKey });
    broadcast(rachaId);
  });

  on('racha:conclude', ({ rachaId, pending }) => {
    store.concludeRacha({ rachaId, clientKey, pending });
    broadcast(rachaId);
  });

  on('racha:cancel', ({ rachaId }) => {
    store.cancelRacha({ rachaId, clientKey });
    io.to(ROOM(rachaId)).emit('racha:deleted', { id: rachaId });
    io.socketsLeave(ROOM(rachaId));
    io.emit('lobby:update', store.getLobby());
  });

  on('racha:setPaid', ({ rachaId, participantId, paid }) => {
    store.setPaid({ rachaId, clientKey, participantId, paid });
    broadcast(rachaId);
  });

  on('chat:history', ({ rachaId, before }) => store.getMessages({ rachaId, before }));

  // De propósito não chama broadcast(): uma mensagem não muda o estado do
  // racha, então vai como delta só para quem está na sala — em vez de reenviar
  // o estado inteiro para todos os sockets a cada linha de conversa.
  on('chat:send', ({ rachaId, body }) => {
    if (!allowChat(socket))
      throw new store.DomainError('Calma aí — muitas mensagens seguidas.');
    const message = store.postMessage({ rachaId, clientKey, body });
    io.to(ROOM(rachaId)).emit('chat:new', { rachaId, message });
    return { message };
  });

  // ---------------------------------------------------------------- admin
  // A senha é conferida uma vez e vira uma flag no socket; a flag morre com a
  // conexão, então o cliente reautentica sozinho depois de cada reconexão.

  const mustBeAdmin = () => {
    if (!socket.data.isAdmin)
      throw new store.DomainError('Sessão admin expirada — entre de novo.');
  };

  on('admin:auth', ({ password }) => {
    if (!ADMIN_PASSWORD)
      throw new store.DomainError(
        'Painel admin desativado — defina ADMIN_PASSWORD no servidor.'
      );
    if (!samePassword(password, ADMIN_PASSWORD)) {
      socket.data.isAdmin = false;
      throw new store.DomainError('Senha de admin incorreta.');
    }
    socket.data.isAdmin = true;
    return { rachas: store.adminListRachas() };
  });

  on('admin:list', () => {
    mustBeAdmin();
    return { rachas: store.adminListRachas() };
  });

  on('admin:deleteRacha', ({ rachaId }) => {
    mustBeAdmin();
    store.adminDeleteRacha({ rachaId });
    io.to(ROOM(rachaId)).emit('racha:deleted', { id: rachaId });
    io.socketsLeave(ROOM(rachaId));
    io.emit('lobby:update', store.getLobby());
    return { rachas: store.adminListRachas() };
  });

  on('admin:setStatus', ({ rachaId, status }) => {
    mustBeAdmin();
    store.adminSetStatus({ rachaId, status });
    broadcast(rachaId);
    return { rachas: store.adminListRachas() };
  });
});

server.listen(PORT, () => {
  console.log(`[rashid] servindo em http://localhost:${PORT}`);
});
