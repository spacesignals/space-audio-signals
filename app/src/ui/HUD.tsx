import { render } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import type { CelestialBodyConfig } from '../types';
import { formatDistance, formatSpeed } from './format';

// CSS injected once
const CSS = `
#hud {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  pointer-events: none;
  font-family: system-ui, -apple-system, sans-serif;
  color: white;
  z-index: 10;
}
#hud > * { pointer-events: auto; }
.hud-panel {
  background: rgba(0,0,0,0.5);
  border-radius: 8px;
  backdrop-filter: blur(4px);
}
.hud-distance {
  position: absolute;
  bottom: 20px; left: 20px;
  padding: 8px 16px;
  font-size: 14px;
}
.hud-speed {
  position: absolute;
  bottom: 20px; right: 20px;
  padding: 8px 16px;
  font-size: 14px;
}
.hud-body-list {
  position: absolute;
  top: 20px; right: 20px;
  padding: 8px;
  max-height: 300px;
  overflow-y: auto;
}
.hud-body-list button {
  display: block;
  width: 100%;
  background: transparent;
  border: 1px solid rgba(255,255,255,0.2);
  color: white;
  padding: 6px 12px;
  margin: 2px 0;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  text-align: left;
}
.hud-body-list button:hover {
  background: rgba(255,255,255,0.1);
  border-color: rgba(255,255,255,0.4);
}
.hud-info {
  position: absolute;
  top: 20px; left: 20px;
  padding: 12px 16px;
  font-size: 13px;
  max-width: 250px;
}
.hud-info h3 { margin: 0 0 8px 0; font-size: 16px; }
.hud-info p { margin: 4px 0; opacity: 0.8; }
.hud-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  margin: 4px 0;
  font-size: 13px;
  opacity: 0.8;
  cursor: pointer;
}
.hud-toggle input { cursor: pointer; }
.controls-hint {
  position: absolute;
  bottom: 60px; left: 50%;
  transform: translateX(-50%);
  padding: 8px 16px;
  font-size: 12px;
  opacity: 0.6;
  white-space: nowrap;
}
.start-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: #000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 100;
  cursor: pointer;
}
.start-overlay h1 {
  font-size: 42px;
  font-weight: 200;
  margin-bottom: 8px;
  letter-spacing: 8px;
  color: #e0d0a0;
}
.start-overlay p {
  font-size: 16px;
  color: rgba(255,255,255,0.5);
  margin-bottom: 40px;
}
.start-overlay .start-btn {
  font-size: 18px;
  color: rgba(255,255,255,0.7);
  animation: pulse 2s infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
`;

interface HUDCallbacks {
  onBodySelect: (bodyId: string) => void;
  onStart: () => void;
  onTour: () => void;
  onTopView: () => void;
  onToggleLabels: (visible: boolean) => void;
  onToggleDebug: () => void;
  onToggleBackgroundAudio: (enabled: boolean) => void;
}

interface HUDState {
  nearestBody: string | null;
  distanceKm: number;
  speedUnitsPerSec: number;
  selectedBody: CelestialBodyConfig | null;
  started: boolean;
}

// Imperative state bridge: Preact reads from this, main.ts writes to it
let hudState: HUDState = {
  nearestBody: null,
  distanceKm: Infinity,
  speedUnitsPerSec: 0,
  selectedBody: null,
  started: false,
};
let rerenderHUD: (() => void) | null = null;

function StartOverlay({ onStart }: { onStart: () => void }) {
  return (
    <div class="start-overlay" onClick={onStart}>
      <h1>GALAXYMUSIC</h1>
      <p>Navigate the solar system. Hear it change.</p>
      <div class="start-btn">Click anywhere to begin</div>
    </div>
  );
}

function BodyList({
  bodies,
  callbacks,
}: {
  bodies: CelestialBodyConfig[];
  callbacks: HUDCallbacks;
}) {
  const [labelsOn, setLabelsOn] = useState(true);
  const [bgAudio, setBgAudio] = useState(true);

  return (
    <div class="hud-body-list hud-panel">
      <div style="font-size:11px;opacity:0.5;margin-bottom:4px;">FLY TO</div>
      <button style="border-color:rgba(100,180,255,0.4)" onClick={callbacks.onTour}>
        Sun and Outwards
      </button>
      <button style="border-color:rgba(100,180,255,0.4)" onClick={callbacks.onTopView}>
        Top View
      </button>
      <label class="hud-toggle">
        <input
          type="checkbox"
          checked={labelsOn}
          onChange={() => {
            const next = !labelsOn;
            setLabelsOn(next);
            callbacks.onToggleLabels(next);
          }}
        />
        Labels
      </label>
      <label class="hud-toggle">
        <input
          type="checkbox"
          checked={bgAudio}
          onChange={() => {
            const next = !bgAudio;
            setBgAudio(next);
            callbacks.onToggleBackgroundAudio(next);
          }}
        />
        Background Audio
      </label>
      <label class="hud-toggle">
        <input type="checkbox" onChange={callbacks.onToggleDebug} />
        Debug
      </label>
      {bodies.map((body) => (
        <button key={body.id} onClick={() => callbacks.onBodySelect(body.id)}>
          {body.name}
        </button>
      ))}
    </div>
  );
}

function BodyInfo({ body }: { body: CelestialBodyConfig | null }) {
  if (!body) return null;
  return (
    <div class="hud-info hud-panel">
      <h3>{body.name}</h3>
      <p>Type: {body.type}</p>
      <p>Radius: {body.radiusKm.toLocaleString()} km</p>
      <p>Audio stems: {body.stems.length}</p>
    </div>
  );
}

function HUDApp({
  bodies,
  callbacks,
}: {
  bodies: CelestialBodyConfig[];
  callbacks: HUDCallbacks;
}) {
  const [, setTick] = useState(0);
  rerenderHUD = useCallback(() => setTick((t) => t + 1), []);

  const s = hudState;

  return (
    <>
      {!s.started && (
        <StartOverlay
          onStart={() => {
            hudState = { ...hudState, started: true };
            rerenderHUD?.();
            callbacks.onStart();
          }}
        />
      )}
      <div id="hud">
        <div class="hud-distance hud-panel">
          {s.nearestBody ? `${s.nearestBody} — ${formatDistance(s.distanceKm)}` : 'Deep Space'}
        </div>
        <div class="hud-speed hud-panel">Speed: {formatSpeed(s.speedUnitsPerSec)}</div>
        <BodyList bodies={bodies} callbacks={callbacks} />
        <BodyInfo body={s.selectedBody} />
        <div class="controls-hint hud-panel">
          WASD / Arrows to move | Mouse drag to look | Scroll to change speed | Click planet to fly there
        </div>
      </div>
    </>
  );
}

/**
 * HUD — Preact-based overlay UI.
 * Keeps the same imperative API as the original DOM version so main.ts doesn't change.
 */
export class HUD {
  private callbacks: HUDCallbacks = {
    onBodySelect: () => {},
    onStart: () => {},
    onTour: () => {},
    onTopView: () => {},
    onToggleLabels: () => {},
    onToggleDebug: () => {},
    onToggleBackgroundAudio: () => {},
  };
  private mountEl: HTMLDivElement;
  private bodies: CelestialBodyConfig[] = [];

  constructor() {
    // Inject CSS
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    // Mount point
    this.mountEl = document.createElement('div');
    document.body.appendChild(this.mountEl);
  }

  initBodyList(bodies: CelestialBodyConfig[]): void {
    this.bodies = bodies;
    this.renderApp();
  }

  private renderApp(): void {
    render(
      <HUDApp bodies={this.bodies} callbacks={this.callbacks} />,
      this.mountEl
    );
  }

  updateDistance(nearestBody: string | null, distanceKm: number): void {
    hudState = { ...hudState, nearestBody, distanceKm };
    rerenderHUD?.();
  }

  updateSpeed(speedUnitsPerSec: number): void {
    hudState = { ...hudState, speedUnitsPerSec };
    rerenderHUD?.();
  }

  showBodyInfo(body: CelestialBodyConfig): void {
    hudState = { ...hudState, selectedBody: body };
    rerenderHUD?.();
  }

  hideBodyInfo(): void {
    hudState = { ...hudState, selectedBody: null };
    rerenderHUD?.();
  }

  setOnBodySelect(cb: (bodyId: string) => void): void {
    this.callbacks.onBodySelect = cb;
  }

  setOnStart(cb: () => void): void {
    this.callbacks.onStart = cb;
  }

  setOnTour(cb: () => void): void {
    this.callbacks.onTour = cb;
  }

  setOnTopView(cb: () => void): void {
    this.callbacks.onTopView = cb;
  }

  setOnToggleLabels(cb: (visible: boolean) => void): void {
    this.callbacks.onToggleLabels = cb;
  }

  setOnToggleDebug(cb: () => void): void {
    this.callbacks.onToggleDebug = cb;
  }

  setOnToggleBackgroundAudio(cb: (enabled: boolean) => void): void {
    this.callbacks.onToggleBackgroundAudio = cb;
  }

  setVisible(visible: boolean): void {
    this.mountEl.style.display = visible ? 'block' : 'none';
  }
}
