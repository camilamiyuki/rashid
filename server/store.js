import crypto from 'node:crypto';
import { createStaticPix, hasError } from 'pix-utils';
import { db } from './db.js';

/** Erro de regra de domínio — a mensagem é segura para mostrar ao usuário. */
export class DomainError extends Error {}

const PIX_CITY = (process.env.PIX_CITY || 'CURITIBA').slice(0, 15);

export const MESSAGE_MAX = 500;
const CHAT_PAGE = 50;

const newId = () => crypto.randomBytes(6).toString('hex');

const qRacha = db.prepare('SELECT * FROM rachas WHERE id = ?');
const qParts = db.prepare('SELECT * FROM participants WHERE racha_id = ?');
const qPartByKey = db.prepare(
  'SELECT * FROM participants WHERE racha_id = ? AND client_key = ?'
);
const qPartById = db.prepare(
  'SELECT * FROM participants WHERE racha_id = ? AND id = ?'
);

function mustGetRacha(rachaId) {
  const r = qRacha.get(String(rachaId ?? ''));
  if (!r) throw new DomainError('Racha não encontrado.');
  return r;
}

function mustBeOrganizer(rachaId, clientKey) {
  const r = mustGetRacha(rachaId);
  if (r.organizer_key !== clientKey)
    throw new DomainError('Só o organizador pode fazer isso.');
  return r;
}

function cleanName(value, label, max) {
  const s = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!s) throw new DomainError(`${label} é obrigatório.`);
  if (s.length > max)
    throw new DomainError(`${label} deve ter no máximo ${max} caracteres.`);
  return s;
}

/** Dígitos verificadores de CPF/CNPJ (módulo 11). Serve para validar e, no caso
 *  de 11 dígitos nus, para desempatar CPF de celular sem DDI. */
function checkDigits(digits, lengths) {
  const [bodyLen] = lengths;
  for (let n = bodyLen; n < digits.length; n++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      // CPF pesa decrescendo de n+1; CNPJ cicla 9..2 a partir do fim.
      const weight = bodyLen === 9 ? n + 1 - i : ((n - 1 - i) % 8) + 2;
      sum += Number(digits[i]) * weight;
    }
    const rest = sum % 11;
    if (Number(digits[n]) !== (rest < 2 ? 0 : 11 - rest)) return false;
  }
  return true;
}

const isRepeated = (d) => /^(\d)\1+$/.test(d);
const isCpf = (d) => d.length === 11 && !isRepeated(d) && checkDigits(d, [9]);
const isCnpj = (d) => d.length === 14 && !isRepeated(d) && checkDigits(d, [12]);

// Os DDDs que existem de fato. A lista completa é o que separa um CPF digitado
// errado (11 dígitos que não fecham o checksum) de um celular de verdade —
// sem ela, "52998224726" passaria como telefone do DDD 52, que não existe.
const DDDS = new Set(
  `11 12 13 14 15 16 17 18 19
   21 22 24 27 28
   31 32 33 34 35 37 38
   41 42 43 44 45 46 47 48 49
   51 53 54 55
   61 62 63 64 65 66 67 68 69
   71 73 74 75 77 79
   81 82 83 84 85 86 87 88 89
   91 92 93 94 95 96 97 98 99`.split(/\s+/)
);

/** Telefone nacional: DDD válido + celular (9 + 8 dígitos) ou fixo (8 dígitos
 *  começando em 2-5). */
function isBrPhone(national) {
  if (!DDDS.has(national.slice(0, 2))) return false;
  const rest = national.slice(2);
  if (rest.length === 9) return rest[0] === '9';
  if (rest.length === 8) return /^[2-5]/.test(rest);
  return false;
}

/** Normaliza a chave PIX para a forma canônica que o BR Code exige.
 *
 *  O banco casa a chave por string exata: telefone só é encontrado em E.164
 *  (`+55` + DDD + número) e CPF/CNPJ só em dígitos nus. Guardar o que o usuário
 *  digitou gera um QR que abre no app do banco mas não acha o recebedor — foi
 *  exatamente o que aconteceu com `41987147149` (celular gravado como CPF).
 *
 *  Onze dígitos nus são ambíguos (CPF ou celular sem DDI); o desempate é o
 *  dígito verificador do CPF. Quem tiver um celular que por acaso passe no
 *  checksum de CPF pode forçar telefone digitando com `+55`. */
function cleanPixKey(value) {
  const s = cleanName(value, 'Chave PIX', 77);
  const invalid = () =>
    new DomainError(
      'Chave PIX inválida — use e-mail, CPF/CNPJ, telefone com DDD ou chave aleatória.'
    );

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return s.toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))
    return s.toLowerCase();

  // Só sobram chaves numéricas: CPF, CNPJ ou telefone.
  if (!/^\+?[\d\s().\-/]+$/.test(s)) throw invalid();
  const digits = s.replace(/\D/g, '');
  const forcedPhone = s.startsWith('+');

  if (!forcedPhone && isCnpj(digits)) return digits;
  if (!forcedPhone && isCpf(digits)) return digits;

  // Telefone: descarta o 55 do país se veio junto.
  const national =
    digits.length > 11 && digits.startsWith('55') ? digits.slice(2) : digits;
  if (isBrPhone(national)) return `+55${national}`;

  if (!forcedPhone && (digits.length === 11 || digits.length === 14))
    throw new DomainError(
      'CPF/CNPJ inválido — confira os dígitos. Se for telefone, escreva com +55.'
    );
  throw new DomainError(
    'Telefone inválido — use DDD + número, como +55 41 98714-7149.'
  );
}

function cleanMessage(value) {
  // Preserva quebras de linha, colapsa o resto do espaço em branco.
  const s = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .trim();
  if (!s) throw new DomainError('Mensagem vazia.');
  if (s.length > MESSAGE_MAX)
    throw new DomainError(`Mensagem deve ter no máximo ${MESSAGE_MAX} caracteres.`);
  return s;
}

function cleanTotal(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 100_000_00)
    throw new DomainError('Valor total inválido.');
  return n;
}

// ---------------------------------------------------------------- leitura

export function getLobby() {
  const rows = db
    .prepare(
      `SELECT r.id, r.name, r.total_cents, r.status, r.created_at,
              COUNT(p.id) AS participant_count
         FROM rachas r
         LEFT JOIN participants p ON p.racha_id = r.id
        WHERE r.status != 'concluido'
        GROUP BY r.id
        ORDER BY r.created_at DESC`
    )
    .all();
  return rows.map((r) => {
    const racha = qRacha.get(r.id);
    const organizer = qPartByKey.get(r.id, racha.organizer_key);
    return {
      id: r.id,
      name: r.name,
      totalCents: r.total_cents,
      status: r.status,
      createdAt: r.created_at,
      participantCount: r.participant_count,
      organizerName: organizer?.name ?? '—',
    };
  });
}

export function getRachaState(rachaId) {
  const r = qRacha.get(rachaId);
  if (!r) return null;
  const participants = qParts
    .all(rachaId)
    .map((p) => ({
      id: p.id,
      name: p.name,
      confirmed: !!p.confirmed,
      paid: !!p.paid,
      isOrganizer: p.client_key === r.organizer_key,
    }))
    .sort(
      (a, b) =>
        b.isOrganizer - a.isOrganizer || a.name.localeCompare(b.name, 'pt-BR')
    );
  return {
    id: r.id,
    name: r.name,
    totalCents: r.total_cents,
    pixKey: r.pix_key,
    status: r.status,
    shareCents: r.share_cents,
    brCode: r.br_code,
    qrDataUrl: r.qr_data_url,
    runnerId: r.runner_id,
    createdAt: r.created_at,
    closedAt: r.closed_at,
    organizerParticipantId:
      participants.find((p) => p.isOrganizer)?.id ?? null,
    participants,
  };
}

// ---------------------------------------------------------------- mutações

export function createRacha({ name, totalCents, pixKey, organizerName, clientKey }) {
  const rachaId = newId();
  const participantId = newId();
  const now = Date.now();
  db.prepare(
    `INSERT INTO rachas (id, name, total_cents, pix_key, status, organizer_key, created_at)
     VALUES (?, ?, ?, ?, 'aberto', ?, ?)`
  ).run(
    rachaId,
    cleanName(name, 'Nome do racha', 60),
    cleanTotal(totalCents),
    cleanPixKey(pixKey),
    clientKey,
    now
  );
  // O organizador entra como participante (a Parte dele é o próprio consumo)
  // e já nasce confirmado.
  db.prepare(
    `INSERT INTO participants (id, racha_id, client_key, name, confirmed)
     VALUES (?, ?, ?, ?, 1)`
  ).run(participantId, rachaId, clientKey, cleanName(organizerName, 'Seu nome', 40));
  return { rachaId, participantId };
}

/** Entra num racha. Três desfechos:
 *  - participante (novo ou já existente): `participantId` preenchido;
 *  - espectador: racha fechado/concluído e a pessoa não estava nele — vê a
 *    Cobrança e a conversa, mas não age (`participantId` null);
 *  - `needsName`: racha aberto e o navegador ainda não tem nome salvo. */
export function joinRacha({ rachaId, clientKey, name }) {
  const r = mustGetRacha(rachaId);
  const existing = qPartByKey.get(r.id, clientKey);
  if (existing) {
    return { participantId: existing.id, state: getRachaState(r.id) };
  }
  // Fechado não aceita novo participante, mas segue visível: quem chega depois
  // (ou trocou de navegador) precisa enxergar o QR para pagar a sua parte.
  if (r.status !== 'aberto')
    return { participantId: null, state: getRachaState(r.id) };
  if (!String(name ?? '').trim()) return { needsName: true };
  const participantId = newId();
  db.prepare(
    `INSERT INTO participants (id, racha_id, client_key, name) VALUES (?, ?, ?, ?)`
  ).run(participantId, r.id, clientKey, cleanName(name, 'Seu nome', 40));
  return { participantId, state: getRachaState(r.id) };
}

export function leaveRacha({ rachaId, clientKey }) {
  const r = mustGetRacha(rachaId);
  if (r.status !== 'aberto')
    throw new DomainError('O racha já foi fechado — fale com o organizador.');
  if (r.organizer_key === clientKey)
    throw new DomainError('O organizador não pode sair do próprio racha. Cancele-o.');
  db.prepare('DELETE FROM participants WHERE racha_id = ? AND client_key = ?').run(
    r.id,
    clientKey
  );
}

export function setConfirmed({ rachaId, clientKey, confirmed }) {
  const r = mustGetRacha(rachaId);
  if (r.status !== 'aberto')
    throw new DomainError('O racha já foi fechado.');
  const p = qPartByKey.get(r.id, clientKey);
  if (!p) throw new DomainError('Você não está neste racha.');
  db.prepare('UPDATE participants SET confirmed = ? WHERE id = ?').run(
    confirmed ? 1 : 0,
    p.id
  );
}

export function updateRacha({ rachaId, clientKey, patch }) {
  const r = mustBeOrganizer(rachaId, clientKey);
  if (r.status !== 'aberto')
    throw new DomainError('Reabra o racha para fazer ajustes.');
  const name =
    patch.name !== undefined ? cleanName(patch.name, 'Nome do racha', 60) : r.name;
  const total =
    patch.totalCents !== undefined ? cleanTotal(patch.totalCents) : r.total_cents;
  const pixKey =
    patch.pixKey !== undefined ? cleanPixKey(patch.pixKey) : r.pix_key;
  db.prepare('UPDATE rachas SET name = ?, total_cents = ?, pix_key = ? WHERE id = ?').run(
    name,
    total,
    pixKey,
    r.id
  );
}

export function kickParticipant({ rachaId, clientKey, participantId }) {
  const r = mustBeOrganizer(rachaId, clientKey);
  if (r.status !== 'aberto')
    throw new DomainError('Reabra o racha para retirar alguém.');
  const target = qPartById.get(r.id, String(participantId ?? ''));
  if (!target) throw new DomainError('Participante não encontrado.');
  if (target.client_key === r.organizer_key)
    throw new DomainError('O organizador não pode se retirar.');
  db.prepare('DELETE FROM participants WHERE id = ?').run(target.id);
}

export async function closeRacha({ rachaId, clientKey }) {
  const r = mustBeOrganizer(rachaId, clientKey);
  if (r.status !== 'aberto')
    throw new DomainError('Só é possível fechar um racha aberto.');
  const parts = qParts.all(r.id);
  if (parts.length === 0) throw new DomainError('Racha sem participantes.');

  // Rateio igual, arredondado para cima ao centavo — os trocados do
  // arredondamento ficam com o organizador.
  const shareCents = Math.ceil(r.total_cents / parts.length);
  const organizer = parts.find((p) => p.client_key === r.organizer_key);

  // Renormaliza no fechamento: rachas criados antes da normalização têm a chave
  // crua no banco e gerariam um QR que não encontra o recebedor.
  const pixKey = cleanPixKey(r.pix_key);
  if (pixKey !== r.pix_key)
    db.prepare('UPDATE rachas SET pix_key = ? WHERE id = ?').run(pixKey, r.id);

  const pix = createStaticPix({
    merchantName: (organizer?.name ?? 'Organizador').slice(0, 25),
    merchantCity: PIX_CITY,
    pixKey,
    transactionAmount: shareCents / 100,
    infoAdicional: `Rashid ${r.name}`.slice(0, 40),
  });
  if (hasError(pix))
    throw new DomainError(`Não foi possível gerar o PIX: ${pix.message}`);

  const brCode = pix.toBRCode();
  const qrDataUrl = await pix.toImage();
  // runner_id volta a NULL: cada fechamento tem o seu próprio sorteio.
  db.prepare(
    `UPDATE rachas
        SET status = 'fechado', share_cents = ?, br_code = ?, qr_data_url = ?,
            runner_id = NULL, closed_at = ?
      WHERE id = ?`
  ).run(shareCents, brCode, qrDataUrl, Date.now(), r.id);
}

/** Sorteia quem desce para buscar. O sorteio é do servidor e fica gravado:
 *  todo mundo tem que ver o mesmo nome, senão cada tela apontaria uma pessoa.
 *  Só quem confirmou entra na roleta, e só rola um sorteio por fechamento. */
export function drawRunner({ rachaId, clientKey }) {
  const r = mustBeOrganizer(rachaId, clientKey);
  if (r.status !== 'fechado')
    throw new DomainError('A roleta só roda com o racha fechado.');
  if (r.runner_id) throw new DomainError('A roleta já rodou neste fechamento.');

  const candidates = qParts.all(r.id).filter((p) => p.confirmed);
  if (candidates.length === 0)
    throw new DomainError('Ninguém confirmou presença — não dá pra sortear.');

  const winner = candidates[crypto.randomInt(candidates.length)];
  db.prepare('UPDATE rachas SET runner_id = ? WHERE id = ?').run(winner.id, r.id);
  return { runnerId: winner.id };
}

export function reopenRacha({ rachaId, clientKey }) {
  const r = mustBeOrganizer(rachaId, clientKey);
  if (r.status !== 'fechado')
    throw new DomainError('Só é possível reabrir um racha fechado.');
  // Reabrir INVALIDA a Cobrança: a Parte será recalculada no próximo
  // fechamento. As marcações de pago são mantidas como informação.
  db.prepare(
    `UPDATE rachas
        SET status = 'aberto', share_cents = NULL, br_code = NULL,
            qr_data_url = NULL, runner_id = NULL, closed_at = NULL
      WHERE id = ?`
  ).run(r.id);
}

/** Destinos possíveis para quem segue sem reembolso marcado na conclusão. */
const PENDING_ACTIONS = new Set(['manter', 'aprovar', 'retirar']);

/** Concluir é irreversível, então o organizador decide de uma vez o que fazer
 *  com os pendentes: deixar como está, dar por pago ou tirar do racha. */
export function concludeRacha({ rachaId, clientKey, pending = 'manter' }) {
  const r = mustBeOrganizer(rachaId, clientKey);
  if (r.status !== 'fechado')
    throw new DomainError('Só é possível concluir um racha fechado.');
  if (!PENDING_ACTIONS.has(pending))
    throw new DomainError('Escolha o que fazer com os pendentes.');

  db.transaction(() => {
    if (pending === 'aprovar')
      db.prepare(
        `UPDATE participants SET paid = 1
          WHERE racha_id = ? AND paid = 0 AND client_key != ?`
      ).run(r.id, r.organizer_key);
    if (pending === 'retirar')
      db.prepare(
        `DELETE FROM participants
          WHERE racha_id = ? AND paid = 0 AND client_key != ?`
      ).run(r.id, r.organizer_key);
    db.prepare(`UPDATE rachas SET status = 'concluido' WHERE id = ?`).run(r.id);
  })();
}

export function cancelRacha({ rachaId, clientKey }) {
  const r = mustBeOrganizer(rachaId, clientKey);
  if (r.status !== 'aberto')
    throw new DomainError('Só é possível cancelar um racha aberto.');
  db.prepare('DELETE FROM rachas WHERE id = ?').run(r.id);
}

// ------------------------------------------------------------------ chat

const toMessage = (m) => ({
  id: m.id,
  authorId: m.author_id,
  authorName: m.author_name,
  body: m.body,
  createdAt: m.created_at,
});

/** Insere e devolve a mensagem pronta para o broadcast (delta, não estado). */
export function postMessage({ rachaId, clientKey, body }) {
  const r = mustGetRacha(rachaId);
  if (r.status === 'concluido')
    throw new DomainError('Racha concluído — o chat está encerrado.');
  const p = qPartByKey.get(r.id, clientKey);
  if (!p) throw new DomainError('Você não está neste racha.');

  const text = cleanMessage(body);
  const createdAt = Date.now();
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO messages (racha_id, author_id, author_name, body, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(r.id, p.id, p.name, text, createdAt);

  return {
    id: Number(lastInsertRowid),
    authorId: p.id,
    authorName: p.name,
    body: text,
    createdAt,
  };
}

/** Página de mensagens em ordem cronológica, da mais recente para trás.
 *  `before` é o id da mensagem mais antiga que o cliente já tem. */
export function getMessages({ rachaId, before }) {
  const r = mustGetRacha(rachaId);
  const cursor =
    Number.isFinite(Number(before)) && Number(before) > 0
      ? Number(before)
      : Number.MAX_SAFE_INTEGER;
  // Pede uma a mais que a página só para saber se ainda há histórico atrás.
  const rows = db
    .prepare(
      `SELECT id, author_id, author_name, body, created_at
         FROM messages
        WHERE racha_id = ? AND id < ?
        ORDER BY id DESC
        LIMIT ?`
    )
    .all(r.id, cursor, CHAT_PAGE + 1);
  const hasMore = rows.length > CHAT_PAGE;
  const page = hasMore ? rows.slice(0, CHAT_PAGE) : rows;
  return { messages: page.reverse().map(toMessage), hasMore };
}

// ----------------------------------------------------------------- admin
// Manutenção fora das regras de organizador: quem tem a ADMIN_PASSWORD age
// sobre qualquer racha. Não há checagem de client_key aqui de propósito.

/** Todos os rachas, inclusive os concluídos (que o lobby esconde). */
export function adminListRachas() {
  return db
    .prepare(
      `SELECT r.id, r.name, r.total_cents, r.status, r.pix_key, r.share_cents,
              r.created_at, r.closed_at,
              (SELECT COUNT(*) FROM participants p WHERE p.racha_id = r.id)
                AS participant_count,
              (SELECT COUNT(*) FROM participants p
                WHERE p.racha_id = r.id AND p.paid = 1) AS paid_count,
              (SELECT COUNT(*) FROM messages m WHERE m.racha_id = r.id)
                AS message_count,
              (SELECT p.name FROM participants p
                WHERE p.racha_id = r.id AND p.client_key = r.organizer_key)
                AS organizer_name
         FROM rachas r
        ORDER BY r.created_at DESC`
    )
    .all()
    .map((r) => ({
      id: r.id,
      name: r.name,
      totalCents: r.total_cents,
      status: r.status,
      pixKey: r.pix_key,
      shareCents: r.share_cents,
      createdAt: r.created_at,
      closedAt: r.closed_at,
      participantCount: r.participant_count,
      paidCount: r.paid_count,
      messageCount: r.message_count,
      organizerName: r.organizer_name ?? '—',
    }));
}

export function adminDeleteRacha({ rachaId }) {
  const r = mustGetRacha(rachaId);
  db.prepare('DELETE FROM rachas WHERE id = ?').run(r.id);
}

/** Reabre ou conclui à força, sem passar pelas transições do organizador.
 *  Reabrir invalida a Cobrança, igual ao fluxo normal. */
export function adminSetStatus({ rachaId, status }) {
  const r = mustGetRacha(rachaId);
  if (status === 'aberto')
    return void db
      .prepare(
        `UPDATE rachas
            SET status = 'aberto', share_cents = NULL, br_code = NULL,
                qr_data_url = NULL, runner_id = NULL, closed_at = NULL
          WHERE id = ?`
      )
      .run(r.id);
  if (status === 'concluido')
    return void db
      .prepare(`UPDATE rachas SET status = 'concluido' WHERE id = ?`).run(r.id);
  throw new DomainError('Status inválido — use "aberto" ou "concluido".');
}

export function setPaid({ rachaId, clientKey, participantId, paid }) {
  const r = mustBeOrganizer(rachaId, clientKey);
  if (r.status !== 'fechado')
    throw new DomainError('Marque pagamentos com o racha fechado.');
  const target = qPartById.get(r.id, String(participantId ?? ''));
  if (!target) throw new DomainError('Participante não encontrado.');
  if (target.client_key === r.organizer_key)
    throw new DomainError('O organizador não deve reembolso a si mesmo.');
  db.prepare('UPDATE participants SET paid = ? WHERE id = ?').run(
    paid ? 1 : 0,
    target.id
  );
}
