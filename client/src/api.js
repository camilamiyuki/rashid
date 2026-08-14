import { io } from 'socket.io-client';

/** Identidade anônima e estável deste navegador (não há login). */
export function getClientKey() {
  let key = localStorage.getItem('rashid.key');
  if (!key) {
    key = crypto.randomUUID();
    localStorage.setItem('rashid.key', key);
  }
  return key;
}

export function connect(password) {
  return io({ auth: { password, clientKey: getClientKey() } });
}

/** Emite um evento com ack em forma de Promise ({ ok, error?, ... }). */
export function call(socket, event, payload = {}) {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, payload, (err, res) => {
      if (err) resolve({ ok: false, error: 'Sem resposta do servidor.' });
      else resolve(res ?? { ok: false, error: 'Resposta vazia.' });
    });
  });
}

export async function checkGate(password) {
  try {
    const res = await fetch('/api/gate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    return !!data.ok;
  } catch {
    return false;
  }
}
