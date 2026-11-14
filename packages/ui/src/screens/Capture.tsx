// Scan, upload and speak: three ways for the chef to fill the request box without typing.
//  - Scan: phone camera → photo → /api/scan (Claude reads the handwriting) → text in the box
//  - Upload: photo or PDF → /api/scan; CSV or Excel → read in the browser, one row per line
//  - Speak: the browser's speech recognition (Safari / Chrome), needs HTTPS or localhost
// The chef always sees and can edit the text before sending it.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { readSheet } from 'read-excel-file/browser';
import type { GatewayApi } from '../api';
import { Icon } from '../ui';

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function speechCtor(): (new () => Recognition) | undefined {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** Phone photos are large: scale to max 1600 px and re-encode as JPEG before sending. */
async function shrinkImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read the photo'))), 'image/jpeg', 0.85));
}

const rowsToText = (rows: unknown[][]) =>
  rows
    .map((row) => row.map((cell) => (cell instanceof Date ? cell.toISOString().slice(0, 10) : String(cell ?? '').trim())).filter(Boolean).join(' '))
    .filter(Boolean)
    .join('\n');

/** CSV with comma or semicolon (Finnish Excel exports use semicolons); quotes handled simply. */
export function parseCsv(text: string): string[][] {
  const first = text.split('\n')[0] ?? '';
  const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  return text.split(/\r?\n/).map((line) => line.split(sep).map((cell) => cell.replace(/^"|"$/g, '').replace(/""/g, '"')));
}

export const csvToText = (text: string) => rowsToText(parseCsv(text));

export async function fileToText(file: File, api: GatewayApi): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || file.type === 'text/csv') return csvToText(await file.text());
  if (name.endsWith('.xlsx') || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return rowsToText((await readSheet(file)) as unknown[][]);
  }
  if (name.endsWith('.xls')) throw new Error('Old .xls files are not supported: save it as .xlsx or .csv');
  if (!api.scan) throw new Error('Reading photos and PDFs needs Mikko online');
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return api.scan(await toBase64(file), 'application/pdf');
  if (file.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/.test(name)) {
    return api.scan(await toBase64(await shrinkImage(file)), 'image/jpeg');
  }
  throw new Error('Use a photo, PDF, CSV or Excel (.xlsx) file');
}

const MIC = 'M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v3.5M9 20.5h6';
const CAMERA = 'M4 8a1 1 0 0 1 1-1h3l1.5-2h5L16 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM12 9.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z';
// Same line style as Icon in ui.tsx, for the two glyphs it does not have.
const Glyph = ({ d }: { d: string }) => (
  <svg className="icon" viewBox="0 0 24 24" width={20} height={20} aria-hidden="true" focusable="false">
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Pill composer: + (photo, camera, file) | the text field passed as children | mic, or Send once there is text. */
export function CaptureBar({
  api,
  onText,
  hasText,
  working,
  children,
}: {
  api: GatewayApi;
  onText: (text: string, mode: 'replace' | 'append') => void;
  hasText: boolean;
  working?: string;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [listening, setListening] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const attachBox = useRef<HTMLDivElement>(null);
  const plus = useRef<HTMLButtonElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const doc = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const Speech = speechCtor();

  useEffect(() => () => recognition.current?.stop(), []);

  // Same as the + menu in Chat.tsx: close on a tap outside or on Escape (focus back on +).
  useEffect(() => {
    if (!menuOpen) return;
    attachBox.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!attachBox.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      plus.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [menuOpen]);

  const onMenuKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  };

  const pick = (input: HTMLInputElement | null) => {
    setMenuOpen(false);
    plus.current?.focus();
    input?.click();
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setError(undefined);
    setBusy(file.type.startsWith('image/') ? 'Reading the note…' : `Reading ${file.name}…`);
    try {
      const text = await fileToText(file, api);
      if (!text.trim()) throw new Error('No text found. Try a sharper photo or type it.');
      onText(text, 'replace');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  };

  const toggleSpeech = () => {
    setError(undefined);
    if (listening) {
      recognition.current?.stop();
      return;
    }
    if (!Speech) {
      setError('Voice input is not available in this browser. Use the microphone on the keyboard instead.');
      return;
    }
    if (!window.isSecureContext) {
      setError('Voice input needs a secure page (https). Open the https address of the app.');
      return;
    }
    const r = new Speech();
    r.lang = navigator.language || 'en-US';
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]!;
        if (result.isFinal) onText(result[0]!.transcript.trim(), 'append');
      }
    };
    r.onerror = (e) => setError(e.error === 'not-allowed' ? 'Microphone access was blocked. Allow it in the browser settings.' : `Voice input stopped (${e.error}).`);
    r.onend = () => setListening(false);
    recognition.current = r;
    r.start();
    setListening(true);
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    void readFile(input.files?.[0]).finally(() => (input.value = ''));
  };

  return (
    <div className="capture">
      <div className="composer">
        <div className="composer-row">
          <div className="attach" ref={attachBox}>
            <button
              ref={plus}
              type="button"
              className="icon-btn"
              aria-label="Add a photo or file"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={menuId}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <Icon name="plus" />
            </button>
            <div id={menuId} className="attach-menu" role="menu" aria-label="Add" hidden={!menuOpen} onKeyDown={onMenuKey}>
              <button type="button" role="menuitem" onClick={() => pick(photo.current)}>
                <Icon name="image" />
                Photo
              </button>
              <button type="button" role="menuitem" onClick={() => pick(camera.current)}>
                <Glyph d={CAMERA} />
                Camera
              </button>
              <button type="button" role="menuitem" onClick={() => pick(doc.current)}>
                <Icon name="file" />
                File
              </button>
            </div>
            <input ref={photo} type="file" accept="image/*" hidden onChange={onPick} />
            <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={onPick} />
            <input
              ref={doc}
              type="file"
              accept="image/*,application/pdf,.pdf,.csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              hidden
              onChange={onPick}
            />
          </div>
          {children}
          {hasText && !listening ? (
            <button type="submit" className="send-btn" aria-label="Send to Mikko" disabled={!!working}>
              <Icon name="send" />
            </button>
          ) : (
            <button type="button" className={listening ? 'icon-btn listening' : 'icon-btn'} aria-label="Speak" aria-pressed={listening} onClick={toggleSpeech}>
              <Glyph d={MIC} />
            </button>
          )}
        </div>
      </div>
      <p className="muted capture-status" role="status" aria-live="polite">
        {busy ?? (listening ? 'Listening… speak your order, then tap the mic again.' : (working ?? ''))}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
