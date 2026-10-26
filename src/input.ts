/**
 * src/input.ts — ৬টি ইনপুট, মোবাইল ও ডেস্কটপে হুবহু সমান ক্ষমতা (+ গেমপ্যাড)।
 *
 * কিবোর্ড: J কাটা · K কোপ · L পোঁতা · Space রোধ · Shift সবে · U সংকল্প · অ্যারো/ADWQ চলা
 * টাচ:    ১–৫ বোতাম + ৬ (সংকল্প), বামে আঠালো-স্টিচ, সোয়াইপ = সবে
 * উত্তর:  ১–৪ / ক খ গ ঘ — প্রশ্ন চললে সংখ্যা-কী উত্তরই দেয় (কাটা নয়!)
 * গেমপ্যাড: বাঁ স্টিক চলা · ✕ কাটা · ○ কোপ · △ পোঁতা · □/L রোধ · R সবে · L2/R2 সংকল্প
 *
 * পুরোনো দুটো ত্রুটি সারানো হয়েছে: (১) চলার কী একটা ভ্যারিয়েবলে থাকত, তাই তির্যক চলা
 * যেত না আর এক কী ছাড়লেই চলা থামত; (২) Digit1–4 প্রথমে আঘাতে ম্যাপ হতো বলে কিবোর্ডে
 * উত্তর দেওয়াই অসম্ভব ছিল।
 */
import type { InputName } from './frames.ts';
import type { InputFrame } from './sim.ts';

export const KEY_MAP: Record<string, InputName> = {
  KeyJ: 'cut', KeyK: 'heavy', KeyL: 'thrust', Space: 'guard', ShiftLeft: 'side', ShiftRight: 'side', KeyU: 'resolve',
  Digit1: 'cut', Digit2: 'heavy', Digit3: 'thrust', Digit4: 'guard', Digit5: 'side', Digit6: 'resolve',
};
const MOVE_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
  ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
};

export class InputSource {
  private pressed: InputName | null = null;
  private heldGuard = false;
  private answer: 0 | 1 | 2 | 3 | null = null;
  private parryAnswer: 0 | 1 | 2 | 3 | null = null;
  private heldMove = new Set<string>();
  private mx = 0; private my = 0;
  private stickVec: [number, number] | null = null;
  private stick = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private onFirstTouch: (() => void) | null = null;
  private padPrev: boolean[] = [];
  /** Esc চাপলে Game এখান থেকে বিরতি দেয়। */
  onEscape: (() => void) | null = null;
  /** যেকোনো ইনপুটে (শব্দ জাগাতে Game ব্যবহার করে)। */
  onAny: (() => void) | null = null;

  private readonly root: HTMLElement;

  constructor(root: HTMLElement, onFirstInput?: () => void) {
    this.root = root;
    this.onFirstTouch = onFirstInput ?? null;
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => this.keyUp(e));
    this.bindTouch();
    this.bindButtons();
  }

  private fire(): void { this.onFirstTouch?.(); this.onAny?.(); }

  private syncMove(): void {
    let x = 0, y = 0;
    for (const k of this.heldMove) { const v = MOVE_KEYS[k]!; x += v[0]; y += v[1]; }
    this.mx = Math.max(-1, Math.min(1, x));
    this.my = Math.max(-1, Math.min(1, y));
  }

  private keyDown(e: KeyboardEvent): void {
    if (e.repeat) return;
    // প্রশ্ন চললে ১–৪ = উত্তর (এর আগে কাটা/কোপে ম্যাপ হয়ে উত্তর দেওয়া যেত না)
    if (this.answerMode && /^Digit[1-4]$/.test(e.code)) {
      this.answer = (Number(e.code.slice(5)) - 1) as 0 | 1 | 2 | 3;
      e.preventDefault(); this.fire(); return;
    }
    if (MOVE_KEYS[e.code]) { this.heldMove.add(e.code); this.syncMove(); e.preventDefault(); this.fire(); return; }
    const inp = KEY_MAP[e.code];
    if (inp) { this.pressed = inp; if (inp === 'guard') this.heldGuard = true; e.preventDefault(); this.fire(); return; }
    if (e.code === 'Escape') { this.escape = !this.escape; this.onEscape?.(); }
  }

  answerMode = false;
  escape = false;

  private keyUp(e: KeyboardEvent): void {
    if (MOVE_KEYS[e.code]) { this.heldMove.delete(e.code); this.syncMove(); return; }
    if (KEY_MAP[e.code] === 'guard') this.heldGuard = false;
  }

  private bindButtons(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-input]').forEach((b) => {
      const name = b.dataset.input as InputName;
      const down = (e: Event) => {
        e.preventDefault();
        this.pressed = name;
        if (name === 'guard') this.heldGuard = true;
        this.fire();
        b.classList.add('on');
        try { navigator.vibrate?.(8); } catch { /* নেই */ }
      };
      const up = () => { b.classList.remove('on'); if (name === 'guard') this.heldGuard = false; };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-answer]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.answer = Number(b.dataset.answer) as 0 | 1 | 2 | 3;
        this.fire();
      });
    });
  }

  private bindTouch(): void {
    const pad = this.root.querySelector<HTMLElement>('#stick');
    if (!pad) return;
    pad.addEventListener('pointerdown', (e) => {
      this.stick = { active: true, id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
      pad.setPointerCapture(e.pointerId);
      this.fire();
    });
    pad.addEventListener('pointermove', (e) => {
      if (!this.stick.active || e.pointerId !== this.stick.id) return;
      const dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy;
      const len = Math.max(1, Math.hypot(dx, dy));
      const k = Math.min(1, len / 46);
      this.stickVec = [(dx / len) * k, (dy / len) * k];
      this.stick.x = (dx / len) * k * 30; this.stick.y = (dy / len) * k * 30;
      const knob = this.root.querySelector<HTMLElement>('#stick .knob');
      if (knob) knob.style.transform = `translate(${this.stick.x}px,${this.stick.y}px)`;
    });
    const end = (e: PointerEvent) => {
      if (!this.stick.active) return;
      // সোয়াইপ = সবে (ডিজাইন: টাচে ৫ নম্বর বা সোয়াইপ)
      const dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy;
      if (Math.hypot(dx, dy) > 64 && Math.abs(dx) > Math.abs(dy)) {
        this.pressed = 'side';
        this.stickVec = [Math.sign(dx), 0];
        setTimeout(() => { if (!this.stick.active) this.stickVec = null; }, 120);
      } else this.stickVec = null;
      this.stick = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 };
      const knob = this.root.querySelector<HTMLElement>('#stick .knob');
      if (knob) knob.style.transform = '';
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
  }

  /** গেমপ্যাড: আর্কেড-ক্যাবিনেটের আধুনিক রূপ — থাকলে পড়া হয়, না থাকলে চুপ। */
  private pollGamepad(): void {
    try {
      const gp = navigator.getGamepads?.()[0];
      if (!gp) return;
      const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
      if (Math.abs(ax) > 0.24 || Math.abs(ay) > 0.24) this.stickVec = [ax, ay];
      else if (!this.stick.active && this.stickVec) this.stickVec = null;
      const map: Record<number, InputName> = { 0: 'cut', 1: 'heavy', 3: 'thrust', 2: 'guard', 4: 'guard', 5: 'side', 6: 'resolve', 7: 'resolve' };
      gp.buttons.forEach((b, i) => {
        const was = this.padPrev[i] ?? false;
        if (b.pressed && !was && map[i]) { this.pressed = map[i]!; this.fire(); }
        this.padPrev[i] = b.pressed;
      });
      if (gp.buttons[9]?.pressed && !this.padPrev[9]) this.onEscape?.();
      this.padPrev[9] = gp.buttons[9]?.pressed ?? false;
    } catch { /* গেমপ্যাড API নেই */ }
  }

  /** প্রতি ফ্রেমে একবারই পড়া হয় — পড়া মাত্রাই ইভেন্টকে খরচ করে (no auto-repeat)। */
  read(): InputFrame {
    this.pollGamepad();
    const guard = this.heldGuard && !this.pressed ? 'guard' : null;
    const mvx = this.stickVec ? this.stickVec[0] : this.mx;
    const mvy = this.stickVec ? this.stickVec[1] : this.my;
    const f: InputFrame = {
      moveX: Math.abs(mvx) < 0.22 ? 0 : mvx,
      moveY: Math.abs(mvy) < 0.22 ? 0 : mvy,
      pressed: this.pressed ?? guard,
      answer: this.answer,
      parryAnswer: this.parryAnswer,
    };
    this.pressed = null; this.answer = null; this.parryAnswer = null;
    return f;
  }

  /** জোরপূর্বক অবস্থা পরিবর্তন (টেস্ট/অটো-প্লে)। */
  inject(inp: InputName | null, mx = 0, my = 0, ans: 0 | 1 | 2 | 3 | null = null): void {
    this.pressed = inp; this.mx = mx; this.my = my; this.answer = ans;
    if (mx !== 0 || my !== 0) this.stickVec = null;
  }
}
