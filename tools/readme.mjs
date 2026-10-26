/**
 * tools/readme.mjs — README.md পুনরুত্পাদক (`npm run readme`); সাইট-বিল্ডের অংশ নয়।
 *
 * কেন: README-র টেবিল, ফ্রেম-ডেটা, অধ্যায়-তালিকা আর ব্যাজের সংখ্যা হাতে লিখলে
 * সেগুলো এক সপ্তাহ পরে মিথ্যা হয়ে যায়। এখানে সব `content/chapters.json`,
 * `src/frames.ts`, `tools/validate.mjs`, `tests/` ও `docs/` থেকে আসে — তাই
 * ইঞ্জিন বদলালে README নিজেই বদলায়। সম্পাদনা = tools/readme-template.md বদলানো।
 *
 * গুরুত্বপূর্ণ: বাংলা অঙ্ক হাতে লেখা হয় না। টেমপ্লেটে যা-ইচ্ছা ল্যাটিন অঙ্কে
 * «…»-এর ভেতর লিখুন (বা শুধু %%VAR%%), এখানে সেগুলো ০-৯ কোডপয়েন্ট থেকে বসে যায়;
 * `img.shields.io` লাইনে অঙ্ক ল্যাটিনই থাকে (না হলে ব্যাজ-URL ভাঙে)।
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const rd = (p) => readFileSync(new URL(p, root), 'utf8');
const kb = (p) => Math.round(statSync(new URL(p, root)).size / 1024);
const toBn = (s) => String(s).replace(/[0-9]/g, (d) => String.fromCodePoint(0x9e6 + Number(d)));
const NUM = /^-?\d+(\.\d+)?$/;

// ── ইতিহাস-সামগ্রী ───────────────────────────────────────────────────────────
const doc = JSON.parse(rd('content/chapters.json'));
const ch = doc.chapters;
const flat = (k) => ch.reduce((n, c) => n + (c[k]?.length ?? 0), 0);
const cards = ch.flatMap((c) => c.cards);
const V = {
  span: `«${doc.meta.span[0]}»–«${doc.meta.span[1]}»`,
  chapters: ch.length,
  cards: cards.length,
  quiz: flat('quiz'),
  tactics: flat('tactics'),
  disputed: cards.filter((c) => c.views).length,
  syncretism: cards.filter((c) => (c.tags ?? []).includes('syncretism')).length,
  srcs: new Set(cards.flatMap((c) => c.sources ?? [])).size,
  legend: Object.keys(doc.meta.sources_legend).length,
  first_title: ch[0].title_bn,
  first_years: ch[0].years_bn.replace('আনুমানিক ', ''),
  duels: ch.filter((c) => c.fight_bn).length,
  waves: ch.reduce((n, c) => n + (c.fight_bn?.waves ?? 0), 0),
};

// ── ইঞ্জিন: ফ্রেম-ডেটা, টেমপ্লেটে হাতে লেখা হয় না ─────────────────────────────
const fr = rd('src/frames.ts');
const NUMF = {
  PARRY_WINDOW: 8, RESOLVE_COST: 10, MAX_HP: 24, MAX_GUARD: 10, GUARD_BREAK_STUN: 46,
};
for (const k of Object.keys(NUMF)) NUMF[k] = Number(fr.match(new RegExp(`${k} = (\\d+)`))[1]);
const MOVE_RE = /id: '(\w+)', bn: '([^']+)', startup: (\d+), active: (\d+), recovery: (\d+),\s*reach: (\d+), dmg: (\d+), guardDmg: (\d+), hitstun: (\d+), blockstun: (\d+)/g;
const moves = {};
for (const m of fr.matchAll(MOVE_RE)) {
  const [, id, bn, su, ac, re, reach, dmg, gd, hs, bs] = m;
  const met = Number(fr.match(new RegExp(`id: '${id}'[\\s\\S]*?meter: (-?\\d+)`))[1]);
  moves[id] = { bn, su, ac, re, reach, dmg, gd, hs, bs, met };
}
const dash = (v) => (v === '0' ? '—' : `«${v}»`);
V.frame_rows = ['cut', 'heavy', 'thrust', 'guard', 'side', 'resolve']
  .map((id) => {
    const m = moves[id];
    return `| ${m.bn} | «${m.su}» / «${m.ac}» / «${m.re}» | ${dash(m.reach)} | ${dash(m.dmg)} | ${dash(m.gd)} | ${dash(m.hs)} | ${dash(m.bs)} | ${m.met > 0 ? `«+${m.met}»` : m.met < 0 ? `«${m.met}»` : `«−${NUMF.RESOLVE_COST}»`} |`;
  })
  .join('\n');
Object.assign(V, Object.fromEntries(Object.entries(NUMF).map(([k, v]) => [k.toLowerCase(), v])));  // টেমপ্লেটে %%max_hp%% ছোট-হরফেই ধরা হয়

// ── অধ্যায়ের টেবিল ───────────────────────────────────────────────────────────
V.ch_table = ch
  .map((c) => {
    const obj = c.fight_bn ? c.fight_bn.duel_bn.split('—')[0].trim() : '—';
    const age = (c.bearer_bn.role_bn.match(/(\p{Nd}+) বছরের/u) ?? [])[1];
    return `| «${c.id}» | ${c.title_bn} | ${c.years_bn.replace('আনুমানিক ', '')} | ${c.bearer_bn.name_bn}${age ? `, «${age}»` : ''} | ${c.fight_bn ? `«${c.fight_bn.waves}»` : '—'} | ${obj} | «${c.cards.length}» | «${c.quiz.length}» |`;
  })
  .join('\n');

// ── যাচাই-নিয়ম, টেস্ট, সাইজ ─────────────────────────────────────────────────
V.rules = [...new Set([...rd('tools/validate.mjs').matchAll(/(?:err|warn)\('([a-z-]+)'/g)].map((m) => m[1]))].sort();
V.rule_list = V.rules.map((r) => `\`${r}\``).join(', ');
V.rules = V.rules.length;
const perFile = {};
for (const f of readdirSync(new URL('tests/', root)).sort()) {
  perFile[f.replace('.test.ts', '')] = (rd(`tests/${f}`).match(/^test\(/gm) ?? []).length;
}
V.tf = perFile.frames; V.ts = perFile.sim; V.td = perFile['dom-smoke']; V.tfeel = perFile.feel ?? 0;
V.tests = Object.values(perFile).reduce((n, v) => n + v, 0);
const fontFiles = readdirSync(new URL('docs/fonts/', root));
const size = (f) => kb(`docs/fonts/${f}`);
V.f_hind = size(fontFiles.find((f) => /hind-.*400/.test(f)));
V.f_hind7 = size(fontFiles.find((f) => /hind-.*700/.test(f)));
V.f_noto = size(fontFiles.find((f) => /bengali-400/.test(f)));
V.f_noto7 = size(fontFiles.find((f) => /bengali-700/.test(f)));
V.fonts_kb = V.f_hind + V.f_hind7 + V.f_noto + V.f_noto7;
const gameFiles = ['docs/index.html', 'docs/app.js', 'docs/styles.css', 'docs/fonts.css', 'docs/sw.js', 'docs/content/chapters.json']
  .concat(fontFiles.map((f) => `docs/fonts/${f}`));
V.game_mb = (gameFiles.reduce((n, p) => n + statSync(new URL(p, root)).size, 0) / 1048576).toFixed(2);
// সাইটের ফাইলের স্থির-তালিকা — `docs/` হেঁটে বেড়ানো যায় না, কারণ CI-তে এই ধাপের
// সময়ে `content-preview.html` এখনও তৈরি-ই হয়নি (preview আলাদা ধাপ)। হাঁটলে সংখ্যা
// লোকালে ও CI-তে আলাদা বেরোত, আর `README তাজা` ধাপটা অর্থহীন ভাবে লাল হতো।
V.docs_mb = (gameFiles.concat('docs/design-khadga.md')
  .reduce((n, p) => n + statSync(new URL(p, root)).size, 0) / 1048576).toFixed(2);
V.json_kb = kb('content/chapters.json');
V.hero_kb = kb('assets/hero.jpg');

// ── রেন্ডার ──────────────────────────────────────────────────────────────────
let out = [];
for (let line of rd('tools/readme-template.md').split('\n')) {
  const latin = line.includes('img.shields.io');   // ব্যাজ-URL: অঙ্ক ল্যাটিন থাকবে
  for (const ph of new Set([...line.matchAll(/%%([A-Za-z0-9_]+)%%/g)].map((m) => m[1]))) {
    if (ph === 'NAV') continue;
    if (!(ph.toLowerCase() in V)) throw new Error(`%%${ph}%%-এর মান নেই`);
    let v = String(V[ph.toLowerCase()]);
    if (!latin && NUM.test(v)) v = `«${v}»`;
    line = line.split(`%%${ph}%%`).join(v);
  }
  out.push(line);
}
out = out.join('\n');

// ন্যাভিগেশন হেডিং থেকেই — কোনো লিংক ভিত্তিহীন হতে পারে না
const heads = [...out.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
const slug = (t) => t.trim().toLowerCase().replace(/\s+/g, '-');
for (const h of heads) {
  if (!/^[\w\u0980-\u09FF -]+$/.test(h)) throw new Error(`হেডিং-এ অপ্রত্যাশিত অক্ষর: ${h}`);
}
out = out.replace('%%NAV%%', heads.map((h) => `<a href="#${slug(h)}">${h}</a>`).join(' · '));

for (let prev; out.includes('«') && out !== prev; ) {   // বাসা-সাজানো মার্কারও খুলবে
  prev = out;
  out = out.replace(/«([^»]*)»/g, (_, g) => toBn(g));
}
if (/[«»]|%%/.test(out)) throw new Error('অপূর্ণ মার্কার থেকে গেছে');

// মার্কডাউন-স্বাস্থ্য: প্রতিটি টেবিলের কলাম-সংখ্যা সমান, URL-এ বাংলা অঙ্ক নয়
for (const block of out.matchAll(/(?:^\|.*\|\n)+/gm)) {
  const cols = new Set(block[0].trim().split('\n').map((l) => l.split('|').length - 2));
  if (cols.size !== 1) throw new Error(`কলাম অমিল (${[...cols].join(',')}) ${block[0].split('\n')[0].slice(0, 50)}`);
}
for (const u of out.matchAll(/https?:\/\/\S+/g)) {
  if (/[০-৯]/.test(u[0])) throw new Error(`URL-এ বাংলা অঙ্ক: ${u[0]}`);
}
writeFileSync(new URL('README.md', root), out.replace(/\s+$/, '') + '\n');
console.log(`README.md ← ${out.split('\n').length} লাইন, ${Buffer.byteLength(out)} বাইট`);
