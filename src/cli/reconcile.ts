import { readFileSync } from 'node:fs';
import { parseEnv } from '../config/env';
import { openDb } from '../database/connection';
import { ProviderReport, reconcile } from '../reconciliation/reconcile';
import { TopupsCore } from '../topups/topups.core';

const [date, reportPath] = process.argv.slice(2);
if (!date || !reportPath) {
  console.error('Usage: npm run reconcile -- <YYYY-MM-DD> <provider-report.json>');
  process.exit(2);
}
const report = ProviderReport.parse({ ...JSON.parse(readFileSync(reportPath, 'utf8')), date });
const db = openDb(parseEnv().DB_PATH);
const result = reconcile(date, new TopupsCore(db).succeededOn(date), report);
console.log(JSON.stringify(result, null, 2));
const bad = result.missingLocally.length + result.missingAtProvider.length + result.amountMismatches.length;
process.exit(bad ? 1 : 0);
