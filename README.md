# Wallet and payments service

NestJS + TypeScript + SQLite (`better-sqlite3`). Wallets hold one currency (NGN or USD), money is whole minor units, and every movement is a double-entry ledger entry. Balances are always derived from the ledger.

## Run it

```bash
npm install
npm test                 # 41 tests, includes real multi-connection concurrency races
npm run typecheck
npm start                # builds, then runs http://localhost:3000 with the DB at ./data/wallet.db
```

Reconciliation demo (made-up provider report in `fixtures/provider-report.json`):

```bash
npm run demo:seed        # (writes data/demo.db, never DB_PATH) builds data/demo.db matching the fixture, with one of each discrepancy
DB_PATH=./data/demo.db npm run reconcile -- 2026-11-26 fixtures/provider-report.json   # exits 1 on any discrepancy
```

### API

| Endpoint | Purpose |
|---|---|
| `POST /users` `{id, currency}` | Create user and wallet |
| `GET /wallets/:userId` | Balance (derived from ledger) |
| `POST /transfers` + `Idempotency-Key` header | `{fromUserId, toUserId, amountMinor, currency}` |
| `POST /topups` `{userId, amountMinor, currency}` | Pending top-up with a provider reference |
| `POST /webhooks/provider` + `X-Signature` | Provider events, HMAC-SHA256 hex of the raw body |
| `POST /reconciliation` | Body is the provider's report for a day; returns the three discrepancy lists |

### API docs (Swagger)

With the server running, open http://localhost:3000/docs (raw OpenAPI JSON at `/docs-json`). Request schemas are generated from the same zod validators the endpoints use, so docs and validation cannot drift. Each endpoint lists its error codes, and the transfer and webhook endpoints show the required `Idempotency-Key` and `X-Signature` headers. Disabled when `NODE_ENV=production`.

### Configuration

Copy `.env.example` to `.env` (loaded by `@nestjs/config`; real environment variables win). Every variable is validated with a zod schema in `src/config/env.ts` at startup, so bad config fails fast with a readable message.

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | 1 to 65535 |
| `DB_PATH` | `./data/wallet.db` | SQLite file, or `:memory:` |
| `PROVIDER_WEBHOOK_SECRET` | `test_whsec_local_only` | At least 16 characters. The default is refused when `NODE_ENV=production` |

Webhook test secret: `test_whsec_local_only`. Sign a payload with
`printf '%s' "$BODY" | openssl dgst -sha256 -hmac test_whsec_local_only`.

Error codes: `VALIDATION_ERROR` 400, `IDEMPOTENCY_KEY_REQUIRED` 400, `INVALID_SIGNATURE` 401, `USER_NOT_FOUND` 404, `USER_EXISTS` 409, `IDEMPOTENCY_KEY_REUSED` 409, `SAME_WALLET` 422, `CURRENCY_MISMATCH` 422, `INSUFFICIENT_FUNDS` 422.

## Design decisions

**Ledger.** `ledger_entries` rows each name one debit account and one credit account for the same positive amount, so the books balance by construction. There are wallet accounts plus per-currency `provider_clearing` and `refund_receivable` system accounts. Top-up: debit clearing, credit wallet. Balance is `SUM(credits) - SUM(debits)` (view `account_balances`); nothing stores a balance that could be edited. The ledger is append-only (triggers block UPDATE and DELETE).

**No overdraws (the concurrency answer).** SQLite has a single writer. Every money-moving operation runs in `BEGIN IMMEDIATE`, which takes the write lock before any read. The balance check and the insert therefore happen under the same lock, and a second transfer from the same wallet waits, then sees the first one's debit. Two further layers: a database trigger refuses any entry that would take a user wallet below zero, and the tests prove the race with 8 and 20 `worker_threads`, each with its own connection, released together by a barrier. I checked the test is sensitive: switching to a deferred transaction makes it fail.

**Idempotency.** The key, request hash (over a fixed field order, so JSON key order is irrelevant), the transfer, and the stored response commit in one transaction. A duplicate arriving mid-flight waits for the lock, then reads the stored response, so it gets exactly the first response; there is no half-finished state to observe. Same key with a different body is 409. Business refusals (422, 404) are stored too, so a retry gets the same answer; unexpected 5xx errors are not stored, so the client may retry. Replays carry an `Idempotent-Replayed: true` header.

**Webhook.** The HMAC is computed over the raw bytes (`rawBody: true`), compared with `timingSafeEqual`, in a guard that runs before parsing the event. The event id is inserted (primary key) and the effect applied in one short transaction, then we answer 200. There are no outbound calls, so it is fast. Duplicates return 200 and do nothing. Unknown references return 200 too (so the provider stops retrying) and are kept in `webhook_events` for investigation.

**Out of order events.** State is derived rather than dependent on arrival order. A refund that arrives before success is parked (`awaiting_success`) and nothing is credited or clawed back. When success arrives the wallet is credited once (the ledger reference `topup:<id>:credit` is UNIQUE and status flips from `pending` in the same transaction), then parked refunds are applied. The end state matches normal order. A success after a failure is ignored. Refunds that would total more than the top-up are rejected and recorded.

**Partial refund after the money is spent.** We claw back `min(refund, current balance)` from the wallet and book the shortfall as a debit on `refund_receivable` (credit clearing). Why: the provider has already taken the money from us, so we cannot refuse the refund, and our books must match theirs. Wallets must never go negative, and we should not take money the user no longer has or touch the recipient's funds. The loss stays visible as a receivable the business can recover, for example by netting against the user's next top-up. This is a product and risk decision, so it is easy to change in `WebhooksCore.applyRefund`.

**Reconciliation.** `reconcile()` is a pure function keyed on provider reference. "Day" is the UTC day we credited the top-up. It compares gross amounts, so refunds do not create mismatches. Provider rows with a non-succeeded status are ignored. A top-up that succeeded just either side of midnight can show up as a false discrepancy; production would compare on the provider's settlement date.

**Money.** `INTEGER` minor units end to end. The API rejects floats, zero, negatives, strings, and integers above `Number.MAX_SAFE_INTEGER`.

**Structure.** Money logic lives in framework-free `*.core.ts` classes that take a DB handle. Each feature has a thin `@Injectable()` service wrapping its core, a controller, and a module, as the Nest docs describe. Config goes through `ConfigModule` with a zod schema, DI tokens are Symbols, and `enableShutdownHooks()` closes the SQLite handle on shutdown. `npm start` runs the compiled build because Nest's constructor injection needs decorator metadata, which `tsx` (esbuild) does not emit. This is what lets the concurrency test run real parallel connections without booting Nest.

## What I would change for production

- PostgreSQL. Lock the wallet row (`SELECT ... FOR UPDATE`) or take a per-wallet advisory lock inside the transaction, always in account id order to avoid deadlocks; keep the trigger or a deferred constraint as a backstop. Idempotency becomes insert-first with an `in_progress` state: duplicates either wait on the row lock or get a 409 with `Retry-After`. Add key expiry.
- Webhooks: verify, persist, enqueue, and answer immediately; process on a worker with retries and a dead-letter queue. Check a timestamp in the signed payload to limit replay, and support secret rotation.
- Authentication and authorisation on every route (today any caller can move money from any wallet), rate limiting, request size limits.
- Reconciliation on a schedule with alerting, settlement-date matching, and refund-aware totals. A workflow to recover receivables.
- Money in `BIGINT` with string transport past 2^53, FX as an explicit separate flow, migrations tooling, structured logs and metrics, an outbox for events leaving the service.

## Split-bill payments at Local

At Local, each diner's share of a split bill is its own payment, charged to that diner, and it is applied to the bill only once the charge is `completed`; the charge itself happens before this step. Applying a payment is asynchronous: it is recorded as `pending` and queued in one database transaction, so the diner never waits. Three split cases are handled. An equal share takes a proportional part of every bill the table owes, so paying the whole amount settles each bill exactly and the rounding remainder is placed so the parts add up to the minor unit. A pay-by-item share goes only to the bills holding the items that diner chose, so nobody settles another diner's bill. A table that has added items, and so has several bills, is covered by the same proportional rule. Amounts are decimal strings converted to minor units (base plus tax, less any overpaid part), the tip rides on the first share, and the platform's service fee is never applied to the bill. The parts of a payment are decided once and stored, and each carries its own stable idempotency id, so a retry never changes an amount or applies one twice. When a share fails, the other diners' payments stand, because each is tracked on its own. A temporary failure is retried for about a minute, then parked with exponential backoff and re-queued by a sweep, reading the bill before every attempt. A share that stays unresolved past the give-up time is kept as `failed` and raises an alert for a person; a closed bill, or one that owes less than the share, fails at once for the same reason, and an applied payment that cannot be read back is flagged as unconfirmed rather than retried blindly. One trade-off is deliberate: a table's payments are applied in the order accepted, so a parked share holds back later ones at that table until it clears or fails. A failed card charge is handled upstream, and a payment that never reaches `completed` is never applied.
