// Battle soundscape — fully WebAudio-synthesized SFX, no audio files, no music.
// (Owner 2026-10-05, his sound doctrine: "every transition gets generated SFX
// that coincides with the scene; your ears know where you are before your
// eyes catch up." Battle bed from Evony's Atlantis: layered howling, war-drums,
// raw battle noise — NOT clean music. "Sound is animation: distant bombardment
// sounds distant, T4s sniping crack." Generative music stays dead.)
//
// Runs on the game's single AudioContext via sound.getBattleBus() — a
// compressor-glued sub-mix under master, so the global mute governs it.
// Autoplay-safe: inert until attach() is called from a user gesture.

import { sound } from "../sound";
import type { ScenePhase } from "./battle-scene-model";

// ---------------------------------------------------------------------------
// Pure mappings — unit-tested, no audio needed.
// ---------------------------------------------------------------------------

/** dist01: 0 = at the camera, 1 = at/beyond the view edge. Near-field punch
 *  falls off exponentially to a far-field whisper. Ground-cam hits harder. */
export function blastGain(dist01: number, groundCam: boolean): number {
  const d = Math.min(1.2, Math.max(0, dist01));
  let g = 0.9 * Math.exp(-2.6 * d);
  if (groundCam) g *= 1.3;
  return Math.min(1, Math.max(0, g));
}

/** Distance-muffled explosions: far blasts lose their top end. */
export function blastCutoff(dist01: number): number {
  const d = Math.min(1.2, Math.max(0, dist01));
  return Math.round(9000 * Math.pow(280 / 9000, d));
}

/** Which stinger a doctrine phase transition earns. Null = no stinger. */
export function stingerForPhase(phase: ScenePhase): "approach" | "touchdown" | "contact" | "weaponsFree" | null {
  switch (phase) {
    case "approach": return "approach";
    case "touchdown": return "touchdown";
    case "contact": return "contact";
    case "weapons-free": return "weaponsFree";
    default: return null; // "resolved" is covered by victor()
  }
}

/** Bed voice shaping — highs rolled off hard, punch in the low-mids so it
 *  reads on phone speakers (no bass). Broad wind, never narrow hiss:
 *  narrow bandpassed noise is what read as "rainfall" on the owner's phone.
 *  Exported so tests can assert the shaping stays sane. */
export const BED = {
  rumbleCutoff: 90,   // Hz — lowpass on the bombardment rumble
  rumbleGain: 0.055,
  windFreq: 240,      // Hz — broad low-mid wind band
  windQ: 0.6,         // broad, never a whistle
  windGain: 0.012,
} as const;

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface BattleCamView {
  x: number; // world 0..1 camera center
  y: number;
  radius: number; // world-units view radius (shrinks as you zoom in)
  ground: boolean; // ground-cam: everything hits nearer and harder
}

const MAX_BOOM_VOICES = 6;
const TRACER_MIN_MS = 70;
const FAR_BOOM_MIN_MS = 400;
const DROPSHIP_MIN_MS = 6000;
const FLANK_MIN_MS = 4000;

class BattleSfx {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private cam: () => BattleCamView = () => ({ x: 0.5, y: 0.5, radius: 0.6, ground: false });
  private bedOn = false;
  private bedTimers: number[] = [];
  private bedNodes: AudioNode[] = [];
  private lastPhase: string | null = null;
  private lastTracerMs = 0;
  private lastFarBoomMs = 0;
  private lastDropshipMs = 0;
  private lastFlankMs = 0;
  private boomVoices = 0;

  /** Camera supplier — the scene sets this so blasts get distance. */
  setCamera(getter: () => BattleCamView): void {
    this.cam = getter;
  }

  /** Call from a user gesture (tap in the scene). Safe to call repeatedly. */
  attach(): void {
    const a = sound.getBattleBus();
    if (!a) return;
    const fresh = !this.ctx;
    this.ctx = a.ctx;
    this.bus = a.bus;
    if (fresh) this.ensureNoise();
    if (!this.bedOn) this.startBed();
  }

  /** Stop the bed. The context stays warm for the next battle. */
  detach(): void {
    this.stopBed();
  }

  /** Forget phase state — call when a new battle starts. */
  reset(): void {
    this.lastPhase = null;
  }

  get attached(): boolean {
    return this.bedOn;
  }

  // --- internals ----------------------------------------------------------

  private ensureNoise(): void {
    if (!this.ctx || this.noiseBuf) return;
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  }

  /** 0 = live. Everything routes here so mute/state checks are uniform. */
  private live(): boolean {
    return !!this.ctx && !!this.bus && !sound.muted;
  }

  private noise(dur: number): AudioBufferSourceNode | null {
    if (!this.ctx || !this.noiseBuf) return null;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.loopEnd = dur + 0.1;
    return s;
  }

  private adsrGain(peak: number, attack: number, dur: number): GainNode | null {
    if (!this.ctx) return null;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }

  private play(node: AudioNode, stopAfter: number): void {
    if (!this.ctx || !this.bus) return;
    node.connect(this.bus);
    const t = this.ctx.currentTime + stopAfter + 0.1;
    for (const n of [node]) {
      if (n instanceof AudioBufferSourceNode || n instanceof OscillatorNode) {
        try { n.start(); } catch { /* already started */ }
        try { n.stop(t); } catch { /* already stopped */ }
        n.onended = () => { try { n.disconnect(); } catch { /* gone */ } };
      }
    }
  }

  /** Start/stop a source that is ALREADY wired through its own chain.
   *  Unlike play(), this never touches the bus — the bed voices connect
   *  through their filters, never raw. (Owner 2026-10-05: play() used to
   *  double-connect the bed's raw white-noise sources straight to the bus,
   *  which read as "rain" and ducked every one-shot under the compressor.) */
  private startLoop(n: AudioBufferSourceNode | OscillatorNode, stopAfter: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + stopAfter + 0.1;
    try { n.start(); } catch { /* already started */ }
    try { n.stop(t); } catch { /* already stopped */ }
    n.onended = () => { try { n.disconnect(); } catch { /* gone */ } };
  }

  private dist(x: number, y: number): number {
    const c = this.cam();
    const r = Math.max(0.05, c.radius);
    let d = Math.hypot(x - c.x, y - c.y) / r;
    if (c.ground) d *= 0.7; // down in the dirt: everything is nearer
    return Math.min(1.2, Math.max(0, d));
  }

  // --- the bed: distant war, always breathing underneath -------------------

  private startBed(): void {
    if (!this.ctx || !this.bus || this.bedOn) return;
    this.bedOn = true;
    const ctx = this.ctx;

    // Distant bombardment rumble — looped noise, low and far.
    const rumble = this.noise(2);
    const rumbleF = ctx.createBiquadFilter();
    rumbleF.type = "lowpass";
    rumbleF.frequency.value = BED.rumbleCutoff;
    const rumbleG = ctx.createGain();
    rumbleG.gain.value = BED.rumbleGain;
    const rumbleLfo = ctx.createOscillator();
    rumbleLfo.frequency.value = 0.05;
    const rumbleLfoG = ctx.createGain();
    rumbleLfoG.gain.value = 0.02;
    if (rumble) {
      rumble.connect(rumbleF);
      rumbleF.connect(rumbleG);
      rumbleG.connect(this.bus);
      rumbleLfo.connect(rumbleLfoG);
      rumbleLfoG.connect(rumbleG.gain);
      this.startLoop(rumble, 3600);
      this.startLoop(rumbleLfo, 3600);
      this.bedNodes.push(rumble, rumbleF, rumbleG, rumbleLfo, rumbleLfoG);
    }

    // Wind — broad low-mid band, wandering slowly. Breathes, never hisses.
    // (Replaces the old narrow howl: bandpassed hiss read as rainfall.)
    const wind = this.noise(2);
    const windF = ctx.createBiquadFilter();
    windF.type = "bandpass";
    windF.frequency.value = BED.windFreq;
    windF.Q.value = BED.windQ;
    const windG = ctx.createGain();
    windG.gain.value = BED.windGain;
    const windLfo = ctx.createOscillator();
    windLfo.frequency.value = 0.05;
    const windLfoG = ctx.createGain();
    windLfoG.gain.value = 0.009;
    const windFLfo = ctx.createOscillator();
    windFLfo.frequency.value = 0.037;
    const windFLfoG = ctx.createGain();
    windFLfoG.gain.value = 90;
    if (wind) {
      wind.connect(windF);
      windF.connect(windG);
      windG.connect(this.bus);
      windLfo.connect(windLfoG);
      windLfoG.connect(windG.gain);
      windFLfo.connect(windFLfoG);
      windFLfoG.connect(windF.frequency);
      this.startLoop(wind, 3600);
      this.startLoop(windLfo, 3600);
      this.startLoop(windFLfo, 3600);
      this.bedNodes.push(wind, windF, windG, windLfo, windLfoG, windFLfo, windFLfoG);
    }

    // War-drums — a low skin hit every 1.4–2.2s, slightly irregular.
    // Phone-audible: body in the low-mids with a skin-slap transient that
    // small speakers actually reproduce (pure sub-bass is lost on a phone).
    const drum = () => {
      if (!this.bedOn || !this.live()) {
        if (this.bedOn) this.bedTimers.push(window.setTimeout(drum, 1600));
        return;
      }
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(120, t);
      o.frequency.exponentialRampToValueAtTime(55, t + 0.3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.14, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.connect(g);
      g.connect(this.bus!);
      o.start(t);
      o.stop(t + 0.5);
      o.onended = () => { try { o.disconnect(); g.disconnect(); } catch { /* gone */ } };
      // Skin slap — the transient small speakers reproduce.
      const slap = this.noise(0.06);
      if (slap) {
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 1;
        const ng = this.adsrGain(0.05, 0.004, 0.06)!;
        slap.connect(bp); bp.connect(ng); ng.connect(this.bus!);
        slap.start(t); slap.stop(t + 0.15);
        slap.onended = () => { try { slap.disconnect(); bp.disconnect(); ng.disconnect(); } catch { /* gone */ } };
      }
      this.bedTimers.push(window.setTimeout(drum, 1400 + Math.random() * 800));
    };
    this.bedTimers.push(window.setTimeout(drum, 900));

    // Far-off battle crackle — somebody else's war, far away.
    const crackle = () => {
      if (this.bedOn) {
        if (this.live()) this.boomAtDist(0.85 + Math.random() * 0.2, false);
        this.bedTimers.push(window.setTimeout(crackle, 5000 + Math.random() * 5000));
      }
    };
    this.bedTimers.push(window.setTimeout(crackle, 4000));
  }

  private stopBed(): void {
    this.bedOn = false;
    for (const t of this.bedTimers) window.clearTimeout(t);
    this.bedTimers = [];
    if (this.ctx) {
      const t = this.ctx.currentTime;
      for (const n of this.bedNodes) {
        try {
          if (n instanceof AudioBufferSourceNode || n instanceof OscillatorNode) n.stop(t + 0.2);
          n.disconnect();
        } catch { /* already gone */ }
      }
    }
    this.bedNodes = [];
  }

  // --- one-shots ----------------------------------------------------------

  /** Phase stingers — your ears know where you are before your eyes catch up. */
  phase(p: ScenePhase): void {
    if (p === this.lastPhase) return;
    this.lastPhase = p;
    const stinger = stingerForPhase(p);
    if (!stinger || !this.live()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;

    if (stinger === "approach") {
      // Tension drone — low wind swelling in.
      for (const f of [55, 55.7]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = f;
        const fl = ctx.createBiquadFilter();
        fl.type = "lowpass";
        fl.frequency.value = 300;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.05, t + 2.2);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 5);
        o.connect(fl); fl.connect(g);
        this.play(g, 5.2);
        o.start(t); o.stop(t + 5.4);
      }
      const n = this.noise(5);
      if (n) {
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass"; bp.frequency.value = 400; bp.Q.value = 1;
        const g = this.adsrGain(0.09, 2.5, 5)!;
        n.connect(bp); bp.connect(g);
        this.play(g, 5.2);
        n.start(t); n.stop(t + 5.4);
      }
    } else if (stinger === "touchdown") {
      // Heavy thump + dust rumble — boots on dirt.
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(70, t);
      o.frequency.exponentialRampToValueAtTime(26, t + 0.5);
      const g = this.adsrGain(0.5, 0.008, 0.7)!;
      o.connect(g);
      this.play(g, 0.9);
      o.start(t); o.stop(t + 1);
      const n = this.noise(0.9);
      if (n) {
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass"; lp.frequency.value = 420;
        const ng = this.adsrGain(0.22, 0.02, 0.9)!;
        n.connect(lp); lp.connect(ng);
        this.play(ng, 1.1);
        n.start(t); n.stop(t + 1.2);
      }
      // Midrange thud — the transient phone speakers reproduce (the sub
      // sine above is felt on big speakers, lost on small ones).
      const thud = this.noise(0.25);
      if (thud) {
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass"; bp.frequency.value = 350; bp.Q.value = 0.8;
        const tg = this.adsrGain(0.3, 0.005, 0.25)!;
        thud.connect(bp); bp.connect(tg);
        this.play(tg, 0.4);
        thud.start(t); thud.stop(t + 0.4);
      }
    } else if (stinger === "contact") {
      // Warning swell — first radar visuals.
      for (let i = 0; i < 3; i++) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = i % 2 === 0 ? 520 : 392;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass"; lp.frequency.value = 1200;
        const g = this.adsrGain(0.09, 0.05, 0.42)!;
        o.connect(lp); lp.connect(g);
        const at = t + i * 0.45;
        this.play(g, 1.6);
        o.start(at); o.stop(at + 0.6);
      }
    } else if (stinger === "weaponsFree") {
      // Eruption — the battle ignites.
      const n = this.noise(1.6);
      if (n) {
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(9000, t);
        lp.frequency.exponentialRampToValueAtTime(400, t + 1.4);
        const g = this.adsrGain(0.5, 0.01, 1.6)!;
        n.connect(lp); lp.connect(g);
        this.play(g, 1.8);
        n.start(t); n.stop(t + 2);
      }
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(100, t);
      o.frequency.exponentialRampToValueAtTime(28, t + 1);
      const g = this.adsrGain(0.4, 0.01, 1.2)!;
      o.connect(g);
      this.play(g, 1.4);
      o.start(t); o.stop(t + 1.5);
      for (let i = 0; i < 4; i++) {
        window.setTimeout(() => this.tracer(i % 2 === 0 ? "crack" : "snipe"), 120 + i * 160);
      }
    }
  }

  /** Explosion at world coords — distance-muffled, ground-cam hits harder. */
  explosion(x: number, y: number, big = false): void {
    if (!this.live()) return;
    if (this.boomVoices >= MAX_BOOM_VOICES) return;
    const now = performance.now();
    const d = this.dist(x, y);
    if (d > 0.8 && now - this.lastFarBoomMs < FAR_BOOM_MIN_MS) return;
    if (d > 0.8) this.lastFarBoomMs = now;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const ground = this.cam().ground;
    const g = blastGain(d, ground) * (big ? 1.35 : 1);
    const cutoff = blastCutoff(d);
    this.boomVoices++;

    const n = this.noise(big ? 0.9 : 0.55);
    if (n) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = cutoff;
      const ng = this.adsrGain(Math.min(1, g), 0.006, big ? 0.9 : 0.55)!;
      n.connect(lp); lp.connect(ng);
      ng.connect(this.bus!);
      n.start(t); n.stop(t + 1.1);
      n.onended = () => {
        this.boomVoices = Math.max(0, this.boomVoices - 1);
        try { n.disconnect(); lp.disconnect(); ng.disconnect(); } catch { /* gone */ }
      };
    } else {
      this.boomVoices = Math.max(0, this.boomVoices - 1);
    }
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.35);
    const og = this.adsrGain(Math.min(1, g * 0.8), 0.006, 0.4)!;
    o.connect(og);
    og.connect(this.bus!);
    o.start(t); o.stop(t + 0.6);
    o.onended = () => { try { o.disconnect(); og.disconnect(); } catch { /* gone */ } };
  }

  private boomAtDist(d: number, big: boolean): void {
    // Bed crackle helper — fixed distance, no camera math.
    if (!this.live() || this.boomVoices >= MAX_BOOM_VOICES) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const n = this.noise(0.7);
    if (!n) return;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = blastCutoff(d);
    const g = this.adsrGain(blastGain(d, false) * (big ? 1.3 : 1), 0.01, 0.7)!;
    n.connect(lp); lp.connect(g);
    this.boomVoices++;
    g.connect(this.bus!);
    n.start(t); n.stop(t + 0.9);
    n.onended = () => {
      this.boomVoices = Math.max(0, this.boomVoices - 1);
      try { n.disconnect(); lp.disconnect(); g.disconnect(); } catch { /* gone */ }
    };
  }

  /** Weapons fire cracks — throttled so 40 tracers don't become 40 voices. */
  tracer(kind: "crack" | "snipe" | "turret" = "crack"): void {
    if (!this.live()) return;
    const now = performance.now();
    if (now - this.lastTracerMs < TRACER_MIN_MS) return;
    this.lastTracerMs = now;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    if (kind === "crack") {
      const n = this.noise(0.09);
      if (!n) return;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = 2400; bp.Q.value = 1.2;
      const g = this.adsrGain(0.05, 0.004, 0.09)!;
      n.connect(bp); bp.connect(g); g.connect(this.bus!);
      n.start(t); n.stop(t + 0.2);
      n.onended = () => { try { n.disconnect(); bp.disconnect(); g.disconnect(); } catch { /* gone */ } };
    } else if (kind === "snipe") {
      // T4 thunder — sharper, meaner crack.
      const n = this.noise(0.14);
      if (!n) return;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass"; hp.frequency.value = 2800;
      const g = this.adsrGain(0.075, 0.003, 0.14)!;
      n.connect(hp); hp.connect(g); g.connect(this.bus!);
      n.start(t); n.stop(t + 0.25);
      n.onended = () => { try { n.disconnect(); hp.disconnect(); g.disconnect(); } catch { /* gone */ } };
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(1800, t);
      o.frequency.exponentialRampToValueAtTime(900, t + 0.08);
      const og = this.adsrGain(0.03, 0.003, 0.09)!;
      o.connect(og); og.connect(this.bus!);
      o.start(t); o.stop(t + 0.15);
      o.onended = () => { try { o.disconnect(); og.disconnect(); } catch { /* gone */ } };
    } else {
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.setValueAtTime(170, t);
      o.frequency.exponentialRampToValueAtTime(90, t + 0.07);
      const g = this.adsrGain(0.035, 0.004, 0.08)!;
      o.connect(g); g.connect(this.bus!);
      o.start(t); o.stop(t + 0.15);
      o.onended = () => { try { o.disconnect(); g.disconnect(); } catch { /* gone */ } };
    }
  }

  /** Delayed-entry dropship engines rolling in. */
  dropship(): void {
    if (!this.live()) return;
    const now = performance.now();
    if (now - this.lastDropshipMs < DROPSHIP_MIN_MS) return;
    this.lastDropshipMs = now;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(60, t);
    o.frequency.linearRampToValueAtTime(115, t + 2);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 500;
    const g = this.adsrGain(0.1, 0.6, 2.2)!;
    o.connect(lp); lp.connect(g); g.connect(this.bus!);
    o.start(t); o.stop(t + 2.4);
    o.onended = () => { try { o.disconnect(); lp.disconnect(); g.disconnect(); } catch { /* gone */ } };
  }

  /** A flank crashing in hits different. */
  flankCrash(): void {
    if (!this.live()) return;
    const now = performance.now();
    if (now - this.lastFlankMs < FLANK_MIN_MS) return;
    this.lastFlankMs = now;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const n = this.noise(1.2);
    if (!n) return;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 850; bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    n.connect(bp); bp.connect(g); g.connect(this.bus!);
    n.start(t); n.stop(t + 1.4);
    n.onended = () => { try { n.disconnect(); bp.disconnect(); g.disconnect(); } catch { /* gone */ } };
  }

  /** Order accepted — crisp military blip. */
  orderAccepted(): void {
    if (!this.live()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    for (const [f, dt] of [[660, 0], [990, 0.07]] as const) {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = f;
      const g = this.adsrGain(0.07, 0.005, 0.09)!;
      o.connect(g); g.connect(this.bus!);
      o.start(t + dt); o.stop(t + dt + 0.15);
      o.onended = () => { try { o.disconnect(); g.disconnect(); } catch { /* gone */ } };
    }
  }

  /** Order rejected — the judge's gavel. Illegal orders SOUND refused. */
  orderRejected(): void {
    if (!this.live()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    for (const [f, dt] of [[130, 0], [98, 0.13]] as const) {
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 600;
      const g = this.adsrGain(0.14, 0.005, 0.12)!;
      o.connect(lp); lp.connect(g); g.connect(this.bus!);
      o.start(t + dt); o.stop(t + dt + 0.2);
      o.onended = () => { try { o.disconnect(); lp.disconnect(); g.disconnect(); } catch { /* gone */ } };
    }
  }

  /** UI toggle throw. */
  uiClick(): void {
    sound.click();
  }

  /** Battle end — who holds the field. Raw, not musical. */
  victor(attackerWon: boolean): void {
    if (!this.live()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    if (attackerWon) {
      for (const f of [196, 197.5]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = f;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass"; lp.frequency.value = 900;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.12, t + 0.8);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
        o.connect(lp); lp.connect(g); g.connect(this.bus!);
        o.start(t); o.stop(t + 2.8);
        o.onended = () => { try { o.disconnect(); lp.disconnect(); g.disconnect(); } catch { /* gone */ } };
      }
      for (const dt of [0, 0.5, 1.0]) {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(58, t + dt);
        o.frequency.exponentialRampToValueAtTime(32, t + dt + 0.3);
        const g = this.adsrGain(0.16, 0.01, 0.4)!;
        o.connect(g); g.connect(this.bus!);
        o.start(t + dt); o.stop(t + dt + 0.6);
        o.onended = () => { try { o.disconnect(); g.disconnect(); } catch { /* gone */ } };
      }
    } else {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(196, t);
      o.frequency.exponentialRampToValueAtTime(98, t + 2.2);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 700;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.11, t + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      o.connect(lp); lp.connect(g); g.connect(this.bus!);
      o.start(t); o.stop(t + 2.8);
      o.onended = () => { try { o.disconnect(); lp.disconnect(); g.disconnect(); } catch { /* gone */ } };
    }
  }
}

export const battleSfx = new BattleSfx();
