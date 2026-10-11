/** Print commitments stored by Nectar:  npm run commitments [-- --all] */
import { loadConfig } from '../src/config.js';
import { loadDotEnv } from '../src/env.js';
import { Store, type CommitmentStatus } from '../src/store/db.js';

loadDotEnv();
const config = loadConfig();
const store = new Store(config.dbPath);
const statuses: CommitmentStatus[] = process.argv.includes('--all') ? ['open', 'suggested', 'done', 'dismissed'] : ['open', 'suggested'];
const rows = store.listCommitments(statuses);
if (rows.length === 0) console.log('No commitments yet.');
for (const c of rows) {
  const due = c.dueAt ? new Date(c.dueAt).toLocaleString('en-GB', { timeZone: config.timezone }) : 'no time';
  console.log(`#${c.id} [${c.status}] ${c.what}${c.who ? ` -> ${c.who}` : ''} | ${due} | ${Math.round(c.confidence * 100)}%`);
  console.log(`     "${c.quote}"`);
}
store.close();
