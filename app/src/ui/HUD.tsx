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
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 160px;
}
.hud-speed label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.hud-speed input[type="range"] {
  flex: 1;
  accent-color: #6CA6FF;
  cursor: pointer;
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
.hud-nav-help {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  padding: 20px 28px;
  font-size: 13px;
  line-height: 1.7;
  max-width: 340px;
  pointer-events: auto;
}
.hud-nav-help h4 {
  margin: 0 0 12px 0;
  font-size: 14px;
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.hud-nav-help table {
  width: 100%;
  border-collapse: collapse;
}
.hud-nav-help td {
  padding: 3px 0;
  vertical-align: top;
}
.hud-nav-help td:first-child {
  color: #6CA6FF;
  font-weight: 600;
  padding-right: 16px;
  white-space: nowrap;
}
.hud-settings {
  position: absolute;
  bottom: 60px; left: 50%;
  transform: translateX(-50%);
  padding: 12px 16px;
  min-width: 200px;
}
.hud-settings h4 {
  margin: 0 0 8px 0;
  font-size: 13px;
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.hud-settings label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  margin: 6px 0;
}
.hud-settings input[type="range"] {
  flex: 1;
  accent-color: #6CA6FF;
  cursor: pointer;
}
.settings-toggle {
  position: absolute;
  bottom: 20px; left: 50%;
  transform: translateX(-50%);
  background: rgba(0,0,0,0.5);
  border: 1px solid rgba(255,255,255,0.2);
  color: white;
  padding: 6px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  backdrop-filter: blur(4px);
}
.settings-toggle:hover {
  background: rgba(255,255,255,0.1);
  border-color: rgba(255,255,255,0.4);
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
  letter-spacing: 6px;
  color: #e0d0a0;
  text-transform: none;
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
  onVolumeChange: (volume: number) => void;
  onBloomStrengthChange: (strength: number) => void;
  onSpeedChange: (speed: number) => void;
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
      <h1>spacesignals</h1>
      <p>stemming and stimming through time and space</p>
      <div class="start-btn">Click anywhere to begin</div>
    </div>
  );
}

function NavHelp() {
  return (
    <div class="hud-nav-help hud-panel">
      <h4>Navigation</h4>
      <table>
        <tr><td>W / Up</td><td>Fly forward</td></tr>
        <tr><td>S / Down</td><td>Fly backward</td></tr>
        <tr><td>A / D</td><td>Strafe left / right</td></tr>
        <tr><td>Left / Right</td><td>Look left / right</td></tr>
        <tr><td>Space</td><td>Fly up</td></tr>
        <tr><td>Shift</td><td>Fly down</td></tr>
        <tr><td>Mouse drag</td><td>Look around</td></tr>
        <tr><td>Scroll</td><td>Zoom in/out</td></tr>
        <tr><td>Speed slider</td><td>Adjust flight speed</td></tr>
      </table>
      <div style="margin-top:12px;opacity:0.5;font-size:12px;">
        Click a body name to fly there automatically.
      </div>
    </div>
  );
}

function BodyList({
  bodies,
  callbacks,
  navHelp,
  onToggleNavHelp,
}: {
  bodies: CelestialBodyConfig[];
  callbacks: HUDCallbacks;
  navHelp: boolean;
  onToggleNavHelp: () => void;
}) {
  const [labelsOn, setLabelsOn] = useState(false);
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
          checked={navHelp}
          onChange={onToggleNavHelp}
        />
        Controls
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

function SettingsPanel({ callbacks }: { callbacks: HUDCallbacks }) {
  const [volume, setVolume] = useState(100);
  const [bloom, setBloom] = useState(100);

  return (
    <div class="hud-settings hud-panel">
      <h4>Settings</h4>
      <label>
        Volume
        <input
          type="range"
          min="0"
          max="100"
          value={volume}
          onInput={(e) => {
            const v = Number((e.target as HTMLInputElement).value);
            setVolume(v);
            callbacks.onVolumeChange(v / 100);
          }}
        />
      </label>
      <label>
        Bloom
        <input
          type="range"
          min="0"
          max="200"
          value={bloom}
          onInput={(e) => {
            const v = Number((e.target as HTMLInputElement).value);
            setBloom(v);
            callbacks.onBloomStrengthChange(v / 100);
          }}
        />
      </label>
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [navHelp, setNavHelp] = useState(false);
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
        <div class="hud-speed hud-panel">
          <div>Speed: {formatSpeed(s.speedUnitsPerSec)}</div>
          <label>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(Math.log(s.speedUnitsPerSec / 0.01) / Math.log(500 / 0.01) * 100)}
              onInput={(e) => {
                const pct = Number((e.target as HTMLInputElement).value) / 100;
                const speed = 0.01 * Math.pow(500 / 0.01, pct);
                callbacks.onSpeedChange(speed);
              }}
            />
          </label>
        </div>
        <BodyList bodies={bodies} callbacks={callbacks} navHelp={navHelp} onToggleNavHelp={() => setNavHelp(!navHelp)} />
        <BodyInfo body={s.selectedBody} />
        {navHelp && <NavHelp />}
        {settingsOpen && <SettingsPanel callbacks={callbacks} />}
        <button class="settings-toggle" onClick={() => setSettingsOpen(!settingsOpen)}>
          {settingsOpen ? 'Close Settings' : 'Settings'}
        </button>
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
    onVolumeChange: () => {},
    onBloomStrengthChange: () => {},
    onSpeedChange: () => {},
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

  /** Update distance readout and speed display in a single re-render. */
  updateTelemetry(nearestBody: string | null, distanceKm: number, speedUnitsPerSec: number): void {
    hudState = { ...hudState, nearestBody, distanceKm, speedUnitsPerSec };
    rerenderHUD?.();
  }

  showBodyInfo(body: CelestialBodyConfig): void {
    hudState = { ...hudState, selectedBody: body };
    rerenderHUD?.();
  }

  setCallbacks(callbacks: Partial<HUDCallbacks>): void {
    Object.assign(this.callbacks, callbacks);
  }
}
