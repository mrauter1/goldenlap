import { clamp } from '../shared/math';
import type { Car } from '../core/model';

interface AudioState {
  ctx: AudioContext | null;
  on: boolean;
  gear: number;
  cutT: number;
  master?: GainNode;
  eGain?: GainNode;
  eLp?: BiquadFilterNode;
  o1?: OscillatorNode;
  o2?: OscillatorNode;
  o3?: OscillatorNode;
  skid?: GainNode;
  rain?: GainNode;
  wind?: GainNode;
  noiseBuf?: AudioBuffer;
}

export interface AudioSystem {
  init(): void;
  resume(): void;
  setMuted(muted: boolean): void;
  beep(frequency: number, duration: number, type?: OscillatorType, gain?: number, delay?: number): void;
  fanfare(): void;
  chime(kind: 'up' | 'down'): void;
  thud(strength: number): void;
  update(delta: number, car: Car | null, running: boolean, wet: number): void;
}

const GEARS = [0, 15, 26, 37, 48, 60, 72, 84, 97] as const;

export function createAudioSystem(): AudioSystem {
  const state: AudioState = { ctx: null, on: true, gear: 1, cutT: 0 };

  function init(): void {
    if (state.ctx) return;
    const audioWindow = window as Window & typeof globalThis & {
      webkitAudioContext?: typeof AudioContext;
    };
    const Context = audioWindow.AudioContext || audioWindow.webkitAudioContext;
    let context: AudioContext;
    try {
      if (!Context) return;
      context = new Context();
    } catch {
      return;
    }
    state.ctx = context;
    state.master = context.createGain();
    state.master.gain.value = 0.8;
    state.master.connect(context.destination);
    state.eGain = context.createGain();
    state.eGain.gain.value = 0;
    const shaper = context.createWaveShaper();
    const curve = new Float32Array(256);
    for (let index = 0; index < 256; index++) {
      const x = index / 127.5 - 1;
      curve[index] = Math.tanh(1.6 * x);
    }
    shaper.curve = curve;
    state.eLp = context.createBiquadFilter();
    state.eLp.type = 'lowpass';
    state.eLp.frequency.value = 2400;
    state.eLp.Q.value = 0.6;
    state.eGain.connect(shaper);
    shaper.connect(state.eLp);
    state.eLp.connect(state.master);
    state.o1 = context.createOscillator();
    state.o1.type = 'sawtooth';
    state.o2 = context.createOscillator();
    state.o2.type = 'sawtooth';
    state.o3 = context.createOscillator();
    state.o3.type = 'square';
    const firstGain = context.createGain();
    const secondGain = context.createGain();
    const thirdGain = context.createGain();
    firstGain.gain.value = 0.42;
    secondGain.gain.value = 0.36;
    thirdGain.gain.value = 0.30;
    state.o1.connect(firstGain);
    firstGain.connect(state.eGain);
    state.o2.connect(secondGain);
    secondGain.connect(state.eGain);
    state.o3.connect(thirdGain);
    thirdGain.connect(state.eGain);
    state.o1.start();
    state.o2.start();
    state.o3.start();
    const noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let index = 0; index < noiseData.length; index++) noiseData[index] = Math.random() * 2 - 1;
    state.noiseBuf = noiseBuffer;
    const makeNoise = (type: BiquadFilterType, frequency: number, q: number): GainNode => {
      const source = context.createBufferSource();
      source.buffer = noiseBuffer;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      filter.Q.value = q || 0.8;
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(state.master!);
      source.start();
      return gain;
    };
    state.skid = makeNoise('bandpass', 900, 0.9);
    state.rain = makeNoise('highpass', 2600, 0.4);
    state.wind = makeNoise('bandpass', 650, 0.4);
  }

  function resume(): void {
    if (state.ctx?.state === 'suspended') void state.ctx.resume();
  }

  function setMuted(muted: boolean): void {
    state.on = !muted;
    if (state.ctx && state.master)
      state.master.gain.setTargetAtTime(muted ? 0 : 0.8, state.ctx.currentTime, 0.03);
  }

  function beep(
    frequency: number,
    duration: number,
    type: OscillatorType = 'square',
    gain = 0.17,
    delay = 0
  ): void {
    if (!state.ctx || !state.on || !state.master) return;
    const context = state.ctx;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(state.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.05);
  }

  function fanfare(): void {
    beep(523, 0.32, 'triangle', 0.20, 0);
    beep(659, 0.32, 'triangle', 0.20, 0.11);
    beep(784, 0.34, 'triangle', 0.20, 0.22);
    beep(1047, 0.62, 'triangle', 0.24, 0.34);
    beep(1319, 0.5, 'sine', 0.10, 0.34);
  }

  function chime(kind: 'up' | 'down'): void {
    if (kind === 'up') {
      beep(587, 0.22, 'triangle', 0.16);
      beep(880, 0.34, 'triangle', 0.16, 0.12);
    } else {
      beep(494, 0.22, 'triangle', 0.14);
      beep(392, 0.3, 'triangle', 0.13, 0.12);
    }
  }

  function thud(strength: number): void {
    if (!state.ctx || !state.on || !state.master || !state.noiseBuf) return;
    const context = state.ctx;
    const start = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(110, start);
    oscillator.frequency.exponentialRampToValueAtTime(38, start + 0.14);
    const amplitude = clamp(0.1 + strength * 0.35, 0.1, 0.5);
    gain.gain.setValueAtTime(amplitude, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.19);
    oscillator.connect(gain);
    gain.connect(state.master);
    oscillator.start(start);
    oscillator.stop(start + 0.25);
    const source = context.createBufferSource();
    source.buffer = state.noiseBuf;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const noiseGain = context.createGain();
    noiseGain.gain.setValueAtTime(amplitude * 0.7, start);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
    source.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(state.master);
    source.start(start, Math.random() * 0.4, 0.14);
  }

  function gearRpm(speed: number): { gear: number; rpm: number } {
    let gear = 1;
    while (gear < GEARS.length - 1 && speed > GEARS[gear]!) gear++;
    const low = GEARS[gear - 1]!;
    const high = GEARS[gear]!;
    return { gear, rpm: clamp((speed - low) / (high - low), 0, 1) };
  }

  function update(delta: number, car: Car | null, running: boolean, wet: number): void {
    if (!state.ctx || !state.on || !state.eGain || !state.eLp || !state.o1 || !state.o2 ||
        !state.o3 || !state.skid || !state.wind || !state.rain) return;
    const time = state.ctx.currentTime;
    const smoothing = 0.055;
    if (car && running) {
      const speed = Math.max(0, car.vx);
      const current = gearRpm(speed);
      if (current.gear !== state.gear) {
        state.gear = current.gear;
        state.cutT = 0.07;
      }
      state.cutT = Math.max(0, state.cutT - delta);
      const rpm = 0.22 + current.rpm * 0.78;
      const frequency = 58 + rpm * 182;
      state.o1.frequency.setTargetAtTime(frequency * 2, time, smoothing);
      state.o2.frequency.setTargetAtTime(frequency * 2.017, time, smoothing);
      state.o3.frequency.setTargetAtTime(frequency, time, smoothing);
      let engineGain = 0.05 + rpm * 0.10;
      if (state.cutT > 0) engineGain *= 0.3;
      state.eGain.gain.setTargetAtTime(engineGain, time, 0.03);
      state.eLp.frequency.setTargetAtTime(1300 + rpm * 2300, time, smoothing);
      const slip = Math.max(Math.abs(car.slipF), Math.abs(car.slipR));
      state.skid.gain.setTargetAtTime(
        car.spd > 6 && slip > 0.13 ? clamp((slip - 0.1) * 1.1, 0.04, 0.22) : 0,
        time,
        0.04
      );
      state.wind.gain.setTargetAtTime(clamp(car.spd * car.spd * 0.000016, 0, 0.09), time, 0.1);
    } else {
      state.eGain.gain.setTargetAtTime(0, time, 0.08);
      state.skid.gain.setTargetAtTime(0, time, 0.08);
      state.wind.gain.setTargetAtTime(0, time, 0.1);
    }
    state.rain.gain.setTargetAtTime(running ? (wet || 0) * 0.10 : 0, time, 0.3);
  }

  return { init, resume, setMuted, beep, fanfare, chime, thud, update };
}
