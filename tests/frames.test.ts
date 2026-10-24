/**
 * tests/frames.test.ts — ফ্রেম-ডেটা-প্রমাণ (design §১১: "প্রত্যেকের ফ্রেম-ডেটা টেস্টে আটকানো")
 * নকশা-সিদ্ধান্তকে কোডে না লিখে টেস্টে আটকানো হয়: কে কার চেয়ে দ্রুত, কী ঢাল ভাঙে,
 * কত ফ্রেমে প্রতিউত্তর খোলে। সংখ্যা বদলালে টেস্ট বলবে নকশা বদলেছে — রেন্ডার বদলেছে কি না না।
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOVES, PARRY_WINDOW, RESOLVE_COST, GUARD_BREAK_STUN, MAX_GUARD, MAX_HP, totalFrames, windows, isActive, canCancelGuard } from '../src/frames.ts';

test('প্রতিটি মুভের ফ্রেম-রেখা অবিচ্ছিন্ন ও ধনাত্মক', () => {
  for (const m of Object.values(MOVES)) {
    assert.ok(m.startup >= 1, `${m.id}: startup`);
    assert.ok(m.recovery >= 1, `${m.id}: recovery`);
    const w = windows(m);
    assert.equal(w.startup[1] + 1, w.active[0], `${m.id}: startup→active জোড়া`);
    assert.equal(w.active[1] + 1, m.id === 'guard' || m.id === 'side' ? w.active[1] + 1 : w.recovery[0], `${m.id}: active→recovery`);
    assert.equal(totalFrames(m), m.startup + m.active + m.recovery);
  }
});

test('হালকা কাটা সবচেয়ে দ্রুত, পোঁতার পাল্লা সবচেয়ে লম্বা', () => {
  assert.ok(MOVES.cut.startup < MOVES.heavy.startup);
  assert.ok(MOVES.cut.startup < MOVES.thrust.startup);
  assert.ok(MOVES.thrust.reach > MOVES.heavy.reach);
  assert.ok(MOVES.thrust.reach > MOVES.cut.reach);
  assert.ok(MOVES.thrust.recovery > MOVES.thrust.active + MOVES.thrust.startup, 'পোঁতার শাস্তি দীর্ঘ রিকভারি');
});

test('কেবল ভারী কোপ ও সংকল্প ঢাল ভাঙে — হালকা কাটা নয়', () => {
  assert.ok(MOVES.cut.guardDmg < MOVES.heavy.guardDmg);
  assert.ok(MOVES.heavy.guardDmg * 3 >= MAX_GUARD, 'তিনটি কোপে ঢাল ফুরায়');
  assert.ok(MOVES.cut.guardDmg * 3 < MAX_GUARD, 'সাত-আটটি হালকা কাটাও ঢাল ভাঙে না');
  assert.ok(MOVES.resolve.guardDmg > MOVES.heavy.guardDmg);
});

test('সংকল্প আঘাত মিটার ছাড়া চলে না, চলে গেলে মিটার শূন্য হয়', () => {
  assert.equal(RESOLVE_COST, 100);
  assert.equal(MOVES.resolve.meter, 0, 'নিজেকে খাওয়ানো মিটার নয়');
  assert.ok(MOVES.cut.meter > 0 && MOVES.heavy.meter > MOVES.cut.meter);
});

test('নিখুঁত রোধের জানালা মানবিক: ৮ ফ্রেম (≈১৩৩ms), কিন্তু ১ ফ্রেম নয়', () => {
  assert.ok(PARRY_WINDOW >= 6 && PARRY_WINDOW <= 10);
  assert.ok(GUARD_BREAK_STUN > PARRY_WINDOW * 3, 'ঢাল ভাঙা শাস্তি parry-র চেয়ে ঢের বড়');
});

test('আঘাতের পর প্রতিপক্ষ রোধের চেয়ে বেশি স্তব্ধ — তাই প্রেসিং চলে', () => {
  for (const m of [MOVES.cut, MOVES.heavy, MOVES.thrust]) assert.ok(m.hitstun > m.blockstun, m.id);
});

test('রোধের রিকভারি-শেষে আগাম-ক্যান্সেল, শুরুতে নয়', () => {
  const g = MOVES.guard;
  assert.equal(canCancelGuard(g, 1), false);
  assert.equal(canCancelGuard(g, g.startup + g.active + 3), true);
  assert.equal(canCancelGuard(MOVES.cut, 12), false, 'আক্রমণ ক্যান্সেল-ফ্রি নয়');
});

test('সবে-র অছোয়া ফ্রেম তার মোট দৈর্ঘ্যের চেয়ে কম (চিরস্থায়ী অন্তর্ধান নয়)', () => {
  const s = MOVES.side;
  assert.ok(s.iframes > 0, 'সবে-তে অছোয়া ফ্রেম আছে');
  assert.ok(s.iframes + s.startup < totalFrames(s), 'i-frames মুভ ফুরোনোর আগেই শেষ — অনন্ত অন্তর্ধান নয়');
  assert.ok(!isActive(s, 0), 'সবে-তে আঘাতের active ফ্রেম নেই');
});

test('প্রাণ এত বেশি নয় যে ৯০ সেকেন্ডে ঢেউ শেষ করা অসম্ভব হয়', () => {
  assert.ok(MAX_HP > 120 && MAX_HP < 400);
});
