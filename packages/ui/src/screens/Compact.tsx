// Compact product lines with photo and price: the short approval card and "What was ordered".
import { useId, useState } from 'react';
import { UNIT_CODE_NAMES } from '@junction/shared';
import type { UiOrder } from '../contract';
import { eur, Icon, substituteReasons, ToneIcon } from '../ui';
import { AIMO_PRODUCTS } from '../aimoProducts';

const BY_ID = new Map(Object.values(AIMO_PRODUCTS).map((p) => [p.productId, p]));
const LEAF = 'M5 19c0-8 5-13 14-14-1 9-6 14-14 14zM5 19l7-7';
const num = (v: number) => v.toLocaleString('fi-FI', { maximumFractionDigits: 1 });

/** Delivery reliability and CO2 from the Aimo data, looked up by product id; nothing when unknown (never guessed). */
export function ProductFacts({ productId }: { productId?: string }) {
  const p = productId ? BY_ID.get(productId) : undefined;
  if (!p || (p.reliability === null && p.co2PerKg === null)) return null;
  // floor, so 99.96 % never reads as 100 %
  const onTime = p.reliability === null ? null : num(Math.floor(p.reliability * 1000) / 10);
  return (
    <span className="pfacts">
      {onTime !== null && (
        <span className="pfact" title={`Delivered as ordered in ${onTime} % of past orders`}>
          <Icon name="clock" size={16} />
          <span aria-hidden="true">{onTime} % on time</span>
          <span className="visually-hidden">Delivered as ordered in {onTime} % of past orders</span>
        </span>
      )}
      {p.co2PerKg !== null && (
        <span className="pfact" title="Product-group average CO₂">
          <svg className="icon" viewBox="0 0 24 24" width={16} height={16} aria-hidden="true" focusable="false">
            <path d={LEAF} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span aria-hidden="true">{num(p.co2PerKg)} kg CO₂/kg</span>
          <span className="visually-hidden">Product-group average CO₂: {num(p.co2PerKg)} kg per kg</span>
        </span>
      )}
    </span>
  );
}

/**
 * Product photo from /products/<id>.jpg (copied from the Valio Aimo webshop for the demo products,
 * with Valio Aimo's permission). Products without a photo show a neutral tile.
 */
export function ProductPhoto({ productId, name, size = 64 }: { productId?: string; name: string; size?: number }) {
  const [missing, setMissing] = useState(!productId);
  if (missing) {
    return (
      <span className="photo photo-empty" style={{ width: size, height: size }} aria-hidden="true">
        {(name.replace(/^[\d\s×x.,]+(?=\D)/i, '').trim().charAt(0) || '·').toUpperCase()}
      </span>
    );
  }
  return (
    <img
      className="photo"
      src={`/products/${encodeURIComponent(productId!)}.jpg`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setMissing(true)}
    />
  );
}

export const packs = (quantity: number, unit: string) => {
  const name = UNIT_CODE_NAMES[unit as keyof typeof UNIT_CODE_NAMES];
  return `${quantity.toLocaleString('fi-FI', { maximumFractionDigits: 2 })} × ${name ?? unit}`;
};

/** Warning icon on a line that needs a look; the reason opens on hover, focus or tap. */
function LineFlag({ title, text }: { title: string; text: string }) {
  const id = useId();
  return (
    <span className="flag">
      <button type="button" className="flag-btn" aria-label={title} aria-describedby={id}>
        <ToneIcon tone="warn" />
      </button>
      <span role="tooltip" id={id} className="flag-tip">
        <strong>{title}</strong>
        {text}
      </span>
    </span>
  );
}

/** One row per order line: photo, product, packs × signed unit price, and a flag with the reason if Mikko is unsure. */
export function CompactLines({ order }: { order: UiOrder }) {
  const reasons = substituteReasons(order);
  return (
    <ul className="compact-lines" aria-label="Products">
      {order.lines.map((line) => (
        <li key={line.lineId} className="compact-line">
          <ProductPhoto productId={line.productId} name={line.productName} />
          <div className="compact-text">
            <strong>{line.productName}</strong>
            <span className="muted">
              {line.quantity.toLocaleString('fi-FI', { maximumFractionDigits: 2 })} × {eur(line.unitPrice)}
            </span>
          </div>
          {line.substituteFor ? (
            <LineFlag title="Substitute" text={reasons.get(line.lineId) ?? `Mikko picked this instead of product ${line.substituteFor}.`} />
          ) : (
            !line.offerVerified && <LineFlag title="Price not verified" text="Valio Aimo's signature on this price did not check out." />
          )}
        </li>
      ))}
    </ul>
  );
}

/** "Price signed by Valio Aimo" note: the order is placed at the fixed price of the signed offer. */
export function SignedPriceNote({ order }: { order: UiOrder }) {
  const verified = order.lines.every((l) => l.offerVerified);
  return (
    <p className="muted signed-note">
      {verified ? '✓ Signed by Valio Aimo' : 'Price not verified'} · {eur(order.totals.gross)}
    </p>
  );
}
