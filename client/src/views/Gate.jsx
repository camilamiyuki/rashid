import { useState } from 'react';
import { Lock, ArrowRight } from 'lucide-react';

export default function Gate({ error, onSubmit }) {
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
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <p className="overline">Engenharia / acesso restrito</p>
        <h1 className="gate-title">Rashid</h1>
        <p className="gate-tag">
          Pizza, esfiha e afins rachados na hora — sem planilha, sem cobrança
          chata.
        </p>
        <p className="body-sm gate-hint">Digite a senha da equipe para entrar.</p>
        <label className="field">
          <span className="field-label">Senha da equipe</span>
          <div className="input-icon">
            <Lock size={16} aria-hidden />
            <input
              className="input"
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="senha da equipe"
              autoFocus
            />
          </div>
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-accent" type="submit" disabled={busy || !value}>
          Entrar <ArrowRight size={16} aria-hidden />
        </button>
      </form>
    </div>
  );
}
