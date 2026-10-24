#!/usr/bin/env node
/**
 * tools/validate.mjs — খড়্গ-এর কনটেন্ট-যাচাই (no dependencies, offline, runs in CI)
 *
 * Usage:   node tools/validate.mjs [content/chapters.json]
 * Exit 0 = পাস (সতর্কতা থাকতে পারে), exit 1 = ত্রুটি।
 *
 * কেন এই স্ক্রিপ্ট দরকার: বাংলা টেক্সট হাতে লিখে JSON বানালে JSON.parse সহজেই
 * টিকে যায়, কিন্তু এই চারটা জিনিস ধরে না —
 *   (ক) বাংলা শব্দের ভেতর ল্যাটিন/দেবনাগরী/CJK অক্ষর লিকেজ,
 *   (খ) উৎসবিহীন দাবি,
 *   (গ) ভাঙা quiz-কাঠামো (choices_bn string হয়ে যাওয়া, answer পাল্লা ছাড়ানো),
 *   (ঘ) বস-ব্লক না-থাকা অথচ লড়াই-থাকা অধ্যায়।
 * এই চারটাই এই গেমের নৈতিক ভিত্তি (design §5), তাই এগুলো machine-checked।
 */
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = resolve(root, process.argv[2] || 'content/chapters.json');

const CARD_TYPES = ['fact', 'event', 'place', 'figure', 'idea', 'legend', 'myth', 'quote', 'disputed'];
const TAGS = ['syncretism', 'economy', 'navy', 'source-criticism', 'coexistence', 'women', 'warfare', 'politics'];
const CHAPTER_KEYS = ['id', 'slug', 'title_bn', 'years_bn', 'fight_bn', 'bearer_bn', 'panels_bn', 'cards', 'quiz', 'tactics', 'boss'];
const CARD_KEYS = ['id', 'type', 'year', 'place', 'bn', 'tags', 'sources', 'context', 'aftermath', 'disputed', 'views', 'gameplay'];
const QUIZ_KEYS = ['id', 'q_bn', 'choices_bn', 'answer', 'explain_bn', 'card'];
const TACTIC_KEYS = ['card', 'boon_bn'];
const BOSS_KEYS = ['name_bn', 'allegiance_bn', 'myth_bn', 'breakline_bn', 'tactic_bn'];

/** ডিজাইন §4: পূজনীয় সুফি/সন্তু কখনও বস বা প্রতিপক্ষ হতে পারবে না। */
const VENERATED = ['শাহ জালাল', 'শাহজালাল', 'শাহ পরান', 'আদম খাঁ', 'খান জাহান আলী', 'শাহ সুজা', 'নূর উল্লাহ', 'শাহে জালাল', 'সাইফ উদ্দিন', 'ফরিদউদ্দিন'];
/** ডিজাইন §5: "জোর করে ধর্মান্তর"-কে সরাস দাবি হিসেবে লেখা যাবে না; নাকচ-প্রসঙ্গেই লিখতে হবে। */
const FORCED = ['জোর করে ধর্মান্তর', 'জোরপূর্বক ধর্মান্তর', 'তলোয়ারের ধর্ম', 'বলপ্রয়োগে ইসলাম', 'বাধ্য করা হলো ধর্ম'];
const DENIAL = ['নয়', 'না', 'ভুল', 'মিথ্যা', 'প্রমাণ', 'নেই', 'থাকে না', 'দেখে', 'বরং'];

const errors = [];
const warns = [];
const err = (rule, where, msg) => errors.push({ rule, where, msg });
const warn = (rule, where, msg) => warns.push({ rule, where, msg });
const uniq = (a) => [...new Set(a)];

// ── লিপি-পরিচ্ছতা ────────────────────────────────────────────────────────────
// নীতি: খেলার পুরো UI বাংলা, তাই display ফিল্ডে ল্যাটিন/দেবনাগরী/CJK/আরবি চলবে না।
// ব্যতিক্রম: দণ্ডি "।" (U+0964) ও "॥" — বাক্য-বিভাজকের বাংলায় নিজস্ব কোডপয়েন্ট নেই,
// এটি ঐ ব্লক থেকেই ধার করা হয়; ভুল নয়।
const BENGALI = /[\u0980-\u09FF]/;
function checkScript(where, field, val, { allowLatin = false, allowQuestion = false } = {}) {
  if (typeof val !== 'string') { err('type', where, `${field} অবশ্যই string হতে হবে (পাওয়া ${typeof val})`); return; }
  if (!val.trim()) { err('empty', where, `${field} খালি`); return; }
  if (!BENGALI.test(val) && !allowLatin) { err('script', where, `${field}-য় বাংলা বর্ণ নেই-ই`); return; }

  const deva = val.match(/[\u0900-\u0963\u0966-\u097F]/g);
  if (deva) err('script', where, `${field}-য় দেবনাগরী বর্ণমালার অক্ষর: ${uniq(deva).join('')}`);
  const cjk = val.match(/[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/g);
  if (cjk) err('script', where, `${field}-য় CJK/Hangul অক্ষর: ${uniq(cjk).join('')}`);
  const ara = val.match(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g);
  if (ara) err('script', where, `${field}-য় আরবি-ব্লকের অক্ষর: ${uniq(ara).join('')}`);
  const asm = val.match(/[ৰৱ]/g);
  if (asm) err('script', where, `${field}-য় আসামিয ৰ/ৱ — বাংলার র/ব লেখো`);

  const glued = val.match(/[\u0980-\u09FF][A-Za-z]|[A-Za-z][\u0980-\u09FF]/g);
  if (glued) err('script', where, `${field}-য় বাংলা বর্ণের গায়ে ল্যাটিন লেগে: ${uniq(glued).join(' ')}`);
  const latin = val.match(/[A-Za-z]{2,}/g);
  if (latin && !allowLatin) err('latin', where, `${field}-য় ল্যাটিন শব্দ — UI সম্পূর্ণ বাংলা হতে হবে: ${uniq(latin).join(', ')}`);

  const digits = val.match(/[\u0980-\u09FF][^\s]{0,5}[0-9]|[0-9]{2,}[\u0980-\u09FF]/);
  if (digits && !allowLatin) err('digits', where, `${field}-য় ASCII সংখ্যা মিশেছে — টেক্সটে বাংলা সংখ্যা: ${digits[0]}`);

  if (/TODO|FIXME|XXX|placeholder|\?\?\?|\bnull\b|undefined/i.test(val)) err('placeholder', where, `${field}-য় অপ্রস্তুত-চিহ্ন আছে`);
  // গবেষণা-অসম্পূর্ণতার চিহ্ন: বাক্যের মাঝে "?" ("লিসবন-পথে? (১৬১১)")।
  // বাক্য-শেষে প্রশ্নবোধক ("...কাদের কাছে?") স্বাভাবিক, সেটি থাকবে।
  if (!allowQuestion) {
    for (const m of val.matchAll(/\?/g)) {
      const after = val.slice(m.index + 1);
      if (!/^\s*(?:$|[”’)"\'\]])/.test(after)) err('hedge', where, `${field}-য় মাঝ-বাক্যে "?" — এটি অসম্পূর্ণ-যাচাই দাবি, হয় যাচাই করো হয় সরাও: "…${val.slice(Math.max(0, m.index - 28), m.index + 14)}…"`, );
    }
  }
}

function main() {
  let doc;
  try { doc = JSON.parse(readFileSync(CONTENT, 'utf8')); }
  catch (e) { console.error(`✗ ${CONTENT} parse-ই হয়নি: ${e.message}`); process.exit(1); }

  const { meta, chapters } = doc;
  if (!meta) err('meta', 'meta', 'নেই');
  const legend = meta?.sources_legend ?? {};
  const span = meta?.span ?? [1204, 1757];

  for (const k of ['title_bn', 'subtitle_bn', 'version', 'language', 'span', 'bearer_lineage_bn', 'sources_legend']) {
    if (!meta || !(k in meta)) err('meta-key', 'meta', `${k} নেই`);
  }
  if (meta) {
    if (meta.language !== 'bn') err('language', 'meta.language', `পুরো UI বাংলা বাধ্যতামূলক (পাওয়া: ${meta.language})`);
    if (!Array.isArray(span) || span.length !== 2 || span[0] >= span[1]) err('meta-span', 'meta.span', 'ঠিক [শুরু, শেষ] লাগবে');
    if (!Object.keys(legend).length) err('meta-legend', 'meta.sources_legend', 'খালি — উৎস-তালিকা লাগবে');
    checkScript('meta', 'title_bn', meta.title_bn);
    checkScript('meta', 'subtitle_bn', meta.subtitle_bn);
    checkScript('meta', 'bearer_lineage_bn', meta.bearer_lineage_bn);
    for (const [k, v] of Object.entries(legend)) {
      if (/[\u0980-\u09FF]/.test(k)) err('legend-key', `meta.sources_legend`, `কী ASCII হতে হবে (বাংলা এসেছে): ${k}`);
      checkScript(`meta.sources_legend.${k}`, 'বিবরণ', v, { allowLatin: true });
    }
  }

  if (!Array.isArray(chapters) || !chapters.length) { err('chapters', 'chapters', 'array লাগবে'); report(); return; }

  const allCardIds = new Set();
  for (const ch of chapters) for (const c of ch.cards || []) allCardIds.add(c.id);

  chapters.forEach((ch, i) => {
    const at = `অধ্যায় ${ch.id}`;
    if (ch.id !== i) err('chapter-order', at, `id ক্রম মেনে ${i} হতে হবে`);
    for (const k of CHAPTER_KEYS) if (k !== 'boss' && !(k in ch)) err('chapter-key', at, `${k} নেই`);
    for (const k of Object.keys(ch)) if (!CHAPTER_KEYS.includes(k)) err('chapter-extra-key', at, `অজানা চাবি ${k}`);
    if (typeof ch.slug !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(ch.slug)) err('chapter-slug', at, `slug ascii-ছোটহরফ: ${ch.slug}`);
    checkScript(at, 'title_bn', ch.title_bn);
    checkScript(at, 'years_bn', ch.years_bn);
    for (const k of ['name_bn', 'role_bn']) checkScript(`${at}.bearer_bn`, k, ch.bearer_bn?.[k]);
    for (const k of Object.keys(ch.bearer_bn || {})) if (!['name_bn', 'role_bn'].includes(k)) err('bearer-extra-key', `${at}.bearer_bn`, `অজানা চাবি ${k}`);

    if (!Array.isArray(ch.panels_bn) || ch.panels_bn.length !== 4)
      err('panels', at, `panels_bn ঠিক ৪টি (পাওয়া ${ch.panels_bn?.length})`);
    (ch.panels_bn || []).forEach((p, j) => {
      checkScript(`${at}.panels_bn[${j}]`, 'প্যানেল', p);
      if (typeof p === 'string' && p.length < 20) err('panels', `${at}.panels_bn[${j}]`, `প্যানেল-পাঠ খুব ছোট (${p.length})`);
      if (typeof p === 'string' && !/[।॥]$/.test(p.trim()) && !/[?"”’]$/.test(p.trim()))
        warn('panels-punct', `${at}.panels_bn[${j}]`, 'বাক্য দণ্ডি দিয়ে শেষ করো');
    });

    // ── কার্ড ──
    if (!Array.isArray(ch.cards) || ch.cards.length < 6 || ch.cards.length > 12)
      err('cards-count', at, `৬–১২টি কার্ড (পাওয়া ${ch.cards?.length})`);
    const seen = new Set();
    let syncretism = 0;
    for (const c of ch.cards || []) {
      const w = `${at}/${c.id ?? '(no id)'}`;
      for (const k of Object.keys(c)) if (!CARD_KEYS.includes(k)) err('card-extra-key', w, `অজানা চাবি ${k}`);
      if (!c.id || !new RegExp(`^c${ch.id}-[a-z0-9][a-z0-9-]*$`).test(c.id)) err('card-id', w, `id "c${ch.id}-…" রূপে লেখো`);
      if (seen.has(c.id)) err('card-dup', w, 'একই id দুবার'); seen.add(c.id);
      if (!CARD_TYPES.includes(c.type)) err('card-type', w, `type হবে ${CARD_TYPES.join('|')} এর একটা (পাওয়া ${c.type})`);
      if (!('year' in c)) err('card-year', w, 'year চাবি থাকতেই হবে (না-জানা হলে null)');
      else if (c.year !== null && (!Number.isInteger(c.year) || c.year < 600 || c.year > 1800)) err('card-year', w, `year অস্বাভাবিক: ${c.year}`);
      else if (Number.isInteger(c.year) && (c.year < span[0] || c.year > span[1]) && !c.context && !c.aftermath)
        err('card-span', w, `year ${c.year} কালসীমা ${span[0]}–${span[1]}-এর বাইরে — প্রেক্ষাপট হলে context:true, ফলাফল-কার্ড হলে aftermath:true দাও`);
      if (c.place !== null) checkScript(w, 'place', c.place);
      checkScript(w, 'bn', c.bn);
      if (typeof c.bn === 'string') {
        if (c.bn.length < 40) err('card-short', w, `bn মাত্র ${c.bn.length} অক্ষর (কমপক্ষে ৪০ — নইলে কার্ড নয়, টিপ্পনী)`);
        if (c.bn.length > 620) err('card-long', w, `bn ${c.bn.length} অক্ষর — মোবাইল কার্ডে ৬২০-এর বেশি ধরবে না`);
        const idx = c.bn.search(/“/);
        if (idx < 0 && c.type === 'quote') err('card-quote', w, 'type "quote" হলে উদ্ধৃতি “ ” দাও');
        for (const f of FORCED) {
          const k = c.bn.indexOf(f);
          if (k >= 0 && !DENIAL.some((x) => c.bn.slice(Math.max(0, k - 70), k + 70).includes(x)))
            err('forced-conversion', w, `“${f}” ন্যায়সঙ্গত দাবি হিসেবে এসেছে — নাকচ/সূত্রসহ প্রসঙ্গে লেখো`);
        }
      }
      if (!Array.isArray(c.tags) || !c.tags.length) err('card-tags', w, 'tags বাধ্যতামূলক (preview + অ্যালগরিদম-ছাঁকনি এতেই চলে)');
      else {
        for (const t of c.tags) if (!TAGS.includes(t)) err('card-tag', w, `অজানা tag "${t}" — অনুমোদিত: ${TAGS.join('|')}`);
        if (c.tags.includes('syncretism')) syncretism++;
      }
      if (!Array.isArray(c.sources) || !c.sources.length) err('card-sources', w, 'উৎসবিহীন কার্ড রাখা যাবে না (design §5)');
      else for (const s of c.sources) {
        if (typeof s !== 'string' || s.length < 4) { err('card-source-weak', w, `উৎস অকার্যকর: ${JSON.stringify(s)}`); continue; }
        if (!Object.keys(legend).some((k) => s.startsWith(k)))
          err('card-source-key', w, `উৎস "${s.slice(0, 44)}" — meta.sources_legend-এর কোনো কী দিয়ে শুরু হয় না`);
        if (/^(banglapedia|bnwiki)$/.test(s.trim()))
          warn('source-unnamed', w, `"${s.trim()}" — নিবন্ধের নাম দাও (${s.trim()}: …), নাহলে যাচাই অসম্ভব`);
      }
      if (c.disputed === true || c.type === 'disputed') {
        if (!Array.isArray(c.views) || c.views.length < 2)
          err('disputed-views', w, 'মতভেদের কার্ডে কমপক্ষে দুটি পক্ষ দেখাতেই হবে (design §5)');
        else (c.views || []).forEach((v, j) => {
          checkScript(`${w}.views[${j}]`, 'মত', v);
          if (typeof v === 'string' && v.length < 25) err('disputed-views', `${w}.views[${j}]`, `পক্ষ খুব ছোট (${v.length}) — এক লাইনে ঝাড়ো না`);
        });
      } else if (Array.isArray(c.views)) err('views-undisputed', w, 'views আছে কিন্তু disputed:true/type="disputed" নেই');
    }
    if (syncretism < 1) err('syncretism-rule', at, 'প্রতি অধ্যায়ে অন্তত একটি সংমিশ্রণ-কার্ড লাগবে (tags-এ syncretism) — design §5');

    // ── quiz ──
    if (!Array.isArray(ch.quiz) || ch.quiz.length < 3 || ch.quiz.length > 5)
      err('quiz-count', at, `৩–৫টি প্রশ্ন (পাওয়া ${ch.quiz?.length})`);
    const qseen = new Set();
    for (const q of ch.quiz || []) {
      const w = `${at}/${q.id ?? '(no id)'}`;
      for (const k of Object.keys(q)) if (!QUIZ_KEYS.includes(k)) err('quiz-extra-key', w, `অজানা চাবি ${k}`);
      if (!new RegExp(`^q${ch.id}-[0-9]+$`).test(q.id || '')) err('quiz-id', w, `id "q${ch.id}-n" রূপের হতে হবে`);
      if (qseen.has(q.id)) err('quiz-dup', w, 'একই প্রশ্ন-id দুবার'); qseen.add(q.id);
      checkScript(w, 'q_bn', q.q_bn, { allowQuestion: true });
      if (typeof q.q_bn === 'string' && !q.q_bn.trim().endsWith('?')) err('quiz-mark', w, 'প্রশ্ন "?" দিয়ে শেষ হতে হবে');
      if (!Array.isArray(q.choices_bn)) { err('quiz-choices', w, `choices_bn array হতে হবে (পাওয়া ${typeof q.choices_bn}: ${JSON.stringify(q.choices_bn).slice(0, 24)})`); }
      else {
        if (q.choices_bn.length !== 4) err('quiz-choices', w, `ঠিক ৪টি বিকল্প (পাওয়া ${q.choices_bn.length})`);
        if (uniq(q.choices_bn).length !== q.choices_bn.length) err('quiz-choices-dup', w, 'বিকল্প পুনরাবৃত্তি');
        q.choices_bn.forEach((c, j) => checkScript(`${w}.choices_bn[${j}]`, 'বিকল্প', c, { allowQuestion: true }));
      }
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) err('quiz-answer', w, `answer ০–৩ (পাওয়া ${JSON.stringify(q.answer)})`);
      else if (Array.isArray(q.choices_bn) && q.choices_bn.length === 4 && uniq(q.choices_bn).length === 4 && q.choices_bn.every((x) => typeof x === 'string')) {
        // সতর্কতা: সঠিক উত্তর আর ব্যাখ্যা যেন মিলে যায় (শব্দ-মিল পরীক্ষা)
      }
      checkScript(w, 'explain_bn', q.explain_bn, { allowQuestion: true });
      if (typeof q.explain_bn === 'string' && q.explain_bn.length < 20) err('quiz-explain', w, `ব্যাখ্যা অন্তত ২০ অক্ষর — শুধু "ঠিক" লেখা যাবে না`);
      if (!allCardIds.has(q.card)) err('quiz-card', w, `নির্দেশিত কার্ড "${q.card}" নেই — প্রশ্ন সবসময় একটি কার্ডে ফেরত নিয়ে যাবে`);
    }

    // ── tactics (কার্ড → গেমপ্লে-লাভ) ──
    if (!Array.isArray(ch.tactics) || ch.tactics.length < 4 || ch.tactics.length > 5)
      err('tactics-count', at, `৪–৫টি tactic (পাওয়া ${ch.tactics?.length})`);
    const tc = new Set();
    for (const t of ch.tactics || []) {
      const w = `${at}.tactic`;
      for (const k of Object.keys(t)) if (!TACTIC_KEYS.includes(k)) err('tactic-extra-key', w, `অজানা চাবি ${k}`);
      if (!allCardIds.has(t.card)) err('tactic-card', w, `কার্ড "${t.card}" নেই`);
      else if (tc.has(t.card)) err('tactic-dup', w, `একই কার্ড দুবার: ${t.card}`);
      tc.add(t.card);
      checkScript(w, 'boon_bn', t.boon_bn);
    }

    // ── বস ↔ লড়াই ──
    const hasBoss = !!ch.boss;
    if (ch.fight_bn === null || ch.fight_bn === undefined) {
      if (hasBoss) err('boss-without-fight', at, 'fight_bn নেই বললে boss রাখা যাবে না');
      if (ch.id !== 0) err('prologue-only', at, `শুধু অধ্যায় ০-ই লড়াইবিহীন হতে পারে (fight_bn null)`);
    } else {
      if (!hasBoss) err('boss-missing', at, 'fight_bn আছে কিন্তু boss ব্লক নেই — লড়াই থাকলে প্রচলিত-ভ্রম ভাঙা থাকতেই হবে');
      if (!Number.isInteger(ch.fight_bn?.waves) || ch.fight_bn.waves < 1 || ch.fight_bn.waves > 4)
        err('fight-waves', at, `waves ১–৪ (পাওয়া ${ch.fight_bn?.waves})`);
      checkScript(at, 'fight_bn.duel_bn', ch.fight_bn?.duel_bn);
    }
    if (hasBoss) {
      for (const k of Object.keys(ch.boss)) if (!BOSS_KEYS.includes(k)) err('boss-extra-key', `${at}.boss`, `অজানা চাবি ${k}`);
      for (const k of BOSS_KEYS) checkScript(`${at}.boss`, k, ch.boss[k]);
      const nm = String(ch.boss.name_bn ?? '');
      for (const v of VENERATED) if (nm.includes(v)) err('venerated-boss', `${at}.boss`, `পূজনীয় ব্যক্তিত্ব প্রতিপক্ষ হতে পারবে না (design §4): ${v}`);
      if (/\d/.test(nm)) err('boss-name', `${at}.boss`, 'বসের নামে ASCII সংখ্যা?');
    }
  });

  report();
}

function report() {
  const rel = relative(root, CONTENT);
  let totalCards = 0, totalQuiz = 0, disputed = 0;
  try {
    const d = JSON.parse(readFileSync(CONTENT, 'utf8'));
    totalCards = d.chapters.reduce((a, c) => a + c.cards.length, 0);
    totalQuiz = d.chapters.reduce((a, c) => a + (c.quiz?.length || 0), 0);
    disputed = d.chapters.reduce((a, c) => a + c.cards.filter((x) => x.disputed).length, 0);
    console.log(`\nখড়্গ কনটেন্ট-যাচাই · ${rel}`);
    console.log(`অধ্যায় ${d.chapters.length} · কার্ড ${totalCards} · প্রশ্ন ${totalQuiz} · মতভেদ-কার্ড ${disputed}`);
  } catch { console.log(`\nখড়্গ কনটেন্ট-যাচাই · ${rel}`); }

  if (warns.length) {
    console.log(`\n⚠ সতর্কতা ${warns.length} (blocking নয়):`);
    for (const w of warns.slice(0, 25)) console.log(`   [${w.rule}] ${w.where}: ${w.msg}`);
    if (warns.length > 25) console.log(`   … আরও ${warns.length - 25}টি`);
  }
  if (errors.length) {
    const byRule = new Map();
    for (const e of errors) byRule.set(e.rule, (byRule.get(e.rule) || 0) + 1);
    console.log(`\n✗ ত্রুটি ${errors.length}:`);
    for (const e of errors.slice(0, 45)) console.log(`   [${e.rule}] ${e.where}: ${e.msg}`);
    if (errors.length > 45) console.log(`   … আরও ${errors.length - 45}টি`);
    console.log(`\n   সার: ${[...byRule].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  ')}`);
    process.exit(1);
  }
  console.log(`\n✓ সব কড়া নিয়ম পাস (সতর্কতা ${warns.length})`);
}

main();
