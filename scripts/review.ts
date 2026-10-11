/**
 * Run the evening review now.
 *   npm run review              sync from Bee, carry over open items, send summary to the wrist
 *   npm run review -- --dry-run report only; change nothing
 */
import { describeReview } from '../src/actions/report.js';
import { EveningReview } from '../src/actions/review.js';
import { BeeClient } from '../src/bee/client.js';
import { ensureProxy } from '../src/bee/proxy.js';
import { loadConfig } from '../src/config.js';
import { loadDotEnv } from '../src/env.js';
import { Store } from '../src/store/db.js';

loadDotEnv();
const config = loadConfig();
const dryRun = process.argv.includes('--dry-run');
const store = new Store(config.dbPath);
const proxy = await ensureProxy(config.beeBin, config.proxyPort);
try {
  const report = await new EveningReview(new BeeClient(proxy.url), store, {
    timezone: config.timezone,
    workdayStartHour: config.workdayStartHour,
    leadMs: config.alarmLeadMs,
    notify: config.createTodos,
    dryRun,
  }).run();
  describeReview(report).forEach((l) => console.log(l));
  if (dryRun) console.log('(dry run: nothing changed)');
} finally {
  proxy.stop();
  store.close();
}
