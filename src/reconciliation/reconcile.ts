import { z } from 'zod';
import { LocalTopup } from '../topups/topups.core';

export const ProviderReport = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payments: z.array(
    z.object({
      providerRef: z.string(),
      amountMinor: z.number().int(),
      currency: z.string(),
      status: z.string().default('succeeded'),
    }),
  ),
});
export type ProviderReport = z.infer<typeof ProviderReport>;

export interface ReconciliationResult {
  date: string;
  matched: number;
  /** Provider has a successful payment that we do not have as successful. */
  missingLocally: { providerRef: string; amountMinor: number; currency: string }[];
  /** We have a successful top-up that the provider does not list. */
  missingAtProvider: { providerRef: string; amountMinor: number; currency: string }[];
  /** Both have it, but amount or currency differ. */
  amountMismatches: { providerRef: string; ourAmountMinor: number; providerAmountMinor: number; ourCurrency: string; providerCurrency: string }[];
}

/** Pure comparison keyed on providerRef. Gross amounts: refunds are not netted off either side. */
export function reconcile(date: string, local: LocalTopup[], report: ProviderReport): ReconciliationResult {
  const theirs = new Map(report.payments.filter((p) => p.status === 'succeeded').map((p) => [p.providerRef, p]));
  const ours = new Map(local.map((t) => [t.providerRef, t]));
  const result: ReconciliationResult = { date, matched: 0, missingLocally: [], missingAtProvider: [], amountMismatches: [] };

  for (const [ref, p] of theirs) {
    const t = ours.get(ref);
    if (!t) {
      result.missingLocally.push({ providerRef: ref, amountMinor: p.amountMinor, currency: p.currency });
    } else if (t.amountMinor !== p.amountMinor || t.currency !== p.currency) {
      result.amountMismatches.push({
        providerRef: ref,
        ourAmountMinor: t.amountMinor,
        providerAmountMinor: p.amountMinor,
        ourCurrency: t.currency,
        providerCurrency: p.currency,
      });
    } else {
      result.matched++;
    }
  }
  for (const [ref, t] of ours) {
    if (!theirs.has(ref)) result.missingAtProvider.push({ providerRef: ref, amountMinor: t.amountMinor, currency: t.currency });
  }
  return result;
}
