// Compact product lines with photo and price: the short approval card and "What was ordered".
import { useState } from 'react';
import { UNIT_CODE_NAMES } from '@junction/shared';
import type { UiOrder } from '../contract';
import { eur } from '../ui';

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

const packs = (quantity: number, unit: string) => {
  const name = UNIT_CODE_NAMES[unit as keyof typeof UNIT_CODE_NAMES];
  return `${quantity.toLocaleString('fi-FI', { maximumFractionDigits: 2 })} × ${name ?? unit}`;
};

/** One row per order line: photo, product, packs × signed unit price, line total. */
export function CompactLines({ order }: { order: UiOrder }) {
  return (
    <ul className="compact-lines" aria-label="Products">
      {order.lines.map((line) => (
        <li key={line.lineId} className="compact-line">
          <ProductPhoto productId={line.productId} name={line.productName} />
          <div className="compact-text">
            <strong>{line.productName}</strong>
            <span className="muted">
              {packs(line.quantity, line.unit)} · {eur(line.unitPrice)}
            </span>
          </div>
          <span className="compact-price">{eur(line.totals.gross)}</span>
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
      {verified ? '✓ Fixed price signed by Valio Aimo' : 'Price not verified'} · incl. VAT {eur(order.totals.gross)}
    </p>
  );
}
