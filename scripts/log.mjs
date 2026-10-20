// Append a timestamped line to tracking/log.md.  Usage: node scripts/log.mjs "message"
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/paths.mjs';

const d = new Date();
const p = (n) => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
appendFileSync(join(ROOT, 'tracking', 'log.md'), `- ${stamp} — ${process.argv.slice(2).join(' ')}\n`);
