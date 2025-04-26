// npm run list-active-trades
// npx ts-node scripts/list-active-trades.ts

import { query } from '../src/db';

interface TradeDeadline {
  id: number;
  leg1_escrow_deposit_deadline: Date | null;
  leg1_fiat_payment_deadline: Date | null;
  leg2_escrow_deposit_deadline: Date | null;
  leg2_fiat_payment_deadline: Date | null;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / (1000 * 60)) % 60;
  const hours = Math.floor(ms / (1000 * 60 * 60)) % 24;
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds) parts.push(`${seconds}s`);
  return parts.length ? parts.join(' ') : '0s';
}

(async () => {
  const rows: TradeDeadline[] = await query(
    `SELECT id,
      leg1_escrow_deposit_deadline,
      leg1_fiat_payment_deadline,
      leg2_escrow_deposit_deadline,
      leg2_fiat_payment_deadline
    FROM trades
    WHERE overall_status != 'CANCELLED'
      AND (
        leg1_escrow_deposit_deadline IS NOT NULL
        OR leg1_fiat_payment_deadline IS NOT NULL
        OR leg2_escrow_deposit_deadline IS NOT NULL
        OR leg2_fiat_payment_deadline IS NOT NULL
      )`
  );

  const now = new Date();

  const active = rows
    .map(t => {
      const deadlines = [
        { field: 'leg1_escrow_deposit_deadline', date: t.leg1_escrow_deposit_deadline! },
        { field: 'leg1_fiat_payment_deadline', date: t.leg1_fiat_payment_deadline! },
        { field: 'leg2_escrow_deposit_deadline', date: t.leg2_escrow_deposit_deadline! },
        { field: 'leg2_fiat_payment_deadline', date: t.leg2_fiat_payment_deadline! },
      ].filter(d => d.date != null) as Array<{ field: string; date: Date }>;

      const upcoming = deadlines.filter(d => d.date > now);
      if (!upcoming.length) return null;
      upcoming.sort((a, b) => a.date.getTime() - b.date.getTime());
      const next = upcoming[0];
      const diff = next.date.getTime() - now.getTime();
      return {
        TradeID: t.id,
        DeadlineField: next.field,
        Deadline: next.date.toISOString(),
        Remaining: formatDuration(diff),
      };
    })
    .filter(x => x != null) as Array<Record<string, unknown>>;

  if (!active.length) {
    console.log('No active trades with upcoming deadlines.');
    process.exit(0);
  }

  console.table(active);
  process.exit(0);
})();
