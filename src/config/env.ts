import { z } from 'zod';

/** Test-only default so the project runs out of the box. Rejected in production. */
export const DEV_WEBHOOK_SECRET = 'test_whsec_local_only';

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DB_PATH: z.string().min(1).default('./data/wallet.db'),
    PROVIDER_WEBHOOK_SECRET: z.string().min(16, 'must be at least 16 characters').default(DEV_WEBHOOK_SECRET),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.PROVIDER_WEBHOOK_SECRET === DEV_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['PROVIDER_WEBHOOK_SECRET'],
        message: 'the development default must not be used in production',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/** Validates raw environment variables, failing fast with a readable message. Also used by the CLI scripts. */
export function parseEnv(raw: Record<string, unknown> = process.env): Env {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${detail}`);
  }
  return parsed.data;
}
