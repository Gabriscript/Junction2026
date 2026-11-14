import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import type { GatewayApi } from '../api';
import type { UiOrder } from '../contract';
import { DEMO_MENU, draftFrom, history, KITCHEN, mergeLines as merge, parLevels, parseMessage, reviewWeek, type Finding, type Unit, type WeekOrder } from '../kitchen';
import { eur, Icon, StatusBadge, ToneIcon } from '../ui';

const UNITS: Unit[] = ['L', 'KG', 'ST'];
const KIND_LABEL: Record<Finding['kind'], string> = { quantity: 'Unusual quantity', missing: 'Forgotten?', menu: 'New on the menu' };
const qty = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const findingKey = (f: Finding) => `${f.kind}|${f.item}`;
const pars = parLevels(history);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One short line per question; the agent's full sentence sits behind "More". */
function headline(f: Finding, rows: WeekOrder[]): [string, string] {
  const par = pars.get(f.item);
  const row = rows.find((r) => r.item === f.item);
  if (f.kind === 'quantity' && row && par) {
    return par.unit === row.unit
      ? [`${cap(f.item)}: ${qty(row.quantity)} ${row.unit}?`, `Usually about ${qty(Math.round(par.median))} ${par.unit}.`]
      : [`${cap(f.item)} in ${row.unit}?`, `You usually order it in ${par.unit}.`];
  }
  if (f.kind === 'missing' && par) return [`${cap(f.item)} is missing.`, par.every === 1 ? 'You order it every week.' : `You order it every ${par.every} weeks.`];
  const dishes = DEMO_MENU.filter((d) => d.ingredients.includes(f.item)).map((d) => d.name);
  return [`${cap(f.item)} is new.`, dishes.length ? `${cap(dishes.join(', '))} needs it.` : 'Your menu needs it.'];
}

interface Draft {
  id: number;
  rows: WeekOrder[];
  unread: string[];
  menu: boolean;
  kept: string[];
  state: 'open' | 'sending' | 'sent';
}

type Message =
  | { id: number; from: 'chef'; text: string; file?: string }
  | { id: number; from: 'agent'; text: string }
  | { id: number; from: 'agent'; draftId: number }
  | { id: number; from: 'agent'; order: UiOrder };

const readBack = (rows: WeekOrder[]) => rows.map((r) => `${qty(r.quantity)} ${r.unit} ${r.item}`).join(', ');

export function Chat({ api }: { api: GatewayApi }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState<Draft>();
  const [text, setText] = useState('');
  const [file, setFile] = useState<string>();
  const [menuSeen, setMenuSeen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [error, setError] = useState<string>();
  const nextId = useRef(1);
  const input = useRef<HTMLTextAreaElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const doc = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const attachId = useId();

  const id = () => nextId.current++;
  const say = (...add: Message[]) => setMessages((all) => [...all, ...add]);
  useEffect(() => end.current?.scrollIntoView?.({ block: 'end' }), [messages, draft]);

  const findings = draft ? reviewWeek(history, draft.menu ? DEMO_MENU : [], draft.rows).filter((f) => !draft.kept.includes(findingKey(f))) : [];
  const open = draft?.state === 'open';

  const confirm = async () => {
    if (!draft || !open || draft.rows.length === 0) return;
    setDraft({ ...draft, state: 'sending' });
    setError(undefined);
    try {
      const order = await api.submitWeek(draft.rows, readBack(draft.rows));
      setDraft({ ...draft, state: 'sent' });
      say({ id: id(), from: 'agent', order });
    } catch (err) {
      setDraft({ ...draft, state: 'open' });
      setError(`The order was not sent. ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const send = (raw: string) => {
    const message = raw.trim();
    // Second Enter on an empty box confirms the order the agent just read back: the double send.
    if (!message && !file) {
      if (open) void confirm();
      return;
    }
    const menu = menuSeen || !!file;
    const out: Message[] = [{ id: id(), from: 'chef', text: message, ...(file ? { file } : {}) }];
    if (file && !menuSeen) {
      out.push({
        id: id(),
        from: 'agent',
        text: `Demo: I can't read files yet, so I used the sample menu (${DEMO_MENU.map((d) => d.name).join(', ')}).`,
      });
    }
    const parsed = parseMessage(message);
    if (parsed.lines.length === 0 && parsed.removed.length === 0 && !parsed.usual) {
      if (open && menu !== draft!.menu) {
        const next = { ...draft!, id: id(), menu };
        setDraft(next);
        out.push({ id: id(), from: 'agent', draftId: next.id });
      } else {
        out.push({
          id: id(),
          from: 'agent',
          text: message
            ? 'I found no quantity. Try "500 L milk, 40 kg mozzarella".'
            : 'Menu added. What do you need?',
        });
      }
    } else {
      const rows = open && !parsed.usual ? merge(draft!.rows, parsed.lines, parsed.removed) : draftFrom(parsed);
      const next: Draft = { id: id(), rows, unread: parsed.unread, menu, kept: open && !parsed.usual ? draft!.kept : [], state: 'open' };
      setDraft(next);
      out.push({ id: id(), from: 'agent', draftId: next.id });
    }
    say(...out);
    setMenuSeen(menu);
    setText('');
    setFile(undefined);
    setError(undefined);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(text);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(text);
    }
  };
  const pick = (target: HTMLInputElement | null) => {
    setAttachOpen(false);
    target?.click();
  };
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const name = e.target.files?.[0]?.name;
    if (name) setFile(name);
    e.target.value = '';
    input.current?.focus();
  };

  const update = (change: (d: Draft) => Draft) => setDraft((d) => (d && d.state === 'open' ? change(d) : d));
  const answer = (f: Finding, line?: WeekOrder) => {
    const fix = line ?? f.suggestion;
    if (fix) update((d) => ({ ...d, rows: merge(d.rows, [fix]) }));
  };
  const keep = (f: Finding) => update((d) => ({ ...d, kept: [...d.kept, findingKey(f)] }));

  const composer = (
    <form className="composer" onSubmit={submit}>
      <label htmlFor="chat-input" className="visually-hidden">
        Message the purchasing agent
      </label>
      {file && (
        <p className="chip">
          <Icon name="clip" size={16} />
          <span>{file}</span>
          <button type="button" className="chip-x" aria-label={`Remove ${file}`} onClick={() => setFile(undefined)}>
            <Icon name="close" size={16} />
          </button>
        </p>
      )}
      <div className="composer-row">
        <div className="attach">
          <button
            type="button"
            className="icon-btn"
            aria-label="Attach a menu photo or a file"
            aria-expanded={attachOpen}
            aria-controls={attachId}
            onClick={() => setAttachOpen((o) => !o)}
          >
            <Icon name="plus" />
          </button>
          <div id={attachId} className="attach-menu" hidden={!attachOpen} onKeyDown={(e) => e.key === 'Escape' && setAttachOpen(false)}>
            <button type="button" onClick={() => pick(photo.current)}>
              <Icon name="image" />
              Photo of the menu
            </button>
            <button type="button" onClick={() => pick(doc.current)}>
              <Icon name="file" />
              File (PDF, CSV, Excel)
            </button>
          </div>
          <input ref={photo} type="file" accept="image/*" hidden onChange={onFile} />
          <input ref={doc} type="file" accept=".pdf,.csv,.xlsx,.xls,.txt" hidden onChange={onFile} />
        </div>
        <textarea
          id="chat-input"
          ref={input}
          rows={1}
          maxLength={1000}
          value={text}
          placeholder={open ? 'Press Enter to send this order, or write a change' : 'What do you need this week?'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
        />
        <button type="submit" className="send-btn" aria-label={open && !text.trim() && !file ? 'Send the order' : 'Send message'}>
          <Icon name="send" />
        </button>
      </div>
    </form>
  );

  if (messages.length === 0) {
    return (
      <div className="chat-empty">
        <h1>Good to see you, {KITCHEN}.</h1>
        <p className="lead">Tell me what you need. I check it before anything is sent.</p>
        {composer}
        <ul className="suggestions" aria-label="Suggestions">
          <li>
            <button type="button" onClick={() => send('Prepare my usual weekly order')}>
              <Icon name="review" />
              Prepare my usual weekly order
            </button>
          </li>
          <li>
            <button type="button" onClick={() => send('1,000 L lactose-free milk by Monday')}>
              <Icon name="request" />
              1,000 L lactose-free milk by Monday
            </button>
          </li>
          <li>
            <button type="button" onClick={() => pick(photo.current)}>
              <Icon name="image" />
              Attach this week's menu
            </button>
          </li>
        </ul>
      </div>
    );
  }

  return (
    <div className="chat">
      <h1 className="visually-hidden">New order</h1>
      <div className="thread" role="log" aria-live="polite" aria-label="Conversation with the purchasing agent">
        {messages.map((m) =>
          m.from === 'chef' ? (
            <div key={m.id} className="msg msg-chef">
              {m.file && (
                <p className="chip">
                  <Icon name="clip" size={16} />
                  <span>{m.file}</span>
                </p>
              )}
              {m.text && <p>{m.text}</p>}
            </div>
          ) : (
            <div key={m.id} className="msg msg-agent">
              <span className="agent-mark" aria-hidden="true">
                <Icon name="shield" size={18} />
              </span>
              <div className="msg-body">
                {'text' in m && <p>{m.text}</p>}
                {'order' in m && <Sent order={m.order} />}
                {'draftId' in m &&
                  (draft && m.draftId === draft.id ? (
                    <Review draft={draft} findings={findings} onAnswer={answer} onKeep={keep} onConfirm={() => void confirm()} />
                  ) : (
                    <p className="muted">Earlier draft, replaced by the one below.</p>
                  ))}
              </div>
            </div>
          ),
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div ref={end} />
      </div>
      <div className="composer-dock">
        {composer}
        <p className="composer-hint">
          {open ? 'Press Enter again to send.' : 'Every order is checked before it goes to Valio Aimo.'}
        </p>
      </div>
    </div>
  );
}

function Review({
  draft,
  findings,
  onAnswer,
  onKeep,
  onConfirm,
}: {
  draft: Draft;
  findings: Finding[];
  onAnswer: (f: Finding, line?: WeekOrder) => void;
  onKeep: (f: Finding) => void;
  onConfirm: () => void;
}) {
  const open = draft.state === 'open';
  const risky = findings.find((f) => f.kind === 'quantity');
  const riskyLine = risky && draft.rows.find((r) => r.item === risky.item);
  const label = !findings.length
    ? 'Send order'
    : riskyLine
      ? `Send with ${qty(riskyLine.quantity)} ${riskyLine.unit} ${riskyLine.item}`
      : `Send anyway, ${findings.length} open`;

  return (
    <div className="review">
      {open && findings.length > 0 && (
        <>
          <p>
            <strong>
              {findings.length === 1 ? '1 thing to check' : `${findings.length} things to check`}
            </strong>
          </p>
          <ul className="questions" aria-label="Open questions">
            {findings.map((f) => (
              <Question key={findingKey(f)} finding={f} rows={draft.rows} onAnswer={onAnswer} onKeep={onKeep} />
            ))}
          </ul>
        </>
      )}
      {open && findings.length === 0 && (
        <p className="notice-ok">
          <ToneIcon tone="ok" />
          All good, nothing unusual.
        </p>
      )}
      <p>
        <strong>{draft.state === 'sent' ? 'Sent:' : `Your order, ${draft.rows.length} lines`}</strong>
      </p>
      <table className="readback">
        <caption className="visually-hidden">Order read back</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col" className="num-col">
              Quantity
            </th>
          </tr>
        </thead>
        <tbody>
          {draft.rows.map((r, i) => (
            <tr key={`${r.item}-${i}`}>
              <th scope="row">{r.item}</th>
              <td className="num num-col">
                {qty(r.quantity)} {r.unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {draft.unread.length > 0 && (
        <p className="muted">Not added, no quantity: {draft.unread.map((u) => `"${u}"`).join(', ')}.</p>
      )}

      {draft.state !== 'sent' && (
        <div className="button-row">
          <button type="button" className={findings.length ? 'btn' : 'btn primary'} disabled={!open} onClick={onConfirm}>
            {draft.state === 'sending' ? 'Sending...' : label}
          </button>
        </div>
      )}
    </div>
  );
}

function Question({
  finding: f,
  rows,
  onAnswer,
  onKeep,
}: {
  finding: Finding;
  rows: WeekOrder[];
  onAnswer: (f: Finding, line?: WeekOrder) => void;
  onKeep: (f: Finding) => void;
}) {
  const [title, detail] = headline(f, rows);
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<Unit>('KG');
  const fieldId = useId();
  const quantity = Number(amount);

  return (
    <li className="question">
      <p className="q-title">
        <ToneIcon tone="warn" />
        <span>
          <strong>{title}</strong> {detail}
        </span>
      </p>
      <details className="more">
        <summary>More</summary>
        <p>
          {KIND_LABEL[f.kind]}: {f.message}
        </p>
      </details>
      {adding ? (
        <form
          className="add-item"
          onSubmit={(e) => {
            e.preventDefault();
            if (amount.trim() && quantity > 0) onAnswer(f, { item: f.item, quantity, unit });
          }}
        >
          <label htmlFor={fieldId}>Quantity of {f.item}</label>
          <div className="add-row">
            <input id={fieldId} type="number" inputMode="decimal" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            <select aria-label={`Unit for ${f.item}`} value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
              {UNITS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
            <button type="submit" className="btn suggest">
              Add
            </button>
          </div>
        </form>
      ) : (
        <div className="button-row">
          {f.kind === 'menu' ? (
            <button type="button" className="btn suggest" onClick={() => setAdding(true)}>
              Add {f.item}
            </button>
          ) : (
            f.suggestion && (
              <button type="button" className="btn suggest" onClick={() => onAnswer(f)}>
                {f.kind === 'missing'
                  ? `Add ${qty(f.suggestion.quantity)} ${f.suggestion.unit} ${f.item}`
                  : `Use ${qty(f.suggestion.quantity)} ${f.suggestion.unit}`}
              </button>
            )
          )}
          <button type="button" className="btn quiet" onClick={() => onKeep(f)}>
            Keep as is
          </button>
        </div>
      )}
    </li>
  );
}

function Sent({ order }: { order: UiOrder }) {
  return (
    <div className="sent">
      <p className="card-head">
        <span>
          <strong>Sent. Order {order.orderId}</strong>, {order.lines.length} lines, <span className="num">{eur(order.totals.gross)}</span> incl. VAT.
        </span>
        <StatusBadge status={order.status} />
      </p>
      <p>
        <a href={`#/orders/${order.orderId}`}>Open decision record for {order.orderId}</a>
      </p>
    </div>
  );
}
