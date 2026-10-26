/**
 * src/save.ts — অগ্রগতির সংরক্ষণ: localStorage + কপি-করা-যায়-এমন হাল-কোড।
 *
 * সার্ভারলেস খেলায় কোনো একাউন্ট নেই, তাই দুটো উপায়:
 *  · localStorage — স্বয়ংক্রিয়;
 *  · হাল-কোড — নোটপ্যাড়ে/চ্যাটে রেখে অন্য ফোনে চালিয়ে নেওয়ার জন্য (compact base36)।
 */
import type { ContentDoc } from './content-types.ts';

export const SAVE_KEY = '***';
export const SAVE_VERSION = 2;

export interface Progress {
  v: number;
  /** সম্পূর্ণ অধ্যায়ের id */
  done: number[];
  /** পড়া কার্ডের id */
  read: string[];
  /** অধ্যায় → সেরা ফলাফল: ০ হেরেছে, ১ জয় (ঢেউ), ২ জয় (ঢেউ+দ্বন্দ্ব) */
  best: Record<string, number>;
  /** অধ্যায় → সেরা স্কোর (আর্কেড-পুনঃখেলার প্রাণ) */
  scores: Record<string, number>;
  /** অধ্যায় → তারা (১–৩): জয় + প্রাণ/লক্ষ্য-অবশিষ্ট + শেখা */
  stars: Record<string, number>;
  endlessBest: number;
  rushBest: number;
  totalScore: number;
  /** অর্জন (কীর্তি) id-র তালিকা */
  feats: string[];
  /** সব মিলিয়ে সঠিক সত্য-উত্তরের সংখ্যা (কীর্তি-গণনা) */
  truthsTotal: number;
  /** প্রথম-লড়াইয়ের কোচ-ইঙ্গিত দেখা শেষ কি না */
  coached: boolean;
  lastChapter: number;
  prefs: Prefs;
}

export interface Prefs {
  /** বাদ-করা মোশন (স্ক্রিন-শেক বন্ধ) */
  reduceMotion: boolean;
  /** রঙ-অন্ধ-বান্ধব প্যালেট */
  colorblind: boolean;
  /** আর্কেড-পিক্সেল মোড: অর্ধ-রেজ্যোলিউশন বাফার + CRT দানা (বন্ধ = মসৃণ ভেক্টর) */
  pixel: boolean;
  /** টেক্সট আকার: ০ ছোট, ১ স্বাভাবিক, ২ বড়, ৩ সবচেয়ে বড় */
  fontScale: 0 | 1 | 2 | 3;
  /** যন্ত্রসংগীত চালু/বন্ধ (design §5: রক্তহীন + যন্ত্র-সংগীত টগল) */
  music: boolean;
  /** সহজ মোড: ঢেউয়ের সময় +৩০ সেকেন্ড, শত্রুর ক্ষতি -২৫% */
  gentle: boolean;
  /** শিক্ষক-মোড: পারির আগে এক-শব্দ উত্তর দেখায় */
  teacher: boolean;
  /** লড়াইয়ের শব্দ (SFX) চালু/বন্ধ */
  sound: boolean;
  lang: 'bn';
}

export const defaultPrefs = (): Prefs => ({
  reduceMotion: false, colorblind: false, fontScale: 1, music: true, gentle: false, teacher: false, lang: 'bn',
  // ডিফল্ট এখন আধুনিক HD-রূপ; পিক্সেল-আর্কেড ঐচ্ছিক স্মৃতি-রূপ হিসেবে টগলে থাকে
  pixel: false, sound: true,
});

export const newProgress = (): Progress => ({
  v: SAVE_VERSION, done: [], read: [], best: {}, scores: {}, stars: {},
  endlessBest: 0, rushBest: 0, totalScore: 0, truthsTotal: 0, feats: [], coached: false, lastChapter: 0,
  prefs: defaultPrefs(),
});

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return newProgress();
    return merge(JSON.parse(raw));
  } catch { return newProgress(); }
}

export function writeProgress(p: Progress): void {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(p)); } catch { /* ব্রাউজার-অস্বীকৃতি: হাল-কোড আছে */ }
}

function merge(o: unknown): Progress {
  const base = newProgress();
  if (!o || typeof o !== 'object') return base;
  const p = o as Partial<Progress>;
  const numRec = (v: unknown): Record<string, number> =>
    (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === 'number')) : {}) as Record<string, number>;
  const prefs = { ...base.prefs, ...(p.prefs ?? {}) };
  // v1-এর সেভে পিক্সেল-মোড ডিফল্ট ছিল — v2-তে একবার আধুনিক রূপে তুলে দিই (টগলে ফেরা যায়)
  if ((p.v ?? 1) < 2) prefs.pixel = false;
  return {
    v: SAVE_VERSION,
    done: Array.isArray(p.done) ? p.done.filter((x) => typeof x === 'number') : [],
    read: Array.isArray(p.read) ? p.read.filter((x) => typeof x === 'string') : [],
    best: numRec(p.best),
    scores: numRec(p.scores), stars: numRec(p.stars),
    endlessBest: typeof p.endlessBest === 'number' ? p.endlessBest : 0,
    rushBest: typeof p.rushBest === 'number' ? p.rushBest : 0,
    totalScore: typeof p.totalScore === 'number' ? p.totalScore : 0,
    truthsTotal: typeof p.truthsTotal === 'number' ? p.truthsTotal : 0,
    feats: Array.isArray(p.feats) ? p.feats.filter((x) => typeof x === 'string') : [],
    coached: !!p.coached,
    lastChapter: typeof p.lastChapter === 'number' ? p.lastChapter : 0,
    prefs,
  };
}

/*
 * হাল-কোডের এনকোডিং — আগের সংস্করণটা গাণিতিকভাবে ভাঙা ছিল: encode ৫-বাইটের
 * খণ্ডকে ৩২-বিট শিফটে ভরত (বিট হারাত), আর decode ধরেই নিত প্রতি খণ্ড ৫ অক্ষর।
 * ফলে কোনো কোডই কখনও ফেরত পড়া যেত না (নতুন টেস্টে ধরা পড়েছে)।
 * এখন Crockford-ধাঁচের ৩২-অক্ষরের বর্ণমালা (l/o/u নেই — হাতে লিখলেও ভুল কম),
 * সামনে ৩ অক্ষরে বাইট-দৈর্ঘ্য, তারপর ৫-বিট করে প্যাক করা মূল তথ্য।
 */
const B32 = '0123456789abcdefghjkmnpqrstvwxyz';

/** অগ্রগতি → হাল-কোড (short, human-pasteable)। */
export function encodeSave(p: Progress): string {
  const payload = {
    d: p.done,
    r: p.read.map((id) => id.replace(/^c/, '')),
    b: p.best,
    s: p.scores, st: p.stars, e: p.endlessBest, rb: p.rushBest, ts: p.totalScore,
    f: [p.prefs.fontScale, p.prefs.reduceMotion ? 1 : 0, p.prefs.colorblind ? 1 : 0, p.prefs.music ? 1 : 0, p.prefs.gentle ? 1 : 0, p.prefs.teacher ? 1 : 0, p.prefs.pixel === false ? 0 : 1, p.prefs.sound === false ? 0 : 1].join(''),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const len = bytes.length;
  let head = '';
  let n = len;
  for (let i = 0; i < 3; i++) { head = B32[n % 32]! + head; n = Math.floor(n / 32); }
  let out = head;
  let acc = 0, bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b; bits += 8;
    while (bits >= 5) { bits -= 5; out += B32[(acc >>> bits) & 31]!; }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += B32[(acc << (5 - bits)) & 31]!;
  return (out.match(/.{1,5}/g) ?? []).join('-');
}

export function decodeSave(code: string, doc: ContentDoc): Progress | null {
  try {
    const clean = code.toLowerCase().replace(/[\s-]/g, '').replace(/o/g, '0').replace(/[il]/g, '1');
    if (clean.length < 4) return null;
    let len = 0;
    for (let i = 0; i < 3; i++) {
      const v = B32.indexOf(clean[i]!);
      if (v < 0) return null;
      len = len * 32 + v;
    }
    if (len === 0 || len > 32767) return null;
    const bytes: number[] = [];
    let acc = 0, bits = 0;
    for (let i = 3; i < clean.length && bytes.length < len; i++) {
      const v = B32.indexOf(clean[i]!);
      if (v < 0) return null;
      acc = (acc << 5) | v; bits += 5;
      if (bits >= 8) { bits -= 8; bytes.push((acc >>> bits) & 255); acc &= (1 << bits) - 1; }
    }
    if (bytes.length !== len) return null;
    const payload = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))) as {
      d: number[]; r: string[]; b: Record<string, number>; f: string;
      s?: Record<string, number>; st?: Record<string, number>; e?: number; rb?: number; ts?: number;
    };
    const ids = new Set(doc.chapters.flatMap((c) => c.cards.map((x) => x.id)));
    const p = newProgress();
    p.done = payload.d ?? [];
    p.read = (payload.r ?? []).map((x) => 'c' + x).filter((id) => ids.has(id));
    p.best = payload.b ?? {};
    p.scores = payload.s ?? {}; p.stars = payload.st ?? {};
    p.endlessBest = payload.e ?? 0; p.rushBest = payload.rb ?? 0; p.totalScore = payload.ts ?? 0;
    const f = (payload.f ?? '100100').split('').map(Number);
    p.prefs = {
      ...defaultPrefs(),
      fontScale: ((f[0] ?? 1) as 0 | 1 | 2 | 3),
      reduceMotion: !!f[1], colorblind: !!f[2], music: !!f[3], gentle: !!f[4], teacher: !!f[5],
      pixel: f[6] === 1, sound: f[7] !== 0,
    };
    return p;
  } catch { return null; }
}
