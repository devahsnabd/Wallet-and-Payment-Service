import { z } from 'zod';

export const CURRENCIES = ['NGN', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const zAmountMinor = z.number().int().safe().positive();
export const zCurrency = z.enum(CURRENCIES);
