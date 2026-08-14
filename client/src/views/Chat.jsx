import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { Send } from 'lucide-react';
import { call } from '../api.js';

const MESSAGE_MAX = 500;

/** Chat ao vivo do racha. Histórico paginado por cursor + deltas via socket;
 *  nunca depende do estado do racha, que continua sendo o canal de rateio. */
export default function Chat({ socket, rachaId, myPid, canSend }) {
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const scrollRef = useRef(null);
  // Só rola sozinho quando o usuário já está colado no fim — não puxa a rolagem
  // de quem subiu para ler mensagens antigas.
  const atBottomRef = useRef(true);

  const isNearBottom = () => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // Carga inicial + reset quando troca de racha.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setMessages([]);
    setHasMore(false);
    call(socket, 'chat:history', { rachaId }).then((res) => {
      if (!alive) return;
      if (res.ok) {
        setMessages(res.messages);
        setHasMore(res.hasMore);
      } else {
        setError(res.error);
      }
      setLoading(false);
      atBottomRef.current = true;
    });
    return () => {
      alive = false;
    };
  }, [socket, rachaId]);

  // Deltas ao vivo. Dedup por id porque o ack do próprio envio também chega.
  useEffect(() => {
    const onNew = ({ rachaId: rid, message }) => {
      if (rid !== rachaId) return;
      atBottomRef.current = isNearBottom();
      setMessages((prev) =>
        prev.some((m) => m.id === message.id) ? prev : [...prev, message]
      );
    };
    socket.on('chat:new', onNew);
    return () => socket.off('chat:new', onNew);
  }, [socket, rachaId]);

  // Mantém a âncora no fim após novas mensagens, se era onde o usuário estava.
  useLayoutEffect(() => {
    if (atBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const loadOlder = useCallback(async () => {
    const oldest = messages[0];
    if (!oldest) return;
    const el = scrollRef.current;
    const before = el ? el.scrollHeight - el.scrollTop : 0;
    const res = await call(socket, 'chat:history', {
      rachaId,
      before: oldest.id,
    });
    if (!res.ok) return setError(res.error);
    if (res.messages.length === 0) return setHasMore(false);
    setHasMore(res.hasMore);
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      return [...res.messages.filter((m) => !seen.has(m.id)), ...prev];
    });
    // Preserva a posição de leitura: reancora pelo delta de altura.
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - before;
    });
  }, [messages, socket, rachaId]);

  async function submit(e) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError('');
    atBottomRef.current = true;
    const res = await call(socket, 'chat:send', { rachaId, body });
    if (res.ok) {
      setDraft('');
      setMessages((prev) =>
        prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]
      );
    } else {
      setError(res.error);
    }
    setSending(false);
  }

  function onKeyDown(e) {
    // Enter envia; Shift+Enter quebra linha.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit(e);
    }
  }

  return (
    <section className="card chat">
      <div className="chat-head">
        <p className="overline">Conversa</p>
      </div>

      <div
        className="chat-log"
        ref={scrollRef}
        onScroll={() => {
          atBottomRef.current = isNearBottom();
        }}
      >
        {loading ? (
          <p className="body-sm chat-empty">Carregando conversa…</p>
        ) : messages.length === 0 ? (
          <p className="body-sm chat-empty">
            Ninguém falou nada ainda. Quebra o gelo!
          </p>
        ) : (
          <>
            {hasMore && (
              <button className="btn btn-ghost chat-more" onClick={loadOlder}>
                Ver mensagens anteriores
              </button>
            )}
            {messages.map((m, i) => (
              <Message
                key={m.id}
                m={m}
                mine={m.authorId === myPid}
                showAuthor={i === 0 || messages[i - 1].authorId !== m.authorId}
              />
            ))}
          </>
        )}
      </div>

      {canSend ? (
        <form className="chat-compose" onSubmit={submit}>
          <textarea
            className="input chat-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MESSAGE_MAX))}
            onKeyDown={onKeyDown}
            placeholder="Escreve aí…"
            rows={1}
            aria-label="Mensagem"
          />
          <button
            className="btn btn-accent chat-send"
            type="submit"
            disabled={sending || !draft.trim()}
            aria-label="Enviar"
          >
            <Send size={16} aria-hidden />
          </button>
        </form>
      ) : (
        <p className="caption chat-locked">
          Entre no racha para participar da conversa.
        </p>
      )}
      {error && <p className="form-error chat-error">{error}</p>}
    </section>
  );
}

function Message({ m, mine, showAuthor }) {
  const time = new Date(m.createdAt).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <div className={`chat-msg ${mine ? 'chat-msg--mine' : ''}`}>
      {showAuthor && !mine && <span className="chat-author">{m.authorName}</span>}
      <div className="chat-bubble">
        <span className="chat-body">{m.body}</span>
        <time className="chat-time" dateTime={new Date(m.createdAt).toISOString()}>
          {time}
        </time>
      </div>
    </div>
  );
}
