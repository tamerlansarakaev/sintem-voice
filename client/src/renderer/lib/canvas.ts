// Canvas animations. Each draws every frame until `destroy` and keeps the
// canvas sharp at the device pixel ratio.

const AMBER = '245, 165, 36';

function animate(
  canvas: HTMLCanvasElement,
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void,
) {
  const context = canvas.getContext('2d')!;
  let frame = 0;

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * ratio;
    canvas.height = canvas.clientHeight * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function tick() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    context.clearRect(0, 0, width, height);
    draw(context, width, height);
    frame = requestAnimationFrame(tick);
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
  };
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

// A few layered sine lines whose height follows `setLevel` (0..1) and
// eases between values, never below `idle`.
export function createWave(
  canvas: HTMLCanvasElement,
  { color = AMBER, lines = 4, idle = 0.18 } = {},
) {
  let level = idle;
  let target = idle;
  let phase = 0;

  const destroy = animate(canvas, (context, width, height) => {
    level += (target - level) * 0.08;
    phase += 0.02 + level * 0.06;

    for (let line = 0; line < lines; line++) {
      const depth = line / lines;
      const amplitude = height * 0.42 * level * (1 - depth * 0.55);
      const frequency = 1.4 + line * 0.55;
      context.beginPath();
      for (let x = 0; x <= width; x += 3) {
        const progress = x / width;
        // Tapers to flat at both edges.
        const envelope = Math.sin(Math.PI * progress) ** 2;
        const y =
          height / 2 +
          Math.sin(progress * Math.PI * 2 * frequency + phase * (1 + line * 0.3)) *
            amplitude *
            envelope;
        if (x === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.strokeStyle = `rgba(${color}, ${0.55 - depth * 0.4})`;
      context.lineWidth = line === 0 ? 2 : 1.25;
      context.stroke();
    }
  });

  return {
    setLevel(value: number) {
      target = Math.max(idle, Math.min(1, value));
    },
    destroy,
  };
}

export type Bars = ReturnType<typeof createBars>;

// Equalizer bars on both sides of a centre gap: the left side follows the
// input level, the right side the output level. `gap` is a width in pixels
// or a function returning it, for a gap that follows the layout.
export function createBars(
  canvas: HTMLCanvasElement,
  { color = AMBER, gap: gapOption = 150 as number | (() => number) } = {},
) {
  const BAR = 3;
  const STEP = 7;
  // Silence keeps the bars still as flat dots.
  const sides = [
    { level: 0, target: 0, phase: 0 },
    { level: 0, target: 0, phase: 0 },
  ];

  const destroy = animate(canvas, (context, width, height) => {
    const center = width / 2;
    const gap = typeof gapOption === 'function' ? gapOption() : gapOption;
    for (const side of sides) {
      side.level += (side.target - side.level) * 0.12;
      side.phase += side.level * 0.12;
    }

    const drawBar = (x: number, { level, phase }: (typeof sides)[number]) => {
      const distance = Math.abs(x - center) - gap / 2;
      const reach = center - gap / 2;
      // Tallest next to the centre, fading out towards the edges.
      const envelope = Math.max(0, 1 - distance / reach) ** 1.4;
      const motion =
        0.35 +
        0.65 *
          Math.abs(
            Math.sin(distance * 0.09 - phase) * Math.sin(distance * 0.031 + phase * 0.6),
          );
      const barHeight = Math.max(BAR, height * 0.8 * level * motion * envelope);
      context.fillStyle = `rgba(${color}, ${0.25 + envelope * 0.5})`;
      context.beginPath();
      context.roundRect(x - BAR / 2, (height - barHeight) / 2, BAR, barHeight, BAR / 2);
      context.fill();
    };

    const start = Math.max(gap, STEP) / 2;
    for (let x = center - start; x > 0; x -= STEP) drawBar(x, sides[0]);
    for (let x = center + start; x < width; x += STEP) drawBar(x, sides[1]);
  });

  return {
    setLevel(value: number) {
      sides[0].target = clamp(value);
    },
    setOutputLevel(value: number) {
      sides[1].target = clamp(value);
    },
    destroy,
  };
}
