import { REASON_CODES } from '@junction/shared';
import { reasonBadge } from './reason.js';

/** Placeholder until Step 9 (approval queue, audit views, request form). */
export function App() {
  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Aimo approvals</h1>
      <p>Approval queue coming in Step 9. Reason codes from the shared contract:</p>
      <ul>
        {REASON_CODES.map((code) => {
          const b = reasonBadge(code);
          return (
            <li key={code}>
              <strong>{b.label}</strong> ({b.tone === 'danger' ? 'blocked' : 'needs approval'}) — {b.help}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
