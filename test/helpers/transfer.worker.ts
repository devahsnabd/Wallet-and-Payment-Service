import { parentPort, workerData } from 'node:worker_threads';
import { openDb } from '../../src/database/connection';
import { TransfersCore } from '../../src/transfers/transfers.core';

/**
 * One worker = one independent SQLite connection, as if it were a separate server process.
 * All workers block on a barrier and are released together to maximise the chance of overlap.
 */
const { dbPath, key, fromUserId, toUserId, amountMinor, currency, barrier } = workerData;
const db = openDb(dbPath);
const core = new TransfersCore(db);
const flags = new Int32Array(barrier as SharedArrayBuffer);
Atomics.add(flags, 0, 1); // ready
Atomics.wait(flags, 1, 0); // wait for go
const result = core.execute(key, { fromUserId, toUserId, amountMinor, currency });
parentPort!.postMessage({ status: result.status, body: result.body });
db.close();
