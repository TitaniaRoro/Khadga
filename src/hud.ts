/**
 * src/hud.ts — খেলার সব লেখা এখানে (এবং শুধু বাংলায়)।
 *
 * নীতি: কোনো English UI নেই — validate.mjs-ও content-এ ল্যাটিন ধরে।
 * এখানে শুধু স্থায়ী-লেবেল; অধ্যায়/কার্ড/প্রশ্নের টেক্সট content/chapters.json থেকে আসে।
 */
export const L = {
  title: 'খড়্গ',
  tagline: 'বাংলার মুসলিম শাসনের ইতিহাস — এক পদাতিকের বংশধারা, ১২০৪–১৭৫৭',
  start: 'খেলা শুরু',
  resume: 'চালিয়ে যাও',
  chapterSelect: 'অধ্যায় বেছে নাও',
  locked: 'আগের অধ্যায় জিতে নাও',
  prologue: 'প্রাক-কথন',
  play: 'লড়ো',
  read: 'পড়ো',
  readAll: 'সব কার্ড পড়া হয়েছে',
  back: 'ফিরে যাও',
  pause: 'বিরতি',
  paused: 'বিরতি — চালিয়ে দিতে চাপো',
  again: 'আবার লড়ো',
  win: 'রক্ষা পেয়েছে',
  lose: 'হেরে গেছ',
  continue: 'পরে যাও',
  settings: 'সেটিংস',
  save: 'হাল-কোড',
  saveCopy: 'কোড কপি করো',
  savePaste: 'কোড বসাও',
  saveDone: 'সংরক্ষিত',
  reduceMotion: 'কম নড়াচড়া',
  colorblind: 'রঙ-অন্ধ-বান্ধব',
  fontBig: 'লেখা বড়',
  fontSmall: 'লেখা ছোট',
  music: 'যন্ত্রসংগীত',
  gentle: 'সহজ মোড',
  teacher: 'শিক্ষক-মোড',
  bloodless: 'রক্ত নেই — খেলা কখনও হত্যা দেখায় না',
  controls: 'নিয়ন্ত্রণ',
  cut: 'কাটা', heavy: 'কোপ', thrust: 'পোঁতা', guard: 'রোধ', side: 'সবে', resolve: 'সংকল্প',
  move: 'চলাফেরা',
  hp: 'প্রাণ', guardMeter: 'ঢাল', meter: 'সংকল্প',
  defense: 'রক্ষা',
  time: 'সময়',
  wave: 'ঢেউ',
  truths: 'সত্য',
  quiz: 'জ্ঞানকোষ',
  answer: 'উত্তর দাও',
  correct: 'ঠিক',
  wrong: 'ভুল',
  sources: 'উৎস',
  disputed: 'মতভেদ',
  bothViews: 'এই নিয়ে ইতিহাসবিদরা একমত নন — দুটো মতই দেখানো হলো',
  viewA: 'পক্ষ ক', viewB: 'পক্ষ খ',
  banner: 'ইতিহাস-প্রহার',
  meterUp: 'সংকল্প বেড়েছে',
  meterDown: 'সংকল্প কমেছে — লড়াই চলতে থাকুক',
  readCardFirst: 'আগে একটা কার্ড পড়ো — সংকল্প-আঘাত সেই তথ্য দিয়েই চলে',
  guardBreak: 'ঢাল ভেঙেছে! প্রশ্নের উত্তর দাও',
  duelHint: 'ঢাল ভাঙো, তারপর ৩টি সঠিক উত্তর — তখনই লড়াই শেষ',
  waveHint: 'নৌকা/ধান/গ্রাম রক্ষা করো — সব শত্রু মারা লাগবে না',
  tactic: 'কার্ডের লাভ',
  bossMyth: 'যা সবাই ভাবে',
  bossBreak: 'যা সত্য',
  chapterDone: 'অধ্যায় শেষ',
  loading: 'ইতিহাস-সামগ্রী আসছে…',
  loadFail: 'সামগ্রী পড়া যায়নি — বিল্ড ঠিক আছে কি না দেখো',
  keys: 'কিবোর্ড: J কাটা · K কোপ · L পোঁতা · Space রোধ · Shift সবে · U সংকল্প · অ্যারো/ADWQ চলা · ১–৪ উত্তর',
} as const;

/** বাংলা সংখ্যা — UI-তে ASCII সংখ্যা দেখানো চলবে না। */
const BN = '০১২৩৪৫৬৭৮৯';
export const bn = (n: number | string): string => String(n).replace(/\d/g, (d) => BN[Number(d)]!);
export const bnTime = (frames: number): string => {
  const s = Math.max(0, Math.ceil(frames / 60));
  return bn(Math.floor(s / 60)) + ':' + bn(String(s % 60).padStart(2, '0'));
};
export const bnPct = (v: number): string => bn(Math.round(v * 100)) + '%';

/** HUD-এর লেবেল-রঙ: প্রাণ/ঢাল/সংকল্প — রঙ-অন্ধতায়ও আলাদা (প্যাটার্ন + নাম)। */
export const METER_LABEL = { hp: L.hp, guard: L.guardMeter, meter: L.meter } as const;
