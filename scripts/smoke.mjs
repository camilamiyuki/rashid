// Smoke test E2E do Rashid: exercita gate, socket auth e o ciclo de vida
// completo do Racha contra um servidor rodando.
//
// Uso: APP_PASSWORD=... BASE_URL=http://localhost:3001 node scripts/smoke.mjs
import { io } from 'socket.io-client';

const BASE = process.env.BASE_URL || 'http://localhost:3001';
const PASSWORD = process.env.APP_PASSWORD || 'esfiha';

let failures = 0;
function check(label, cond, extra = '') {
  if (cond) console.log(`  ok  ${label}`);
  else {
    failures++;
    console.error(`FALHA  ${label} ${extra}`);
  }
}

function client(clientKey) {
  return io(BASE, { auth: { password: PASSWORD, clientKey }, transports: ['websocket'] });
}

function call(socket, event, payload = {}) {
  return new Promise((resolve) => {
    socket.timeout(5000).emit(event, payload, (err, res) =>
      resolve(err ? { ok: false, error: 'timeout' } : res)
    );
  });
}

const connected = (s) =>
  new Promise((resolve, reject) => {
    s.on('connect', resolve);
    s.on('connect_error', reject);
  });

const nextEvent = (s, event) =>
  new Promise((resolve) => s.once(event, resolve));

/** Aguarda um racha:state que satisfaça o predicado (broadcasts podem chegar
 *  fora de ordem em relação aos acks de outros sockets). */
const waitForState = (s, pred, ms = 5000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      s.off('racha:state', handler);
      reject(new Error('timeout esperando racha:state'));
    }, ms);
    const handler = (state) => {
      if (pred(state)) {
        clearTimeout(timer);
        s.off('racha:state', handler);
        resolve(state);
      }
    };
    s.on('racha:state', handler);
  });

// ---------------------------------------------------------------- gate

const gate = async (pw) =>
  (
    await fetch(`${BASE}/api/gate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    })
  ).json();

console.log('— gate');
check('senha errada é recusada', !(await gate('senha-errada')).ok);
check('senha certa é aceita', (await gate(PASSWORD)).ok);

console.log('— socket auth');
const intruder = io(BASE, {
  auth: { password: 'senha-errada', clientKey: 'intruso-1234' },
  transports: ['websocket'],
});
await connected(intruder).then(
  () => check('socket com senha errada é recusado', false),
  (err) => check('socket com senha errada é recusado', err.message === 'unauthorized')
);
intruder.close();

// ---------------------------------------------------------------- fluxo

console.log('— fluxo do racha');
const gio = client('gio-clientkey-0001');
const bruno = client('bruno-clientkey-01');
const ana = client('ana-clientkey-0001');
await Promise.all([connected(gio), connected(bruno), connected(ana)]);

// criar (total R$100,00)
const created = await call(gio, 'racha:create', {
  name: 'pizza smoke test',
  totalCents: 10000,
  pixKey: 'giordano.zonta@gmail.com',
  organizerName: 'Gio',
});
check('organizador cria o racha', created.ok, created.error);
const rachaId = created.rachaId;

// lobby lista o racha
const lobby = await call(bruno, 'lobby:list');
check(
  'lobby lista o racha aberto',
  lobby.ok && lobby.rachas.some((r) => r.id === rachaId && r.status === 'aberto')
);

// bruno e ana entram
const jBruno = await call(bruno, 'racha:join', { rachaId, name: 'Bruno' });
const jAna = await call(ana, 'racha:join', { rachaId, name: 'Ana' });
check('participantes entram', jBruno.ok && jAna.ok);
check('estado tem 3 participantes', jAna.state.participants.length === 3);
check(
  'organizador já nasce confirmado',
  jAna.state.participants.find((p) => p.isOrganizer)?.confirmed === true
);

// join idempotente (refresh)
const jBruno2 = await call(bruno, 'racha:join', { rachaId, name: 'Bruno' });
check(
  'rejoin é idempotente (mesmo participantId)',
  jBruno2.ok && jBruno2.participantId === jBruno.participantId
);

// broadcast em tempo real: bruno confirma, ana recebe estado
const anaSees = waitForState(
  ana,
  (s) => s.participants.find((p) => p.id === jBruno.participantId)?.confirmed === true
);
const conf = await call(bruno, 'racha:confirm', { rachaId, confirmed: true });
const seen = await anaSees.catch(() => null);
check('confirmação propaga via websocket', conf.ok && seen !== null);

// não-organizador não pode fechar / ajustar / expulsar
check('não-organizador não fecha', !(await call(bruno, 'racha:close', { rachaId })).ok);
check(
  'não-organizador não ajusta',
  !(await call(bruno, 'racha:update', { rachaId, patch: { totalCents: 1 } })).ok
);

// organizador ajusta o total para R$110,00 e expulsa + readmite ana
const upd = await call(gio, 'racha:update', { rachaId, patch: { totalCents: 11000 } });
check('organizador ajusta total', upd.ok, upd.error);
const kick = await call(gio, 'racha:kick', { rachaId, participantId: jAna.participantId });
check('organizador retira participante', kick.ok, kick.error);
const jAna2 = await call(ana, 'racha:join', { rachaId, name: 'Ana' });
check('participante retirado consegue voltar (aberto)', jAna2.ok);

// fechar: 3 pessoas, R$110,00 → parte = ceil(11000/3) = 3667
const brunoSeesClose = waitForState(bruno, (s) => s.status === 'fechado');
const closed = await call(gio, 'racha:close', { rachaId });
check('organizador fecha o racha', closed.ok, closed.error);
const closedState = await brunoSeesClose;
check('parte arredonda pra cima (R$36,67)', closedState.shareCents === 3667,
  `got ${closedState.shareCents}`);
check('BR Code gerado', typeof closedState.brCode === 'string' && closedState.brCode.startsWith('000201'));
check('QR image gerada', typeof closedState.qrDataUrl === 'string' && closedState.qrDataUrl.startsWith('data:image/png'));
check('BR Code contém a chave PIX', closedState.brCode.includes('giordano.zonta@gmail.com'));

// racha fechado não aceita novo participante, mas deixa ver a cobrança
const late = client('atrasado-clientkey');
await connected(late);
const jLate = await call(late, 'racha:join', { rachaId, name: 'Atrasado' });
check('fechado aceita espectador', jLate.ok, jLate.error);
check('espectador não vira participante', jLate.participantId === null);
check(
  'espectador enxerga a cobrança',
  typeof jLate.state?.brCode === 'string' && jLate.state.brCode.startsWith('000201')
);
check(
  'espectador não entra na lista de participantes',
  jLate.state.participants.length === 3
);
check(
  'espectador não manda mensagem',
  !(await call(late, 'chat:send', { rachaId, body: 'oi' })).ok
);
late.close();

// roleta: só o organizador gira, sorteia entre quem confirmou, roda uma vez
console.log('— roleta do busca-pizza');
check('não-organizador não gira a roleta',
  !(await call(bruno, 'racha:drawRunner', { rachaId })).ok);
const drawn = await call(gio, 'racha:drawRunner', { rachaId });
check('organizador gira a roleta', drawn.ok, drawn.error);
check('a roleta não roda duas vezes no mesmo fechamento',
  !(await call(gio, 'racha:drawRunner', { rachaId })).ok);
const stDraw = await call(bruno, 'racha:join', { rachaId, name: 'Bruno' });
check('o sorteado é o mesmo para todo mundo', stDraw.state.runnerId === drawn.runnerId);
{
  // Só confirmados entram: Gio (organizador, nasce confirmado) e Bruno.
  const eligible = stDraw.state.participants.filter((p) => p.confirmed).map((p) => p.id);
  check('o sorteado confirmou presença', eligible.includes(drawn.runnerId),
    `runner ${drawn.runnerId} fora de [${eligible}]`);
}

// organizador marca bruno como pago; bruno não pode marcar
check(
  'não-organizador não marca pago',
  !(await call(bruno, 'racha:setPaid', { rachaId, participantId: jBruno.participantId, paid: true })).ok
);
const paid = await call(gio, 'racha:setPaid', { rachaId, participantId: jBruno.participantId, paid: true });
check('organizador marca pago', paid.ok, paid.error);
check(
  'organizador não é marcável como pago',
  !(await call(gio, 'racha:setPaid', { rachaId, participantId: created.participantId, paid: true })).ok
);

// reabrir invalida a cobrança
const reopened = await call(gio, 'racha:reopen', { rachaId });
const stAfterReopen = await call(bruno, 'racha:join', { rachaId, name: 'Bruno' });
check('reabrir invalida cobrança', reopened.ok &&
  stAfterReopen.state.brCode === null && stAfterReopen.state.shareCents === null
);
check('reabrir zera a roleta', stAfterReopen.state.runnerId === null);
check(
  'marcação de pago sobrevive à reabertura',
  stAfterReopen.state.participants.find((p) => p.id === jBruno.participantId)?.paid === true
);

// fechar de novo e concluir mantendo os pendentes (bruno pago, ana não)
const closed2 = await call(gio, 'racha:close', { rachaId });
check('fecha de novo após reabrir', closed2.ok, closed2.error);
check(
  'destino inválido para os pendentes é recusado',
  !(await call(gio, 'racha:conclude', { rachaId, pending: 'sei-la' })).ok
);
const concluded = await call(gio, 'racha:conclude', { rachaId, pending: 'manter' });
check('organizador conclui o racha fechado', concluded.ok, concluded.error);
const stConcluded = await call(ana, 'racha:join', { rachaId, name: 'Ana' });
check(
  'pendente segue pendente com "manter"',
  stConcluded.state.participants.find((p) => p.id === jAna2.participantId)?.paid === false
);
const lobbyAfter = await call(bruno, 'lobby:list');
check(
  'concluído some do lobby',
  lobbyAfter.ok && !lobbyAfter.rachas.some((r) => r.id === rachaId)
);

// ------------------------------------------------- destino dos pendentes

console.log('— pendentes na conclusão');
for (const [pending, expectPaid, expectCount] of [
  ['aprovar', true, 2],
  ['retirar', null, 1],
]) {
  const c = await call(gio, 'racha:create', {
    name: `pendentes ${pending}`,
    totalCents: 2000,
    pixKey: 'giordano.zonta@gmail.com',
    organizerName: 'Gio',
  });
  const j = await call(bruno, 'racha:join', { rachaId: c.rachaId, name: 'Bruno' });
  await call(gio, 'racha:close', { rachaId: c.rachaId });
  const res = await call(gio, 'racha:conclude', { rachaId: c.rachaId, pending });
  check(`conclui com pending="${pending}"`, res.ok, res.error);
  const after = await call(bruno, 'racha:join', { rachaId: c.rachaId, name: 'Bruno' });
  check(
    `pending="${pending}" deixa ${expectCount} participante(s)`,
    after.state.participants.length === expectCount,
    `got ${after.state.participants.length}`
  );
  if (expectPaid !== null)
    check(
      `pending="${pending}" marca o devedor como pago`,
      after.state.participants.find((p) => p.id === j.participantId)?.paid === expectPaid
    );
  else
    check(
      `pending="${pending}" tira o devedor da lista`,
      !after.state.participants.some((p) => p.id === j.participantId)
    );
}

// cancelamento emite racha:deleted
const c2 = await call(gio, 'racha:create', {
  name: 'cancelamento teste',
  totalCents: 5000,
  pixKey: 'giordano.zonta@gmail.com',
  organizerName: 'Gio',
});
await call(bruno, 'racha:join', { rachaId: c2.rachaId, name: 'Bruno' });
const brunoSeesDelete = nextEvent(bruno, 'racha:deleted');
await call(gio, 'racha:cancel', { rachaId: c2.rachaId });
const del = await brunoSeesDelete;
check('cancelar emite racha:deleted na sala', del.id === c2.rachaId);

// validações
check('total inválido é recusado', !(await call(gio, 'racha:create', {
  name: 'x', totalCents: -5, pixKey: 'a@b.c', organizerName: 'Gio',
})).ok);
check('chave PIX inválida é recusada no fechamento', await (async () => {
  const bad = await call(gio, 'racha:create', {
    name: 'pix ruim', totalCents: 1000, pixKey: '@@@', organizerName: 'Gio',
  });
  if (!bad.ok) return true; // recusada já na criação também vale
  const res = await call(gio, 'racha:close', { rachaId: bad.rachaId });
  await call(gio, 'racha:cancel', { rachaId: bad.rachaId });
  return !res.ok;
})());

// --------------------------------------------------- normalização do PIX

console.log('— chave PIX no BR Code');
// O banco casa a chave por string exata: telefone só em E.164, CPF só em
// dígitos nus. Foi o que quebrou o QR de "41987147149" (celular virou CPF).
const pixCases = [
  ['41987147149', '+5541987147149', 'celular sem DDI vira E.164'],
  ['(41) 98714-7149', '+5541987147149', 'celular formatado vira E.164'],
  ['+55 41 98714-7149', '+5541987147149', 'celular com DDI é normalizado'],
  ['5541987147149', '+5541987147149', 'celular com 55 na frente vira E.164'],
  ['(41) 3333-4444', '+554133334444', 'fixo com DDD vira E.164'],
  ['529.982.247-25', '52998224725', 'CPF perde a pontuação'],
  ['11.222.333/0001-81', '11222333000181', 'CNPJ perde a pontuação'],
  ['GIORDANO.Zonta@Gmail.com', 'giordano.zonta@gmail.com', 'e-mail vai em minúsculas'],
];
for (const [input, expected, label] of pixCases) {
  const c = await call(gio, 'racha:create', {
    name: `pix ${input}`,
    totalCents: 1000,
    pixKey: input,
    organizerName: 'Gio',
  });
  if (!c.ok) {
    check(label, false, c.error);
    continue;
  }
  const closedPix = await call(gio, 'racha:close', { rachaId: c.rachaId });
  const st = await call(gio, 'racha:join', { rachaId: c.rachaId });
  const field = `01${String(expected.length).padStart(2, '0')}${expected}`;
  check(
    label,
    closedPix.ok && st.state.brCode.includes(field) && st.state.pixKey === expected,
    `esperava "${expected}", veio "${st.state?.pixKey}"`
  );
  await call(gio, 'racha:conclude', { rachaId: c.rachaId, pending: 'manter' });
}
for (const [bad, label] of [
  ['529.982.247-26', 'CPF com dígito verificador errado é recusado'],
  ['11.222.333/0001-82', 'CNPJ com dígito verificador errado é recusado'],
  ['+55 20 98714-7149', 'DDD inexistente é recusado'],
  ['+55 41 88714-7149', 'celular sem o 9 na frente é recusado'],
])
  check(label, !(await call(gio, 'racha:create', {
    name: 'chave ruim', totalCents: 1000, pixKey: bad, organizerName: 'Gio',
  })).ok);

// ---------------------------------------------------------------- admin

console.log('— painel admin');
const ADMIN = process.env.ADMIN_PASSWORD || '';
if (!ADMIN) {
  check(
    'sem ADMIN_PASSWORD o painel fica desativado',
    !(await call(gio, 'admin:auth', { password: 'qualquer' })).ok
  );
  console.log('  --  demais checagens de admin puladas (defina ADMIN_PASSWORD)');
} else {
  check('senha de admin errada é recusada',
    !(await call(gio, 'admin:auth', { password: `${ADMIN}-errada` })).ok);
  check('sem auth os eventos de admin são recusados',
    !(await call(gio, 'admin:list')).ok);
  const adminAuth = await call(gio, 'admin:auth', { password: ADMIN });
  check('senha de admin certa autentica', adminAuth.ok, adminAuth.error);
  check('admin enxerga rachas concluídos',
    adminAuth.rachas?.some((r) => r.id === rachaId && r.status === 'concluido'));

  const victim = await call(gio, 'racha:create', {
    name: 'alvo do admin', totalCents: 1000,
    pixKey: 'giordano.zonta@gmail.com', organizerName: 'Gio',
  });
  await call(bruno, 'racha:join', { rachaId: victim.rachaId, name: 'Bruno' });
  const forced = await call(gio, 'admin:setStatus', {
    rachaId: victim.rachaId, status: 'concluido',
  });
  check('admin conclui à força', forced.ok &&
    forced.rachas.find((r) => r.id === victim.rachaId)?.status === 'concluido');

  const brunoSeesAdminDelete = nextEvent(bruno, 'racha:deleted');
  const removed = await call(gio, 'admin:deleteRacha', { rachaId: victim.rachaId });
  check('admin exclui o racha', removed.ok &&
    !removed.rachas.some((r) => r.id === victim.rachaId));
  check('exclusão do admin avisa a sala',
    (await brunoSeesAdminDelete).id === victim.rachaId);
}

gio.close();
bruno.close();
ana.close();

console.log(failures === 0 ? '\nSMOKE OK' : `\nSMOKE FALHOU (${failures})`);
process.exit(failures === 0 ? 0 : 1);
