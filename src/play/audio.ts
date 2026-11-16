// A score made only of oscillators and noise. Each realm has a drone, a few plucked or bell notes,
// and its own footsteps. The walker's speed opens the wind. Nothing is loaded.

/** What the score needs to know each frame. */
export interface ScoreFrame {
  dt: number;
  realmA: number;
  realmB: number;
  realmBlend: number;
  speed: number;
  flying: boolean;
  gliding: boolean;
  grounded: boolean;
  planet: number;
  /** Height above the ground in metres. */
  altitude: number;
}

export type ScoreEvent = "jump" | "land" | "step" | "sing" | "planet" | "corkscrew" | "hinge" | "ripple" | "photo" | "thunder";

type Melody = "pluck" | "bell" | "glass" | "bubble" | "ping";

interface StepSound {
  /** Noise band in Hz. */
  low: number;
  high: number;
  seconds: number;
  gain: number;
  /** Optional pitched click: frequency in Hz and gain. */
  tone?: [number, number];
}

interface RealmSound {
  /** Pad chord as semitones above `root`. */
  root: number;
  chord: number[];
  padWave: OscillatorType;
  padCutoff: number;
  padGain: number;
  /** Melody notes as semitones above `root`, in octave 0 of the melody range. */
  scale: number[];
  octaves: number[];
  melody: Melody;
  /** Seconds between melody notes, from and to. */
  every: [number, number];
  melodyGain: number;
  /** Extra gain on the wind and where its band sits. */
  wind: number;
  windTilt: number;
  step: StepSound;
}

/** Overall level before the compressor. The score is a bed under what the player does, so it sits low. */
const MASTER_LEVEL = 0.62;

const semitone = (root: number, n: number): number => root * Math.pow(2, n / 12);

const REALM_SOUND: RealmSound[] = [
  {
    // Paper Dunes: warm and open, like a low sun.
    root: 73.42,
    chord: [12, 19, 24, 28, 31, 38],
    padWave: "sawtooth",
    padCutoff: 1100,
    padGain: 0.045,
    scale: [0, 2, 6, 7, 9],
    octaves: [24, 36, 48],
    melody: "pluck",
    every: [1.6, 4.2],
    melodyGain: 0.16,
    wind: 1,
    windTilt: 1,
    step: { low: 500, high: 3200, seconds: 0.14, gain: 0.22 },
  },
  {
    // Prism Forest: night glass, with bells in a long room.
    root: 110,
    chord: [0, 7, 14, 15, 19, 24],
    padWave: "triangle",
    padCutoff: 2400,
    padGain: 0.06,
    scale: [0, 3, 5, 7, 10],
    octaves: [24, 36, 48],
    melody: "bell",
    every: [2.2, 5.5],
    melodyGain: 0.13,
    wind: 0.5,
    windTilt: 1.6,
    step: { low: 2500, high: 9000, seconds: 0.07, gain: 0.12, tone: [2300, 0.05] },
  },
  {
    // Lantern Deep: a low hum under water, with bubbles.
    root: 43.65,
    chord: [12, 19, 26, 28],
    padWave: "sawtooth",
    padCutoff: 520,
    padGain: 0.07,
    scale: [0, 2, 7, 9],
    octaves: [36, 48, 60],
    melody: "bubble",
    every: [0.8, 2.6],
    melodyGain: 0.07,
    wind: 0.3,
    windTilt: 0.35,
    step: { low: 120, high: 700, seconds: 0.22, gain: 0.3 },
  },
  {
    // Mirror Flats: sparse and high, glass in still air.
    root: 98,
    chord: [12, 14, 19, 26, 31],
    padWave: "sine",
    padCutoff: 3200,
    padGain: 0.07,
    scale: [0, 2, 7, 9, 14],
    octaves: [24, 36],
    melody: "glass",
    every: [3.5, 8],
    melodyGain: 0.1,
    wind: 1.3,
    windTilt: 1.2,
    step: { low: 1800, high: 7000, seconds: 0.1, gain: 0.15, tone: [1200, 0.03] },
  },
  {
    // Ember Canyons: low and uneasy, with metal.
    root: 41.2,
    chord: [12, 13, 19, 24, 25],
    padWave: "sawtooth",
    padCutoff: 700,
    padGain: 0.06,
    scale: [0, 1, 5, 7, 8],
    octaves: [36, 48],
    melody: "ping",
    every: [3, 7],
    melodyGain: 0.1,
    wind: 0.7,
    windTilt: 0.6,
    step: { low: 90, high: 1500, seconds: 0.18, gain: 0.3, tone: [180, 0.12] },
  },
];

interface RealmBus {
  gain: GainNode;
  nextNote: number;
  extraAt: number;
  chordFreqs: number[];
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;

/**
 * The procedural score. Create it on any thread, call `start` on a user gesture, then feed it a
 * `ScoreFrame` every frame. Tests can give it an OfflineAudioContext through `attach`.
 */
export class Score {
  muted = false;
  private ctx: BaseAudioContext | null = null;
  private master!: GainNode;
  private reverbIn!: GainNode;
  private delayIn!: GainNode;
  private noise!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private windPan!: StereoPannerNode;
  private realms: RealmBus[] = [];
  private blend: [number, number, number] = [0, 0, 0];
  private started = false;
  private lastStep = 0;
  private rumble!: GainNode;

  /** Uses a given context instead of creating one. */
  attach(ctx: BaseAudioContext): void {
    this.ctx = ctx;
    this.build(ctx);
  }

  /** Creates the audio graph. Browsers only allow it after a click or key press. */
  start(): void {
    if (this.started) {
      if (this.ctx instanceof AudioContext && this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    if (this.ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor({ latencyHint: "interactive" });
    this.ctx = ctx;
    this.build(ctx);
    if (ctx.state === "suspended") void ctx.resume();
    document.addEventListener("visibilitychange", () => void (document.hidden ? ctx.suspend() : ctx.resume()));
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    const ctx = this.ctx;
    if (!ctx || !this.started) return;
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, ctx.currentTime, 0.12);
  }

  private build(ctx: BaseAudioContext): void {
    this.started = true;
    const out = ctx.createDynamicsCompressor();
    out.threshold.value = -16;
    out.knee.value = 18;
    out.ratio.value = 3.5;
    out.attack.value = 0.01;
    out.release.value = 0.35;
    out.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(out);
    this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER_LEVEL, ctx.currentTime, 1.6);

    this.noise = noiseBuffer(ctx, 4);

    const reverb = ctx.createConvolver();
    reverb.buffer = impulse(ctx, 3.6);
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 0.9;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverbIn.connect(reverb).connect(wet).connect(this.master);

    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.36;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 2400;
    this.delayIn = ctx.createGain();
    this.delayIn.connect(delay);
    delay.connect(damp).connect(feedback).connect(delay);
    damp.connect(this.master);
    damp.connect(this.reverbIn);

    for (const sound of REALM_SOUND) this.realms.push(this.buildRealm(ctx, sound));

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.Q.value = 0.55;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windPan = ctx.createStereoPanner();
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.windPan).connect(this.master);
    wind.start();

    // A low rumble for the planet and the fold powers.
    this.rumble = ctx.createGain();
    this.rumble.gain.value = 0;
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = 38;
    const subFilter = ctx.createBiquadFilter();
    subFilter.type = "lowpass";
    subFilter.frequency.value = 120;
    sub.connect(subFilter).connect(this.rumble).connect(this.master);
    sub.start();
  }

  private buildRealm(ctx: BaseAudioContext, sound: RealmSound): RealmBus {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master);
    const send = ctx.createGain();
    send.gain.value = 0.7;
    gain.connect(send).connect(this.reverbIn);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = sound.padCutoff;
    filter.Q.value = sound.padWave === "sawtooth" ? 2.2 : 0.7;
    const pad = ctx.createGain();
    pad.gain.value = sound.padGain;
    filter.connect(pad).connect(gain);

    // A slow breath in the filter keeps the drone alive.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rand(0.04, 0.09);
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = sound.padCutoff * 0.35;
    lfo.connect(lfoDepth).connect(filter.frequency);
    lfo.start();

    const chordFreqs: number[] = [];
    for (const offset of sound.chord) {
      const f = semitone(sound.root, offset);
      chordFreqs.push(f);
      for (const cents of [-7, 7]) {
        const osc = ctx.createOscillator();
        osc.type = sound.padWave;
        osc.frequency.value = f;
        osc.detune.value = cents + rand(-3, 3);
        osc.connect(filter);
        osc.start();
      }
    }
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = sound.root / 2;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.18;
    sub.connect(subGain).connect(gain);
    sub.start();
    return { gain, nextNote: 0, extraAt: 0, chordFreqs };
  }

  /** Feeds the frame. Fades realm voices, opens the wind and schedules the next notes. */
  update(f: ScoreFrame): void {
    const ctx = this.ctx;
    if (!ctx || !this.started) return;
    const now = ctx.currentTime;
    this.blend = [f.realmA, f.realmB, f.realmBlend];
    for (let i = 0; i < this.realms.length; i++) {
      const target = (i === f.realmA ? 1 - f.realmBlend : 0) + (i === f.realmB ? f.realmBlend : 0);
      const bus = this.realms[i]!;
      bus.gain.gain.setTargetAtTime(target, now, 0.9);
      if (target > 0.06) this.scheduleNotes(ctx, i, bus, target, now);
    }
    const dominant = f.realmBlend < 0.5 ? f.realmA : f.realmB;
    const sound = REALM_SOUND[dominant]!;
    const air = Math.min(1, f.speed / 42) + (f.flying ? 0.25 : 0) + (f.gliding ? 0.2 : 0) + Math.min(0.3, f.altitude / 400);
    this.windFilter.frequency.setTargetAtTime((180 + air * 2300) * sound.windTilt, now, 0.25);
    this.windGain.gain.setTargetAtTime((0.012 + air * 0.15) * sound.wind, now, 0.3);
    this.windPan.pan.setTargetAtTime(Math.sin(now * 0.21) * 0.35, now, 0.5);
    this.rumble.gain.setTargetAtTime(f.planet * 0.22, now, 0.5);
  }

  private scheduleNotes(ctx: BaseAudioContext, index: number, bus: RealmBus, presence: number, now: number): void {
    const sound = REALM_SOUND[index]!;
    if (bus.nextNote === 0) bus.nextNote = now + rand(0.5, 2);
    if (now + 0.25 < bus.nextNote) return;
    const when = Math.max(now + 0.02, bus.nextNote);
    bus.nextNote = when + rand(sound.every[0], sound.every[1]);
    const note = semitone(sound.root, pick(sound.scale) + pick(sound.octaves));
    this.note(ctx, sound.melody, note, when, sound.melodyGain * presence);
    if (index === 2 && Math.random() < 0.08) this.whale(ctx, when + 0.4, presence);
    if (index === 4 && Math.random() < 0.45) this.crackle(ctx, when + rand(0.1, 0.9), presence);
  }

  private note(ctx: BaseAudioContext, kind: Melody, freq: number, when: number, level: number): void {
    const out = ctx.createGain();
    out.connect(this.master);
    const send = ctx.createGain();
    send.gain.value = 0.55;
    out.connect(send).connect(this.reverbIn);
    const echo = ctx.createGain();
    echo.gain.value = 0.5;
    out.connect(echo).connect(this.delayIn);
    switch (kind) {
      case "pluck": {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = freq;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(freq * 7, when);
        lp.frequency.exponentialRampToValueAtTime(freq * 1.4, when + 0.5);
        osc.connect(lp).connect(out);
        envelope(out.gain, when, 0.004, 1.5, level);
        osc.start(when);
        osc.stop(when + 1.8);
        break;
      }
      case "bell":
      case "glass":
      case "ping": {
        const ratio = kind === "ping" ? 2.76 : kind === "glass" ? 2 : 3.5;
        const index = kind === "ping" ? 3.2 : kind === "glass" ? 1.1 : 2.4;
        const decay = kind === "ping" ? 1.1 : kind === "glass" ? 5 : 3.4;
        const carrier = ctx.createOscillator();
        carrier.frequency.value = freq;
        const mod = ctx.createOscillator();
        mod.frequency.value = freq * ratio;
        const depth = ctx.createGain();
        depth.gain.setValueAtTime(freq * ratio * index * 0.35, when);
        depth.gain.exponentialRampToValueAtTime(1, when + decay * 0.7);
        mod.connect(depth).connect(carrier.frequency);
        carrier.connect(out);
        envelope(out.gain, when, 0.003, decay, level);
        carrier.start(when);
        mod.start(when);
        carrier.stop(when + decay + 0.2);
        mod.stop(when + decay + 0.2);
        break;
      }
      case "bubble": {
        const osc = ctx.createOscillator();
        osc.frequency.setValueAtTime(freq * 2, when);
        osc.frequency.exponentialRampToValueAtTime(freq * 3.4, when + 0.09);
        osc.connect(out);
        envelope(out.gain, when, 0.004, 0.16, level * 1.6);
        osc.start(when);
        osc.stop(when + 0.25);
        break;
      }
    }
  }

  /** A long falling and rising voice in the deep. */
  private whale(ctx: BaseAudioContext, when: number, presence: number): void {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    const base = rand(120, 190);
    osc.frequency.setValueAtTime(base, when);
    osc.frequency.exponentialRampToValueAtTime(base * 1.7, when + 2.4);
    osc.frequency.exponentialRampToValueAtTime(base * 1.15, when + 5.5);
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 5.2;
    const vDepth = ctx.createGain();
    vDepth.gain.value = 5;
    vibrato.connect(vDepth).connect(osc.frequency);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 520;
    const out = ctx.createGain();
    envelope(out.gain, when, 1.4, 5, 0.14 * presence);
    osc.connect(lp).connect(out);
    out.connect(this.master);
    out.connect(this.reverbIn);
    osc.start(when);
    vibrato.start(when);
    osc.stop(when + 7);
    vibrato.stop(when + 7);
  }

  private crackle(ctx: BaseAudioContext, when: number, presence: number): void {
    for (let i = 0; i < 4; i++) {
      this.burst(ctx, when + i * rand(0.03, 0.12), 1800, 9000, 0.03, 0.1 * presence, rand(-0.6, 0.6));
    }
  }

  /** A short band of noise with a quick fade, the basis of footsteps and taps. */
  private burst(ctx: BaseAudioContext, when: number, low: number, high: number, seconds: number, level: number, pan: number): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = low;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = high;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(hp).connect(lp).connect(g).connect(p).connect(this.master);
    envelope(g.gain, when, 0.002, seconds, level);
    src.start(when, rand(0, 2.5), seconds + 0.05);
  }

  /** One-shot sounds for what the walker does. */
  event(kind: ScoreEvent, strength = 1, on = true): void {
    const ctx = this.ctx;
    if (!ctx || !this.started) return;
    const now = ctx.currentTime;
    const dominant = this.dominant;
    const sound = REALM_SOUND[dominant]!;
    switch (kind) {
      case "step": {
        if (now - this.lastStep < 0.12) return;
        this.lastStep = now;
        const s = sound.step;
        const pan = rand(-0.25, 0.25);
        this.burst(ctx, now, s.low * rand(0.85, 1.2), s.high * rand(0.85, 1.15), s.seconds, s.gain * (0.45 + 0.55 * strength), pan);
        if (s.tone) {
          const osc = ctx.createOscillator();
          osc.frequency.value = s.tone[0] * rand(0.9, 1.1);
          const g = ctx.createGain();
          osc.connect(g).connect(this.master);
          envelope(g.gain, now, 0.002, 0.07, s.tone[1] * strength);
          osc.start(now);
          osc.stop(now + 0.1);
        }
        return;
      }
      case "jump":
        this.burst(ctx, now, 400, 2400, 0.22, 0.1, 0);
        return;
      case "land": {
        const s = sound.step;
        this.burst(ctx, now, s.low * 0.5, s.high * 0.6, 0.3, 0.35 * (0.4 + strength), 0);
        const osc = ctx.createOscillator();
        osc.frequency.setValueAtTime(110, now);
        osc.frequency.exponentialRampToValueAtTime(42, now + 0.2);
        const g = ctx.createGain();
        osc.connect(g).connect(this.master);
        envelope(g.gain, now, 0.004, 0.3, 0.3 * strength);
        osc.start(now);
        osc.stop(now + 0.4);
        return;
      }
      case "sing": {
        const notes = [0, 7, 12, 16, 19].map((n) => semitone(sound.root, n + 36));
        notes.forEach((f, i) => this.note(ctx, "bell", f, now + i * 0.075, 0.2));
        this.sweep(ctx, now, 500, 6000, 1.4, 0.07, "bandpass");
        return;
      }
      case "planet":
        if (on) this.sweep(ctx, now, 120, 2600, 2.6, 0.2, "lowpass", "sawtooth");
        else this.sweep(ctx, now, 2200, 100, 2.2, 0.16, "lowpass", "sawtooth");
        return;
      case "corkscrew": {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(on ? 160 : 700, now);
        osc.frequency.exponentialRampToValueAtTime(on ? 900 : 120, now + 2);
        const wob = ctx.createOscillator();
        wob.frequency.value = 7;
        const wobDepth = ctx.createGain();
        wobDepth.gain.value = 40;
        wob.connect(wobDepth).connect(osc.frequency);
        const g = ctx.createGain();
        osc.connect(g);
        g.connect(this.master);
        g.connect(this.reverbIn);
        envelope(g.gain, now, 0.3, 2, 0.1);
        osc.start(now);
        wob.start(now);
        osc.stop(now + 2.4);
        wob.stop(now + 2.4);
        return;
      }
      case "hinge":
        this.burst(ctx, now, 300, 5000, 0.35, 0.22, 0);
        this.burst(ctx, now + 0.4, 100, 900, 0.5, 0.3, 0);
        this.sweep(ctx, now, on ? 200 : 900, on ? 900 : 200, 1.2, 0.06, "bandpass");
        return;
      case "ripple": {
        const osc = ctx.createOscillator();
        osc.frequency.setValueAtTime(90, now);
        osc.frequency.exponentialRampToValueAtTime(34, now + 1.4);
        const g = ctx.createGain();
        osc.connect(g).connect(this.master);
        envelope(g.gain, now, 0.01, 1.6, 0.5);
        osc.start(now);
        osc.stop(now + 1.8);
        this.sweep(ctx, now + 0.1, 3000, 400, 3, 0.06, "bandpass");
        return;
      }
      case "photo":
        this.burst(ctx, now, 2000, 9000, 0.025, 0.2, -0.1);
        this.burst(ctx, now + 0.06, 1200, 6000, 0.03, 0.16, 0.1);
        return;
      case "thunder":
        this.thunder(ctx, now, strength);
        return;
    }
  }

  /** `closeness` from 0 to 1: a near bolt cracks almost at once and rolls loud, a far one comes late and soft. */
  private thunder(ctx: BaseAudioContext, now: number, closeness: number): void {
    const when = now + 0.1 + 3.6 * (1 - closeness);
    const level = 0.35 + 1.1 * closeness;
    if (closeness > 0.55) this.burst(ctx, when, 900, 6000, 0.16, 0.45 * (closeness - 0.4), rand(-0.5, 0.5));
    let at = when;
    for (let i = 0; i < 5; i++) {
      const tail = rand(2.4, 4.4) * (0.7 + 0.5 * closeness);
      const source = ctx.createBufferSource();
      source.buffer = this.noise;
      source.playbackRate.value = rand(0.4, 0.7);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 0.9;
      filter.frequency.setValueAtTime(rand(420, 800) * (0.6 + 0.6 * closeness), at);
      filter.frequency.exponentialRampToValueAtTime(rand(40, 70), at + tail);
      const g = ctx.createGain();
      source.connect(filter).connect(g);
      g.connect(this.master);
      g.connect(this.reverbIn);
      envelope(g.gain, at, 0.05 + 0.1 * (1 - closeness), tail, level * (1 - 0.17 * i));
      source.start(at);
      source.stop(at + tail + 0.4);
      at += rand(0.2, 0.7);
    }
    const boom = ctx.createOscillator();
    boom.frequency.setValueAtTime(58, when);
    boom.frequency.exponentialRampToValueAtTime(26, when + 1.6);
    const bg = ctx.createGain();
    boom.connect(bg).connect(this.master);
    envelope(bg.gain, when, 0.03, 2.2, 0.6 * level);
    boom.start(when);
    boom.stop(when + 2.4);
  }

  private get dominant(): number {
    const [a, b, t] = this.blend;
    return t < 0.5 ? a : b;
  }

  private sweep(ctx: BaseAudioContext, when: number, from: number, to: number, seconds: number, level: number, type: BiquadFilterType, wave?: OscillatorType): void {
    const source: AudioScheduledSourceNode = wave ? ctx.createOscillator() : ctx.createBufferSource();
    if (source instanceof OscillatorNode) {
      source.type = wave ?? "sawtooth";
      source.frequency.value = Math.min(from, to) * 0.5;
    } else if (source instanceof AudioBufferSourceNode) {
      source.buffer = this.noise;
    }
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = type === "bandpass" ? 1.2 : 3;
    f.frequency.setValueAtTime(from, when);
    f.frequency.exponentialRampToValueAtTime(to, when + seconds);
    const g = ctx.createGain();
    source.connect(f).connect(g);
    g.connect(this.master);
    g.connect(this.reverbIn);
    envelope(g.gain, when, seconds * 0.35, seconds * 0.65, level);
    source.start(when);
    source.stop(when + seconds + 0.3);
  }
}

/** Fast attack to `peak`, then a long exponential fade to silence. */
function envelope(param: AudioParam, when: number, attack: number, decay: number, peak: number): void {
  param.cancelScheduledValues(when);
  param.setValueAtTime(0.0001, when);
  param.linearRampToValueAtTime(Math.max(peak, 0.0002), when + attack);
  param.exponentialRampToValueAtTime(0.0001, when + attack + decay);
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // Pink-ish noise from three one-pole filters, so it sounds like air and not hiss.
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    data[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
  }
  return buffer;
}

/** A room made of decaying noise whose high frequencies fade first. */
function impulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const k = 0.12 + 0.86 * (1 - Math.pow(t, 0.35));
      lp += (Math.random() * 2 - 1 - lp) * k;
      data[i] = lp * Math.pow(1 - t, 2.6) * (i < 400 ? i / 400 : 1);
    }
  }
  return buffer;
}
