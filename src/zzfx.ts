// ZzFX - Zuper Zmall Zound Zynth - Micro Edition
// MIT License - Copyright 2019 Frank Force
// https://github.com/KilledByAPixel/ZzFX
import { S } from './state'

// This is a minified build of zzfx for use in size coding projects.
// You can use zzfxV to set volume.
// Feel free to minify it further for your own needs!

///////////////////////////////////////////////////////////////////////////////

// ZzFXMicro - Zuper Zmall Zound Zynth - v1.3.1 by Frank Force

// ==ClosureCompiler==
// @compilation_level ADVANCED_OPTIMIZATIONS
// @output_file_name ZzFXMicro.min.js
// @js_externs zzfx, zzfxG, zzfxP, zzfxV, zzfxX
// @language_out ECMASCRIPT_2019
// ==/ClosureCompiler==

// TypeScript types
type ZzfxParams = [
  volume?: number,
  randomness?: number,
  frequency?: number,
  attack?: number,
  sustain?: number,
  release?: number,
  shape?: number,
  shapeCurve?: number,
  slide?: number,
  deltaSlide?: number,
  pitchJump?: number,
  pitchJumpTime?: number,
  repeatTime?: number,
  noise?: number,
  modulation?: number,
  bitCrush?: number,
  delay?: number,
  sustainVolume?: number,
  decay?: number,
  tremolo?: number,
  filter?: number,
]

let zzfxV: number = 0.3 // volume
let musicGain = null as GainNode | null
export const zzfxR: number = 44100 // sample rate
export const zzfxX: AudioContext = new AudioContext() // audio context

export const toggleMute = () => {
  S.muteState = (S.muteState + 1) % 3
  localStorage.m = S.muteState // persist across sessions
  zzfxV = S.muteState === 0 ? 0 : 0.3
  if (musicGain) musicGain.gain.value = S.muteState === 2 ? 1 : 0 // music only in "all sound"
}

// ── Procedural ambient score ────────────────────────────────────────────────
// A chord-swell pad + a swung downtempo drum loop, both driven off ONE step clock so
// they never drift. Not a pre-rendered loop — scheduled live, so it never repeats a
// fixed buffer. Routed through musicGain, so muteState controls it (music in state 2).
// 16-step swung loop, one row per voice: [zzfx params, 'x'=hit pattern]. Params are inlined
// (not a name→params record) so mangleProps can't break a string-keyed lookup. kick/snare/hat.
const PAT: [ZzfxParams, string][] = [
  [[1.7, 0, 90, .001, .03, .12, 0, 0, 0, -15, 0, 0, 0, .6, 0, 0, 0, 1, .05, 0, -350], 'x.........x.....'],
  [[.5, .1, 500, 0, .015, .07, 3, 0, 0, 0, 0, 0, 0, 6, 0, 0, 0, 1, 0, 0, 2200], '....x.......x...'],
  [[.28, .1, 7000, 0, .002, .03, 3, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 1, 0, 0, 3000], 'x.x.x.x.x.x.x.x.'],
]
// chord voicings (semitone offsets from root). home = 0-3, away = 4-7.
const CHORDS = [[0, 7, 10, 15], [0, 3, 10, 14], [-2, 5, 8, 12], [0, 7, 12, 17],
  [5, 8, 12, 17], [3, 10, 14, 19], [7, 10, 15, 22], [0, 5, 12, 17]]
// section sequence: home, home, away (each block = its 4 chords), then repeat.
const SEQ = [0, 1, 2, 3, 0, 1, 2, 3, 4, 5, 6, 7]
const ROOT = 53, BPM = 70, SWING = .26, DRUMVOL = .6
const LOOPS_PER_CHORD = 2 // how many 16-step loops each chord holds
// chord-swell envelope (seconds). sustain is DERIVED so total voice length
// (ATK + sustain + REL) = chordPeriod + OVERLAP. OVERLAP > 0 => chords crossfade;
// OVERLAP < 0 => a gap of near-silence between chords.
const ATK = 1, REL = 2, OVERLAP = 1

// Chord buffers, rendered once at load (renderMusic). Each chord voice is a ~6s buffer,
// identical every time it plays, so pre-rendering makes playback a cheap BufferSource
// replay with zero runtime hitch. Rendering is pure math (no gesture needed) — only
// playback needs a resumed AudioContext, which happens on first input via playMusic().
let cache: AudioBuffer[][]
export const renderMusic = () => {
  const loopLen = 16 * (15000 / BPM) / 1000              // seconds per loop (swing cancels)
  const sus = Math.max(.1, LOOPS_PER_CHORD * loopLen + OVERLAP - ATK - REL) // derived sustain
  // defer a tick so the menu overlay paints before this ~0.5s blocking render
  setTimeout(() => {
    cache = CHORDS.map((chord) => chord.map((semi) => {
      const base = 440 * 2 ** ((ROOT + semi - 69) / 12)
      const a = zzfxG(.13, 0, base, ATK, sus, REL, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0)          // fundamental
      const b = zzfxG(.1, 0, base * 1.005, ATK, sus, REL, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0)   // detune twin
      const buf = zzfxX.createBuffer(1, a.length, zzfxR)
      const d = buf.getChannelData(0)
      d.set(a); for (let i = 0; i < b.length; i++) d[i] += b[i] // sum both voices into one buffer
      return buf
    }))
  })
}

// chord swells auto-arm after the first full drum loop (see tick) — one round of drums alone,
// then the pads come in. ciRef.c is the chord index.
let ciRef = { c: 0 }

export const playMusic = () => {
  const mg = musicGain = zzfxX.createGain()
  mg.connect(zzfxX.destination)
  mg.gain.value = S.muteState === 2 ? 1 : 0 // music only in "all sound"
  const drumBus = zzfxX.createGain()
  drumBus.gain.value = DRUMVOL
  drumBus.connect(mg)

  let s = 0, loop = 0
  const swell = () => {
    if (!cache) return // buffers not rendered yet (shouldn't happen — rendered at load)
    for (const buf of cache[SEQ[ciRef.c++ % SEQ.length]]) {
      const src = zzfxX.createBufferSource()
      src.buffer = buf; src.connect(mg); src.start()
    }
  }
  const tick = () => {
    for (const [params, p] of PAT) if (p[s] === 'x') zzfxP(zzfxG(...params), drumBus)
    // first swell after two full drum loops (loop 2), then every LOOPS_PER_CHORD loops after.
    if (s === 0) { if (loop > 0 && loop % LOOPS_PER_CHORD === 0) swell(); loop++ }
    const base = 15000 / BPM
    setTimeout(tick, base * (s % 2 ? 1 + SWING : 1 - SWING))
    s = (s + 1) % 16
  }
  tick()
}

export function zzfx(...z: ZzfxParams): AudioBufferSourceNode {
  if (S.muteState === 0) return {} as AudioBufferSourceNode // sfx in states 1 and 2
  return zzfxP(zzfxG(...z))
}

export function zzfxP(sample: Float32Array, dest?: AudioNode): AudioBufferSourceNode {
  const buffer = zzfxX.createBuffer(1, sample.length, zzfxR)
  buffer.getChannelData(0).set(sample)
  const source = zzfxX.createBufferSource()
  source.buffer = buffer
  source.connect(dest || zzfxX.destination)
  source.start()
  return source
}

export function zzfxG(
  volume = 1,
  randomness = 0.05,
  frequency = 220,
  attack = 0,
  sustain = 0,
  release = 0.1,
  shape = 0,
  shapeCurve = 1,
  slide = 0,
  deltaSlide = 0,
  pitchJump = 0,
  pitchJumpTime = 0,
  repeatTime = 0,
  noise = 0,
  modulation = 0,
  bitCrush = 0,
  delay = 0,
  sustainVolume = 1,
  decay = 0,
  tremolo = 0,
  filter = 0,
): Float32Array {
  // ...existing code...
  const PI2 = Math.PI * 2
  const sign = (v: number) => (v < 0 ? -1 : 1)
  slide = (slide * (500 * PI2)) / zzfxR / zzfxR
  const startSlide = slide
  frequency =
    (frequency * ((1 + randomness * 2 * Math.random() - randomness) * PI2)) /
    zzfxR
  const startFrequency = frequency
  const b: number[] = []
  let t = 0
  let tm = 0
  let i = 0
  let j = 1
  let r = 0
  let c = 0
  let s = 0
  let f: number
  let length: number
  const quality = 2
  const w = (PI2 * Math.abs(filter) * 2) / zzfxR
  const cos = Math.cos(w)
  const alpha = Math.sin(w) / 2 / quality
  const a0 = 1 + alpha
  const a1 = (-2 * cos) / a0
  const a2 = (1 - alpha) / a0
  const b0 = (1 + sign(filter) * cos) / 2 / a0
  const b1 = -(sign(filter) + cos) / a0
  const b2 = b0
  let x2 = 0
  let x1 = 0
  let y2 = 0
  let y1 = 0

  // ...existing code...
  attack = attack * zzfxR + 9
  decay *= zzfxR
  sustain *= zzfxR
  release *= zzfxR
  delay *= zzfxR
  deltaSlide *= (500 * PI2) / zzfxR ** 3
  modulation *= PI2 / zzfxR
  pitchJump *= PI2 / zzfxR
  pitchJumpTime *= zzfxR
  repeatTime = (repeatTime * zzfxR) | 0
  volume *= zzfxV

  length = (attack + decay + sustain + release + delay) | 0
  while (i < length) {
    // ...existing code...
    if (!(++c % ((bitCrush * 100) | 0))) {
      s = shape
        ? shape > 1
          ? shape > 2
            ? shape > 3
              ? Math.sin(t ** 3)
              : Math.max(Math.min(Math.tan(t), 1), -1)
            : 1 - (((((2 * t) / PI2) % 2) + 2) % 2)
          : 1 - 4 * Math.abs(Math.round(t / PI2) - t / PI2)
        : Math.sin(t)

      s =
        (repeatTime
          ? 1 - tremolo + tremolo * Math.sin((PI2 * i) / repeatTime)
          : 1) *
        sign(s) *
        Math.abs(s) ** shapeCurve *
        (i < attack
          ? i / attack
          : i < attack + decay
          ? 1 - ((i - attack) / decay) * (1 - sustainVolume)
          : i < attack + decay + sustain
          ? sustainVolume
          : i < length - delay
          ? ((length - i - delay) / release) * sustainVolume
          : 0)

      if (delay) {
        if (delay > i) {
          s = s / 2
        } else {
          const releaseDelay = i < length - delay ? 1 : (length - i) / delay
          s = s / 2 + (releaseDelay * b[(i - delay) | 0]) / 2 / volume
        }
      }

      if (filter) {
        // break up assignments for TypeScript
        x2 = x1
        x1 = s
        y2 = y1
        y1 = b2 * x2 + b1 * x2 + b0 * x1 - a2 * y2 - a1 * y1
        s = y1
      }
    }

    // break up assignments for TypeScript
    slide += deltaSlide
    frequency += slide
    f = frequency * Math.cos(modulation * tm++)
    t += f + f * noise * Math.sin(i ** 5)

    if (j && ++j > pitchJumpTime) {
      frequency += pitchJump
      // startFrequency is const, so skip updating it
      j = 0
    }

    if (repeatTime && !(++r % repeatTime)) {
      frequency = startFrequency
      slide = startSlide
      j = j || 1
    }

    b[i++] = s * volume
  }

  return Float32Array.from(b)
}
