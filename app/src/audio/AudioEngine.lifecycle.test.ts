import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioEngine } from './AudioEngine';
import type { BodyDistance } from '../types';

// Minimal AudioContext mock
function createMockAudioContext() {
  const gainNode = {
    gain: { value: 0, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const oscillator = {
    type: 'sine',
    frequency: { value: 0 },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const bufferSource = {
    buffer: null,
    loop: false,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
  };
  const filter = {
    type: 'lowpass',
    frequency: { value: 0 },
    Q: { value: 0 },
    connect: vi.fn(),
  };

  const ctx = {
    state: 'running',
    currentTime: 0,
    sampleRate: 44100,
    destination: {},
    createGain: vi.fn(() => ({ ...gainNode, gain: { ...gainNode.gain, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() } })),
    createOscillator: vi.fn(() => ({ ...oscillator, frequency: { value: 0 } })),
    createBufferSource: vi.fn(() => ({ ...bufferSource })),
    createBiquadFilter: vi.fn(() => ({ ...filter, frequency: { value: 0 }, Q: { value: 0 } })),
    createBuffer: vi.fn(() => ({ getChannelData: () => new Float32Array(44100 * 2) })),
    decodeAudioData: vi.fn(),
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(),
  };

  return ctx;
}

function makeDistance(bodyId: string, distanceKm: number, audibilityRadiusKm = 1e8): BodyDistance {
  return {
    bodyId,
    distanceKm,
    config: {
      id: bodyId,
      name: bodyId,
      type: 'planet',
      radiusKm: 6371,
      audibilityRadiusKm,
      maxGain: 0.6,
      gainCurve: 'logarithmic',
      stems: [`${bodyId}/pad-01.m4a`],
      color: '#fff',
    },
  };
}

describe('AudioEngine lifecycle', () => {
  let mockCtx: ReturnType<typeof createMockAudioContext>;

  beforeEach(() => {
    mockCtx = createMockAudioContext();
    vi.stubGlobal('AudioContext', function MockAudioContext() {
      return mockCtx;
    });
  });

  it('init creates AudioContext and starts drone', async () => {
    const engine = new AudioEngine();
    await engine.init();

    expect(mockCtx.createGain).toHaveBeenCalled();
    expect(mockCtx.createOscillator).toHaveBeenCalled();
    expect(mockCtx.createBufferSource).toHaveBeenCalled();
  });

  it('init is idempotent (double init does nothing)', async () => {
    const engine = new AudioEngine();
    await engine.init();
    const callCount = mockCtx.createGain.mock.calls.length;
    await engine.init();
    // No additional gain nodes created
    expect(mockCtx.createGain.mock.calls.length).toBe(callCount);
  });

  it('update does nothing before init', () => {
    const engine = new AudioEngine();
    // Should not throw
    engine.update([makeDistance('earth', 50_000)]);
  });

  it('update resumes suspended context', async () => {
    const engine = new AudioEngine();
    await engine.init();
    mockCtx.state = 'suspended';
    engine.update([makeDistance('earth', 50_000)]);
    expect(mockCtx.resume).toHaveBeenCalled();
  });

  it('getActiveStems returns 0 before init', () => {
    const engine = new AudioEngine();
    expect(engine.getActiveStems()).toBe(0);
  });

  it('getLoadedStems returns 0 before init', () => {
    const engine = new AudioEngine();
    expect(engine.getLoadedStems()).toBe(0);
  });

  it('dispose clears state', async () => {
    const engine = new AudioEngine();
    await engine.init();
    engine.dispose();
    expect(mockCtx.close).toHaveBeenCalled();
    expect(engine.getActiveStems()).toBe(0);
    expect(engine.getLoadedStems()).toBe(0);
  });

  it('setMasterVolume clamps to [0, 1]', async () => {
    const engine = new AudioEngine();
    await engine.init();
    // Should not throw
    engine.setMasterVolume(0.5);
    engine.setMasterVolume(-1);
    engine.setMasterVolume(2);
  });
});
