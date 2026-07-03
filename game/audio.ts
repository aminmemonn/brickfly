import { clamp } from './util';
import { MAX_SPEED } from './constants';

const PENTATONIC = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 659.25, 783.99];

/**
 * Runtime-synthesized audio: engine hum tied to throttle, wind tied to speed,
 * a discovery chime, and a light generative music loop. Everything is
 * generated with WebAudio oscillators/noise, so the game ships zero assets.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;

  private engineOsc: OscillatorNode | null = null;
  private engineSub: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineLevel: GainNode | null = null;

  private windSource: AudioBufferSourceNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windLevel: GainNode | null = null;

  private musicTimer: number | null = null;
  private beat = 0;

  private sfxEnabled = true;
  private musicEnabled = true;

  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);

    this.sfxGain = ctx.createGain();
    this.sfxGain.connect(this.master);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.3;
    this.musicGain.connect(this.master);

    this.buildEngine(ctx);
    this.buildWind(ctx);
    this.startMusic();
    this.applyToggles();
  }

  setEnabled(music: boolean, sfx: boolean): void {
    this.musicEnabled = music;
    this.sfxEnabled = sfx;
    this.applyToggles();
  }

  private applyToggles(): void {
    if (!this.ctx) return;
    if (this.sfxGain) this.sfxGain.gain.value = this.sfxEnabled ? 1 : 0;
    if (this.musicGain) this.musicGain.gain.value = this.musicEnabled ? 0.3 : 0;
  }

  private buildEngine(ctx: AudioContext): void {
    this.engineLevel = ctx.createGain();
    this.engineLevel.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 500;

    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 70;
    this.engineSub = ctx.createOscillator();
    this.engineSub.type = 'square';
    this.engineSub.frequency.value = 35;

    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    this.engineSub.connect(subGain);
    subGain.connect(this.engineFilter);
    this.engineOsc.connect(this.engineFilter);
    this.engineFilter.connect(this.engineLevel);
    this.engineLevel.connect(this.sfxGain!);
    this.engineOsc.start();
    this.engineSub.start();
  }

  private buildWind(ctx: AudioContext): void {
    const seconds = 2;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.windSource = ctx.createBufferSource();
    this.windSource.buffer = buffer;
    this.windSource.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 700;
    this.windFilter.Q.value = 0.6;
    this.windLevel = ctx.createGain();
    this.windLevel.gain.value = 0;

    this.windSource.connect(this.windFilter);
    this.windFilter.connect(this.windLevel);
    this.windLevel.connect(this.sfxGain!);
    this.windSource.start();
  }

  setFlight(throttle: number, speed: number, paused: boolean): void {
    if (!this.ctx || !this.engineOsc || !this.engineLevel || !this.windLevel) return;
    const t = this.ctx.currentTime;
    const target = paused ? 0 : 0.06 + throttle * 0.075;
    this.engineLevel.gain.setTargetAtTime(target, t, 0.12);
    this.engineOsc.frequency.setTargetAtTime(58 + throttle * 74, t, 0.15);
    this.engineSub?.frequency.setTargetAtTime(29 + throttle * 37, t, 0.15);
    this.engineFilter?.frequency.setTargetAtTime(380 + speed * 2.4, t, 0.2);

    const windAmount = clamp(speed / MAX_SPEED, 0, 1);
    this.windLevel.gain.setTargetAtTime(paused ? 0 : windAmount * windAmount * 0.16, t, 0.25);
    this.windFilter?.frequency.setTargetAtTime(500 + windAmount * 1400, t, 0.3);
  }

  private pluck(freq: number, when: number, dur: number, gain: number, type: OscillatorType = 'triangle'): void {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(gain, when + 0.015);
    env.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(env);
    env.connect(this.musicGain);
    osc.start(when);
    osc.stop(when + dur + 0.05);
  }

  private chimeNote(freq: number, when: number, gain: number): void {
    if (!this.ctx || !this.sfxGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(gain, when + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, when + 0.9);
    osc.connect(env);
    env.connect(this.sfxGain);
    osc.start(when);
    osc.stop(when + 1);
  }

  discover(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.chimeNote(f, t + i * 0.09, 0.16));
  }

  click(): void {
    if (!this.ctx) return;
    this.chimeNote(880, this.ctx.currentTime, 0.05);
  }

  crash(): void {
    if (!this.ctx || !this.sfxGain) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 0.6;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 1.8);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfxGain);
    src.start(t);
    this.chimeNote(90, t, 0.35);
  }

  private startMusic(): void {
    if (!this.ctx || this.musicTimer !== null) return;
    const step = () => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime + 0.08;
      this.beat++;
      if (this.beat % 8 === 1) {
        this.pluck(PENTATONIC[0] / 2, t, 1.6, 0.11, 'sine');
      }
      if (Math.random() < 0.55) {
        const note = PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)];
        this.pluck(note, t, 0.9, 0.07);
        if (Math.random() < 0.25) this.pluck(note * 1.5, t + 0.14, 0.7, 0.045);
      }
    };
    this.musicTimer = window.setInterval(step, 280);
  }

  dispose(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    void this.ctx?.close();
    this.ctx = null;
  }
}
