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
  private ambienceGain: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextAt = 0;
  /** AudioContext সত্যিই চলছে কি না — UI-র শব্দ-বোতাম এটা দেখেই রূপ বদলায়। */
  unlocked = false;
  /** লড়াই যত উত্তপ্ত, তাল তত ঘন (Game বসায়)। */
  intensity = 0;
  musicOn = true;
  sfxOn = true;

  /**
   * প্রথম ব্যবহারকারী-স্পর্শে ডাকা হয়। আগে নতুন context-এ resume() ডাকা হতো না,
   * তাই কোনো কোনো ব্রাউজারে context suspended-ই থেকে যেত — টগল 'চালু' অথচ নীরব।
   * এখন create + resume + compressor, আর সফল হলে ছোট্ট স্বাগত-ঢোল বাজে যাতে
   * খেলোয়াড় সঙ্গে সঙ্গে *শুনে* বুঝতে পারে শব্দ এসেছে।
   */
  unlock(): boolean {
    if (this.ctx) {
      void this.ctx.resume().then(() => { this.unlocked = this.ctx!.state === 'running'; }).catch(() => undefined);
      return this.unlocked || this.ctx.state === 'running';
    }
    try {
      const Ctor: AC | undefined = (globalThis as { AudioContext?: AC }).AudioContext
        ?? (globalThis as { webkitAudioContext?: AC }).webkitAudioContext;
      if (!Ctor) return false;
      this.ctx = new Ctor();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 22; comp.ratio.value = 7;
      comp.attack.value = 0.004; comp.release.value = 0.18;
      comp.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.95;
      this.master.connect(comp);
      this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = this.musicOn ? 0.52 : 0;
      this.musicGain.connect(this.master);
      this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = this.sfxOn ? 1 : 0;
      this.sfxGain.connect(this.master);
      // নদীপাড়ের হাওয়া: লুপ-নয়েজ + লোপাস — যুদ্ধ না থাকলেও পর্দা জীবন্ত শোনায়
      this.ambienceGain = this.ctx.createGain();
      this.ambienceGain.gain.value = this.sfxOn ? 0.028 : 0;
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
      const loop = this.noiseSource(2.4); loop.loop = true;
      loop.connect(lp); lp.connect(this.ambienceGain); this.ambienceGain.connect(this.master);
      loop.start();
      const lfo = this.ctx.createOscillator(); const lg = this.ctx.createGain();
      lfo.frequency.value = 0.09; lg.gain.value = 0.012;
      lfo.connect(lg); lg.connect(this.ambienceGain.gain); lfo.start();
      this.nextAt = this.ctx.currentTime + 0.06;
      this.timer = setInterval(() => this.schedule(), 80);
      void this.ctx.resume().catch(() => undefined);
      this.unlocked = true;
      this.ctx.addEventListener?.('statechange', () => { this.unlocked = this.ctx!.state === 'running'; });
      setTimeout(() => this.startJingle(), 40);
      return true;
    } catch { this.ctx = null; this.unlocked = false; return false; }
  }

  get isUnlocked(): boolean { return this.unlocked && !!this.ctx; }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (this.ctx && this.musicGain) this.musicGain.gain.setTargetAtTime(on ? 0.52 : 0, this.ctx.currentTime, 0.08);
  }
  setSfx(on: boolean): void {
    this.sfxOn = on;
    if (this.ctx && this.sfxGain) this.sfxGain.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
    if (this.ctx && this.ambienceGain) this.ambienceGain.gain.setTargetAtTime(on ? 0.028 : 0, this.ctx.currentTime, 0.1);
  }

  // ─── তাল: ৮-পদক্ষেপ ঢোল-চক্র, ওপরে ধীর বাঁশি-সুর (পঞ্চস্বরী) ───────────────
  private schedule(): void {
    if (!this.ctx || !this.musicGain || !this.musicOn) return;
    // ট্যাব ঘুমিয়ে থাকলে ঘড়ি পিছিয়ে থাকবে — অতীতের সব তাল একসাথে বাজিয়ে দেওয়া নয়
    if (this.nextAt < this.ctx.currentTime - 0.3) this.nextAt = this.ctx.currentTime + 0.05;
    const spb = 60 / (116 + this.intensity * 30) / 2;   // অষ্টমাংশ তাল, লড়াইয়ে দ্রুততর
    // সুরের বাক্য: ১৬ পদক্ষেপের ঢেউ — শূন্যস্থান মানেই আগের সুরের প্রতিধ্বনি শোনা যায়
    const MELODY = [0, -1, 2, 3, 2, -1, 1, 0, 0, -1, 2, 4, 3, 2, 1, -1];
    const SCALE = [293.66, 349.23, 392, 440, 523.25, 587.33];
    const BASS = [73.42, 73.42, 87.31, 98];
    while (this.nextAt < this.ctx.currentTime + 0.24) {
      const s = this.step % 16;
      const bar = Math.floor(this.step / 16);
      const t = this.nextAt;
      if (s % 8 === 0) this.drum(t, 84, 0.85);                            // ভারী 'ধা'
      if (s % 8 === 4) this.drum(t, 108, 0.62);
      if (s % 8 === 6) this.drum(t, 146, 0.42);                           // 'না'
      if (this.intensity > 0.55 && s % 4 === 2) this.drum(t, 122, 0.4);   // উত্তাপে বাড়তি ঘা
      if (s % 2 === 1) this.knock(t, this.intensity > 0.25 ? 0.13 : 0.07); // প্রতি অফ-বিটে খঞ্জনি-ঝিলিক
      if (s % 4 === 0) this.bass(t, BASS[bar % 4]!, 0.75);
      if (s === 0 && bar % 2 === 0) this.bass(t, 36.71, 0.5);             // গভীর ড্রোন (হেডফোনে)
      const note = MELODY[s]!;
      if (note >= 0) {
        const f = SCALE[note]!;
        this.pluck(t, f, 0.34);
        if (this.intensity > 0.3 || s === 0) this.flute(t, f, 0, 0.15);
      }
      this.step += 1;
      this.nextAt += spb;
    }
  }

  /** তারের ঝংকার: ত্রিভুজ-তরঙ্গের দ্রুত ক্ষয় + হালকা দ্বিতীয় হারমোনিক। */
  private pluck(t: number, freq: number, vol: number): void {
    if (!this.ctx || !this.musicGain) return;
    for (const [mul, v] of [[1, vol], [2, vol * 0.32]] as const) {
      const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
      o.type = mul === 1 ? 'triangle' : 'sine'; o.frequency.value = freq * mul;
      this.env(g, t, v, mul === 1 ? 0.34 : 0.16);
      o.connect(g); g.connect(this.musicGain); o.start(t); o.stop(t + 0.4);
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
  private route(g: GainNode, pan: number): void {
    if (!this.ctx || !this.sfxGain) return;
    if (pan !== 0 && typeof this.ctx.createStereoPanner === 'function') {
      const pn = this.ctx.createStereoPanner(); pn.pan.value = Math.max(-0.8, Math.min(0.8, pan));
      g.connect(pn); pn.connect(this.sfxGain);
    } else g.connect(this.sfxGain);
  }
  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', slideTo?: number, delay = 0, pan = 0): void {
    if (!this.ctx || !this.sfxGain || !this.sfxOn) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    this.env(g, t, vol, dur);
    o.connect(g); this.route(g, pan); o.start(t); o.stop(t + dur + 0.03);
  }
  private noise(dur: number, vol: number, freq: number, type: BiquadFilterType = 'bandpass', delay = 0, pan = 0, slideTo?: number): void {
    if (!this.ctx || !this.sfxGain || !this.sfxOn) return;
    const t = this.ctx.currentTime + delay;
    const src = this.noiseSource(dur); const f = this.ctx.createBiquadFilter(); const g = this.ctx.createGain();
    f.type = type; f.frequency.setValueAtTime(freq, t);
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    this.env(g, t, vol, dur);
    src.connect(f); f.connect(g); this.route(g, pan); src.start(t);
  }

  swing(heavy = false, pan = 0): void {
    // ফিল্টার-সুইপেই 'শোঁ' শব্দটা আসে — স্থির ফ্রিকোয়েন্সিতে শুধু হিস শোনাত
    this.noise(heavy ? 0.2 : 0.13, heavy ? 0.5 : 0.34, heavy ? 2400 : 3200, 'bandpass', 0, pan, heavy ? 500 : 800);
  }
  hit(heavy = false, pan = 0): void {
    this.tone(heavy ? 110 : 165, 0.14, heavy ? 0.8 : 0.55, 'sine', 50, 0, pan);
    this.noise(0.08, 0.34, 2600, 'highpass', 0, pan);
    this.tone(heavy ? 620 : 840, 0.06, 0.18, 'square', 300, 0, pan);   // ধাতব ঝনক
  }
  /** আঘাতের গর্জন: নায়ক ও শত্রুর গলার উচ্চতা আলাদা, তাই কানে দল চেনা যায়। */
  grunt(hostile = false, pan = 0): void {
    const f = hostile ? 130 + Math.random() * 40 : 190 + Math.random() * 50;
    this.tone(f, 0.11, 0.24, 'sawtooth', f * 0.55, 0, pan);
  }
  /** বড় আঘাত আসার সতর্ক-বিপ: চোখের লাল ঝলকের কানের সঙ্গী। */
  warning(pan = 0): void { this.tone(1180, 0.07, 0.16, 'square', 880, 0, pan); this.tone(1180, 0.07, 0.13, 'square', 880, 0.1, pan); }
  footstep(): void { this.noise(0.045, 0.07, 420, 'lowpass'); }
  hurt(): void { this.tone(210, 0.16, 0.42, 'sawtooth', 100); this.grunt(false, 0); }
  block(pan = 0): void { this.tone(520, 0.09, 0.34, 'square', 260, 0, pan); this.tone(1240, 0.12, 0.16, 'sine', 900, 0, pan); this.noise(0.06, 0.2, 3400, 'highpass', 0, pan); }
  parry(): void { this.tone(1320, 0.22, 0.42, 'sine', 1760); this.tone(1980, 0.3, 0.22, 'sine', undefined, 0.03); this.noise(0.1, 0.16, 4200, 'highpass'); }
  guardBreak(): void {
    this.noise(0.36, 0.7, 1300, 'bandpass', 0, 0, 300);
    this.noise(0.2, 0.4, 3200, 'highpass', 0.03);
    this.tone(760, 0.38, 0.4, 'square', 130);
    this.tone(88, 0.45, 0.7, 'sine', 42, 0.02);
  }
  dash(): void { this.noise(0.16, 0.26, 500, 'lowpass', 0, 0, 1600); }
  /** শব্দ-চালুর মুহূর্তের প্রমাণ-শব্দ: ঢোল + তিন সুরের আরোহণ। */
  startJingle(): void {
    this.drumNow(0); this.drumNow(0.12);
    [392, 523.25, 659.25].forEach((f, i) => this.tone(f, 0.22, 0.26, 'triangle', undefined, 0.05 + i * 0.09));
  }
  testSound(): void { this.startJingle(); this.swing(true); this.hit(true); }
  resolve(): void {
    this.tone(196, 0.5, 0.4, 'sawtooth', 392);
    this.noise(0.3, 0.3, 1800); this.tone(784, 0.4, 0.22, 'sine', 1175, 0.06);
  }
  pickup(): void { this.tone(880, 0.12, 0.22); this.tone(1175, 0.16, 0.2, 'sine', undefined, 0.07); this.tone(1568, 0.22, 0.16, 'sine', undefined, 0.14); }
  correct(): void { this.tone(659, 0.12, 0.26); this.tone(880, 0.14, 0.26, 'sine', undefined, 0.08); this.tone(1319, 0.26, 0.22, 'sine', undefined, 0.16); }
  wrong(): void { this.tone(220, 0.22, 0.22, 'triangle', 165); }
  down(): void { this.tone(140, 0.22, 0.34, 'sine', 60); this.noise(0.14, 0.16, 500, 'lowpass'); }
  ui(): void { this.tone(620, 0.05, 0.12, 'triangle'); }
  announce(): void {
    this.drumNow(0); this.drumNow(0.13); this.drumNow(0.26);
    // রণশিঙা: দুই সুরের স-তরঙ্গ আহ্বান
    this.tone(196, 0.42, 0.3, 'sawtooth', 294, 0.04);
    this.tone(294, 0.42, 0.2, 'sawtooth', 392, 0.04);
    this.tone(392, 0.3, 0.22, 'triangle', undefined, 0.06);
  }
  win(): void { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.28, 0.24, 'triangle', undefined, i * 0.1)); }
  lose(): void { [392, 330, 262].forEach((f, i) => this.tone(f, 0.32, 0.2, 'triangle', undefined, i * 0.14)); }
  private drumNow(delay: number): void {
    if (!this.ctx) return;
    const keep = this.musicOn; void keep;
    this.tone(130, 0.2, 0.62, 'sine', 58, delay);
  }
  vibrate(ms: number): void {
    try { (globalThis as { navigator?: Navigator }).navigator?.vibrate?.(ms); } catch { /* ডেস্কটপে নেই */ }
  }
}
