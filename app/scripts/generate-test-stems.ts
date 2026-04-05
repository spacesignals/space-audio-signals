/**
 * Generate synthetic test stems in C minor for each planet.
 * Each body gets 1-3 stems: a drone, a pad, and optionally a texture layer.
 * All in C minor (C, D, Eb, F, G, Ab, Bb).
 *
 * Run: cd app && npx tsx scripts/generate-test-stems.ts
 * Requires: npm install wav-encoder (dev dependency)
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const SAMPLE_RATE = 44100;
const DURATION = 30; // seconds per stem (they loop)

// C minor scale frequencies (octave 2-4 range for ambient feel)
const NOTES: Record<string, number> = {
  C2: 65.41, D2: 73.42, Eb2: 77.78, F2: 87.31, G2: 98.00, Ab2: 103.83, Bb2: 116.54,
  C3: 130.81, D3: 146.83, Eb3: 155.56, F3: 174.61, G3: 196.00, Ab3: 207.65, Bb3: 233.08,
  C4: 261.63, D4: 293.66, Eb4: 311.13, F4: 349.23, G4: 392.00, Ab4: 415.30, Bb4: 466.16,
};

// Body assignments — each gets notes from C minor that feel right for its character
const BODY_STEMS: Record<string, { stems: { name: string; notes: string[]; type: 'drone' | 'pad' | 'texture' | 'chaotic' }[] }> = {
  sun: {
    stems: [
      { name: 'drone-01', notes: ['C2'], type: 'drone' },        // Root, deep
      { name: 'texture-01', notes: ['G2', 'C3'], type: 'texture' }, // Fifth + octave
    ],
  },
  mercury: {
    stems: [
      { name: 'tone-01', notes: ['Bb3', 'F3'], type: 'pad' },   // Quick, nervous
    ],
  },
  venus: {
    stems: [
      { name: 'pad-01', notes: ['Ab3', 'Eb3'], type: 'pad' },   // Warm, hazy
      { name: 'texture-01', notes: ['Ab4'], type: 'texture' },
    ],
  },
  earth: {
    stems: [
      { name: 'pad-01', notes: ['C3', 'G3'], type: 'pad' },     // Home — root + fifth
      { name: 'melody-01', notes: ['Eb4', 'D4', 'C4'], type: 'texture' }, // Minor melody fragment
    ],
  },
  mars: {
    stems: [
      { name: 'drone-01', notes: ['D2', 'Ab2'], type: 'chaotic' },   // Tritone grinding
      { name: 'texture-01', notes: ['F3', 'Bb3', 'D4'], type: 'chaotic' }, // Restless cluster
      { name: 'texture-02', notes: ['Ab3', 'Eb4'], type: 'texture' }, // High dissonant shimmer
    ],
  },
  jupiter: {
    stems: [
      { name: 'bass-01', notes: ['C2', 'G2'], type: 'drone' },   // Massive — root power
      { name: 'pad-01', notes: ['Eb3', 'Bb3'], type: 'pad' },    // Minor third + seventh
      { name: 'texture-01', notes: ['G4', 'Eb4'], type: 'texture' },
    ],
  },
  saturn: {
    stems: [
      { name: 'pad-01', notes: ['Ab3', 'C3'], type: 'pad' },    // Ethereal minor sixth
      { name: 'shimmer-01', notes: ['Eb4', 'Bb4'], type: 'texture' }, // High shimmer
      { name: 'drone-01', notes: ['F2'], type: 'drone' },
    ],
  },
  uranus: {
    stems: [
      { name: 'tone-01', notes: ['Bb2', 'F3'], type: 'pad' },   // Cold, distant
      { name: 'texture-01', notes: ['D4', 'Ab3'], type: 'texture' },
    ],
  },
  neptune: {
    stems: [
      { name: 'pad-01', notes: ['Eb2', 'Bb2'], type: 'pad' },   // Deepest, most distant
      { name: 'drone-01', notes: ['G2', 'D3'], type: 'drone' },  // Minor feel
    ],
  },
};

function generateStem(
  notes: string[],
  type: 'drone' | 'pad' | 'texture' | 'chaotic',
  duration: number,
  sampleRate: number
): Float32Array {
  const numSamples = duration * sampleRate;
  const buffer = new Float32Array(numSamples);
  const freqs = notes.map(n => NOTES[n]);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sample = 0;

    for (const freq of freqs) {
      switch (type) {
        case 'drone':
          // Sine + subtle harmonics, slow amplitude LFO
          sample += Math.sin(2 * Math.PI * freq * t) * 0.5;
          sample += Math.sin(2 * Math.PI * freq * 2 * t) * 0.15; // octave harmonic
          sample += Math.sin(2 * Math.PI * freq * 3 * t) * 0.05; // fifth harmonic
          sample *= 0.8 + 0.2 * Math.sin(2 * Math.PI * 0.05 * t); // slow LFO
          break;

        case 'pad':
          // Saw-ish with detuning for warmth
          sample += Math.sin(2 * Math.PI * freq * t) * 0.35;
          sample += Math.sin(2 * Math.PI * (freq * 1.003) * t) * 0.35; // slight detune
          sample += Math.sin(2 * Math.PI * (freq * 0.997) * t) * 0.35; // slight detune other way
          sample *= 0.7 + 0.3 * Math.sin(2 * Math.PI * 0.08 * t); // gentle pulse
          break;

        case 'texture':
          // High partials + noise modulation for shimmer
          sample += Math.sin(2 * Math.PI * freq * t) * 0.3;
          sample += Math.sin(2 * Math.PI * freq * 1.5 * t) * 0.15; // fifth partial
          sample += Math.sin(2 * Math.PI * freq * 2.01 * t) * 0.1; // detuned octave
          // Amplitude modulated by a slow random-ish LFO
          sample *= 0.5 + 0.5 * Math.sin(2 * Math.PI * (0.13 + freq * 0.0001) * t);
          break;

        case 'chaotic':
          // Aggressive, restless: multiple detuned oscillators, fast cross-modulation,
          // irregular amplitude stutters. Mars = tension, conflict, dust storms.
          {
            const base = Math.sin(2 * Math.PI * freq * t);
            const detune1 = Math.sin(2 * Math.PI * freq * 1.007 * t);
            const detune2 = Math.sin(2 * Math.PI * freq * 0.993 * t);
            // FM synthesis: modulate frequency with another oscillator
            const fm = Math.sin(2 * Math.PI * freq * t + 3.5 * Math.sin(2 * Math.PI * freq * 0.51 * t));
            // Fast irregular LFO — multiple rates beating against each other
            const lfo1 = Math.sin(2 * Math.PI * 1.3 * t);
            const lfo2 = Math.sin(2 * Math.PI * 0.7 * t);
            const lfo3 = Math.sin(2 * Math.PI * 3.1 * t);
            const stutter = 0.3 + 0.7 * Math.max(0, lfo1 * lfo2 + 0.3 * lfo3);
            // Mix
            sample += (base * 0.25 + detune1 * 0.2 + detune2 * 0.2 + fm * 0.35) * stutter;
            // Add gritty harmonics
            sample += Math.sin(2 * Math.PI * freq * 3.01 * t) * 0.08;
            sample += Math.sin(2 * Math.PI * freq * 5.03 * t) * 0.04;
          }
          break;
      }
    }

    // Normalize per number of notes
    sample /= freqs.length;

    // Gentle fade in/out for seamless looping (crossfade first/last 2 seconds)
    const fadeLen = 2 * sampleRate;
    if (i < fadeLen) {
      sample *= i / fadeLen;
    } else if (i > numSamples - fadeLen) {
      sample *= (numSamples - i) / fadeLen;
    }

    // Soft clip to prevent harsh peaks
    sample = Math.tanh(sample * 0.8);

    buffer[i] = sample;
  }

  return buffer;
}

function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const numSamples = samples.length;
  const bytesPerSample = 2; // 16-bit
  const dataSize = numSamples * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  // WAV header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);        // chunk size
  buffer.writeUInt16LE(1, 20);         // PCM
  buffer.writeUInt16LE(1, 22);         // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);        // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Write samples as 16-bit PCM
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const val = s < 0 ? s * 32768 : s * 32767;
    buffer.writeInt16LE(Math.round(val), 44 + i * 2);
  }

  return buffer;
}

// Generate all stems
const outBase = join(process.cwd(), 'public', 'audio');

for (const [bodyId, config] of Object.entries(BODY_STEMS)) {
  const bodyDir = join(outBase, bodyId);
  mkdirSync(bodyDir, { recursive: true });

  for (const stem of config.stems) {
    console.log(`Generating ${bodyId}/${stem.name} [${stem.notes.join(', ')}] (${stem.type})...`);
    const samples = generateStem(stem.notes, stem.type, DURATION, SAMPLE_RATE);
    const wav = encodeWav(samples, SAMPLE_RATE);
    writeFileSync(join(bodyDir, `${stem.name}.wav`), wav);
  }
}

console.log('\nDone! Generated WAV stems in public/audio/');
console.log('Note: These are WAV files. The body configs expect .m4a — updating now would');
console.log('require changing data/bodies.ts. For dev testing, WAV works fine in browsers.');
console.log('\nTo use: update stem extensions in src/data/bodies.ts from .m4a to .wav');
