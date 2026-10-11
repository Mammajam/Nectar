/** Create Bee to-dos with alarms for open commitments that have none:  npm run schedule */
import { describeScheduled } from '../src/actions/report.js';
import { TodoScheduler } from '../src/actions/scheduler.js';
import { BeeCli } from '../src/bee/cli.js';
import { BeeClient } from '../src/bee/client.js';
import { ensureProxy } from '../src/bee/proxy.js';
import { loadConfig } from '../src/config.js';
import { loadDotEnv } from '../src/env.js';
import { Store } from '../src/store/db.js';

loadDotEnv();
const config = loadConfig();
const store = new Store(config.dbPath);
const proxy = await ensureProxy(config.beeBin, config.proxyPort);
try {
  const results = await new TodoScheduler(new BeeClient(proxy.url), new BeeCli(config.beeBin), store, {
    timezone: config.timezone,
    leadMs: config.alarmLeadMs,
    workdayStartHour: config.workdayStartHour,
    sameDayCutoffHour: config.sameDayCutoffHour,
  }).scheduleAll();
  if (results.length === 0) console.log('Nothing to schedule.');
  results.forEach((r) => console.log(describeScheduled(r, new Date(), config.timezone)));
} finally {
  proxy.stop();
  store.close();
}
