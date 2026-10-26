/**
 * tests/feel.test.ts — চোখে ও কানে খেলা বোঝার প্রমাণ।
 *
 * ব্যবহারকারীর অভিযোগ দুটো ছিল: (১) নায়ক ও শত্রুর পোশাক একই, (২) শব্দ নেই।
 * এই পরীক্ষা সেই দুটো ফেরত আসা আটকায়: প্রতিটি চরিত্রের পোশাক-আকৃতি/প্রতীক/অস্ত্র
 * আলাদা থাকতে হবে, আর SoundEngine সত্যিকারের AudioContext পেলে resume করে
 * শব্দের node চালু করবে — নীরব no-op নয়।
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OUTFITS, outfitOf } from '../src/render.ts';
import { Fighter, type EnemyKind } from '../src/fighter.ts';
import { SoundEngine } from '../src/audio.ts';

test('নায়ক, প্রতিটি শত্রু, বস ও মিত্রের পোশাক-পরিচয় আলাদা', () => {
  const entries = Object.entries(OUTFITS) as [EnemyKind, typeof OUTFITS.hero][];
  assert.equal(entries.length, 7);
  const fingerprint = entries.map(([, o]) => [o.garment, o.shape, o.badge, o.weapon_bn, o.head, o.sash].join('|'));
  assert.equal(new Set(fingerprint).size, entries.length, 'দুই ধরনের পোশাক-সেট এক হয়ে গেছে');
  assert.equal(new Set(entries.map(([, o]) => o.shape)).size, entries.length, 'পোশাকের সিলুয়েট আলাদা নয়');
  assert.equal(new Set(entries.map(([, o]) => o.badge)).size, entries.length, 'বুকের প্রতীক আলাদা নয়');
  assert.equal(new Set(entries.map(([, o]) => o.weapon_bn)).size, entries.length, 'অস্ত্র আলাদা নয়');

  const hero = OUTFITS.hero;
  for (const [kind, outfit] of entries) {
    assert.ok(outfit.label_bn.length > 2 && outfit.weapon_bn.length > 1, `${kind}: পরিচিতি অসম্পূর্ণ`);
    if (kind === 'hero') continue;
    assert.notEqual(
      [outfit.garment, outfit.shape, outfit.badge, outfit.weapon_bn].join('|'),
      [hero.garment, hero.shape, hero.badge, hero.weapon_bn].join('|'),
      `${kind} আবার নায়কের মতো দেখাচ্ছে`,
    );
  }

  const make = (kind: EnemyKind): Fighter => new Fighter({
    name_bn: kind, facing: 1, x: 0, y: 0, tone: '#000000', defense: 1, kind,
  });
  assert.equal(outfitOf(make('blade'), 'foe'), OUTFITS.blade);
  assert.equal(outfitOf(make('blade'), 'hero'), OUTFITS.hero, 'খেলোয়াড়ের ভূমিকা সবসময় নায়কের পোশাক পায়');
  assert.equal(outfitOf(make('blade'), 'ally'), OUTFITS.ally, 'মিত্রকে শত্রুর পোশাকে আঁকা যাবে না');
});

class FakeParam {
  value = 0;
  setValueAtTime(v: number): void { this.value = v; }
  exponentialRampToValueAtTime(v: number): void { this.value = v; }
  setTargetAtTime(v: number): void { this.value = v; }
}

class FakeNode {
  gain = new FakeParam(); frequency = new FakeParam(); Q = new FakeParam(); pan = new FakeParam();
  threshold = new FakeParam(); knee = new FakeParam(); ratio = new FakeParam(); attack = new FakeParam(); release = new FakeParam();
  type = ''; buffer: unknown = null; loop = false;
  connect(): void {}
  start(): void {}
  stop(): void {}
}

class FakeAudioContext {
  static last: FakeAudioContext | null = null;
  state = 'suspended';
  currentTime = 0;
  sampleRate = 8000;
  destination = new FakeNode();
  resumeCalls = 0;
  starts = 0;

  constructor() { FakeAudioContext.last = this; }
  async resume(): Promise<void> { this.resumeCalls += 1; this.state = 'running'; }
  addEventListener(): void {}
  private node(): FakeNode {
    const n = new FakeNode();
    n.start = () => { this.starts += 1; };
    return n;
  }
  createDynamicsCompressor(): FakeNode { return this.node(); }
  createGain(): FakeNode { return this.node(); }
  createBiquadFilter(): FakeNode { return this.node(); }
  createOscillator(): FakeNode { return this.node(); }
  createBufferSource(): FakeNode { return this.node(); }
  createStereoPanner(): FakeNode { return this.node(); }
  createBuffer(_channels: number, len: number): { getChannelData: () => Float32Array } {
    return { getChannelData: () => new Float32Array(len) };
  }
}

test('AudioContext না থাকলে SoundEngine নীরবে নিরাপদ থাকে', () => {
  const g = globalThis as unknown as { AudioContext?: unknown; webkitAudioContext?: unknown };
  const old = g.AudioContext, oldWebkit = g.webkitAudioContext;
  g.AudioContext = undefined; g.webkitAudioContext = undefined;
  try {
    const s = new SoundEngine();
    assert.equal(s.unlock(), false);
    assert.equal(s.isUnlocked, false);
    assert.doesNotThrow(() => { s.swing(true); s.hit(true); s.warning(); s.ui(); });
  } finally {
    g.AudioContext = old; g.webkitAudioContext = oldWebkit;
  }
});

test('AudioContext থাকলে unlock সত্যিই resume করে এবং SFX node চালু হয়', () => {
  const g = globalThis as unknown as { AudioContext?: unknown; webkitAudioContext?: unknown };
  const old = g.AudioContext, oldWebkit = g.webkitAudioContext;
  g.AudioContext = FakeAudioContext; g.webkitAudioContext = undefined;
  const s = new SoundEngine();
  try {
    assert.equal(s.unlock(), true);
    assert.equal(s.isUnlocked, true);
    const ctx = FakeAudioContext.last!;
    assert.ok(ctx.resumeCalls >= 1, 'নতুন context-এ resume ডাকা হয়নি — ব্রাউজারে suspended থাকতে পারে');
    const before = ctx.starts;
    s.testSound();
    s.swing(true, -0.5);
    s.warning(0.5);
    assert.ok(ctx.starts >= before + 6, `SFX চালু হওয়ার প্রমাণ কম: ${ctx.starts - before}`);

    s.setSfx(false);
    const muted = ctx.starts;
    s.swing(true); s.hit(true);
    assert.equal(ctx.starts, muted, 'SFX বন্ধ থাকলেও শব্দ তৈরি হচ্ছে');
  } finally {
    const timer = (s as unknown as { timer: ReturnType<typeof setInterval> | null }).timer;
    if (timer) clearInterval(timer);
    g.AudioContext = old; g.webkitAudioContext = oldWebkit;
  }
});
