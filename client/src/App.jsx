import { useEffect, useState } from 'react';
import { connect, checkGate } from './api.js';
import Gate from './views/Gate.jsx';
import Home from './views/Home.jsx';
import Room from './views/Room.jsx';
import Admin from './views/Admin.jsx';

function useHashRoute() {
  const [route, setRoute] = useState(() => location.hash.slice(1) || '/');
  useEffect(() => {
    const onChange = () => setRoute(location.hash.slice(1) || '/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export default function App() {
  const [password, setPassword] = useState(() =>
    localStorage.getItem('rashid.pw')
  );
  const [gateError, setGateError] = useState('');
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const route = useHashRoute();

  useEffect(() => {
    if (!password) return;
    const s = connect(password);
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('connect_error', (err) => {
      if (err.message === 'unauthorized') {
        s.close();
        localStorage.removeItem('rashid.pw');
        setSocket(null);
        setPassword(null);
        setGateError('Senha incorreta ou alterada. Tente de novo.');
      }
    });
    setSocket(s);
    return () => s.close();
  }, [password]);

  async function handleGate(candidate) {
    const ok = await checkGate(candidate);
    if (ok) {
      localStorage.setItem('rashid.pw', candidate);
      setGateError('');
      setPassword(candidate);
    } else {
      setGateError('Senha incorreta.');
    }
  }

  if (!password) return <Gate error={gateError} onSubmit={handleGate} />;
  if (!socket) return null;

  const rachaId = route.startsWith('/r/') ? route.slice(3) : null;
  const isAdmin = route === '/admin';

  return (
    <div className="shell">
      <header className="shell-header">
        <a className="brand" href="#/">
          <span className="brand-name">Rashid</span>
          <span className="brand-slash">/</span>
          <span className="brand-sub">racha de comida</span>
        </a>
        <div className="shell-side">
          <a className="admin-link" href="#/admin" title="Painel admin">
            admin
          </a>
          <span
            className={`conn-dot ${connected ? 'conn-dot--on' : ''}`}
            title={connected ? 'Conectado' : 'Reconectando…'}
          />
        </div>
      </header>
      <main className={rachaId ? 'container container--room' : 'container'}>
        {isAdmin ? (
          <Admin socket={socket} />
        ) : rachaId ? (
          <Room key={rachaId} socket={socket} rachaId={rachaId} />
        ) : (
          <Home socket={socket} />
        )}
      </main>
    </div>
  );
}
