/**
 * tools/playtest.mjs — "পাতাটা সত্যিই খেলা যায়?" প্রশ্নের উত্তর পরীক্ষা নয়, খেলা।
 *
 * প্রতিটি অধ্যায়ে আসল `src/sim.ts`-এ ঢেউ/দ্বন্দ্ব চালানো হয়, একটি নীতিমালার
 * (policy) খেলোয়াড় হাত-পা নাড়ায়, কার্ড তোলে, প্রশ্নের উত্তর দেয়। যত-বার
 * হেরেছে/জেতে — সেটাই এখানে ফল। কোনো DOM, কোনো বিল্ড-জাদু ছাড়াই।
 *
 *     npm run playtest          # ৯ অধ্যায় × ৩ খেলা
 *
 * সীমাবদ্ধতা (সৎ থাকার জন্য): এটা রোবটের হাতের-অনুভব নাপা — ফ্রেম-রেট, স্পর্শ
 * নিয়ন্ত্রণ, চোখের আরাম এখানে মাপা যায় না। তার জন্য আসল ব্রাউজার দরকার।
 */
import { readFileSync } from 'node:fs';
const { Sim, emptyInput } = await import('../src/sim.ts');
const { MAX_GUARD } = await import('../src/frames.ts');
const doc = JSON.parse(readFileSync(new URL('../content/chapters.json', import.meta.url), 'utf8'));

const REACH = 62;
/** একটি দক্ষ খেলোয়াড়: দূরত্ব-ও-গভীরতা মিলিয়ে চাপ, ঢাল ভাঙো, সংকল্প খাটাও, সত্যি দাও। */
function policy(sim, lastQ) {
  const inp = emptyInput();
  const p = sim.player;
  const foes = sim.enemies.filter((e) => e.alive);
  const foe = foes.sort((a, b) => Math.abs(a.x - p.x) + Math.abs(a.y - p.y) - Math.abs(b.x - p.x) - Math.abs(b.y - p.y))[0];
  if (foe) {
    const dx = foe.x - p.x, dy = foe.y - p.y;
    const ad = Math.abs(dx);
    if (ad > REACH - 10) inp.moveX = dx > 0 ? 1 : -1;          // দূরত্ব পূরো
    else if (ad < 14) inp.moveX = dx > 0 ? -1 : 1;              // ওপরে উঠে পড়লে এক পা পিছু (নাহলে আঘাত ফাঁকা যায়)
    if (Math.abs(dy) > 8) inp.moveY = dy > 0 ? 1 : -1;
    if (ad <= REACH - 4 && ad >= 14 && Math.abs(dy) <= 12 && p.actionable) {
      inp.pressed = p.meter >= 100 ? 'resolve' : (foe.guard > MAX_GUARD * 0.55 ? 'heavy' : 'cut');
    }
  }
  const obj = sim.objective;
  if (obj && obj.hp > 0) {                                   // লক্ষ্য বিপদে ডাকলে ধাওয়া
    const threat = foes.find((e) => Math.abs(e.x - obj.x) < 120);
    if (threat && Math.abs(threat.x - p.x) > 90) {
      const d = threat.x - p.x;
      if (!inp.moveX) inp.moveX = d > 0 ? 1 : -1;
    }
  }
  if (sim.duel?.question) inp.answer = sim.duel.question.answer;
  else if (lastQ && (sim.duel?.cooldown ?? 0) > 0) inp.parryAnswer = lastQ.answer;
  return inp;
}

function run(ch, mode, seed) {
  const sim = new Sim(ch, doc.meta, mode, seed, new Map());
  for (const c of ch.cards) sim.readCard(c.id);            // ব্রিফিং-কার্ড পড়া খেলোয়াড়
  let t = 0, answers = 0, asked = 0, lastQ = null;
  const cap = sim.timeLeft + 900;                      // অধ্যায়-দৈর্ঘ্য + স্বস্তির মার্জিন
  while (!sim.over && t < cap) {
    const evs = sim.step(policy(sim, lastQ));
    t++;
    for (const ev of evs ?? []) {
      if (ev.t === 'question') { asked++; lastQ = ev.q; }
      if (ev.t === 'answered') { if (ev.correct) answers++; }
    }
    if (t % 30 === 0) for (const c of ch.cards) if (!sim.readCards.has(c.id) && Math.abs(c.id.length) > 0) sim.readCard(c.id);
    for (const f of [sim.player, ...sim.enemies, ...(sim.ally ? [sim.ally] : [])]) {
      if (!Number.isFinite(f.x) || !Number.isFinite(f.hp)) return { bad: `NaN অবস্থা (t=${t}, ${f.name_bn})` };
      if (t > cap - 1 && !sim.over) return { bad: `সময়-শেষেও over সেট হয়নি (timeLeft=${Math.round(sim.timeLeft)})` };
    }
  }
  return { over: sim.over, t, answers, asked, why: sim.loseWhy_bn, hp: Math.round(sim.player.hp), objHp: sim.objective?.maxHp ? Math.round(sim.objective.hp) : null, truths: sim.duel?.truths ?? null };
}

const rows = [];
const skip = [];
for (const ch of doc.chapters) {
  const modes = ch.fight_bn ? ['wave', 'duel'] : [];   // লড়াই-বিহীন অধ্যায় (০) বাদ
  for (const mode of modes) {
    const eps = [1, 2, 3].map((s) => run(ch, mode, s * 977 + ch.id));
    const bad = eps.find((e) => e.bad);
    if (bad) { rows.push({ id: ch.id, title: ch.title_bn, mode, win: '✗ ' + bad.bad }); continue; }
    const wins = eps.filter((e) => e.over === 'win').length;
    rows.push({
      id: ch.id, title: ch.title_bn, mode, win: `${wins}/${eps.length}`,
      t: Math.round(eps.reduce((a, e) => a + e.t, 0) / eps.length),
      ans: eps.reduce((a, e) => a + e.answers, 0),
      card: eps.reduce((a, e) => a + e.asked, 0),
      extra: mode === 'duel' ? `সত্যি ${eps.map((e) => e.truths).join('/')}` : `লক্ষ্য-HP ${eps.map((e) => e.objHp).join('/')}`,
    });
  }
}
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 0x9fff ? 2 : 1), 0)));
console.log(`\nঅধ্যায়  ধরন    জয়    ফ্রেম  উত্তর  কার্ড  বিবরণ`);
for (const r of rows) {
  console.log(`${pad(r.id + ' ' + r.title.slice(0, 14), 22)}${pad(r.mode, 7)}${pad(r.win, 6)}${pad(r.t ?? '-', 6)}${pad(r.ans ?? '-', 7)}${pad(r.card ?? '-', 6)}${r.extra ?? ''}`);
}
const tot = rows.length, ok = rows.filter((r) => /^\d+\/\d+$/.test(r.win) && Number(r.win[0]) > 0).length;
console.log(`\n${ok}/${tot} লড়াই-ধরনে অন্তত একবার জয় হয়েছে (রোবট, ৩ বারের মধ্যে)।`);
console.log('যা এতে মাপা হয় না: ফ্রেম-রেট, স্পর্শ-নিয়ন্ত্রণের অনুভূতি, শব্দ, চোখের আরাম।');
if (ok < tot) { console.log('✗ যেসব ধরনে রোবট একবারও জিততে পারেনি — হয় খুব কঠিন, নয় নীতিমালা দুর্বল; মানুয়ে খেলে দেখুন।'); }
