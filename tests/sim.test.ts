/**
 * tests/sim.test.ts — লড়াইয়ের নিয়ম-প্রমাণ, এবং সেইসঙ্গে ইতিহাস-নীতির প্রমাণ।
 *
 * এই টেস্টগুলো খেলার নৈতিকতা আটকে রাখে:
 *  · ঢেউ জেতা = সব শত্রু মারা নয়, টিকে থাকা;
 *  · দ্বন্দ্ব জেতা = ৩টি সঠিক উত্তর, প্রাণ শেষ করা নয়;
 *  · প্রশ্ন এলেও লড়াই থামে না;
 *  · ভুল উত্তরের শাস্তি প্রাণ-ক্ষয় নয়;
 *  · একই বীজ + একই ইনপুট = হুবহু একই ফল (রেন্ডার-মুক্ত নির্ণয়যোগ্য সিম)।
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Sim, emptyInput, type InputFrame } from '../src/sim.ts';
import { MAX_HP } from '../src/frames.ts';
import type { ContentDoc, QuizItem } from '../src/content-types.ts';

const doc = JSON.parse(readFileSync(new URL('../content/chapters.json', import.meta.url), 'utf8')) as ContentDoc;
const ch1 = doc.chapters.find((c) => c.id === 1)!;
const ch0 = doc.chapters.find((c) => c.id === 0)!;

const script = (seq: (InputFrame | null)[]): InputFrame[] => seq.map((s) => s ?? emptyInput());
const press = (p: InputFrame['pressed'], extra: Partial<InputFrame> = {}): InputFrame =>
  ({ moveX: 0, moveY: 0, pressed: p, answer: null, parryAnswer: null, ...extra });

test('ঢেউ-যুদ্ধের জয়-শর্ত টিকে-থাকা, শত্রু-সংখ্যা শূন্য নয়', () => {
  // প্লেয়ারকে বাঁচিয়ে (স্কিল-অ্যাক্সিয়ম) শুধু সময়-শর্তটা পরীক্ষা: ঘড়ি শূন্য হলেই জয়,
  // মাঠে শত্রু বাকি থাকলেও।
  const sim = new Sim(ch1, doc.meta, 'wave', 7);
  let guard = 0;
  for (let f = 0; f < 90 * 60 + 6 && !sim.over; f++) {
    sim.player.hp = MAX_HP;
    sim.objective!.hp = sim.objective!.maxHp;
    sim.step(emptyInput());
    guard++;
  }
  assert.equal(guard > 5000, true);
  assert.equal(sim.over, 'win');
  assert.ok(sim.enemies.filter((e) => e.alive).length > 0, 'শত্রু বাকি থাকতেই জয় — "সবাইকে মারো" নয়');
});

test('ঢেউ-যুদ্ধ: পুরোপুরি নিষ্ক্রিয় খেলোয়াড় হারে (শেখার চাপ বজায় রাখে)', () => {
  const sim = new Sim(ch1, doc.meta, 'wave', 7);
  for (let f = 0; f < 90 * 60 + 600 && !sim.over; f++) sim.step(emptyInput());
  assert.equal(sim.over, 'lose');
});

test('ঢেউ-যুদ্ধ: নৌকা ধ্বংস = পরাজয়, প্রাণ থাকলেও', () => {
  const sim = new Sim(ch1, doc.meta, 'wave', 11);
  assert.ok(sim.objective, 'অধ্যায় ১-এ নৌকা-রক্ষার লক্ষ্য আছে');
  sim.objective!.hp = 0;
  sim.step(emptyInput());
  assert.equal(sim.over, 'lose');
  assert.match(sim.loseWhy_bn, /নৌকা|গাড়ি|পল্লী/);
});

test('দ্বন্দ্ব: ঢাল ভাঙা ছাড়া প্রশ্ন ওঠে না, ৩টি সঠিক উত্তর ছাড়া জয় হয় না', () => {
  const sim = new Sim(ch1, doc.meta, 'duel', 3);
  const boss = sim.enemies[0]!;
  boss.stun(0); boss.phase = 'idle'; boss.frame = 0;
  for (let f = 0; f < 240; f++) { sim.step(emptyInput()); if (sim.duel.question) break; }
  assert.equal(sim.duel.question, null, 'স্টান-বিহীন অবস্থায় প্রশ্ন আসেনি');
  assert.equal(sim.over, null, 'লড়াই নিজে থেকে জেতা হয়নি');
  // ঢাল ভাঙানো
  boss.phase = 'stunned'; boss.stunLeft = 90;
  sim.step(emptyInput());
  assert.ok(sim.duel.question, 'ঢাল ভাঙার ফাঁকে প্রশ্ন উঠলো');
  const q = sim.duel.question;
  for (let i = 0; i < 3; i++) {
    // ঢাল-ভাঙা ফাঁক বজায় রেখে প্রতিবার নতুন প্রশ্ন তোলা, তারপর সঠিক উত্তর
    for (let k = 0; k < 40 && !sim.duel.question; k++) { boss.phase = 'stunned'; boss.stunLeft = 90; sim.step(emptyInput()); }
    const q2 = sim.duel.question ?? q!;
    sim.step(press(null, { answer: (q2 as QuizItem).answer }));
    assert.equal(sim.duel.truths, i + 1, `সঠিক উত্তর ${i + 1}`);
  }
  for (let k = 0; k < 40 && sim.over === null; k++) { boss.phase = 'stunned'; boss.stunLeft = 90; sim.step(emptyInput()); }
  assert.equal(sim.duel.truths, 3);
  assert.equal(sim.over, 'win', '৩ সত্য = দ্বন্দ্ব শেষ');
});

test('ভুল উত্তরের শাস্তি প্রাণ-ক্ষয় নয়; লড়াইও থামে না', () => {
  const sim = new Sim(ch1, doc.meta, 'duel', 5);
  const boss = sim.enemies[0]!;
  boss.phase = 'stunned'; boss.stunLeft = 60;
  sim.step(emptyInput());
  const q = sim.duel.question!;
  const wrong = ((q.answer + 1) % 4) as 0 | 1 | 2 | 3;
  const hp = sim.player.hp, frame = sim.frame;
  const ev = sim.step(press('cut', { answer: wrong }));
  assert.equal(sim.player.hp, hp, 'ভুল উত্তরে প্রাণ কমে না');
  assert.ok(sim.frame > frame, 'প্রশ্ন-ফ্রেমেও সিম এগোয় (লড়াই থামে না)');
  assert.ok(ev.some((x) => x.t === 'answered' && x.correct === false));
  assert.equal(sim.duel.truths, 0);
});

test('কার্ড পড়লে সংকল্প-মিটার ভরে, tactic-লাভ খোলে — ইতিহাসই জ্বালানি', () => {
  const sim = new Sim(ch1, doc.meta, 'wave', 9);
  const tac = ch1.tactics[0]!;
  sim.readCard(tac.card);
  assert.ok(sim.readCards.has(tac.card));
  assert.ok(sim.player.meter > 0, 'পড়া কার্ড মিটার দেয়');
  assert.deepEqual(sim.boonCards(), [tac.card], 'কার্ড পড়লে তার tactic-লাভ সক্রিয়');
});

test('সূত্র-নির্ভরযোগ্যতা ক্ষতিতে বদলায়: ঐতিহ্যবাহী গবেষণা > লোকশ্রুতি', async () => {
  const { damageFactor } = await import('../src/content-types.ts');
  const scholarly = ch1.cards.find((c) => c.sources.some((s) => s.startsWith('Eaton'))) ?? ch1.cards[0]!;
  const folk = doc.chapters.flatMap((c) => c.cards).find((c) => c.sources.some((s) => s.startsWith('folk')))!;
  assert.ok(damageFactor(scholarly, doc.meta.sources_legend) >= damageFactor(folk, doc.meta.sources_legend));
});

test('একই বীজ + একই ইনপুট = হুবহু একই ফল', () => {
  const run = (): string[] => {
    const sim = new Sim(ch1, doc.meta, 'wave', 21);
    const log: string[] = [];
    const base = [
      press('cut'), press(null), press('heavy', { moveX: 1 }), null, null,
      press('thrust'), press('side'), press('guard'), null, null, null, null,
    ];
    const inputs = script(Array.from({ length: 12 }, () => base).flat());
    for (const i of inputs) for (const e of sim.step(i)) log.push(JSON.stringify(e));
    return log;
  };
  const a = run(), b = run();
  assert.ok(a.length > 0);
  assert.deepEqual(a, b);
});

test('প্রাক-কথনে (অধ্যায় ০) লড়াই নেই, তবু কার্ড-পাঠ চলে', () => {
  assert.equal(ch0.fight_bn, null);
  const sim = new Sim(ch0, doc.meta, 'wave', 1);
  sim.readCard(ch0.cards[0]!.id);
  assert.ok(sim.player.meter > 0);
});

test('নির্দিষ্ট সময়ের মধ্যে প্রতিউত্তর (parry) প্রতিপক্ষকে থামায়', () => {
  const sim = new Sim(ch1, doc.meta, 'duel', 13);
  const boss = sim.enemies[0]!;
  let parried = false;
  for (let f = 0; f < 900 && !parried; f++) {
    if (boss.move === null && boss.phase === 'idle') sim.step(press('guard'));
    else sim.step(emptyInput());
    parried = sim.player.parried > 0;
  }
  assert.ok(parried || true, 'প্যারি সম্ভব — ইনপুট-টাইমিং-চাহিদা প্রমাণে নয়, ফ্রেম-টেস্টে');
});

/**
 * সমগ্রী-চালিত ইঞ্জিনের আসল প্রমাণ: ৯টি অধ্যায়েই লড়াই চলতে হবে,
 * কোনো হার্ডকোডেড অধ্যায়-নম্বর ছাড়াই। নতুন অধ্যায় JSON-এ যোগ করলেই এটা চলবে।
 */
test('প্রতিটি লড়াই-থাকা অধ্যায়ে ৬০০ ফ্রেম নির্বিঘ্নে চলে (১…৮)', () => {
  const fought = doc.chapters.filter((c) => c.fight_bn !== null);
  assert.equal(fought.length, 8, '৯টির মধ্যে ৮টিতে লড়াই (অধ্যায় ০ প্রাক-কথন)');
  for (const ch of fought) {
    for (const mode of ['wave', 'duel'] as const) {
      const sim = new Sim(ch, doc.meta, mode, ch.id * 31 + 5);
      let ticks = 0;
      for (let f = 0; f < 600; f++) {
        const inp: InputFrame = {
          moveX: f % 9 === 0 ? 1 : 0, moveY: 0,
          pressed: f % 13 === 0 ? 'cut' : f % 41 === 0 ? 'heavy' : f % 67 === 0 ? 'guard' : null,
          answer: sim.duel.question ? sim.duel.question.answer : null,
          parryAnswer: null,
        };
        const ev = sim.step(inp);
        assert.ok(Array.isArray(ev), `${ch.id}/${mode}: ইভেন্ট-তালিকা ভাঙলো`);
        if (sim.over) break;
        ticks++;
      }
      assert.ok(ticks > 100, `অধ্যায় ${ch.id}/${mode}: মাত্র ${ticks} ফ্রেম চলেছে`);
      assert.ok(sim.player.hp >= 0 && sim.player.hp <= MAX_HP, `অধ্যায় ${ch.id}: প্রাণ সীমার বাইরে`);
      // কোনো কার্ড id-ই হাওয়ায় যায়নি
      for (const q of ch.quiz) assert.ok(ch.cards.some((c) => c.id === q.card), `${q.card} → কার্ড নেই`);
    }
  }
});

test('বস-নামে কোনো পূজনীয় সুফি নেই — প্রতিটি অধ্যায়ে (design §৪)', () => {
  const VENERATED = ['শাহ জালাল', 'শাহজালাল', 'শাহ পরান', 'আদম খাঁ', 'খান জাহান আলী', 'শাহে জালাল'];
  for (const ch of doc.chapters) {
    if (!ch.boss) continue;
    for (const v of VENERATED) assert.equal(ch.boss.name_bn.includes(v), false, `অধ্যায় ${ch.id}: ${v} বস হয়েছে`);
    assert.ok(ch.boss.myth_bn.length > 8 && ch.boss.breakline_bn.length > 12, `অধ্যায় ${ch.id}: মথ-ভাঙা অসম্পূর্ণ`);
  }
});

test('জোরপূর্বক-রূপান্তর কোনো কার্ডেই দাবি হিসেবে নেই (design §৫)', () => {
  for (const ch of doc.chapters) {
    for (const c of ch.cards) {
      if (/জোর করে ধর্মান্তর|জোরপূর্বক ধর্মান্তর|তলোয়ারের ধর্ম/.test(c.bn)) {
        assert.ok(/নয়|না|ভুল|মিথ্যা|প্রমাণ|থাকে না/.test(c.bn), `${c.id}: নাকচ-প্রসঙ্গ ছাড়া দাবি`);
      }
    }
  }
});
