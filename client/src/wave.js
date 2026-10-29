// Animated sound wave drawn on a canvas: a few layered sine lines whose
// height follows `setLevel` (0..1) and eases between values.
function createWave(canvas, { color = '245, 165, 36', lines = 4, idle = 0.18 } = {}) {
  const context = canvas.getContext('2d');
  let level = idle;
  let target = idle;
  let phase = 0;

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * ratio;
    canvas.height = canvas.clientHeight * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function draw() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    context.clearRect(0, 0, width, height);
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
    requestAnimationFrame(draw);
  }

  new ResizeObserver(resize).observe(canvas);
  resize();
  requestAnimationFrame(draw);

  return {
    setLevel(value) {
      target = Math.max(idle, Math.min(1, value));
    },
  };
}

// Equalizer of rounded bars on both sides of a central gap (where the
// button sits). Bar heights follow `setLevel` (0..1) and ease between values.
// Equalizer bars on both sides of a centre gap: the left side follows the
// input level, the right side the output level. `gap` is a width in pixels
// or a function returning it, for a gap that follows the layout.
function createBars(canvas, { color = '245, 165, 36', gap: gapOption = 150 } = {}) {
  const context = canvas.getContext('2d');
  const BAR = 3;
  const STEP = 7;
  // Silence keeps the bars still as flat dots.
  const sides = [
    { level: 0, target: 0, phase: 0 },
    { level: 0, target: 0, phase: 0 },
  ];

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * ratio;
    canvas.height = canvas.clientHeight * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function draw() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const center = width / 2;
    const gap = typeof gapOption === 'function' ? gapOption() : gapOption;
    context.clearRect(0, 0, width, height);
    for (const side of sides) {
      side.level += (side.target - side.level) * 0.12;
      side.phase += side.level * 0.12;
    }

    const start = Math.max(gap, STEP) / 2;
    for (let x = center - start; x > 0; x -= STEP) {
      drawBar(x, center, height, gap, sides[0]);
    }
    for (let x = center + start; x < width; x += STEP) {
      drawBar(x, center, height, gap, sides[1]);
    }
    requestAnimationFrame(draw);
  }

  function drawBar(x, center, height, gap, { level, phase }) {
    const distance = Math.abs(x - center) - gap / 2;
    const reach = center - gap / 2;
    // Tallest next to the centre, fading out towards the edges.
    const envelope = Math.max(0, 1 - distance / reach) ** 1.4;
    const motion =
      0.35 +
      0.65 * Math.abs(Math.sin(distance * 0.09 - phase) * Math.sin(distance * 0.031 + phase * 0.6));
    const barHeight = Math.max(BAR, height * 0.8 * level * motion * envelope);
    context.fillStyle = `rgba(${color}, ${0.25 + envelope * 0.5})`;
    context.beginPath();
    context.roundRect(x - BAR / 2, (height - barHeight) / 2, BAR, barHeight, BAR / 2);
    context.fill();
  }

  new ResizeObserver(resize).observe(canvas);
  resize();
  requestAnimationFrame(draw);

  const clamp = (value) => Math.max(0, Math.min(1, value));
  return {
    setLevel(value) {
      sides[0].target = clamp(value);
    },
    setOutputLevel(value) {
      sides[1].target = clamp(value);
    },
  };
}
