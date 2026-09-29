import { useCallback, useEffect, useRef, useState } from "react";
import { BoxLoader } from "./box-loader";
import { JevboxIcon } from "./jevbox-icon";
import { Button } from "./coss/button";

const SIZES = [16, 24, 40, 64, 96];
const SPEEDS = [0.25, 0.5, 1, 2];

// Dev preview for BoxLoader, served at /loader outside the signed-in app.
export function LoaderPreview() {
  const root = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(2800);

  const animations = useCallback(
    () => root.current?.getAnimations({ subtree: true }) ?? [],
    [],
  );

  useEffect(() => {
    const [first] = animations();
    const total = first?.effect?.getTiming().duration;
    if (typeof total === "number") setDuration(total);
  }, [animations]);

  useEffect(() => {
    for (const animation of animations()) {
      animation.playbackRate = speed;
      if (playing) animation.play();
      else animation.pause();
    }
    if (!playing) return;
    let frame = requestAnimationFrame(function update() {
      const current = Number(animations()[0]?.currentTime ?? 0);
      setTime(current % duration);
      frame = requestAnimationFrame(update);
    });
    return () => cancelAnimationFrame(frame);
  }, [animations, duration, playing, speed]);

  const scrub = (value: number) => {
    setPlaying(false);
    setTime(value);
    for (const animation of animations()) {
      animation.pause();
      animation.currentTime = value;
    }
  };

  return (
    <main className="loader-preview">
      <header>
        <h1>Box loader</h1>
        <p>
          Loops every {(duration / 1000).toFixed(1)}s and rests on the Jevbox
          icon.
        </p>
      </header>
      <div className="loader-preview-stage" ref={root}>
        <figure>
          <JevboxIcon size={160} className="loader-preview-icon" />
          <figcaption>Icon</figcaption>
        </figure>
        <figure>
          <BoxLoader size={160} />
          <figcaption>Loader</figcaption>
        </figure>
        <div className="loader-preview-sizes">
          {SIZES.map((size) => (
            <figure key={size}>
              <BoxLoader size={size} />
              <figcaption>{size}px</figcaption>
            </figure>
          ))}
        </div>
      </div>
      <div className="loader-preview-controls">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPlaying((value) => !value)}
        >
          {playing ? "Pause" : "Play"}
        </Button>
        <input
          type="range"
          min={0}
          max={duration - 1}
          step={10}
          value={Math.round(time)}
          aria-label="Scrub animation"
          onChange={(event) => scrub(Number(event.target.value))}
        />
        <output>{Math.round(time)}ms</output>
        <div className="loader-preview-speeds" role="group" aria-label="Speed">
          {SPEEDS.map((value) => (
            <Button
              key={value}
              variant={value === speed ? "secondary" : "ghost"}
              size="xs"
              onClick={() => setSpeed(value)}
            >
              {value}×
            </Button>
          ))}
        </div>
      </div>
    </main>
  );
}
