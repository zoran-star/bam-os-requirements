import { readFileSync } from 'fs';
const html = readFileSync('bam-portal/public/client-portal.html', 'utf8');
const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
let ok = true;
for (const s of scripts) {
  const code = s.replace(/<\/?script[^>]*>/gi, '');
  if (!code.trim()) continue;
  try { new Function(code); } catch(e) { console.log('JS error:', e.message.slice(0, 200)); ok = false; }
}
if (ok) console.log('JS syntax OK');
else process.exit(1);
