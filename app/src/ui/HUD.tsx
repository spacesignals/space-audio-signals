import { render } from 'preact';
import { useState, useCallback, useEffect } from 'preact/hooks';
import type { CelestialBodyConfig } from '../types';
import { formatDistance, formatSpeed } from './format';

/*
 * Zen Drift HUD — minimal, serif, nearly chromeless.
 * Three expanding orb menus at the bottom (moons / worlds / views),
 * whisper-style corner controls, quiet settings sheet, and the
 * spinning-ring start overlay.
 */
const CSS = `
#hud, .zen-start {
  --text: rgba(240, 238, 232, 0.9);
  --dim: rgba(240, 238, 232, 0.38);
  --faint: rgba(240, 238, 232, 0.16);
  --soft: rgba(240, 238, 232, 0.55);
  --accent: #8fd0ff;
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
  color: var(--text);
  user-select: none;
}
#hud {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  pointer-events: none;
  font-family: "Cormorant Garamond", Georgia, "Times New Roman", serif;
  z-index: 10;
}

/* ---------- top-left corner: settings + toggles ---------- */
.zen-corner {
  position: absolute; top: 20px; left: 22px;
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  pointer-events: auto;
}
.whisper {
  font-family: system-ui, sans-serif;
  font-size: 10px; letter-spacing: 4px; text-transform: uppercase;
  color: var(--soft); cursor: pointer; background: none; border: none;
  padding: 8px 0; transition: color 0.5s;
}
.whisper:hover { color: var(--text); }
.zen-check {
  display: flex; align-items: center; gap: 9px;
  font-family: system-ui, sans-serif;
  font-size: 9px; letter-spacing: 3px; text-transform: uppercase;
  color: var(--dim); cursor: pointer; background: none; border: none;
  padding: 5px 0; transition: color 0.4s;
}
.zen-check:hover { color: var(--soft); }
.zen-check.on { color: var(--soft); }
.zc-dot {
  width: 6px; height: 6px; border-radius: 50%;
  border: 1px solid var(--dim); background: transparent;
  transition: background 0.4s, box-shadow 0.4s, border-color 0.4s;
}
.zen-check.on .zc-dot {
  background: var(--text); border-color: var(--text);
  box-shadow: 0 0 8px rgba(240, 238, 232, 0.6);
}

/* ---------- top-right: live body info ---------- */
.zen-info {
  position: absolute; top: 22px; right: 26px;
  text-align: right; pointer-events: none; max-width: 260px;
}
.zi-name {
  font-size: 26px; font-weight: 300; letter-spacing: 8px;
  text-transform: lowercase;
}
.zi-row {
  font-family: system-ui, sans-serif;
  font-size: 10px; letter-spacing: 2.5px; text-transform: uppercase;
  color: var(--dim); margin-top: 6px; font-variant-numeric: tabular-nums;
}
.zi-row.live { color: var(--soft); }

/* ---------- orb row ---------- */
.orb-row {
  position: absolute; bottom: 36px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 34px;
  pointer-events: auto; z-index: 5;
}
.orb-unit { display: flex; flex-direction: column; align-items: center; gap: 9px; }
.orb-btn {
  position: relative; border-radius: 50%;
  border: 1px solid var(--dim); background: transparent; cursor: pointer;
  transition: transform 0.6s var(--ease), border-color 0.6s;
}
.orb-btn:hover { border-color: var(--text); }
.orb-btn.big { width: 42px; height: 42px; }
.orb-btn.small { width: 30px; height: 30px; }
.orb-btn::before {
  content: ''; position: absolute; border-radius: 50%;
  background: var(--text); opacity: 0.85;
  animation: zen-pulse 4.5s ease-in-out infinite;
}
.orb-btn.big::before { inset: 13px; }
.orb-btn.small::before { inset: 10px; animation-delay: 1.2s; }
@keyframes zen-pulse {
  0%, 100% { transform: scale(0.72); opacity: 0.45; }
  50% { transform: scale(1); opacity: 0.9; }
}
.orb-btn.open { transform: rotate(45deg); border-color: var(--text); }
.orb-btn.open::before {
  animation: none; opacity: 0.9; border-radius: 0;
  clip-path: polygon(46% 0, 54% 0, 54% 46%, 100% 46%, 100% 54%, 54% 54%, 54% 100%, 46% 100%, 46% 54%, 0 54%, 0 46%, 46% 46%);
}
.orb-btn.big.open::before { inset: 9px; }
.orb-btn.small.open::before { inset: 7px; }
.orb-lbl {
  font-family: system-ui, sans-serif; font-size: 9px; letter-spacing: 3px;
  text-transform: uppercase; color: var(--faint); transition: color 0.4s;
}
.orb-unit:hover .orb-lbl, .orb-unit.open .orb-lbl { color: var(--dim); }

/* ---------- constellation menus ---------- */
.constellation { position: absolute; bottom: 60px; left: 50%; width: 0; height: 0; pointer-events: none; z-index: 4; }
.c-item {
  position: absolute; left: 0; top: 0;
  transform: translate(-50%, -50%);
  background: none; border: none; cursor: pointer; color: var(--dim);
  display: flex; flex-direction: column; align-items: center; gap: 7px;
  opacity: 0; pointer-events: none;
  transition: opacity 0.5s var(--ease), transform 0.7s var(--ease), color 0.4s;
  font-family: inherit;
}
.constellation.open .c-item { opacity: 1; pointer-events: auto; }
.c-item .pt {
  width: 7px; height: 7px; border-radius: 50%; background: currentColor;
  box-shadow: 0 0 12px currentColor; transition: transform 0.4s var(--ease);
}
.c-item:hover { color: var(--text); }
.c-item:hover .pt { transform: scale(1.7); }
.c-item .nm { font-size: 14px; letter-spacing: 4px; text-transform: lowercase; white-space: nowrap; }
.c-item.dense .nm { font-size: 12px; letter-spacing: 3px; }
.zen-arc {
  position: absolute; inset: 0; pointer-events: none; z-index: 3;
  opacity: 0; transition: opacity 0.8s var(--ease);
}
.zen-arc.show { opacity: 1; }

/* ---------- nav help (controls) ---------- */
.zen-navhelp {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  padding: 26px 34px; pointer-events: auto;
  background: rgba(3, 3, 9, 0.72); backdrop-filter: blur(8px);
  border: 1px solid var(--faint); border-radius: 4px;
}
.zen-navhelp h4 {
  font-family: system-ui, sans-serif; font-weight: 400;
  font-size: 10px; letter-spacing: 4px; text-transform: uppercase;
  color: var(--dim); margin: 0 0 16px 0;
}
.zen-navhelp table { border-collapse: collapse; font-family: system-ui, sans-serif; font-size: 12px; }
.zen-navhelp td { padding: 4px 0; vertical-align: top; color: var(--soft); }
.zen-navhelp td:first-child {
  color: var(--text); padding-right: 22px; white-space: nowrap;
  font-size: 11px; letter-spacing: 1px;
}

/* ---------- settings sheet ---------- */
.zen-sheet {
  position: absolute; inset: 0; z-index: 20;
  display: grid; place-items: center;
  background: rgba(3, 3, 9, 0.82); backdrop-filter: blur(8px);
  pointer-events: auto;
}
.zen-sheet .inner { width: 300px; text-align: center; }
.zen-sheet h3 { font-weight: 300; font-size: 22px; letter-spacing: 8px; text-transform: lowercase; margin: 0 0 44px 0; }
.sh-row { margin: 30px 0; }
.sh-row .k {
  font-family: system-ui, sans-serif; font-size: 10px; letter-spacing: 4px;
  text-transform: uppercase; color: var(--dim); display: block; margin-bottom: 14px;
}
.sh-row .k output { color: var(--soft); margin-left: 10px; letter-spacing: 1px; }
.zen-sheet input[type="range"] {
  -webkit-appearance: none; appearance: none; width: 100%; height: 1px; background: var(--faint);
  outline: none; cursor: pointer;
}
.zen-sheet input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none; width: 15px; height: 15px; border-radius: 50%;
  background: #030309; border: 1px solid var(--text);
  transition: background 0.3s;
}
.zen-sheet input[type="range"]::-webkit-slider-thumb:hover { background: var(--text); }
.zen-sheet .close { margin-top: 40px; color: var(--faint); }
.zen-sheet .close:hover { color: var(--text); }

/* ---------- start overlay (spinning ring, lowercase) ---------- */
.zen-start {
  position: fixed; inset: 0; z-index: 100; display: grid; place-items: center;
  background: radial-gradient(ellipse at 50% 45%, #060b1a 0%, #030309 75%);
  cursor: pointer; pointer-events: auto;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
.zen-start .ring {
  width: 130px; height: 130px; border-radius: 50%;
  border: 1px solid rgba(143, 208, 255, 0.35);
  display: grid; place-items: center; margin: 0 auto 34px;
  animation: zen-spin 14s linear infinite; position: relative;
}
.zen-start .ring::before {
  content: ''; position: absolute; top: -4px; left: 50%; width: 7px; height: 7px;
  border-radius: 50%; background: var(--accent); box-shadow: 0 0 12px var(--accent);
}
.zen-start .core {
  width: 44px; height: 44px; border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #ffe9b0, #c98a2e);
  box-shadow: 0 0 40px rgba(255, 200, 90, 0.5);
}
@keyframes zen-spin { to { transform: rotate(360deg); } }
.zen-start h1 { font-size: 26px; font-weight: 200; letter-spacing: 10px; text-align: center; margin: 0 0 10px 0; text-transform: lowercase; }
.zen-start p { font-size: 11px; letter-spacing: 3px; color: var(--dim); text-align: center; margin: 0; }
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

type MenuName = 'moons' | 'worlds' | 'views';

interface MenuItem {
  id: string;
  label: string;
  color: string;
}

/** Positions for items along a staggered constellation arc above the orb row. */
function arcPositions(
  n: number,
  radiusMax: number,
  yScale: number,
  span: number,
  dense: boolean
): { x: number; y: number }[] {
  const R = Math.min(window.innerWidth * 0.36, radiusMax);
  const half = Math.PI * span;
  return Array.from({ length: n }, (_, i) => {
    const a = Math.PI / 2 + half - (n === 1 ? half : (i / (n - 1)) * 2 * half);
    // Stagger alternate items vertically so adjacent labels never collide;
    // dense menus (many moons) cycle three levels instead of two.
    const stagger = dense ? [14, -26, -64][i % 3] : n > 4 ? (i % 2 ? -30 : 12) : 0;
    return { x: Math.cos(a) * R, y: -Math.sin(a) * (R * yScale) - 40 + stagger };
  });
}

const MENU_GEOMETRY: Record<MenuName, { radiusMax: number; yScale: number; span: number }> = {
  moons: { radiusMax: 420, yScale: 0.55, span: 0.4 },
  worlds: { radiusMax: 340, yScale: 0.55, span: 0.38 },
  views: { radiusMax: 150, yScale: 0.75, span: 0.21 },
};

function Constellation({
  name,
  items,
  open,
  onPick,
}: {
  name: MenuName;
  items: MenuItem[];
  open: boolean;
  onPick: (id: string) => void;
}) {
  const geo = MENU_GEOMETRY[name];
  const dense = items.length > 12;
  const positions = arcPositions(items.length, geo.radiusMax, geo.yScale, geo.span, dense);
  return (
    <div class={`constellation${open ? ' open' : ''}`}>
      {items.map((item, i) => {
        const t = open
          ? `translate(calc(-50% + ${positions[i].x}px), calc(-50% + ${positions[i].y}px))`
          : 'translate(-50%, -50%)';
        return (
          <button
            key={item.id}
            class={`c-item${dense ? ' dense' : ''}`}
            style={{ transform: t }}
            onClick={(e) => {
              e.stopPropagation();
              onPick(item.id);
            }}
          >
            <span class="pt" style={{ color: item.color }}></span>
            <span class="nm">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Dashed arc line through the open menu's constellation points. */
function ArcLine({ menu, count }: { menu: MenuName | null; count: number }) {
  if (!menu || count === 0) return <svg class="zen-arc" />;
  const geo = MENU_GEOMETRY[menu];
  const positions = arcPositions(count, geo.radiusMax, geo.yScale, geo.span, count > 12);
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight - 60;
  const d = positions
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(cx + p.x).toFixed(1)} ${(cy + p.y).toFixed(1)}`)
    .join(' ');
  return (
    <svg class="zen-arc show" viewBox={`0 0 ${window.innerWidth} ${window.innerHeight}`}>
      <path d={d} fill="none" stroke="rgba(240,238,232,0.1)" stroke-width="1" stroke-dasharray="2 6" />
    </svg>
  );
}

function ZenCheck({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button class={`zen-check${checked ? ' on' : ''}`} onClick={onToggle}>
      <span class="zc-dot"></span>
      {label}
    </button>
  );
}

function NavHelp() {
  return (
    <div class="zen-navhelp">
      <h4>Navigation</h4>
      <table>
        <tbody>
          <tr><td>W / Up</td><td>Fly forward</td></tr>
          <tr><td>S / Down</td><td>Fly backward</td></tr>
          <tr><td>A / D</td><td>Strafe left / right</td></tr>
          <tr><td>Left / Right</td><td>Look left / right</td></tr>
          <tr><td>Space</td><td>Fly up</td></tr>
          <tr><td>Shift</td><td>Fly down</td></tr>
          <tr><td>Mouse drag</td><td>Look around</td></tr>
          <tr><td>Scroll</td><td>Change speed</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function StartOverlay({ onStart }: { onStart: () => void }) {
  return (
    <div class="zen-start" onClick={onStart}>
      <div>
        <div class="ring"><div class="core"></div></div>
        <h1>spacesignals</h1>
        <p>click to enter the system</p>
      </div>
    </div>
  );
}

const VIEW_ITEMS: MenuItem[] = [
  { id: 'tour', label: 'grand tour', color: '#8fd0ff' },
  { id: 'top', label: 'top view', color: '#c9b8ff' },
];

function HUDApp({
  bodies,
  callbacks,
}: {
  bodies: CelestialBodyConfig[];
  callbacks: HUDCallbacks;
}) {
  const [, setTick] = useState(0);
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [labelsOn, setLabelsOn] = useState(false);
  const [navHelp, setNavHelp] = useState(false);
  const [bgAudio, setBgAudio] = useState(true);
  const [debugOn, setDebugOn] = useState(false);
  const [volume, setVolume] = useState(100);
  const [bloom, setBloom] = useState(100);
  rerenderHUD = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    // Any click outside the orbs/menus closes the open menu; keep arc
    // positions fresh on window resize.
    const close = () => setOpenMenu(null);
    const onResize = () => setTick((t) => t + 1);
    document.addEventListener('click', close);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('click', close);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const s = hudState;

  const worlds: MenuItem[] = bodies
    .filter((b) => b.type !== 'moon')
    .map((b) => ({ id: b.id, label: b.name.toLowerCase(), color: b.color || '#c8c8c8' }));
  const moons: MenuItem[] = bodies
    .filter((b) => b.type === 'moon')
    .map((b) => ({ id: b.id, label: b.name.toLowerCase(), color: b.color || '#c8c8c8' }));

  const toggleMenu = (name: MenuName) => setOpenMenu(openMenu === name ? null : name);
  const pickBody = (id: string) => {
    setOpenMenu(null);
    callbacks.onBodySelect(id);
  };
  const pickView = (id: string) => {
    setOpenMenu(null);
    if (id === 'tour') callbacks.onTour();
    else callbacks.onTopView();
  };

  const menuItems: Record<MenuName, MenuItem[]> = { moons, worlds, views: VIEW_ITEMS };

  // Log-scale slider position for current flight speed (0.01 .. 500 units/s)
  const speedPct = s.speedUnitsPerSec > 0
    ? Math.max(0, Math.min(100, Math.round((Math.log(s.speedUnitsPerSec / 0.01) / Math.log(500 / 0.01)) * 100)))
    : 0;

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
        <div class="zen-corner">
          <button class="whisper" onClick={() => setSheetOpen(true)}>settings</button>
          <ZenCheck label="labels" checked={labelsOn} onToggle={() => {
            const next = !labelsOn;
            setLabelsOn(next);
            callbacks.onToggleLabels(next);
          }} />
          <ZenCheck label="controls" checked={navHelp} onToggle={() => setNavHelp(!navHelp)} />
          <ZenCheck label="background audio" checked={bgAudio} onToggle={() => {
            const next = !bgAudio;
            setBgAudio(next);
            callbacks.onToggleBackgroundAudio(next);
          }} />
          <ZenCheck label="debug" checked={debugOn} onToggle={() => {
            setDebugOn(!debugOn);
            callbacks.onToggleDebug();
          }} />
        </div>

        <div class="zen-info">
          {s.selectedBody && (
            <>
              <div class="zi-name">{s.selectedBody.name.toLowerCase()}</div>
              <div class="zi-row">{s.selectedBody.type.replace('-', ' ')}</div>
              <div class="zi-row">radius {s.selectedBody.radiusKm.toLocaleString()} km</div>
              <div class="zi-row">{s.selectedBody.stems.length} audio stems</div>
            </>
          )}
          {s.started && (
            <div class="zi-row live">
              {s.nearestBody
                ? `${s.nearestBody} · ${formatDistance(s.distanceKm)}`
                : 'deep space'}
              {' · '}{formatSpeed(s.speedUnitsPerSec)}
            </div>
          )}
        </div>

        {navHelp && <NavHelp />}

        <ArcLine menu={openMenu} count={openMenu ? menuItems[openMenu].length : 0} />
        <Constellation name="moons" items={moons} open={openMenu === 'moons'} onPick={pickBody} />
        <Constellation name="worlds" items={worlds} open={openMenu === 'worlds'} onPick={pickBody} />
        <Constellation name="views" items={VIEW_ITEMS} open={openMenu === 'views'} onPick={pickView} />

        <div class="orb-row">
          <div class={`orb-unit${openMenu === 'moons' ? ' open' : ''}`}>
            <button
              class={`orb-btn small${openMenu === 'moons' ? ' open' : ''}`}
              onClick={(e) => { e.stopPropagation(); toggleMenu('moons'); }}
              title="Moons"
            ></button>
            <span class="orb-lbl">moons</span>
          </div>
          <div class={`orb-unit${openMenu === 'worlds' ? ' open' : ''}`}>
            <button
              class={`orb-btn big${openMenu === 'worlds' ? ' open' : ''}`}
              onClick={(e) => { e.stopPropagation(); toggleMenu('worlds'); }}
              title="Worlds"
            ></button>
            <span class="orb-lbl">worlds</span>
          </div>
          <div class={`orb-unit${openMenu === 'views' ? ' open' : ''}`}>
            <button
              class={`orb-btn small${openMenu === 'views' ? ' open' : ''}`}
              onClick={(e) => { e.stopPropagation(); toggleMenu('views'); }}
              title="Views"
            ></button>
            <span class="orb-lbl">views</span>
          </div>
        </div>

        {sheetOpen && (
          <div class="zen-sheet" onClick={(e) => { if (e.target === e.currentTarget) setSheetOpen(false); }}>
            <div class="inner">
              <h3>settings</h3>
              <div class="sh-row">
                <span class="k">volume<output>{volume}</output></span>
                <input
                  type="range" min="0" max="100" value={volume}
                  onInput={(e) => {
                    const v = Number((e.target as HTMLInputElement).value);
                    setVolume(v);
                    callbacks.onVolumeChange(v / 100);
                  }}
                />
              </div>
              <div class="sh-row">
                <span class="k">glow<output>{bloom}</output></span>
                <input
                  type="range" min="0" max="200" value={bloom}
                  onInput={(e) => {
                    const v = Number((e.target as HTMLInputElement).value);
                    setBloom(v);
                    callbacks.onBloomStrengthChange(v / 100);
                  }}
                />
              </div>
              <div class="sh-row">
                <span class="k">flight speed<output>{formatSpeed(s.speedUnitsPerSec)}</output></span>
                <input
                  type="range" min="0" max="100" value={speedPct}
                  onInput={(e) => {
                    const pct = Number((e.target as HTMLInputElement).value) / 100;
                    callbacks.onSpeedChange(0.01 * Math.pow(500 / 0.01, pct));
                  }}
                />
              </div>
              <button class="whisper close" onClick={() => setSheetOpen(false)}>return</button>
            </div>
          </div>
        )}
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
