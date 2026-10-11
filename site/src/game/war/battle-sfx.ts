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
import { zoomBusGain, zoomVirtualRadius, clampZoomBand } from "../audio/zoom-audio";

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
  // Zoom-driven audio LOD (seamless-world spec §5): zoomBusGain() scales the
  // bus gain, zoomVirtualRadius() feeds dist() below. Defaults = Z4 ground,
  // i.e. byte-identical behavior to before the zoom LOD existed.
  private zoomBand: 1 | 2 | 3 | 4 = 4;
  private zoomGain = 1;
  private zoomRadius = 0;
  private busBaseGain = 0.9; // battle bus nominal gain, captured on attach
  private lastTracerMs = 0;
  private lastFarBoomMs = 0;
  private lastDropshipMs = 0;
  private lastFlankMs = 0;
  private boomVoices = 0;
  // Shared saturation for explosions — tanh grit so layered blasts bite
  // instead of just getting louder. Built on attach, feeds the bus.
  private boomShaper: WaveShaperNode | null = null;
  // Battle intensity 0..1 — the bed breathes with the fighting.
  private intensity = 0;
  private bedRumbleGain: GainNode | null = null;

  /** Camera supplier — the scene sets this so blasts get distance. */
  setCamera(getter: () => BattleCamView): void {
    this.cam = getter;
  }

  /** Zoom-driven audio LOD (seamless-world spec §5) — the scene calls this
   *  from the frame loop with the current zoom band (1 = orbit … 4 = ground).
   *  Applies the zoom gain multiplier onto the bus gain and the zoom virtual
   *  radius into the EXISTING blastGain/blastCutoff distance curve — one
   *  curve, fed by zoom, no second distance model. Out-of-range clamps to
   *  the nearest band; non-finite fails safe to Z1 (silent). Mute toggle
   *  behavior unchanged — master still governs the bus. */
  setZoomAudioLevel(z: number): void {
    const band = clampZoomBand(z);
    if (band === this.zoomBand) return;
    this.zoomBand = band;
    this.zoomGain = zoomBusGain(band);
    this.zoomRadius = zoomVirtualRadius(band);
    this.applyZoomGain();
  }

  /** Push the zoom gain multiplier onto the bus gain (smoothed — no clicks).
   *  Scales the bus's nominal gain, so Z4 is identical to today's level. */
  private applyZoomGain(): void {
    if (!this.ctx || !this.bus) return;
    this.bus.gain.setTargetAtTime(this.busBaseGain * this.zoomGain, this.ctx.currentTime, 0.25);
  }

  /** Call from a user gesture (tap in the scene). Safe to call repeatedly. */
  attach(): void {
    const a = sound.getBattleBus();
    if (!a) return;
    const fresh = !this.ctx;
    this.ctx = a.ctx;
    this.bus = a.bus;
    if (fresh) {
      this.ensureNoise();
      this.ensureBoomShaper();
      this.busBaseGain = this.bus.gain.value;
    }
    if (!this.bedOn) this.startBed();
    this.applyZoomGain(); // a zoom level set pre-attach takes effect now
  }

  /** Gentle tanh saturation shared by all explosion layers — grit, not volume. */
  private ensureBoomShaper(): void {
    if (!this.ctx || !this.bus || this.boomShaper) return;
    const ws = this.ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = i / 128 - 1;
      curve[i] = Math.tanh(2.1 * x);
    }
    ws.curve = curve;
    ws.connect(this.bus);
    this.boomShaper = ws;
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
    // Zoom LOD virtual radius: at altitude the audio pretends the camera's
    // view radius is small, so every explosion reads at/beyond the view edge
    // on the SAME blastGain/blastCutoff curve — distant rumble that opens up
    // as you descend. 0 = no override, the live camera's radius drives (Z4).
    const real = Math.max(0.05, c.radius);
    const r = this.zoomRadius > 0 ? this.zoomRadius : real;
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
    rumbleG.gain.value = BED.rumbleGain * (1 + this.intensity * 1.2);
    this.bedRumbleGain = rumbleG;
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
      // Drums quicken as the battle intensifies — 2.2s apart at rest,
      // ~1.1s apart at full intensity.
      const gap = (1400 + Math.random() * 800) / (1 + this.intensity * 0.9);
      this.bedTimers.push(window.setTimeout(drum, gap));
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

  /** Battle intensity 0..1 — the bed breathes with the fighting: the
   *  bombardment rumble swells and the war-drums quicken. Clamped; safe to
   *  call every frame from the scene (no-ops when unchanged or detached). */
  setIntensity(v: number): void {
    const nv = Math.min(1, Math.max(0, v));
    if (nv === this.intensity) return;
    this.intensity = nv;
    if (!this.ctx || !this.bedOn) return;
    const t = this.ctx.currentTime;
    if (this.bedRumbleGain) {
      this.bedRumbleGain.gain.setTargetAtTime(
        BED.rumbleGain * (1 + nv * 1.2), t, 0.8);
    }
  }

  private stopBed(): void {
    this.bedOn = false;
    this.bedRumbleGain = null;
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

  /** Explosion at world coords — distance-muffled, ground-cam hits harder.
   *  Four layers from one shared noise source (the blast breathes as one):
   *  the supersonic crack, the midrange body, the long rumble tail, plus a
   *  sub-bass pressure wave and its phone-audible harmonic. Big blasts shed
   *  sparse debris crackles afterwards. Everything bites through the shared
   *  saturation shaper. */
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
    const out = this.boomShaper ?? this.bus!;
    this.boomVoices++;

    // One noise source, split four ways — layers, not separate pops.
    const tailDur = big ? 1.8 : 1.2;
    const n = this.noise(tailDur);
    if (n) {
      // Layer 1: the crack — supersonic snap, highpassed, gone in 30ms.
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = Math.min(6500, Math.max(1200, cutoff * 1.6));
      const cg = this.adsrGain(Math.min(1, g * 1.05), 0.002, 0.035)!;
      n.connect(hp); hp.connect(cg); cg.connect(out);

      // Layer 2: the body — midrange whoomph with a punchy attack.
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = Math.min(750, Math.max(180, cutoff * 0.35));
      bp.Q.value = 0.7;
      const bg = this.adsrGain(Math.min(1, g * 0.9), 0.007, big ? 0.5 : 0.35)!;
      n.connect(bp); bp.connect(bg); bg.connect(out);

      // Layer 3: the rumble tail — low, slow, long. This is what lingers.
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = Math.min(170, Math.max(60, cutoff * 0.12));
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(0.0001, t);
      lg.gain.exponentialRampToValueAtTime(Math.min(1, g * 0.7), t + 0.05);
      lg.gain.exponentialRampToValueAtTime(0.0001, t + tailDur);
      n.connect(lp); lp.connect(lg); lg.connect(out);

      n.start(t);
      n.stop(t + tailDur + 0.1);
      const cleanup = [hp, cg, bp, bg, lp, lg];
      n.onended = () => {
        this.boomVoices = Math.max(0, this.boomVoices - 1);
        try {
          n.disconnect();
          for (const nn of cleanup) nn.disconnect();
        } catch { /* gone */ }
      };
    } else {
      this.boomVoices = Math.max(0, this.boomVoices - 1);
    }

    // Layer 4: sub-bass pressure wave — the thump you feel in your chest.
    // Long decay; real blasts push air for a full second, not a quarter.
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(big ? 92 : 82, t);
    o.frequency.exponentialRampToValueAtTime(23, t + (big ? 0.95 : 0.65));
    const og = this.adsrGain(Math.min(1, g * 0.85), 0.005, big ? 1.15 : 0.75)!;
    o.connect(og); og.connect(out);
    o.start(t);
    o.stop(t + (big ? 1.35 : 0.95));
    o.onended = () => { try { o.disconnect(); og.disconnect(); } catch { /* gone */ } };

    // Phone-audible punch — the 2nd harmonic carries the thump on small
    // speakers where the sub sine above is lost entirely.
    const oh = ctx.createOscillator();
    oh.type = "triangle";
    oh.frequency.setValueAtTime(164, t);
    oh.frequency.exponentialRampToValueAtTime(46, t + 0.4);
    const ohg = this.adsrGain(Math.min(1, g * 0.32), 0.005, 0.38)!;
    oh.connect(ohg); ohg.connect(out);
    oh.start(t);
    oh.stop(t + 0.55);
    oh.onended = () => { try { oh.disconnect(); ohg.disconnect(); } catch { /* gone */ } };

    // Debris crackle on big blasts — sparse secondary pops as wreckage lands.
    if (big && g > 0.12) {
      const pops = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < pops; i++) {
        const delayMs = (0.28 + Math.random() * 0.95) * 1000;
        window.setTimeout(() => {
          if (!this.live()) return;
          const tt = this.ctx!.currentTime;
          const pn = this.noise(0.09);
          if (!pn) return;
          const pbp = this.ctx!.createBiquadFilter();
          pbp.type = "bandpass";
          pbp.frequency.value = 1100 + Math.random() * 2200;
          pbp.Q.value = 2.2;
          const pg = this.adsrGain(g * 0.22 * (0.4 + Math.random() * 0.6), 0.003, 0.09)!;
          pn.connect(pbp); pbp.connect(pg); pg.connect(out);
          pn.start(tt);
          pn.stop(tt + 0.18);
          pn.onended = () => { try { pn.disconnect(); pbp.disconnect(); pg.disconnect(); } catch { /* gone */ } };
        }, delayMs);
      }
    }
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

  /** Weapons fire — throttled so 40 tracers don't become 40 voices.
   *  Each kind has a real voice: lasers sweep down (the pew has a throat),
   *  railguns crack violent, turrets thump heavy. Optional world coords let
   *  distant fire read distant — sound is animation. */
  tracer(kind: "crack" | "snipe" | "turret" | "chaingun" = "crack", x?: number, y?: number): void {
    if (!this.live()) return;
    const now = performance.now();
    if (now - this.lastTracerMs < TRACER_MIN_MS) return;
    this.lastTracerMs = now;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const bus = this.bus!;
    // Distance voice: far fire is quieter and duller. Defaults to mid-field
    // when the scene doesn't pass a position (backward compatible).
    const dg = x !== undefined && y !== undefined
      ? blastGain(this.dist(x, y), this.cam().ground)
      : 0.55;
    if (dg < 0.04) return;

    if (kind === "crack") {
      // Laser — a sawtooth throat sweeping down, with a plasma snap on top.
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(1450, t);
      o.frequency.exponentialRampToValueAtTime(310, t + 0.11);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 4200;
      const g = this.adsrGain(0.13 * dg, 0.004, 0.14)!;
      o.connect(lp); lp.connect(g); g.connect(bus);
      o.start(t); o.stop(t + 0.22);
      o.onended = () => { try { o.disconnect(); lp.disconnect(); g.disconnect(); } catch { /* gone */ } };
      const n = this.noise(0.05);
      if (n) {
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass"; hp.frequency.value = 3200;
        const ng = this.adsrGain(0.05 * dg, 0.002, 0.05)!;
        n.connect(hp); hp.connect(ng); ng.connect(bus);
        n.start(t); n.stop(t + 0.1);
        n.onended = () => { try { n.disconnect(); hp.disconnect(); ng.disconnect(); } catch { /* gone */ } };
      }
    } else if (kind === "snipe") {
      // T4 railgun — violent crack, deep punch underneath. The mean one.
      const n = this.noise(0.16);
      if (n) {
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass"; hp.frequency.value = 2400;
        const g = this.adsrGain(0.12 * dg, 0.002, 0.16)!;
        n.connect(hp); hp.connect(g); g.connect(bus);
        n.start(t); n.stop(t + 0.26);
        n.onended = () => { try { n.disconnect(); hp.disconnect(); g.disconnect(); } catch { /* gone */ } };
      }
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.setValueAtTime(2300, t);
      o.frequency.exponentialRampToValueAtTime(420, t + 0.1);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 5000;
      const og = this.adsrGain(0.06 * dg, 0.002, 0.12)!;
      o.connect(lp); lp.connect(og); og.connect(bus);
      o.start(t); o.stop(t + 0.2);
      o.onended = () => { try { o.disconnect(); lp.disconnect(); og.disconnect(); } catch { /* gone */ } };
      const th = ctx.createOscillator();
      th.type = "sine";
      th.frequency.setValueAtTime(140, t);
      th.frequency.exponentialRampToValueAtTime(55, t + 0.12);
      const thg = this.adsrGain(0.09 * dg, 0.004, 0.16)!;
      th.connect(thg); thg.connect(bus);
      th.start(t); th.stop(t + 0.24);
      th.onended = () => { try { th.disconnect(); thg.disconnect(); } catch { /* gone */ } };
    } else if (kind === "chaingun") {
      // Chain gun — rapid mechanical bark, not a laser pew. Harsh noise
      // burst with a metallic clank underneath. (Hans Oct 11 2026)
      const n = this.noise(0.09);
      if (n) {
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 1.2;
        const g = this.adsrGain(0.14 * dg, 0.002, 0.09)!;
        n.connect(bp); bp.connect(g); g.connect(bus);
        n.start(t); n.stop(t + 0.14);
        n.onended = () => { try { n.disconnect(); bp.disconnect(); g.disconnect(); } catch { /* gone */ } };
      }
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.setValueAtTime(180, t);
      o.frequency.exponentialRampToValueAtTime(90, t + 0.08);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 1200;
      const og = this.adsrGain(0.08 * dg, 0.002, 0.1)!;
      o.connect(lp); lp.connect(og); og.connect(bus);
      o.start(t); o.stop(t + 0.16);
      o.onended = () => { try { o.disconnect(); lp.disconnect(); og.disconnect(); } catch { /* gone */ } };
    } else {
      // Turret — heavy rotary thump, low and blunt.
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(290, t);
      o.frequency.exponentialRampToValueAtTime(85, t + 0.1);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 900;
      const g = this.adsrGain(0.1 * dg, 0.005, 0.14)!;
      o.connect(lp); lp.connect(g); g.connect(bus);
      o.start(t); o.stop(t + 0.22);
      o.onended = () => { try { o.disconnect(); lp.disconnect(); g.disconnect(); } catch { /* gone */ } };
      const n = this.noise(0.1);
      if (n) {
        const nbp = ctx.createBiquadFilter();
        nbp.type = "bandpass"; nbp.frequency.value = 500; nbp.Q.value = 0.8;
        const ng = this.adsrGain(0.07 * dg, 0.004, 0.1)!;
        n.connect(nbp); nbp.connect(ng); ng.connect(bus);
        n.start(t); n.stop(t + 0.18);
        n.onended = () => { try { n.disconnect(); nbp.disconnect(); ng.disconnect(); } catch { /* gone */ } };
      }
    }
  }

  /** Hull impact — rams, collisions, debris strikes. Struck-metal partials
   *  (inharmonic, like a real plate) over a strike transient, with the hull
   *  itself groaning underneath as the structure resonates. Distance-gated
   *  like everything else. */
  impact(x: number, y: number, metal = true): void {
    if (!this.live()) return;
    const d = this.dist(x, y);
    const g = blastGain(d, this.cam().ground);
    if (g < 0.05) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const out = this.boomShaper ?? this.bus!;

    if (metal) {
      // Struck plate — inharmonic partials, slightly detuned per hit so
      // repeated impacts don't machine-gun.
      const partials: Array<[number, number]> = [
        [211, 0.5], [347, 0.34], [522, 0.24], [833, 0.14],
      ];
      for (const [f, a] of partials) {
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = f * (0.97 + Math.random() * 0.06);
        const og = this.adsrGain(g * 0.26 * a, 0.003, 0.42)!;
        o.connect(og); og.connect(out);
        o.start(t);
        o.stop(t + 0.55);
        o.onended = () => { try { o.disconnect(); og.disconnect(); } catch { /* gone */ } };
      }
      // The strike itself — bright transient.
      const n = this.noise(0.07);
      if (n) {
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass"; bp.frequency.value = 2600; bp.Q.value = 1.4;
        const ng = this.adsrGain(g * 0.38, 0.002, 0.07)!;
        n.connect(bp); bp.connect(ng); ng.connect(out);
        n.start(t);
        n.stop(t + 0.14);
        n.onended = () => { try { n.disconnect(); bp.disconnect(); ng.disconnect(); } catch { /* gone */ } };
      }
    }
    // Hull groan — low structure resonance, the ship complaining.
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(96, t);
    o.frequency.exponentialRampToValueAtTime(41, t + 0.7);
    const og = this.adsrGain(g * 0.5, 0.012, 0.85)!;
    o.connect(og); og.connect(out);
    o.start(t);
    o.stop(t + 1.05);
    o.onended = () => { try { o.disconnect(); og.disconnect(); } catch { /* gone */ } };
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

  /** Movement-report alert — Longeyes calling out an enemy maneuver.
   *  Two-tone high ping, distinct from the order blips. */
  ping(): void {
    if (!this.live()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    for (const [f, dt] of [[1180, 0], [880, 0.12]] as const) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const g = this.adsrGain(0.09, 0.005, 0.1)!;
      o.connect(g); g.connect(this.bus!);
      o.start(t + dt); o.stop(t + dt + 0.18);
      o.onended = () => { try { o.disconnect(); g.disconnect(); } catch { /* gone */ } };
    }
  }

  /** Routine comms blip — softer than the alert ping. Battle-comms bubbles
   *  that don't need a pulse use this. Respects the same mute/live gate. */
  blip(): void {
    if (!this.live()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = 740;
    const g = this.adsrGain(0.05, 0.005, 0.07)!;
    o.connect(g); g.connect(this.bus!);
    o.start(t); o.stop(t + 0.12);
    o.onended = () => { try { o.disconnect(); g.disconnect(); } catch { /* gone */ } };
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
