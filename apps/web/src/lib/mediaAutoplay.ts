/**
 * Browser autoplay policy requires a user gesture before media can play with sound. A
 * participant's device can only promise "I will play when the host hits play" once its
 * audio is UNLOCKED. We detect that automatically (no button):
 *
 *  - A tiny silent audio element is test-played on mount (to catch sticky activation
 *    carried over from the join tap) and on every subsequent tap. If it plays, audio is
 *    unlocked for this page.
 *  - Each real paused media element is also blessed (silently) on taps so it's playable.
 *
 * `isAudioUnlocked()` lets the readiness reporter tell the host the device is good to go.
 */

// A ~50ms silent WAV as a data URI — loads with no network, safe to test-play.
function silentWavUri(): string {
  const sr = 8000;
  const n = Math.floor(sr * 0.05);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n * 2, true);
  let s = '';
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return 'data:audio/wav;base64,' + btoa(s);
}

let unlocked = false;
let installed = false;
let gestures = 0;
let tester: HTMLAudioElement | null = null;
const blessed = new WeakSet<HTMLMediaElement>();

export function isAudioUnlocked(): boolean {
  return unlocked;
}

if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as unknown as { __mp?: unknown }).__mp = {
    unlocked: () => unlocked,
    gestures: () => gestures,
    installed: () => installed,
  };
}

function testUnlock(): void {
  if (unlocked) return;
  if (!tester) {
    tester = document.createElement('audio');
    tester.src = silentWavUri();
    tester.volume = 0;
  }
  const p = tester.play();
  if (p && typeof p.then === 'function') {
    p.then(() => {
      tester?.pause();
      unlocked = true;
    }).catch(() => {
      /* still locked; another gesture will retry */
    });
  }
}

function blessPausedMedia(): void {
  document.querySelectorAll('audio,video').forEach((node) => {
    const el = node as HTMLMediaElement;
    if (blessed.has(el) || !el.paused) return;
    const vol = el.volume;
    el.volume = 0;
    const p = el.play();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        el.pause();
        try {
          el.currentTime = 0;
        } catch {
          /* ignore */
        }
        el.volume = vol;
        blessed.add(el);
        unlocked = true;
      }).catch(() => {
        el.volume = vol;
      });
    } else {
      el.volume = vol;
    }
  });
}

/** Install once on the participant page. Detects unlock immediately + on every tap. */
export function installAutoplayUnlock(): () => void {
  if (installed) return () => {};
  installed = true;
  const handler = () => {
    gestures++;
    unlocked = true; // a real user gesture occurred → the page can play media
    testUnlock();
    blessPausedMedia();
  };
  // Try immediately (sticky activation from the join tap may already allow playback).
  testUnlock();
  document.addEventListener('pointerdown', handler, { capture: true });
  document.addEventListener('touchstart', handler, { capture: true, passive: true });
  document.addEventListener('click', handler, { capture: true });
  return () => {
    installed = false;
    document.removeEventListener('pointerdown', handler, true);
    document.removeEventListener('touchstart', handler, true);
    document.removeEventListener('click', handler, true);
  };
}
