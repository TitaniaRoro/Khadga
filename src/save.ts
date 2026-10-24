/**
 * src/save.ts — অগ্রগতির সংরক্ষণ: localStorage + কপি-করা-যায়-এমন হাল-কোড।
 *
 * সার্ভারলেস খেলায় কোনো একাউন্ট নেই, তাই দুটো উপায়:
 *  · localStorage — স্বয়ংক্রিয়;
 *  · হাল-কোড — নোটপ্যাড়ে/চ্যাটে রেখে অন্য ফোনে চালিয়ে নেওয়ার জন্য (compact base36)।
 */
import type { ContentDoc } from './content-types.ts';

export const SAVE_KEY = '***';
export const SAVE_VERSION = 1;

export interface Progress {
  v: number;
  /** সম্পূর্ণ অধ্যায়ের id */
  done: number[];
  /** পড়া কার্ডের id */
  read: string[];
  /** অধ্যায় → সেরা ফলাফল: ০ হেরেছে, ১ জয় (ঢেউ), ২ জয় (ঢেউ+দ্বন্দ্ব) */
  best: Record<string, number>;
  prefs: Prefs;
}

export interface Prefs {
  /** বাদ-করা মোশন (স্ক্রিন-শেক বন্ধ) */
  reduceMotion: boolean;
  /** রঙ-অন্ধ-বান্ধব প্যালেট */
  colorblind: boolean;
  /** টেক্সট আকার: ০ ছোট, ১ স্বাভাবিক, ২ বড়, ৩ সবচেয়ে বড় */
  fontScale: 0 | 1 | 2 | 3;
  /** যন্ত্রসংগীত চালু/বন্ধ (design §5: রক্তহীন + যন্ত্র-সংগীত টগল) */
  music: boolean;
  /** সহজ মোড: ঢেউয়ের সময় +৩০ সেকেন্ড, শত্রুর ক্ষতি -২৫% */
  gentle: boolean;
  /** শিক্ষক-মোড: পারির আগে এক-শব্দ উত্তর দেখায় */
  teacher: boolean;
  lang: 'bn';
}

export const defaultPrefs = (): Prefs => ({
  reduceMotion: false, colorblind: false, fontScale: 1, music: true, gentle: false, teacher: false, lang: 'bn',
});

export const newProgress = (): Progress => ({ v: SAVE_VERSION, done: [], read: [], best: {}, prefs: defaultPrefs() });

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
  return {
    v: SAVE_VERSION,
    done: Array.isArray(p.done) ? p.done.filter((x) => typeof x === 'number') : [],
    read: Array.isArray(p.read) ? p.read.filter((x) => typeof x === 'string') : [],
    best: p.best && typeof p.best === 'object' ? { ...p.best } : {},
    prefs: { ...base.prefs, ...(p.prefs ?? {}) },
  };
}

const A = '0123456789abcdefghijklmnopqrstuvwxyz';

/** অগ্রগতি → হাল-কোড (short, human-pasteable)। */
export function encodeSave(p: Progress): string {
  const payload = {
    d: p.done,
    r: p.read.map((id) => id.replace(/^c/, '')),
    b: p.best,
    f: [p.prefs.fontScale, p.prefs.reduceMotion ? 1 : 0, p.prefs.colorblind ? 1 : 0, p.prefs.music ? 1 : 0, p.prefs.gentle ? 1 : 0, p.prefs.teacher ? 1 : 0].join(''),
  };
  const b = new TextEncoder().encode(JSON.stringify(payload));
  let out = '';
  for (let i = 0; i < b.length; i += 5) {
    let n = 0;
    for (let j = 0; j < 5 && i + j < b.length; j++) n = (n << 8) | b[i + j]!;
    let chunk = '';
    do { chunk = A[n % 36]! + chunk; n = Math.floor(n / 36); } while (n > 0);
    out += chunk.padStart(4, '0');
  }
  return (out.match(/.{1,5}/g) ?? []).join('-');
}

export function decodeSave(code: string, doc: ContentDoc): Progress | null {
  try {
    const clean = code.replace(/[\s-]/g, '');
    let bits: number[] = [];
    for (const ch of clean) {
      const v = A.indexOf(ch);
      if (v < 0) return null;
      bits.push(v);
    }
    const bytes: number[] = [];
    for (let i = 0; i + 4 < bits.length; i += 5) {
      let n = 0;
      for (let j = 0; j < 5; j++) n = n * 36 + bits[i + j]!;
      for (let k = 4; k >= 1; k--) bytes.push((n >>> (8 * k)) & 255);
    }
    const payload = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))) as {
      d: number[]; r: string[]; b: Record<string, number>; f: string;
    };
    const ids = new Set(doc.chapters.flatMap((c) => c.cards.map((x) => x.id)));
    const p = newProgress();
    p.done = payload.d ?? [];
    p.read = (payload.r ?? []).map((x) => 'c' + x).filter((id) => ids.has(id));
    p.best = payload.b ?? {};
    const f = (payload.f ?? '100100').split('').map(Number);
    p.prefs = {
      ...defaultPrefs(),
      fontScale: ((f[0] ?? 1) as 0 | 1 | 2 | 3),
      reduceMotion: !!f[1], colorblind: !!f[2], music: !!f[3], gentle: !!f[4], teacher: !!f[5],
    };
    return p;
  } catch { return null; }
}
