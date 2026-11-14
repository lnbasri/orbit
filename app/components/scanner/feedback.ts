// Sound and vibration feedback. Browser only. iOS needs a tap before audio can play (unlockAudio on "Mulai scan"),
// and iOS Safari has no vibration: the verdict is therefore always also big, coloured and readable.
let ctx: AudioContext | null = null;

export function unlockAudio() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx ??= new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    // no audio: fine
  }
}

function tone(freq: number, start: number, length: number, gain = 0.18) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  amp.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  amp.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + length);
  osc.connect(amp).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + length + 0.02);
}

export type FeedbackKind = "ok" | "warn" | "bad";

export function feedback(kind: FeedbackKind, soundOn: boolean) {
  try {
    if (soundOn) {
      if (kind === "ok") {
        tone(880, 0, 0.12);
        tone(1320, 0.12, 0.16);
      } else if (kind === "warn") {
        tone(660, 0, 0.18);
        tone(660, 0.26, 0.18);
      } else {
        tone(220, 0, 0.22, 0.25);
        tone(180, 0.28, 0.32, 0.25);
      }
    }
    navigator.vibrate?.(kind === "ok" ? 40 : kind === "warn" ? [60, 60, 60] : [200, 80, 200]);
  } catch {
    // feedback is a nicety
  }
}
