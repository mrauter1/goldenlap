import { TAU, clamp } from '../shared/math';
import { mulberry32 } from '../shared/rng';

interface SkidMark { x0: number; y0: number; x1: number; y1: number; a: number }
interface DustParticle {
  x: number; y: number; vx: number; vy: number; life: number; t: number; r: number;
}
interface ConfettiParticle {
  x: number; y: number; vx: number; vy: number; rot: number; vr: number;
  w: number; h: number; c: string; t: number; life: number;
}

export interface EffectsSystem {
  addSkid(x0: number, y0: number, x1: number, y1: number, alpha: number): void;
  clearSkids(): void;
  drawSkids(context: CanvasRenderingContext2D): void;
  addDust(x: number, y: number, vx: number, vy: number, big: boolean): void;
  clearDust(): void;
  stepDust(delta: number): void;
  drawDust(context: CanvasRenderingContext2D, color: string): void;
  burstConfetti(): void;
  hasConfetti(): boolean;
  stepConfetti(delta: number): void;
  drawConfetti(context: CanvasRenderingContext2D): void;
  drawRain(context: CanvasRenderingContext2D, wet: number, cameraSpeed: number): void;
}

export function createEffectsSystem(
  reducedMotion: boolean,
  viewport: () => { width: number; height: number }
): EffectsSystem {
  const skidMaximum = 1500;
  const skids: Array<SkidMark | undefined> = new Array(skidMaximum);
  let skidHead = 0;
  let skidCount = 0;
  const dust: DustParticle[] = [];
  const confetti: ConfettiParticle[] = [];
  let rainSeed = 0;

  function addSkid(x0: number, y0: number, x1: number, y1: number, alpha: number): void {
    skids[skidHead] = { x0, y0, x1, y1, a: alpha };
    skidHead = (skidHead + 1) % skidMaximum;
    if (skidCount < skidMaximum) skidCount++;
  }

  function clearSkids(): void {
    skidHead = 0;
    skidCount = 0;
  }

  function drawSkids(context: CanvasRenderingContext2D): void {
    if (!skidCount) return;
    context.lineWidth = 0.34;
    context.lineCap = 'round';
    for (let bucketIndex = 0; bucketIndex < 4; bucketIndex++) {
      context.strokeStyle = `rgba(28,24,38,${0.09 + bucketIndex * 0.075})`;
      context.beginPath();
      for (let index = 0; index < skidCount; index++) {
        const skid = skids[(skidHead - 1 - index + skidMaximum * 2) % skidMaximum]!;
        const bucket = Math.min(3, (skid.a * 4) | 0);
        if (bucket !== bucketIndex) continue;
        context.moveTo(skid.x0, skid.y0);
        context.lineTo(skid.x1, skid.y1);
      }
      context.stroke();
    }
  }

  function addDust(x: number, y: number, vx: number, vy: number, big: boolean): void {
    if (dust.length > 260) return;
    dust.push({
      x,
      y,
      vx,
      vy,
      life: 0.55 + Math.random() * 0.5,
      t: 0,
      r: (big ? 0.9 : 0.5) + Math.random() * 0.8
    });
  }

  function clearDust(): void {
    dust.length = 0;
  }

  function stepDust(delta: number): void {
    for (let index = dust.length - 1; index >= 0; index--) {
      const particle = dust[index]!;
      particle.t += delta;
      if (particle.t > particle.life) {
        dust.splice(index, 1);
        continue;
      }
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.vx *= 1 - 2.4 * delta;
      particle.vy *= 1 - 2.4 * delta;
    }
  }

  function drawDust(context: CanvasRenderingContext2D, color: string): void {
    for (const particle of dust) {
      const fade = 1 - particle.t / particle.life;
      context.globalAlpha = fade * 0.5;
      context.fillStyle = color;
      context.beginPath();
      context.arc(particle.x, particle.y, particle.r * (1.6 - fade * 0.6), 0, TAU);
      context.fill();
    }
    context.globalAlpha = 1;
  }

  function burstConfetti(): void {
    if (reducedMotion) return;
    const { width, height: _height } = viewport();
    const colors = ['#E9B44C', '#D95B43', '#F5F1E6', '#2E7DA6', '#8FBF8F'];
    for (let index = 0; index < 110; index++) {
      confetti.push({
        x: width / 2 + (Math.random() - 0.5) * width * 0.4,
        y: -14 - Math.random() * 120,
        vx: (Math.random() - 0.5) * 90,
        vy: 110 + Math.random() * 150,
        rot: Math.random() * TAU,
        vr: (Math.random() - 0.5) * 9,
        w: 6 + Math.random() * 6,
        h: 3.5 + Math.random() * 3.5,
        c: colors[(Math.random() * colors.length) | 0]!,
        t: 0,
        life: 2.6 + Math.random()
      });
    }
  }

  function hasConfetti(): boolean {
    return confetti.length > 0;
  }

  function stepConfetti(delta: number): void {
    const { height } = viewport();
    for (let index = confetti.length - 1; index >= 0; index--) {
      const particle = confetti[index]!;
      particle.t += delta;
      if (particle.t > particle.life || particle.y > height + 20) {
        confetti.splice(index, 1);
        continue;
      }
      particle.x += (particle.vx + Math.sin(particle.t * 5 + particle.rot) * 32) * delta;
      particle.y += particle.vy * delta;
      particle.rot += particle.vr * delta;
    }
  }

  function drawConfetti(context: CanvasRenderingContext2D): void {
    for (const particle of confetti) {
      context.save();
      context.translate(particle.x, particle.y);
      context.rotate(particle.rot);
      context.globalAlpha = clamp((particle.life - particle.t) / 0.5, 0, 1);
      context.fillStyle = particle.c;
      context.fillRect(-particle.w / 2, -particle.h / 2, particle.w, particle.h);
      context.restore();
    }
    context.globalAlpha = 1;
  }

  function drawRain(
    context: CanvasRenderingContext2D,
    wet: number,
    cameraSpeed: number
  ): void {
    if (wet <= 0.02) return;
    const { width, height } = viewport();
    context.fillStyle = `rgba(58,74,102,${(wet * 0.16).toFixed(3)})`;
    context.fillRect(0, 0, width, height);
    if (reducedMotion) return;
    rainSeed = (rainSeed + 1) % 1000;
    const random = mulberry32(rainSeed * 7919);
    const count = Math.round(26 + wet * 70);
    context.strokeStyle = 'rgba(215,228,244,0.35)';
    context.lineWidth = 1;
    context.beginPath();
    const length = 9 + Math.min(26, cameraSpeed * 0.18);
    for (let index = 0; index < count; index++) {
      const x = random() * width;
      const y = random() * height;
      context.moveTo(x, y);
      context.lineTo(x - length * 0.28, y + length);
    }
    context.stroke();
  }

  return {
    addSkid,
    clearSkids,
    drawSkids,
    addDust,
    clearDust,
    stepDust,
    drawDust,
    burstConfetti,
    hasConfetti,
    stepConfetti,
    drawConfetti,
    drawRain
  };
}
