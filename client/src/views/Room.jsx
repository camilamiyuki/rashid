import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  X,
  LogOut,
  RefreshCw,
  Flag,
  Pencil,
  ArrowLeft,
  Dices,
} from 'lucide-react';
import { call } from '../api.js';
import { parseMoney, formatMoney } from '../money.js';
import Chat from './Chat.jsx';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '../ui/dialog.jsx';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '../ui/alert-dialog.jsx';

const STATUS_LABEL = {
  aberto: 'Aberto',
  fechado: 'Fechado',
  concluido: 'Concluído',
};

export default function Room({ socket, rachaId }) {
  const [state, setState] = useState(null);
  const [myPid, setMyPid] = useState(null);
  const [phase, setPhase] = useState('joining'); // joining | prompt | in | blocked | removed | deleted
  const [blockedMsg, setBlockedMsg] = useState('');
  const joinedOnce = useRef(false);

  async function join(name) {
    const res = await call(socket, 'racha:join', { rachaId, name });
    if (!res.ok) {
      setBlockedMsg(res.error);
      setPhase('blocked');
      return res;
    }
    // Racha aberto e este navegador ainda não tem nome: pergunta antes de entrar.
    if (res.needsName) {
      setPhase('prompt');
      return res;
    }
    joinedOnce.current = true;
    // `participantId` null = espectador: vê a Cobrança e a conversa, não age.
    setMyPid(res.participantId);
    setState(res.state);
    setPhase('in');
    return res;
  }

  useEffect(() => {
    join(localStorage.getItem('rashid.name') ?? '');

    const onState = (s) => {
      if (s.id === rachaId) setState(s);
    };
    const onDeleted = ({ id }) => {
      if (id === rachaId) setPhase('deleted');
    };
    const onReconnect = () => {
      // Reentra na sala do socket após queda do servidor/conexão.
      if (joinedOnce.current) join(localStorage.getItem('rashid.name') ?? '');
    };
    socket.on('racha:state', onState);
    socket.on('racha:deleted', onDeleted);
    socket.on('connect', onReconnect);
    return () => {
      socket.off('racha:state', onState);
      socket.off('racha:deleted', onDeleted);
      socket.off('connect', onReconnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, rachaId]);

  // Detecta remoção pelo organizador: eu tinha participantId e sumi da lista.
  useEffect(() => {
    if (phase === 'in' && state && myPid) {
      if (!state.participants.some((p) => p.id === myPid)) setPhase('removed');
    }
  }, [state, myPid, phase]);

  if (phase === 'prompt') return <NamePrompt onSubmit={(n) => join(n)} />;
  if (phase === 'blocked') return <Notice title="Sem entrada" body={blockedMsg} />;
  if (phase === 'removed')
    return (
      <Notice
        title="Você foi retirado do racha"
        body="O organizador removeu você desta divisão."
      />
    );
  if (phase === 'deleted')
    return (
      <Notice
        title="Racha cancelado"
        body="O organizador cancelou este racha."
      />
    );
  if (!state) return <p className="body-sm room-loading">Entrando no racha…</p>;

  // Espectador num racha que reabriu ainda dá tempo de virar participante.
  const enter = async () => {
    const saved = localStorage.getItem('rashid.name') ?? '';
    if (saved) await join(saved);
    else setPhase('prompt');
  };

  return (
    <RoomView
      socket={socket}
      state={state}
      myPid={myPid}
      rachaId={rachaId}
      onEnter={enter}
    />
  );
}

// ------------------------------------------------------------------ views

function RoomView({ socket, state, myPid, rachaId, onEnter }) {
  const me = state.participants.find((p) => p.id === myPid);
  const isOrganizer = state.organizerParticipantId === myPid;
  const organizer = state.participants.find((p) => p.isOrganizer);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  const act = async (event, payload = {}) => {
    setError('');
    const res = await call(socket, event, { rachaId, ...payload });
    if (!res.ok) setError(res.error);
    return res;
  };

  const confirmedCount = state.participants.filter((p) => p.confirmed).length;
  const owers = state.participants.filter((p) => !p.isOrganizer);
  const paidCount = owers.filter((p) => p.paid).length;

  return (
    <div className="room">
      <a className="back-link body-sm" href="#/">
        <ArrowLeft size={14} aria-hidden /> Lobby
      </a>

      <div className="room-head">
        <div>
          <p className="overline">
            {organizer?.name} / organiza este racha
          </p>
          <h2 className="h3">{state.name}</h2>
        </div>
        <span className={`chip chip--${state.status}`}>
          {STATUS_LABEL[state.status]}
        </span>
      </div>

      <div className="room-layout">
      <div className="room-main">
      <div className="room-figures card">
        <PizzaDial
          slices={state.participants.length}
          lit={state.status === 'aberto' ? confirmedCount : paidCount + 1}
          caption={
            state.status === 'aberto'
              ? `${confirmedCount} de ${state.participants.length} confirmados`
              : `${paidCount} de ${owers.length} pagos`
          }
        />
        <div className="figure-stack">
          <Figure
            label={state.status === 'aberto' ? 'Parte (prévia)' : 'Parte'}
            value={formatMoney(
              state.shareCents ??
                Math.ceil(state.totalCents / Math.max(state.participants.length, 1))
            )}
            highlight
          />
          <Figure label="Total" value={formatMoney(state.totalCents)} />
          <Figure label="Pessoas" value={String(state.participants.length)} />
        </div>
      </div>

      {state.status === 'fechado' && (
        <>
          <RunnerRoulette
            state={state}
            myPid={myPid}
            isOrganizer={isOrganizer}
            onDraw={() => act('racha:drawRunner')}
          />
          <ChargePanel state={state} me={me} organizer={organizer} />
        </>
      )}

      {state.status === 'concluido' && (
        <div className="card notice-card">
          <p className="overline">Encerrado</p>
          <p className="body">
            Racha concluído. {paidCount}/{owers.length} reembolsos marcados
            como pagos.
          </p>
        </div>
      )}

      {!me && (
        <div className="card notice-card">
          <p className="overline">Você está de fora</p>
          <p className="body-sm">
            {state.status === 'aberto'
              ? 'Você ainda não entrou neste racha — entre para confirmar a sua parte.'
              : 'Este racha fechou antes de você entrar. Dá pra ver a cobrança e a conversa, mas não dá mais para participar.'}
          </p>
          {state.status === 'aberto' && (
            <button className="btn btn-accent notice-btn" onClick={onEnter}>
              <Check size={16} aria-hidden /> Entrar no racha
            </button>
          )}
        </div>
      )}

      <Dialog
        open={isOrganizer && editing && state.status === 'aberto'}
        onOpenChange={setEditing}
      >
        <DialogContent>
          <EditForm
            state={state}
            onSave={async (patch) => {
              const res = await act('racha:update', { patch });
              if (res.ok) setEditing(false);
            }}
          />
        </DialogContent>
      </Dialog>

      <section className="card participants">
        <div className="participants-head">
          <p className="overline">
            Participantes /{' '}
            {state.status === 'aberto'
              ? `${confirmedCount} de ${state.participants.length} confirmados`
              : `${paidCount} de ${owers.length} pagos`}
          </p>
        </div>
        <ul>
          {state.participants.map((p) => (
            <ParticipantRow
              key={p.id}
              p={p}
              state={state}
              isMe={p.id === myPid}
              canKick={isOrganizer && state.status === 'aberto' && !p.isOrganizer}
              canTogglePaid={
                isOrganizer && state.status === 'fechado' && !p.isOrganizer
              }
              onKick={() => act('racha:kick', { participantId: p.id })}
              onTogglePaid={() =>
                act('racha:setPaid', { participantId: p.id, paid: !p.paid })
              }
            />
          ))}
        </ul>
      </section>

      {error && <p className="form-error">{error}</p>}

      <div className="room-actions">
        {state.status === 'aberto' && me && !isOrganizer && (
          <>
            <button
              className={me.confirmed ? 'btn btn-primary' : 'btn btn-accent'}
              onClick={() => act('racha:confirm', { confirmed: !me.confirmed })}
            >
              <Check size={16} aria-hidden />
              {me.confirmed ? 'Confirmado' : 'Tô dentro'}
            </button>
            <button className="btn btn-ghost" onClick={async () => {
              const res = await act('racha:leave');
              if (res.ok) location.hash = '#/';
            }}>
              <LogOut size={16} aria-hidden /> Sair do racha
            </button>
          </>
        )}

        {isOrganizer && state.status === 'aberto' && (
          <>
            <button className="btn btn-accent" onClick={() => act('racha:close')}>
              Fechar racha e gerar PIX
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(true)}>
              <Pencil size={16} aria-hidden /> Ajustar
            </button>
            <ConfirmDialog
              title="Cancelar este racha?"
              description="Isso apaga a sala para todos os participantes. Não dá pra desfazer."
              confirmLabel="Cancelar racha"
              confirmClassName="btn btn-danger"
              cancelLabel="Voltar"
              onConfirm={() => act('racha:cancel')}
            >
              <button className="btn btn-danger-ghost">
                <X size={16} aria-hidden /> Cancelar racha
              </button>
            </ConfirmDialog>
          </>
        )}

        {isOrganizer && state.status === 'fechado' && (
          <>
            <ConfirmDialog
              title="Reabrir o racha?"
              description="O QR atual será invalidado e a parte de cada pessoa recalculada no próximo fechamento. As marcações de pago são mantidas."
              confirmLabel="Reabrir"
              cancelLabel="Voltar"
              onConfirm={() => act('racha:reopen')}
            >
              <button className="btn btn-ghost">
                <RefreshCw size={16} aria-hidden /> Reabrir e ajustar
              </button>
            </ConfirmDialog>
            <ConcludeDialog
              pendingNames={owers.filter((p) => !p.paid).map((p) => p.name)}
              onConclude={(pending) => act('racha:conclude', { pending })}
            />
          </>
        )}
      </div>
      </div>

      <Chat socket={socket} rachaId={rachaId} myPid={myPid} canSend={!!me} />
      </div>
    </div>
  );
}

const SPIN_MS = 4200;

/** A roleta do busca-pizza: quem confirmou entra, um desce.
 *  O sorteio vem pronto do servidor — a roda aqui só encena o resultado, para
 *  que todas as telas parem no mesmo nome. */
function RunnerRoulette({ state, myPid, isOrganizer, onDraw }) {
  const candidates = state.participants.filter((p) => p.confirmed);
  const step = 360 / Math.max(candidates.length, 1);
  const indexOf = (id) => candidates.findIndex((p) => p.id === id);
  // O gradiente das fatias começa em -90° (9h) e cresce no sentido horário,
  // então a bissetriz da fatia i fica aqui, medida em graus a partir das 12h.
  // O rótulo e o ângulo de parada saem os dois desta conta — se saíssem de
  // contas separadas, a roleta pararia numa fatia e apontaria outra.
  const bisector = (i) => -90 + i * step + step / 2;
  const restAngle = (i) => -bisector(i);
  // O rótulo é um braço que sai do centro para a direita, então o zero dele é
  // às 3h, não às 12h como no gradiente. Sem esses -90° o nome fica uma fatia
  // adiantado em relação à cor que ele nomeia.
  const labelAngle = (i) => bisector(i) - 90;

  const [angle, setAngle] = useState(() => {
    const i = indexOf(state.runnerId);
    return i >= 0 ? restAngle(i) : 0;
  });
  const [spinning, setSpinning] = useState(false);
  const lastRunner = useRef(state.runnerId);

  useEffect(() => {
    if (state.runnerId === lastRunner.current) return;
    lastRunner.current = state.runnerId;
    const i = indexOf(state.runnerId);
    if (i < 0) return setAngle(0);
    setSpinning(true);
    // Continua do ângulo atual e dá mais cinco voltas antes de parar.
    setAngle((a) => Math.ceil(a / 360) * 360 + 360 * 5 + restAngle(i));
    const t = setTimeout(() => setSpinning(false), SPIN_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.runnerId]);

  const runner = state.participants.find((p) => p.id === state.runnerId);
  const winnerIdx = indexOf(state.runnerId);
  // A fatia vencedora só acende quando a roda para: o verde é a revelação.
  const settled = winnerIdx >= 0 && !spinning;
  const wedges = candidates
    .map((p, i) => {
      // Com um número ímpar de fatias a alternância se encontra consigo mesma
      // na volta; a última recebe um terceiro tom para não colar na primeira.
      const alt =
        candidates.length % 2 === 1 && i === candidates.length - 1
          ? 'var(--slice-c)'
          : i % 2
            ? 'var(--slice-a)'
            : 'var(--slice-b)';
      const color = settled && i === winnerIdx ? 'var(--slime)' : alt;
      return `${color} ${i * step}deg ${(i + 1) * step}deg`;
    })
    .join(', ');

  return (
    <section className="card roulette-zone">
      <p className="overline">Quem desce pra buscar</p>

      {candidates.length === 0 ? (
        <p className="body-sm">
          Ninguém confirmou presença antes do fechamento — a roleta fica de fora
          desta vez.
        </p>
      ) : (
        <>
          <div className="roulette">
            <span className="roulette-pin" aria-hidden />
            <div
              className="roulette-wheel"
              style={{
                '--slice': `${step}deg`,
                transform: `rotate(${angle}deg)`,
                transitionDuration: spinning ? `${SPIN_MS}ms` : '0ms',
                background: `conic-gradient(from -90deg, ${wedges})`,
              }}
            >
              {candidates.map((p, i) => {
                // Avalia a posição final, já com a roda girada: assim os nomes
                // param todos em pé quando a roleta para.
                const deg = (((labelAngle(i) + angle) % 360) + 360) % 360;
                // Metade esquerda: vira o nome para não ficar de cabeça pra baixo.
                const flipped = deg > 90 && deg < 270;
                const cls = [
                  'roulette-name',
                  flipped && 'roulette-name--flip',
                  settled && i === winnerIdx && 'roulette-name--won',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <span
                    key={p.id}
                    className={cls}
                    style={{ transform: `rotate(${labelAngle(i)}deg)` }}
                  >
                    {/* Nome curto: o rótulo cabe entre dois cortes, não a
                        biografia. */}
                    <span>{p.name.split(' ')[0].slice(0, 9)}</span>
                  </span>
                );
              })}
            </div>
          </div>

          {runner ? (
            <p className={`roulette-result ${spinning ? 'is-spinning' : ''}`}>
              {spinning
                ? 'Girando…'
                : runner.id === myPid
                  ? `Deu você, ${runner.name}. Pega a chave e desce.`
                  : `${runner.name} desce pra buscar.`}
            </p>
          ) : isOrganizer ? (
            <button className="btn btn-accent" onClick={onDraw}>
              <Dices size={16} aria-hidden /> Girar a roleta
            </button>
          ) : (
            <p className="body-sm roulette-wait">
              Esperando o organizador girar a roleta.
            </p>
          )}
          <p className="caption">
            Só quem confirmou entra no sorteio ({candidates.length} na roda). Um
            sorteio por fechamento — reabrir o racha zera a roleta.
          </p>
        </>
      )}
    </section>
  );
}

function ChargePanel({ state, me, organizer }) {
  const [copied, setCopied] = useState(false);
  const iOwe = me && !me.isOrganizer;

  async function copy() {
    try {
      await navigator.clipboard.writeText(state.brCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard indisponível — o código continua visível para seleção */
    }
  }

  return (
    <section className="card qr-zone">
      <p className="overline">Cobrança</p>
      <p className="qr-lead">
        {iOwe
          ? me.paid
            ? 'Sua parte já está marcada como paga.'
            : `Pague sua parte de ${formatMoney(state.shareCents)} para ${organizer?.name}.`
          : `Cada pessoa paga ${formatMoney(state.shareCents)} para ${organizer?.name}.`}
      </p>
      {state.qrDataUrl && (
        <img
          className="qr-img"
          src={state.qrDataUrl}
          alt={`QR Code PIX de ${formatMoney(state.shareCents)}`}
        />
      )}
      <div className="code-box">
        <code className="code-text">{state.brCode}</code>
        <button className="btn btn-primary btn-copy" onClick={copy}>
          {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
          {copied ? 'Copiado' : 'Copiar código'}
        </button>
      </div>
      {/* A chave fica à mostra para o organizador conferir que o QR aponta pra
          conta certa antes da galera pagar. */}
      <p className="caption">
        Chave PIX: <strong>{state.pixKey}</strong>
      </p>
      <p className="caption">
        PIX estático — após pagar, avise o organizador para marcar seu nome.
      </p>
    </section>
  );
}

function ParticipantRow({ p, state, isMe, canKick, canTogglePaid, onKick, onTogglePaid }) {
  return (
    <li className="participant-row">
      <div className="participant-id">
        {state.status === 'aberto' && (
          <span
            className={`dot ${p.confirmed ? 'dot--on' : ''}`}
            title={p.confirmed ? 'Confirmado' : 'Ainda não confirmou'}
          />
        )}
        <span className="participant-name">
          {p.name}
          {isMe && <span className="you-tag"> / você</span>}
        </span>
        {p.isOrganizer && <span className="org-tag">organizador</span>}
      </div>
      <div className="participant-side">
        {state.status !== 'aberto' && !p.isOrganizer && (
          canTogglePaid ? (
            <button
              className={`paid-toggle ${p.paid ? 'paid-toggle--on' : ''}`}
              onClick={onTogglePaid}
            >
              <Check size={14} aria-hidden /> {p.paid ? 'Pago' : 'Marcar pago'}
            </button>
          ) : (
            <span className={`paid-badge ${p.paid ? 'paid-badge--on' : ''}`}>
              {p.paid ? 'Pago' : 'Pendente'}
            </span>
          )
        )}
        {canKick && (
          <button
            className="icon-btn"
            title={`Retirar ${p.name}`}
            onClick={onKick}
          >
            <X size={16} aria-hidden />
          </button>
        )}
      </div>
    </li>
  );
}

function EditForm({ state, onSave }) {
  const [name, setName] = useState(state.name);
  const [total, setTotal] = useState(
    (state.totalCents / 100).toFixed(2).replace('.', ',')
  );
  const [pixKey, setPixKey] = useState(state.pixKey);
  const [error, setError] = useState('');

  function submit(e) {
    e.preventDefault();
    const totalCents = parseMoney(total);
    if (!totalCents) return setError('Valor total inválido.');
    onSave({ name, totalCents, pixKey });
  }

  return (
    <form className="dlg-form" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Ajustar racha</DialogTitle>
        <DialogDescription>
          Enquanto o racha está aberto, você pode mudar o nome, o valor total e
          a chave PIX. A parte de cada um é recalculada no fechamento.
        </DialogDescription>
      </DialogHeader>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Nome</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span className="field-label">Valor total (R$)</span>
          <input
            className="input"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            inputMode="decimal"
          />
        </label>
        <label className="field">
          <span className="field-label">Chave PIX</span>
          <input className="input" value={pixKey} onChange={(e) => setPixKey(e.target.value)} />
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
      <DialogFooter>
        <DialogClose asChild>
          <button className="btn btn-ghost" type="button">
            Cancelar
          </button>
        </DialogClose>
        <button className="btn btn-accent" type="submit">
          Salvar ajustes
        </button>
      </DialogFooter>
    </form>
  );
}

/** Conclusão do racha. Como concluir é irreversível, quem ainda está sem
 *  reembolso marcado não pode simplesmente ficar em aberto para sempre: o
 *  organizador decide de uma vez se mantém, dá por pago ou retira. */
function ConcludeDialog({ pendingNames, onConclude }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState('manter');
  const [busy, setBusy] = useState(false);

  const options = [
    {
      value: 'manter',
      label: 'Manter como pendentes',
      hint: 'Fica registrado quem não acertou.',
    },
    {
      value: 'aprovar',
      label: 'Aprovar automaticamente',
      hint: 'Marca todo mundo como pago e encerra sem pendência.',
    },
    {
      value: 'retirar',
      label: 'Retirar do racha',
      hint: 'Tira os pendentes da lista. As mensagens deles continuam no chat.',
    },
  ];

  async function confirm() {
    setBusy(true);
    const res = await onConclude(pendingNames.length ? pending : 'manter');
    setBusy(false);
    if (res?.ok !== false) setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="btn btn-primary">
          <Flag size={16} aria-hidden /> Concluir racha
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Concluir o racha?</DialogTitle>
          <DialogDescription>
            Encerra a divisão de vez. Ninguém mais entra e não dá pra reabrir
            depois.
          </DialogDescription>
        </DialogHeader>

        {pendingNames.length > 0 ? (
          <fieldset className="conclude-choice">
            <legend className="field-label">
              {pendingNames.length === 1
                ? `${pendingNames[0]} ainda não acertou. O que fazer?`
                : `${pendingNames.length} pessoas ainda não acertaram (${pendingNames.join(', ')}). O que fazer?`}
            </legend>
            {options.map((o) => (
              <label
                key={o.value}
                className={`choice ${pending === o.value ? 'choice--on' : ''}`}
              >
                <input
                  type="radio"
                  name="pending"
                  value={o.value}
                  checked={pending === o.value}
                  onChange={() => setPending(o.value)}
                />
                <span>
                  <span className="choice-label">{o.label}</span>
                  <span className="choice-hint">{o.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="body-sm">Todos os reembolsos já estão marcados.</p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <button className="btn btn-ghost" type="button">
              Voltar
            </button>
          </DialogClose>
          <button
            className="btn btn-primary"
            type="button"
            onClick={confirm}
            disabled={busy}
          >
            Concluir racha
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Confirmação destrutiva/irreversível no padrão shadcn AlertDialog.
 *  `children` é o gatilho (um botão já estilizado). */
function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancelar',
  confirmClassName = 'btn btn-primary',
  onConfirm,
  children,
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction className={confirmClassName} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function NamePrompt({ onSubmit }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    localStorage.setItem('rashid.name', name.trim());
    await onSubmit(name.trim());
    setBusy(false);
  }

  return (
    <form className="card name-prompt" onSubmit={submit}>
      <p className="overline">Quase lá</p>
      <h2 className="h4">Como você se chama?</h2>
      <label className="field">
        <span className="field-label">Seu nome</span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="como a galera te conhece"
          autoFocus
        />
      </label>
      <button className="btn btn-accent" type="submit" disabled={busy || !name.trim()}>
        Entrar no racha
      </button>
    </form>
  );
}

/** "Racha" é dividir a pizza: cada participante é uma fatia, e a fatia acende
 *  quando a pessoa confirma (racha aberto) ou paga (racha fechado). Pizza
 *  inteira, com casca — sem miolo vazado, senão vira medidor de carregamento. */
function PizzaDial({ slices, lit, caption }) {
  const n = Math.max(slices, 1);
  const step = 360 / n;
  const wedges = Array.from({ length: n }, (_, i) => {
    const color = i < lit ? 'var(--slime)' : 'var(--dough)';
    return `${color} ${i * step}deg ${(i + 1) * step}deg`;
  }).join(', ');

  return (
    <figure className="pizza">
      <div
        className="pizza-wheel"
        role="img"
        aria-label={`${lit} de ${n} fatias acertadas.`}
        style={{
          '--slice': `${step}deg`,
          background: `conic-gradient(from -90deg, ${wedges})`,
        }}
      />
      <figcaption className="pizza-caption">{caption}</figcaption>
    </figure>
  );
}

function Figure({ label, value, highlight }) {
  return (
    <div className={`figure ${highlight ? 'figure--highlight' : ''}`}>
      <p className="overline">{label}</p>
      <p className="figure-value">{value}</p>
    </div>
  );
}

function Notice({ title, body }) {
  return (
    <div className="card notice-card">
      <h2 className="h4">{title}</h2>
      <p className="body-sm">{body}</p>
      <a className="btn btn-primary notice-btn" href="#/">
        <ArrowLeft size={16} aria-hidden /> Voltar ao lobby
      </a>
    </div>
  );
}
