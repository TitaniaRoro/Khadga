/**
 * src/main.ts — বুট: কনটেন্ট আনা → খেলা চালু → Service Worker (অফলাইনেও খেলা চলে)।
 */
import { Game } from './game.ts';
import type { ContentDoc } from './content-types.ts';

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) return;
  const fail = (msg: string): void => {
    document.getElementById('loadmsg')!.textContent = msg;
  };
  let doc: ContentDoc;
  try {
    const r = await fetch('content/chapters.json', { cache: 'force-cache' });
    if (!r.ok) throw new Error(String(r.status));
    doc = (await r.json()) as ContentDoc;
  } catch {
    fail('সামগ্রী পড়া যায়নি — বিল্ড ঠিক আছে কি না দেখো (npm run build)।');
    return;
  }
  document.getElementById('loadmsg')?.remove();
  document.getElementById('gtitle')!.textContent = doc.meta.title_bn;
  document.getElementById('gsub')!.textContent = doc.meta.subtitle_bn;
  document.documentElement.lang = doc.meta.language;
  const game = new Game(doc, root);
  (window as unknown as { khadga: Game }).khadga = game;
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    addEventListener('load', () => { void navigator.serviceWorker.register('sw.js').catch(() => undefined); });
  }
}

void boot();
