/**
 * src/frames.ts — ফ্রেম-ডেটা: লড়াইয়ের একমাত্র সত্য।
 *
 * ৬০Hz ফিক্সড-স্টেপ। প্রতিটি মুভ = startup | active | recovery ফ্রেম-সংখ্যা,
 * পাল্লা (reach), প্রতিপক্ষের স্টান (hitstun/blockstun), ঢাল-ক্ষয় (guardDmg)।
 * এই টেবিলটাই টেস্টে আটকানো (design §11) — নকশা বদলালে সংখ্যা বদলাবে, টেস্ট ধরবে।
 *
 * ভারসাম্যের নীতি (নৈর্জিক নয়, হিসাব):
 *  · হালকা কাটা সবচেয়ে দ্রুত, কিন্তু ঢাল ভাঙে না;
 *  · ভারী কোপ ধীর + পাল্লা কম, ঢাল-ক্ষয় সবচেয়ে বেশি;
 *  · পোঁতা সবচেয়ে লম্বা পাল্লা, ভুল জায়গায় গেলে সবচেয়ে বড় শাস্তি (দীর্ঘ রিকভারি);
 *  · রোধের ভেতর ৮-ফ্রেমের নিখুঁত-জানালা (parry) — সেখান থেকেই প্রতিউত্তর;
 *  · সবে-র ১০ ফ্রেম অছোঁয়া (i-frames), তারপর দুর্বল — তাই পাল্লায় দৌড় নয়, সময়ে দৌড়।
 */

export const FPS = 60 as const;
export const DT = 1 / FPS;

export type InputName = 'cut' | 'heavy' | 'thrust' | 'guard' | 'side' | 'resolve';
export type GuardState = 'none' | 'guard' | 'parry' | 'broken';

export interface MoveDef {
  id: InputName;
  /** বাংলা নাম — HUD-তে এটাই দেখায় (UI সম্পূর্ণ বাংলা)। */
  bn: string;
  startup: number;
  active: number;
  recovery: number;
  reach: number;
  dmg: number;
  guardDmg: number;
  hitstun: number;
  blockstun: number;
  /** সফল আঘাতে সংকল্প-মিটারের অংশ (০–১০০)। */
  meter: number;
  iframes: number;
  lunge: number;
  knockback: number;
  high: boolean;
}

export const MOVES: Record<InputName, MoveDef> = {
  cut: {
    id: 'cut', bn: 'কাটা', startup: 4, active: 4, recovery: 9,
    reach: 58, dmg: 6, guardDmg: 4, hitstun: 14, blockstun: 8,
    meter: 4, iframes: 0, lunge: 2, knockback: 8, high: false,
  },
  heavy: {
    id: 'heavy', bn: 'কোপ', startup: 11, active: 5, recovery: 20,
    reach: 66, dmg: 15, guardDmg: 34, hitstun: 24, blockstun: 12,
    meter: 8, iframes: 0, lunge: 4, knockback: 26, high: true,
  },
  thrust: {
    id: 'thrust', bn: 'পোঁতা', startup: 9, active: 3, recovery: 22,
    reach: 104, dmg: 12, guardDmg: 12, hitstun: 20, blockstun: 10,
    meter: 6, iframes: 0, lunge: 14, knockback: 16, high: false,
  },
  guard: {
    id: 'guard', bn: 'রোধ', startup: 1, active: 26, recovery: 6,
    reach: 0, dmg: 0, guardDmg: 0, hitstun: 0, blockstun: 0,
    meter: 2, iframes: 0, lunge: 0, knockback: 0, high: false,
  },
  side: {
    id: 'side', bn: 'সবে', startup: 2, active: 0, recovery: 12,
    reach: 0, dmg: 0, guardDmg: 0, hitstun: 0, blockstun: 0,
    meter: 1, iframes: 10, lunge: 0, knockback: 0, high: false,
  },
  resolve: {
    id: 'resolve', bn: 'সংকল্প', startup: 6, active: 8, recovery: 26,
    reach: 82, dmg: 34, guardDmg: 40, hitstun: 40, blockstun: 30,
    meter: 0, iframes: 12, lunge: 10, knockback: 40, high: true,
  },
};

/** নিখুঁত রোধের জানালা (ফ্রেম)। */
export const PARRY_WINDOW = 8;
/** সংকল্প-আঘাত পেতে লাগবে এই পরিমাণ মিটার। */
export const RESOLVE_COST = 100;
/** ঢাল ভাঙলে প্রতিপক্ষ এত ফ্রেম নড়তে পারে না। */
export const GUARD_BREAK_STUN = 46;
/** মোট প্রাণ। */
export const MAX_HP = 240;
/** মোট ঢাল-ক্ষমতা। */
export const MAX_GUARD = 100;

export const totalFrames = (m: MoveDef): number => m.startup + m.active + m.recovery;

export interface MoveWindow { startup: [number, number]; active: [number, number]; recovery: [number, number] }

/** মুভের ফ্রেম-রেখা — টেস্ট এটিই আটকায়; ইঞ্জিন শুধু পড়ে। */
export function windows(m: MoveDef): MoveWindow {
  return {
    startup: [0, m.startup - 1],
    active: [m.startup, m.startup + m.active - 1],
    recovery: [m.startup + m.active, totalFrames(m) - 1],
  };
}
export const isActive = (m: MoveDef, f: number): boolean => {
  const w = windows(m);
  return f >= w.active[0] && f <= w.active[1];
};
export const isStartup = (m: MoveDef, f: number): boolean => f < m.startup;
export const isRecovery = (m: MoveDef, f: number): boolean => f >= m.startup + m.active;
/** রোধের রিকভারি-শেষে আগাম-ক্যান্সেল — মোবাইলের দ্রুত-হাতেও শাস্তি না। */
export const canCancelGuard = (m: MoveDef, f: number): boolean =>
  m.id === 'guard' && f >= m.startup + m.active + 3;
