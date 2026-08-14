import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldAlert, Trash2, RefreshCw, Flag, ArrowLeft } from 'lucide-react';
import { call } from '../api.js';
import { formatMoney } from '../money.js';
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

const fmtDate = (ms) =>
  new Date(ms).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Manutenção da instância. A senha de admin é separada da senha da equipe e
 *  vive só na sessão: a flag mora no socket, então cada reconexão reautentica. */
export default function Admin({ socket }) {
  const [rachas, setRachas] = useState(null);
  const [error, setError] = useState('');
  // sessionStorage, não localStorage: fecha a aba, perde o acesso admin.
  const password = useRef(sessionStorage.getItem('rashid.admin') ?? '');

  const auth = useCallback(
    async (candidate) => {
      const res = await call(socket, 'admin:auth', { password: candidate });
      if (!res.ok) {
        sessionStorage.removeItem('rashid.admin');
        password.current = '';
        setRachas(null);
        setError(res.error);
        return false;
      }
      sessionStorage.setItem('rashid.admin', candidate);
      password.current = candidate;
      setError('');
      setRachas(res.rachas);
      return true;
    },
    [socket]
  );

  useEffect(() => {
    if (password.current) auth(password.current);
    // A flag de admin morre junto com o socket — reautentica ao reconectar.
    const onConnect = () => {
      if (password.current) auth(password.current);
    };
    socket.on('connect', onConnect);
    return () => socket.off('connect', onConnect);
  }, [socket, auth]);

  const act = async (event, payload = {}) => {
    const res = await call(socket, event, payload);
    if (!res.ok) return setError(res.error);
    setError('');
    setRachas(res.rachas);
  };

  if (!rachas) return <AdminGate error={error} onSubmit={auth} />;

  return (
    <div className="admin">
      <a className="back-link body-sm" href="#/">
        <ArrowLeft size={14} aria-hidden /> Lobby
      </a>

      <div className="home-head">
        <div>
          <p className="overline">Admin / manutenção</p>
          <h2 className="h3">Todos os rachas</h2>
        </div>
        <button className="btn btn-ghost" onClick={() => act('admin:list')}>
          <RefreshCw size={16} aria-hidden /> Atualizar
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}

      {rachas.length === 0 ? (
        <div className="empty card">
          <p className="body-lg">Nenhum racha no banco.</p>
        </div>
      ) : (
        <ul className="admin-list">
          {rachas.map((r) => (
            <li key={r.id} className="admin-row card">
              <div className="admin-row-main">
                <p className="overline">
                  {r.organizerName} / {fmtDate(r.createdAt)} / <code>{r.id}</code>
                </p>
                <h3 className="h4">
                  <a href={`#/r/${r.id}`}>{r.name}</a>
                </h3>
                <p className="caption admin-meta">
                  {formatMoney(r.totalCents)}
                  {r.shareCents ? ` / parte ${formatMoney(r.shareCents)}` : ''} ·{' '}
                  {r.paidCount}/{r.participantCount} pagos · {r.messageCount}{' '}
                  msgs · chave <strong>{r.pixKey}</strong>
                </p>
              </div>
              <div className="admin-row-side">
                <span className={`chip chip--${r.status}`}>
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
                <div className="admin-row-actions">
                  {r.status !== 'aberto' && (
                    <Confirm
                      title={`Reabrir "${r.name}"?`}
                      description="Volta para aberto e invalida a cobrança atual. A parte será recalculada no próximo fechamento."
                      confirmLabel="Reabrir"
                      onConfirm={() =>
                        act('admin:setStatus', { rachaId: r.id, status: 'aberto' })
                      }
                    >
                      <button className="btn btn-ghost btn-sm">
                        <RefreshCw size={14} aria-hidden /> Reabrir
                      </button>
                    </Confirm>
                  )}
                  {r.status !== 'concluido' && (
                    <Confirm
                      title={`Concluir "${r.name}"?`}
                      description="Encerra o racha à força, sem passar pelo organizador."
                      confirmLabel="Concluir"
                      onConfirm={() =>
                        act('admin:setStatus', {
                          rachaId: r.id,
                          status: 'concluido',
                        })
                      }
                    >
                      <button className="btn btn-ghost btn-sm">
                        <Flag size={14} aria-hidden /> Concluir
                      </button>
                    </Confirm>
                  )}
                  <Confirm
                    title={`Excluir "${r.name}"?`}
                    description="Apaga o racha, os participantes e todo o histórico de conversa. Não dá pra desfazer."
                    confirmLabel="Excluir de vez"
                    confirmClassName="btn btn-danger"
                    onConfirm={() => act('admin:deleteRacha', { rachaId: r.id })}
                  >
                    <button className="btn btn-danger-ghost btn-sm">
                      <Trash2 size={14} aria-hidden /> Excluir
                    </button>
                  </Confirm>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AdminGate({ error, onSubmit }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!value || busy) return;
    setBusy(true);
    await onSubmit(value);
    setBusy(false);
  }

  return (
    <form className="card admin-gate" onSubmit={submit}>
      <p className="overline">Área restrita</p>
      <h2 className="h4">Painel admin</h2>
      <p className="body-sm">
        Senha própria, diferente da senha da equipe. Daqui dá pra apagar
        qualquer racha.
      </p>
      <label className="field">
        <span className="field-label">Senha de admin</span>
        <div className="input-icon">
          <ShieldAlert size={16} aria-hidden />
          <input
            className="input"
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        </div>
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="btn btn-accent" type="submit" disabled={busy || !value}>
        Entrar
      </button>
      <a className="back-link body-sm" href="#/">
        <ArrowLeft size={14} aria-hidden /> Voltar ao lobby
      </a>
    </form>
  );
}

function Confirm({
  title,
  description,
  confirmLabel,
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
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction className={confirmClassName} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
