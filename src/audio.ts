/**
 * src/audio.ts — কোডেই বানানো শব্দ (WebAudio), কোনো অডিও-ফাইল নেই।
 *
 * আগের সংস্করণে 'যন্ত্রসংগীত' টগল ছিল, কিন্তু শব্দ বলতে কিছুই বাজত না —
 * নীরব লড়াই আর্কেড-অনুভূতির সবচেয়ে বড় শত্রু। এখানে ঢোল-নাকা 동작ের তাল,
 * বাঁশির মতো সাইন-সুর আর লড়াইয়ের সব SFX অসিলেটর/নয়েজ দিয়ে তৈরি;
 * ফাইল-বাজেটে খরচ শূন্য, অফলাইনেও চলে।
 *
 * নীতি (design §৫): যন্ত্রসংগীত সম্পূর্ণ বন্ধ করা যায়; SFX আলাদা করে মিউটও যায়।
 * ব্রাউজার নীতি অনুযায়ী AudioContext প্রথম স্পর্শ/ক্লিকের পরেই জাগে (unlock)।
 */

type AC = typeof AudioContext;

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextAt = 0;
  /** লড়াই যত উত্তপ্ত, তাল তত ঘন (Game বসায়)। */
  intensity = 0;
  musicOn = true;
  sfxOn = true;

  /** প্রথম ব্যবহারকারী-স্পর্শে ডাকা হয়; ব্যর্থ হলে খেলা নীরবে চলে (ক্র্যাশ নয়)। */
  unlock(): void {
    if (this.ctx) { void this.ctx.resume().catch(() => undefined); return; }
    try {
      const Ctor: AC | undefined = (globalThis as { AudioContext?: AC }).AudioContext
        ?? (globalThis as { webkitAudioContext?: AC }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.85;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = this.musicOn ? 0.34 : 0;
      this.musicGain.connect(this.master);
      this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = this.sfxOn ? 0.9 : 0;
      this.sfxGain.connect(this.master);
      this.nextAt = this.ctx.currentTime + 0.06;
      this.timer = setInterval(() => this.schedule(), 90);
    } catch { this.ctx = null; }
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (this.ctx && this.musicGain) this.musicGain.gain.setTargetAtTime(on ? 0.34 : 0, this.ctx.currentTime, 0.08);
  }
  setSfx(on: boolean): void {
    this.sfxOn = on;
    if (this.ctx && this.sfxGain) this.sfxGain.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
  }

  // ─── তাল: ৮-পদক্ষেপ ঢোল-চক্র, ওপরে ধীর বাঁশি-সুর (পঞ্চস্বরী) ───────────────
  private schedule(): void {
    if (!this.ctx || !this.musicGain || !this.musicOn) return;
    // ট্যাব ঘুমিয়ে থাকলে ঘড়ি পিছিয়ে থাকবে — অতীতের সব তাল একসাথে বাজিয়ে দেওয়া নয়
    if (this.nextAt < this.ctx.currentTime - 0.3) this.nextAt = this.ctx.currentTime + 0.05;
    const spb = 60 / (104 + this.intensity * 22) / 2;   // অষ্টমাংশ তাল
    while (this.nextAt < this.ctx.currentTime + 0.22) {
      const s = this.step % 16;
      const t = this.nextAt;
      if (s % 4 === 0) this.drum(t, 92, 0.5);                       // ঢোলের 'ধা'
      if (s % 8 === 6) this.drum(t, 150, 0.28);                     // 'না'-এর খোঁচা
      if (this.intensity > 0.35 && s % 2 === 1) this.knock(t, 0.12);
      if (this.intensity > 0.7 && s % 4 === 3) this.drum(t, 118, 0.3);
      if (s === 0 || s === 6 || s === 10) {                          // সুরের ফোঁটা
        const scale = [293.66, 349.23, 392, 440, 523.25, 587.33];
        const idx = [0, 2, 3, 2, 4, 3, 2, 1][Math.floor(this.step / 16) % 8]!;
        this.flute(t, scale[idx]!, 0.002 + (s === 0 ? 0.35 : 0.22), 0.16);
      }
      if (s % 8 === 0) this.bass(t, 73.42, 0.5);
      this.step += 1;
      this.nextAt += spb;
    }
  }

  private env(g: GainNode, t: number, peak: number, dur: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  private drum(t: number, freq: number, vol: number): void {
    if (!this.ctx || !this.musicGain) return;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(freq * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + 0.14);
    this.env(g, t, vol, 0.16);
    o.connect(g); g.connect(this.musicGain); o.start(t); o.stop(t + 0.2);
  }
  private knock(t: number, vol: number): void {
    if (!this.ctx || !this.musicGain) return;
    const src = this.noiseSource(0.05); const f = this.ctx.createBiquadFilter(); const g = this.ctx.createGain();
    f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 1.2;
    this.env(g, t, vol, 0.05);
    src.connect(f); f.connect(g); g.connect(this.musicGain); src.start(t);
  }
  private flute(t: number, freq: number, _lead: number, vol: number): void {
    if (!this.ctx || !this.musicGain) return;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain(); const vib = this.ctx.createOscillator(); const vg = this.ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    vib.frequency.value = 5.2; vg.gain.value = freq * 0.006; vib.connect(vg); vg.connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.07);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(g); g.connect(this.musicGain);
    o.start(t); o.stop(t + 0.46); vib.start(t); vib.stop(t + 0.46);
  }
  private bass(t: number, freq: number, vol: number): void {
    if (!this.ctx || !this.musicGain) return;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.type = 'triangle'; o.frequency.value = freq;
    this.env(g, t, vol * 0.4, 0.5);
    o.connect(g); g.connect(this.musicGain); o.start(t); o.stop(t + 0.55);
  }

  private noiseSource(dur: number): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf; return src;
  }

  // ─── SFX ──────────────────────────────────────────────────────────────────
  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', slideTo?: number, delay = 0): void {
    if (!this.ctx || !this.sfxGain || !this.sfxOn) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    this.env(g, t, vol, dur);
    o.connect(g); g.connect(this.sfxGain); o.start(t); o.stop(t + dur + 0.03);
  }
  private noise(dur: number, vol: number, freq: number, type: BiquadFilterType = 'bandpass', delay = 0): void {
    if (!this.ctx || !this.sfxGain || !this.sfxOn) return;
    const t = this.ctx.currentTime + delay;
    const src = this.noiseSource(dur); const f = this.ctx.createBiquadFilter(); const g = this.ctx.createGain();
    f.type = type; f.frequency.value = freq;
    this.env(g, t, vol, dur);
    src.connect(f); f.connect(g); g.connect(this.sfxGain); src.start(t);
  }

  swing(heavy = false): void { this.noise(heavy ? 0.16 : 0.1, heavy ? 0.32 : 0.2, heavy ? 900 : 1500); }
  hit(heavy = false): void {
    this.tone(heavy ? 120 : 170, 0.12, heavy ? 0.55 : 0.36, 'sine', 55);
    this.noise(0.07, 0.22, 2400, 'highpass');
  }
  hurt(): void { this.tone(210, 0.14, 0.3, 'sawtooth', 110); }
  block(): void { this.tone(340, 0.07, 0.22, 'square', 240); this.noise(0.05, 0.14, 3200, 'highpass'); }
  parry(): void { this.tone(1320, 0.2, 0.32, 'sine', 1760); this.tone(1980, 0.26, 0.16, 'sine', undefined, 0.03); }
  guardBreak(): void {
    this.noise(0.32, 0.5, 1100, 'bandpass');
    this.tone(760, 0.35, 0.3, 'square', 140);
    this.tone(90, 0.4, 0.5, 'sine', 45, 0.02);
  }
  dash(): void { this.noise(0.12, 0.14, 700, 'lowpass'); }
  resolve(): void {
    this.tone(196, 0.5, 0.4, 'sawtooth', 392);
    this.noise(0.3, 0.3, 1800); this.tone(784, 0.4, 0.22, 'sine', 1175, 0.06);
  }
  pickup(): void { this.tone(880, 0.12, 0.22); this.tone(1175, 0.16, 0.2, 'sine', undefined, 0.07); this.tone(1568, 0.22, 0.16, 'sine', undefined, 0.14); }
  correct(): void { this.tone(659, 0.12, 0.26); this.tone(880, 0.14, 0.26, 'sine', undefined, 0.08); this.tone(1319, 0.26, 0.22, 'sine', undefined, 0.16); }
  wrong(): void { this.tone(220, 0.22, 0.22, 'triangle', 165); }
  down(): void { this.tone(140, 0.22, 0.34, 'sine', 60); this.noise(0.14, 0.16, 500, 'lowpass'); }
  ui(): void { this.tone(620, 0.05, 0.12, 'triangle'); }
  announce(): void { this.drumNow(0); this.drumNow(0.13); this.tone(392, 0.3, 0.2, 'triangle', undefined, 0.05); }
  win(): void { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.28, 0.24, 'triangle', undefined, i * 0.1)); }
  lose(): void { [392, 330, 262].forEach((f, i) => this.tone(f, 0.32, 0.2, 'triangle', undefined, i * 0.14)); }
  private drumNow(delay: number): void {
    if (!this.ctx) return;
    const keep = this.musicOn; void keep;
    this.tone(130, 0.18, 0.4, 'sine', 60, delay);
  }
  vibrate(ms: number): void {
    try { (globalThis as { navigator?: Navigator }).navigator?.vibrate?.(ms); } catch { /* ডেস্কটপে নেই */ }
  }
}
