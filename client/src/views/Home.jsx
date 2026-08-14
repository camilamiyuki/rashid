import { useEffect, useState } from 'react';
import { Plus, ArrowRight, Users } from 'lucide-react';
import { call } from '../api.js';
import { parseMoney, formatMoney } from '../money.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '../ui/dialog.jsx';

const STATUS_LABEL = { aberto: 'Aberto', fechado: 'Fechado' };

export default function Home({ socket }) {
  const [rachas, setRachas] = useState([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const refresh = () =>
      call(socket, 'lobby:list').then((res) => {
        if (res.ok) setRachas(res.rachas);
      });
    refresh();
    const onUpdate = (list) => setRachas(list);
    socket.on('lobby:update', onUpdate);
    socket.on('connect', refresh);
    return () => {
      socket.off('lobby:update', onUpdate);
      socket.off('connect', refresh);
    };
  }, [socket]);

  return (
    <div className="home">
      <div className="home-head">
        <div>
          <p className="overline">Lobby</p>
          <h2 className="h3">Rachas rolando agora</h2>
        </div>
        <button className="btn btn-accent" onClick={() => setCreating(true)}>
          <Plus size={16} aria-hidden /> Novo racha
        </button>
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <CreateForm socket={socket} onDone={() => setCreating(false)} />
        </DialogContent>
      </Dialog>

      {rachas.length === 0 && (
        <div className="empty card">
          <p className="body-lg">Nenhum racha aberto.</p>
          <p className="body-sm empty-sub">
            Alguém precisa tomar a iniciativa da esfiha.
          </p>
        </div>
      )}

      <ul className="racha-list">
        {rachas.map((r) => (
          <li key={r.id}>
            <a className="racha-card card" href={`#/r/${r.id}`}>
              <div className="racha-card-main">
                <p className="overline">
                  {r.organizerName} / <Users size={11} aria-hidden />{' '}
                  {r.participantCount}
                </p>
                <h3 className="h4">{r.name}</h3>
              </div>
              <div className="racha-card-side">
                <span className={`chip chip--${r.status}`}>
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
                <span className="racha-total">{formatMoney(r.totalCents)}</span>
                <ArrowRight className="card-arrow" size={18} aria-hidden />
              </div>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CreateForm({ socket, onDone }) {
  const [name, setName] = useState('');
  const [total, setTotal] = useState('');
  const [pixKey, setPixKey] = useState(
    () => localStorage.getItem('rashid.pix') ?? ''
  );
  const [organizerName, setOrganizerName] = useState(
    () => localStorage.getItem('rashid.name') ?? ''
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const totalCents = parseMoney(total);
    if (!totalCents) return setError('Valor total inválido. Ex: 350,00');
    setBusy(true);
    setError('');
    const res = await call(socket, 'racha:create', {
      name,
      totalCents,
      pixKey,
      organizerName,
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    localStorage.setItem('rashid.name', organizerName.trim());
    localStorage.setItem('rashid.pix', pixKey.trim());
    onDone();
    location.hash = `#/r/${res.rachaId}`;
  }

  return (
    <form className="dlg-form" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Novo racha</DialogTitle>
        <DialogDescription>
          Você adianta a conta e recebe os reembolsos na sua chave PIX. O valor
          pode ser ajustado enquanto o racha estiver aberto.
        </DialogDescription>
      </DialogHeader>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Nome do racha</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="pizza hoje meio dia"
            autoFocus
          />
        </label>
        <label className="field">
          <span className="field-label">Valor total (R$)</span>
          <input
            className="input"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            placeholder="350,00"
            inputMode="decimal"
          />
        </label>
        <label className="field">
          <span className="field-label">Sua chave PIX</span>
          <input
            className="input"
            value={pixKey}
            onChange={(e) => setPixKey(e.target.value)}
            placeholder="e-mail, CPF, telefone ou aleatória"
          />
        </label>
        <label className="field">
          <span className="field-label">Seu nome</span>
          <input
            className="input"
            value={organizerName}
            onChange={(e) => setOrganizerName(e.target.value)}
            placeholder="quem tá organizando"
          />
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
      <DialogFooter>
        <DialogClose asChild>
          <button className="btn btn-ghost" type="button">
            Cancelar
          </button>
        </DialogClose>
        <button className="btn btn-accent" type="submit" disabled={busy}>
          Criar racha <ArrowRight size={16} aria-hidden />
        </button>
      </DialogFooter>
    </form>
  );
}
