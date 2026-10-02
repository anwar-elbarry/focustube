import { useCallback, useEffect, useRef, useState } from "react";

export type Phase = "focus" | "break";
export type Preset = { focus: number; break: number; label: string };

export const PRESETS: Preset[] = [
  { focus: 25, break: 5, label: "25 / 5" },
  { focus: 50, break: 10, label: "50 / 10" },
];

export type TimerState = {
  preset: Preset;
  phase: Phase;
  /** Seconds left in the current phase. */
  remaining: number;
  paused: boolean;
};

/** Pomodoro timer; `onPhaseEnd` receives the phase that is starting. */
export function useFocusTimer(onPhaseEnd: (next: Phase, preset: Preset) => void) {
  const [timer, setTimer] = useState<TimerState | null>(null);
  const endRef = useRef(onPhaseEnd);
  endRef.current = onPhaseEnd;

  useEffect(() => {
    if (!timer || timer.paused) return;
    const t = setInterval(() => {
      setTimer((s) => {
        if (!s || s.paused) return s;
        if (s.remaining > 1) return { ...s, remaining: s.remaining - 1 };
        const next: Phase = s.phase === "focus" ? "break" : "focus";
        // Defer the side effect out of the state updater.
        setTimeout(() => endRef.current(next, s.preset));
        return { ...s, phase: next, remaining: s.preset[next] * 60 };
      });
    }, 1000);
    return () => clearInterval(t);
  }, [timer?.paused, timer !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback(
    (preset: Preset) => setTimer({ preset, phase: "focus", remaining: preset.focus * 60, paused: false }),
    []
  );
  const togglePause = useCallback(() => setTimer((s) => s && { ...s, paused: !s.paused }), []);
  const skip = useCallback(
    () =>
      setTimer((s) => {
        if (!s) return s;
        const next: Phase = s.phase === "focus" ? "break" : "focus";
        return { ...s, phase: next, remaining: s.preset[next] * 60, paused: false };
      }),
    []
  );
  const stop = useCallback(() => setTimer(null), []);

  return { timer, start, togglePause, skip, stop };
}

/** A soft two-note chime, so a phase change is noticed without looking. */
export function chime() {
  try {
    const ctx = new AudioContext();
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      const t0 = ctx.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.18, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.65);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch {
    /* audio unavailable */
  }
}

export const formatClock = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
