export interface Clock {
  schedule(cb: () => void): void;
  cancel(): void;
}

export interface PlaybackOptions {
  totalSteps: number;
  onStep: (index: number) => void;
  /** Fires once at the moment natural playback transitions from
   *  playing → stopped (index reaches totalSteps). Lets the orchestrator
   *  flip its `playing` flag and rebuild the transport so the play/pause
   *  button doesn't stay stuck on "pause" after the run finishes.
   *  Does NOT fire on manual pause() or stepTo(end). */
  onComplete?: () => void;
  clock: Clock;
}

export interface PlaybackController {
  play(): void;
  pause(): void;
  stepTo(index: number): void;
  getIndex(): number;
  isPlaying(): boolean;
}

export function createPlayback(opts: PlaybackOptions): PlaybackController {
  const { totalSteps, onStep, onComplete, clock } = opts;
  let index = 0;
  let playing = false;

  function clamp(i: number): number {
    if (i < 0) return 0;
    if (i > totalSteps) return totalSteps;
    return i;
  }

  function setIndex(i: number): void {
    const clamped = clamp(i);
    if (clamped === index) return;
    index = clamped;
    onStep(index);
  }

  function scheduleTick(): void {
    clock.schedule(() => {
      if (!playing) return;
      if (index >= totalSteps) {
        playing = false;
        onComplete?.();
        return;
      }
      setIndex(index + 1);
      if (index >= totalSteps) {
        playing = false;
        onComplete?.();
        return;
      }
      scheduleTick();
    });
  }

  return {
    play(): void {
      if (index >= totalSteps) {
        setIndex(0);
      }
      if (playing) return;
      playing = true;
      scheduleTick();
    },
    pause(): void {
      playing = false;
      clock.cancel();
    },
    stepTo(i: number): void {
      setIndex(i);
    },
    getIndex(): number {
      return index;
    },
    isPlaying(): boolean {
      return playing;
    },
  };
}

export function createRafClock(intervalMs: number | (() => number)): Clock {
  const getInterval = typeof intervalMs === 'function' ? intervalMs : () => intervalMs;
  let timer: number | null = null;
  return {
    schedule(cb: () => void): void {
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        cb();
      }, getInterval());
    },
    cancel(): void {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    },
  };
}
