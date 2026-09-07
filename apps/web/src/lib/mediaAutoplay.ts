/**
 * Browser autoplay policy requires a user gesture before media can play with sound.
 * Participants can't hear host-triggered audio/video unless their media elements have
 * been "unlocked" by a gesture first.
 *
 * We unlock by blessing every currently-paused media element on the participant's taps
 * (they tap to join and to answer anyway): calling play() then immediately pausing it,
 * inside the gesture, marks the element user-activated so it can later be played
 * programmatically when the host hits play. Once blessed, an element stays unlocked.
 */
const blessed = new WeakSet<HTMLMediaElement>();
let installed = false;

export function blessPausedMedia(): void {
  document.querySelectorAll('audio,video').forEach((node) => {
    const el = node as HTMLMediaElement;
    if (blessed.has(el) || !el.paused) return;
    // Bless silently (volume 0) so there's no audible blip; the element still genuinely
    // plays within the gesture, which is what unlocks later programmatic playback.
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
      }).catch(() => {
        el.volume = vol; // still locked; will retry on the next gesture
      });
    } else {
      el.volume = vol;
    }
  });
}

/** Attach once on the participant page: every tap unlocks any not-yet-unlocked media. */
export function installAutoplayUnlock(): () => void {
  if (installed) return () => {};
  installed = true;
  const handler = () => blessPausedMedia();
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
