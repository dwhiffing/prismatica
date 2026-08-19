// ZzFX - Zuper Zmall Zound Zynth - Micro Edition
// MIT License - Copyright 2019 Frank Force
// https://github.com/KilledByAPixel/ZzFX
import { clickSound, music } from './sounds'
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
  if (S.muteState) zzfx(...clickSound) // audible feedback whenever sfx are on
  if (musicGain) musicGain.gain.value = S.muteState === 2 ? 1 : 0 // music only in "all sound"
}

export const playMusic = () => {
  // @ts-ignore
  const m = zzfxM(...music)
  // @ts-ignore
  const musicNode = zzfxP(...m)

  musicGain = zzfxX.createGain()
  musicGain.connect(zzfxX.destination)
  musicNode.disconnect()
  musicNode.connect(musicGain)
  musicNode.loop = true
  musicGain.gain.value = S.muteState === 2 ? 1 : 0 // music only in "all sound"
}

export function zzfx(...z: ZzfxParams): AudioBufferSourceNode {
  if (S.muteState === 0) return {} as AudioBufferSourceNode // sfx in states 1 and 2
  return zzfxP(zzfxG(...z))
}

export function zzfxP(...samples: Float32Array[]): AudioBufferSourceNode {
  const buffer = zzfxX.createBuffer(samples.length, samples[0].length, zzfxR)
  const source = zzfxX.createBufferSource()
  samples.map((d, i) => buffer.getChannelData(i).set(d))
  source.buffer = buffer
  source.connect(zzfxX.destination)
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

// @ts-ignore
export const zzfxM=(n,f,t,e=125)=>{let l,o,z,r,g,h,x,a,u,c,d,i,m,p,G,M=0,R=[],b=[],j=[],k=0,q=0,s=1,v={},w=zzfxR/e*60>>2;for(;s;k++)R=[s=a=d=m=0],t.map((e,d)=>{for(x=f[e][k]||[0,0,0],s|=!!f[e][k],G=m+(f[e][0].length-2-!a)*w,p=d==t.length-1,o=2,r=m;o<x.length+p;a=++o){for(g=x[o],u=o==x.length+p-1&&p||c!=(x[0]||0)|g|0,z=0;z<w&&a;z++>w-99&&u?i+=(i<1)/99:0)h=(1-i)*R[M++]/2||0,b[r]=(b[r]||0)-h*q+h,j[r]=(j[r++]||0)+h*q+h;g&&(i=g%1,q=x[1]||0,(g|=0)&&(R=v[[c=x[M=0]||0,g]]=v[[c,g]]||(l=[...n[c]],l[2]*=2**((g-12)/12),g>0?zzfxG(...l):[])))}m=G});return[b,j]}
