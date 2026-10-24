/**
 * src/input.ts — ৬টি ইনপুট, মোবাইল ও ডেস্কটপে হুবহু সমান ক্ষমতা।
 *
 * কিবোর্ড: J কাটা · K কোপ · L পোঁতা · Space রোধ · Shift সবে · U সংকল্প · অ্যারো/ADWQ চলা
 * টাচ:    ১–৫ বোতাম + ৬ (সংকল্প), বামে আঠালো-স্টিচ, সোয়াইপ = সবে
 * উত্তর:  ১–৪ / ক খ গ ঘ — লড়াই থামে না, তাই ইনপুট কিউতে বসে না, ফ্রেমে পড়া হয়।
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
  private mx = 0; private my = 0;
  private stick = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private onFirstTouch: (() => void) | null = null;

  private readonly root: HTMLElement;

  constructor(root: HTMLElement, onFirstInput?: () => void) {
    this.root = root;
    this.onFirstTouch = onFirstInput ?? null;
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => this.keyUp(e));
    this.bindTouch();
    this.bindButtons();
  }

  private fire(): void { this.onFirstTouch?.(); }

  private keyDown(e: KeyboardEvent): void {
    if (e.repeat) return;
    const mv = MOVE_KEYS[e.code];
    if (mv) { this.mx = mv[0]; this.my = mv[1]; e.preventDefault(); this.fire(); return; }
    const inp = KEY_MAP[e.code];
    if (inp) { this.pressed = inp; if (inp === 'guard') this.heldGuard = true; e.preventDefault(); this.fire(); return; }
    if (/^Digit[1-4]$/.test(e.code) && this.answerMode) { this.answer = Number(e.code.slice(5)) - 1 as 0 | 1 | 2 | 3; this.fire(); }
    if (e.code === 'Escape') { this.escape = !this.escape; }
  }

  answerMode = false;
  escape = false;

  private keyUp(e: KeyboardEvent): void {
    const mv = MOVE_KEYS[e.code];
    if (mv) { if (this.mx === mv[0] && this.my === mv[1]) { this.mx = 0; this.my = 0; } return; }
    if (KEY_MAP[e.code] === 'guard') this.heldGuard = false;
  }

  private bindButtons(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-input]').forEach((b) => {
      const name = b.dataset.input as InputName;
      const down = (e: Event) => { e.preventDefault(); this.pressed = name; this.fire(); b.classList.add('on'); };
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
      this.mx = (dx / len) * k; this.my = (dy / len) * k;
      this.stick.x = (dx / len) * k * 30; this.stick.y = (dy / len) * k * 30;
      const knob = this.root.querySelector<HTMLElement>('#stick .knob');
      if (knob) knob.style.transform = `translate(${this.stick.x}px,${this.stick.y}px)`;
    });
    const end = (e: PointerEvent) => {
      if (!this.stick.active) return;
      // সোয়াইপ = সবে (ডিজাইন: টাচে ৫ নম্বর বা সোয়াইপ)
      const dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy;
      if (Math.hypot(dx, dy) > 64 && Math.abs(dx) > Math.abs(dy)) this.pressed = 'side';
      this.stick = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 };
      this.mx = 0; this.my = 0;
      const knob = this.root.querySelector<HTMLElement>('#stick .knob');
      if (knob) knob.style.transform = '';
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
  }

  /** প্রতি ফ্রেমে একবারই পড়া হয় — পড়া মাত্রাই ইভেন্টকে খরচ করে (no auto-repeat)। */
  read(): InputFrame {
    const guard = this.heldGuard && !this.pressed ? 'guard' : null;
    const f: InputFrame = {
      moveX: Math.abs(this.mx) < 0.22 ? 0 : this.mx,
      moveY: Math.abs(this.my) < 0.22 ? 0 : this.my,
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
  }
}
