/**
 * Browser autoplay policy requires a user gesture before media can play with sound. A
 * participant device only becomes able to play host-triggered audio/video after such a
 * gesture. We establish and detect that WITHOUT ever touching the real question media —
 * important because on iOS the `volume` property is ignored, so "silently" test-playing
 * the real audio would actually blast it audibly on the user's tap, before the host says
 * go. Instead:
 *
 *  - We play a tiny SILENT tester clip (on mount, for sticky activation carried over from
 *    the join tap, and on every tap). That unlocks the page's audio.
 *  - Any real user gesture also flips `unlocked` directly.
 *
 * The real audio/video is then played only by the host's play command (same path video
 * already uses), never during unlocking — so tapping never starts the question audio.
 */

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

// Play only the SILENT tester — never the real question media.
function testUnlock(): void {
  if (!tester) {
    tester = document.createElement('audio');
    tester.src = silentWavUri();
    tester.muted = true; // muted so it's silent on every platform incl. iOS
  }
  const p = tester.play();
  if (p && typeof p.then === 'function') {
    p.then(() => {
      tester?.pause();
      unlocked = true;
    }).catch(() => {
      /* still locked; a real gesture (below) will also flip it */
    });
  }
}

/**
 * Called from an explicit "I'm ready" tap (a real gesture): "bless" the current question's
 * real audio/video elements by briefly play→pause-ing them (unmuted, within the gesture)
 * and kick off buffering. iOS requires this gesture-initiated play before it will let the
 * host's later Play command start the element — so this makes host-triggered playback
 * reliable across iOS/Android/laptop. Runs at currentTime 0 and resets, so it's just a
 * blink, not the actual playback (which only the host starts).
 */
export function blessRealMedia(): void {
  unlocked = true;
  document.querySelectorAll('audio, .stage-video-wrap video').forEach((node) => {
    const el = node as HTMLMediaElement;
    if ((el.src || '').startsWith('data:')) return;
    try {
      el.load();
    } catch {
      /* ignore */
    }
    const p = el.play();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        el.pause();
        try {
          el.currentTime = 0;
        } catch {
          /* ignore */
        }
      }).catch(() => {
        /* couldn't bless this element; host Play may still work via page activation */
      });
    }
  });
  testUnlock();
}

/** Install once on the participant page. Detects unlock immediately + on every tap. */
export function installAutoplayUnlock(): () => void {
  if (installed) return () => {};
  installed = true;
  const handler = () => {
    gestures++;
    unlocked = true; // a real user gesture occurred → the page can play media on command
    testUnlock();
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
