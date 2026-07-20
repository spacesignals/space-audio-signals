import { render } from 'preact';
import { useState, useCallback, useEffect } from 'preact/hooks';
import type { CelestialBodyConfig } from '../types';
import { formatDistance, formatSpeed } from './format';
import { FACTS } from '../data/facts';
import { DEEP_SPACE_DRONE_MAX_GAIN } from '../data/constants';
import { loadSettings, saveSettings, type AppSettings } from './settings';

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
  position: absolute;
  top: calc(20px + env(safe-area-inset-top, 0px));
  left: calc(22px + env(safe-area-inset-left, 0px));
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

/* ---------- top-right: live body info panel ---------- */
.zen-info {
  position: absolute;
  top: calc(22px + env(safe-area-inset-top, 0px));
  right: calc(26px + env(safe-area-inset-right, 0px));
  text-align: right; pointer-events: none; max-width: 280px;
}
.zen-info .panel { pointer-events: auto; }
.zi-name {
  font-size: 26px; font-weight: 300; letter-spacing: 8px;
  text-transform: lowercase;
}
.zi-row {
  font-family: system-ui, sans-serif;
  font-size: 10px; letter-spacing: 2.5px; text-transform: uppercase;
  color: var(--dim); margin-top: 6px; font-variant-numeric: tabular-nums;
}
.zi-row.live { color: var(--soft); transition: color 0.3s; }
.zi-row.live.flash { color: var(--accent); }
.zi-tagline {
  font-style: italic; font-size: 14px; letter-spacing: 1px;
  color: var(--soft); margin-top: 10px;
}
.zi-fact {
  font-size: 12.5px; letter-spacing: 0.5px; line-height: 1.5;
  color: var(--dim); margin-top: 9px;
}
.zi-stat {
  font-family: system-ui, sans-serif;
  font-size: 9px; letter-spacing: 2px; text-transform: uppercase;
  color: var(--dim); margin-top: 5px; font-variant-numeric: tabular-nums;
}
.zi-stat b { color: var(--soft); font-weight: 400; margin-left: 8px; }
.zi-mix-title {
  font-family: system-ui, sans-serif;
  font-size: 9px; letter-spacing: 3px; text-transform: uppercase;
  color: var(--faint); margin-top: 16px;
}
.zi-mix-sub {
  font-family: system-ui, sans-serif;
  font-size: 8px; letter-spacing: 3px; text-transform: uppercase;
  color: var(--faint); margin-top: 12px; opacity: 0.7;
}
.zi-mix-row .lbl .body { color: var(--faint); }
.zi-mix-row {
  display: flex; align-items: center; justify-content: flex-end; gap: 10px;
  margin-top: 6px;
}
.zi-mix-row .lbl {
  font-family: system-ui, sans-serif;
  font-size: 9px; letter-spacing: 1.5px; text-transform: lowercase;
  color: var(--dim); white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; max-width: 150px;
}
.zi-mix-row .bar {
  width: 74px; height: 2px; background: var(--faint);
  border-radius: 1px; overflow: hidden; flex-shrink: 0;
}
.zi-mix-row .bar .fill {
  height: 100%; background: var(--soft);
  transition: width 0.25s linear;
}
.zi-mix-row .pct {
  font-family: system-ui, sans-serif;
  font-size: 9px; letter-spacing: 0.5px; color: var(--soft);
  min-width: 22px; text-align: right; font-variant-numeric: tabular-nums;
}
/* stem rows are clickable to mute/unmute */
.zi-mix-row.stem {
  background: none; border: none; width: 100%; padding: 0;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.zi-mix-row.stem .lbl { transition: color 0.3s; }
.zi-mix-row.stem:hover .lbl { color: var(--text); }
.zi-mix-row.stem.muted .lbl { text-decoration: line-through; color: var(--faint); }
.zi-mix-row.stem.muted .pct { color: var(--faint); }
.zi-close {
  background: none; border: none; cursor: pointer;
  font-family: system-ui, sans-serif;
  font-size: 9px; letter-spacing: 3px; text-transform: uppercase;
  color: var(--faint); padding: 10px 0 0 0; transition: color 0.4s;
}
.zi-close:hover { color: var(--text); }
@media (max-width: 700px) {
  /* below the corner toggles so the two blocks never collide */
  .zen-info { top: calc(210px + env(safe-area-inset-top, 0px)); }
}

/* ---------- orb row ---------- */
.orb-row {
  position: absolute;
  bottom: calc(36px + env(safe-area-inset-bottom, 0px));
  left: 50%; transform: translateX(-50%);
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

/* ---------- time bar (bottom-left) ---------- */
.zen-time {
  position: absolute;
  bottom: calc(36px + env(safe-area-inset-bottom, 0px));
  left: calc(26px + env(safe-area-inset-left, 0px));
  pointer-events: auto;
}
.zt-date {
  font-size: 19px; font-weight: 300; letter-spacing: 4px;
  text-transform: lowercase; color: var(--soft);
  font-variant-numeric: tabular-nums;
}
.zt-clock {
  font-family: system-ui, sans-serif;
  font-size: 9px; letter-spacing: 3px; text-transform: uppercase;
  color: var(--dim); margin-top: 3px; font-variant-numeric: tabular-nums;
}
.zt-controls {
  display: flex; align-items: center; gap: 10px; margin-top: 8px;
}
.zt-btn {
  background: none; border: 1px solid var(--faint); border-radius: 50%;
  width: 22px; height: 22px; color: var(--dim); cursor: pointer;
  font-family: system-ui, sans-serif; font-size: 12px; line-height: 1;
  display: grid; place-items: center; padding: 0;
  transition: color 0.4s, border-color 0.4s;
}
.zt-btn:hover { color: var(--text); border-color: var(--soft); }
.zt-rate {
  font-family: system-ui, sans-serif;
  font-size: 9px; letter-spacing: 3px; text-transform: uppercase;
  color: var(--soft); min-width: 68px; text-align: center;
  font-variant-numeric: tabular-nums;
}
.zt-live {
  display: flex; align-items: center; gap: 6px;
  background: none; border: none; cursor: pointer;
  font-family: system-ui, sans-serif;
  font-size: 9px; letter-spacing: 3px; text-transform: uppercase;
  color: var(--dim); padding: 4px 0; transition: color 0.4s;
}
.zt-live:hover { color: var(--text); }
.zt-live .dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--dim); transition: background 0.4s, box-shadow 0.4s;
}
.zt-live.on { color: var(--soft); cursor: default; }
.zt-live.on .dot { background: #7fd8a0; box-shadow: 0 0 8px rgba(127, 216, 160, 0.7); }
@media (max-width: 700px) {
  .zen-time { bottom: calc(120px + env(safe-area-inset-bottom, 0px)); }
}

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
.zen-navhelp td.nh-sec {
  color: var(--dim); font-size: 9px; letter-spacing: 3px;
  text-transform: uppercase; padding-top: 14px;
}

/* ---------- settings dropdown (anchored under the corner button) ---------- */
.zen-drop {
  position: absolute;
  top: calc(52px + env(safe-area-inset-top, 0px));
  left: calc(22px + env(safe-area-inset-left, 0px));
  z-index: 20; width: 220px;
  padding: 16px 18px 12px 18px;
  background: rgba(3, 3, 9, 0.78); backdrop-filter: blur(8px);
  border: 1px solid var(--faint); border-radius: 4px;
  pointer-events: auto; text-align: left;
  max-height: calc(100vh - 120px); overflow-y: auto; scrollbar-width: none;
}
.zen-drop::-webkit-scrollbar { display: none; }
.sh-row { margin: 0 0 16px 0; }
.sh-row .k {
  font-family: system-ui, sans-serif; font-size: 9px; letter-spacing: 3px;
  text-transform: uppercase; color: var(--dim); display: block; margin-bottom: 7px;
}
.sh-row .k output { color: var(--soft); margin-left: 8px; letter-spacing: 1px; }
.zen-drop input[type="range"] {
  -webkit-appearance: none; appearance: none; width: 100%; height: 1px; background: var(--faint);
  outline: none; cursor: pointer;
}
.zen-drop input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none; width: 13px; height: 13px; border-radius: 50%;
  background: #030309; border: 1px solid var(--text);
  transition: background 0.3s;
}
.zen-drop input[type="range"]::-webkit-slider-thumb:hover { background: var(--text); }
.zen-drop .close { margin-top: 2px; color: var(--faint); padding: 4px 0; }
.zen-drop .close:hover { color: var(--text); }
.sh-layers { display: flex; flex-direction: column; align-items: flex-start; }
.sh-layers .k { margin-bottom: 2px; }
.sh-layers .zen-check { padding: 3px 0; }

/* ---------- onboarding cards ---------- */
.zen-onboard {
  position: absolute; inset: 0; z-index: 30;
  display: grid; place-items: center;
  background: rgba(3, 3, 9, 0.78); backdrop-filter: blur(8px);
  pointer-events: auto;
}
.zen-onboard .card { width: 300px; text-align: center; padding: 0 20px; }
.zen-onboard h3 {
  font-weight: 300; font-size: 24px; letter-spacing: 8px;
  text-transform: lowercase; margin: 0 0 22px 0;
}
.zen-onboard p {
  font-size: 14px; letter-spacing: 0.5px; line-height: 1.7;
  color: var(--soft); margin: 0 0 30px 0;
}
.zen-onboard .dots { display: flex; justify-content: center; gap: 10px; margin-bottom: 26px; }
.zen-onboard .dots span {
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--faint); transition: background 0.4s;
}
.zen-onboard .dots span.on { background: var(--soft); }

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
  onMoonTour: () => void;
  onTopView: () => void;
  onToggleLabels: (visible: boolean) => void;
  onToggleOrbits: (visible: boolean) => void;
  onToggleStarfield: (visible: boolean) => void;
  onToggleBelts: (visible: boolean) => void;
  onToggleFlood: (flood: boolean) => void;
  onTimeStep: (dir: 1 | -1) => void;
  onTimeLive: () => void;
  onToggleDebug: () => void;
  onToggleBackgroundAudio: (enabled: boolean) => void;
  onVolumeChange: (volume: number) => void;
  onBloomStrengthChange: (strength: number) => void;
  onSpeedChange: (speed: number) => void;
  onToggleStemMute: (stemId: string) => void;
}

interface MixRow {
  id: string;
  label: string;
  gain: number;
  muted: boolean;
  body?: string; // set when the stem belongs to a nearby body, not the selected one
}

interface HUDState {
  nearestBody: string | null;
  distanceKm: number;
  speedUnitsPerSec: number;
  selectedBody: CelestialBodyConfig | null;
  started: boolean;
  simDate: Date | null;
  timeRateLabel: string;
  timeLive: boolean;
  mix: MixRow[];
  droneLevel: number;
  speedFlashUntil: number;
}

// Imperative state bridge: Preact reads from this, main.ts writes to it
let hudState: HUDState = {
  nearestBody: null,
  distanceKm: Infinity,
  speedUnitsPerSec: 0,
  selectedBody: null,
  started: false,
  simDate: null,
  timeRateLabel: 'live',
  timeLive: true,
  mix: [],
  droneLevel: 0,
  speedFlashUntil: 0,
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
  // Keep long labels inside the viewport on narrow screens
  const xLimit = Math.max(window.innerWidth / 2 - 110, 60);
  return Array.from({ length: n }, (_, i) => {
    const a = Math.PI / 2 + half - (n === 1 ? half : (i / (n - 1)) * 2 * half);
    // Stagger alternate items vertically so adjacent labels never collide;
    // dense menus (many moons) cycle three levels instead of two.
    const stagger = dense ? [14, -26, -64][i % 3] : n > 4 ? (i % 2 ? -30 : 12) : 0;
    const x = Math.max(-xLimit, Math.min(xLimit, Math.cos(a) * R));
    return { x, y: -Math.sin(a) * (R * yScale) - 40 + stagger };
  });
}

const MENU_GEOMETRY: Record<MenuName, { radiusMax: number; yScale: number; span: number }> = {
  moons: { radiusMax: 420, yScale: 0.55, span: 0.4 },
  worlds: { radiusMax: 340, yScale: 0.55, span: 0.38 },
  views: { radiusMax: 210, yScale: 0.75, span: 0.3 },
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

const IS_TOUCH = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

function NavHelp() {
  if (IS_TOUCH) {
    return (
      <div class="zen-navhelp">
        <h4>Navigation</h4>
        <table>
          <tbody>
            <tr><td>Drag</td><td>Look around</td></tr>
            <tr><td>Double tap</td><td>Cruise forward on / off</td></tr>
            <tr><td>Two-finger drag</td><td>Fly forward / backward</td></tr>
            <tr><td>Pinch</td><td>Change speed</td></tr>
            <tr><td class="nh-sec" colspan={2}>On a journey</td></tr>
            <tr><td>Tap</td><td>Exit the journey</td></tr>
          </tbody>
        </table>
      </div>
    );
  }
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
          <tr><td>Scroll</td><td>Travel forward / back</td></tr>
          <tr><td>1 – 9</td><td>Speed presets (crawl to max)</td></tr>
          <tr><td>Click body</td><td>Fly to it</td></tr>
          <tr><td class="nh-sec" colspan={2}>On a journey</td></tr>
          <tr><td>Right arrow</td><td>Skip to next stop</td></tr>
          <tr><td>Space</td><td>Exit the journey</td></tr>
        </tbody>
      </table>
    </div>
  );
}

const ONBOARD_KEY = 'galaxymusic-onboarded-v1';

const ONBOARD_CARDS: { title: string; body: string }[] = IS_TOUCH
  ? [
      { title: 'look', body: 'drag with one finger to look around. planet positions are real and current.' },
      { title: 'move', body: 'drag with two fingers to fly forward or back. pinch to change speed. double-tap to toggle cruise.' },
      { title: 'navigate', body: 'tap a planet, moon, or its label to fly there. each body has its own audio that fades in as you get closer.' },
      { title: 'journeys', body: 'the journeys menu runs a guided tour of the system. tap the screen to exit a journey at any time.' },
      { title: 'time', body: 'the clock (bottom left) speeds up or reverses time with − and +. reset or live returns to real time.' },
    ]
  : [
      { title: 'look', body: 'drag the mouse to look around. planet positions are real and current.' },
      { title: 'move', body: 'w a s d to move, space and shift for up and down. scroll to travel forward or back. keys 1–9 set speed (1 slowest, 9 fastest).' },
      { title: 'navigate', body: 'click a planet, moon, or its label to fly there. each body has its own audio that fades in as you get closer.' },
      { title: 'journeys', body: 'the journeys menu runs a guided tour. on a journey, right arrow skips to the next stop and space exits.' },
      { title: 'time', body: 'the clock (bottom left) speeds up or reverses time with − and +. reset or live returns to real time.' },
    ];

function Onboarding({ onDone }: { onDone: () => void }) {
  const [card, setCard] = useState(0);
  const last = card === ONBOARD_CARDS.length - 1;
  return (
    <div class="zen-onboard">
      <div class="card">
        <h3>{ONBOARD_CARDS[card].title}</h3>
        <p>{ONBOARD_CARDS[card].body}</p>
        <div class="dots">
          {ONBOARD_CARDS.map((_, i) => <span class={i === card ? 'on' : ''}></span>)}
        </div>
        <button
          class="whisper"
          onClick={() => (last ? onDone() : setCard(card + 1))}
        >{last ? 'ok, got it' : 'next'}</button>
      </div>
    </div>
  );
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function TimeBar({ callbacks }: { callbacks: HUDCallbacks }) {
  const s = hudState;
  if (!s.simDate) return null;
  const d = s.simDate;
  const hours24 = d.getHours();
  const h12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours24 < 12 ? 'am' : 'pm';
  return (
    <div class="zen-time">
      <div class="zt-date">{MONTHS[d.getMonth()]} {d.getDate()}, {d.getFullYear()}</div>
      <div class="zt-clock">{h12}:{mm} {ampm}</div>
      <div class="zt-controls">
        <button class="zt-btn" title="Slower / backwards" onClick={() => callbacks.onTimeStep(-1)}>−</button>
        <span class="zt-rate">{s.timeRateLabel}</span>
        <button class="zt-btn" title="Faster forwards" onClick={() => callbacks.onTimeStep(1)}>+</button>
        {!s.timeLive && (
          <button class="zt-live" title="Return to real time" onClick={() => callbacks.onTimeLive()}>
            reset
          </button>
        )}
        <button
          class={`zt-live${s.timeLive ? ' on' : ''}`}
          onClick={() => { if (!s.timeLive) callbacks.onTimeLive(); }}
        >
          <span class="dot"></span>
          live
        </button>
      </div>
    </div>
  );
}

function StartOverlay({ onStart }: { onStart: () => void }) {
  return (
    <div class="zen-start" onClick={onStart}>
      <div>
        <div class="ring"><div class="core"></div></div>
        <h1>spacesignals</h1>
        <p>{IS_TOUCH ? 'tap to enter the system' : 'click to enter the system'}</p>
      </div>
    </div>
  );
}

const VIEW_ITEMS: MenuItem[] = [
  { id: 'tour', label: 'planet focus tour', color: '#8fd0ff' },
  { id: 'top', label: 'top view', color: '#c9b8ff' },
  { id: 'moonTour', label: 'ambient moon tour', color: '#d8d8ce' },
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
  const [navHelp, setNavHelp] = useState(false);
  const [debugOn, setDebugOn] = useState(false);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  rerenderHUD = useCallback(() => setTick((t) => t + 1), []);

  /** Flip a boolean setting: persist + notify the engine. */
  const toggleSetting = (key: keyof AppSettings, notify: (v: boolean) => void) => {
    const next = !settings[key];
    setSettings(saveSettings({ [key]: next }));
    notify(next);
  };

  useEffect(() => {
    // Any click outside the orbs/menus closes the open menu and the settings
    // dropdown; keep arc positions fresh on window resize.
    const close = () => { setOpenMenu(null); setSheetOpen(false); };
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
    else if (id === 'moonTour') callbacks.onMoonTour();
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
            let seen = false;
            try { seen = !!localStorage.getItem(ONBOARD_KEY); } catch { /* ignore */ }
            if (!seen) setOnboardOpen(true);
          }}
        />
      )}
      <div id="hud">
        <div class="zen-corner">
          <button class="whisper" onClick={(e) => { e.stopPropagation(); setSheetOpen(!sheetOpen); }}>settings</button>
          <button class="whisper" onClick={() => setOnboardOpen(true)}>guide</button>
          <ZenCheck label="controls" checked={navHelp} onToggle={() => setNavHelp(!navHelp)} />
          <ZenCheck label="debug" checked={debugOn} onToggle={() => {
            setDebugOn(!debugOn);
            callbacks.onToggleDebug();
          }} />
        </div>

        <div class="zen-info">
          {s.selectedBody && (() => {
            const body = s.selectedBody;
            const facts = FACTS[body.id];
            const hasStems = body.stems.length + (body.delayedStems?.length ?? 0) > 0;
            const ownRows = s.mix.filter((m) => !m.body);
            const nearbyRows = s.mix.filter((m) => m.body);
            const renderMixRow = (m: MixRow) => {
              const pct = Math.min(100, Math.round((m.gain / Math.max(body.maxGain, 0.01)) * 100));
              return (
                <button
                  key={m.id}
                  class={`zi-mix-row stem${m.muted ? ' muted' : ''}`}
                  title={m.muted ? 'unmute stem' : 'mute stem'}
                  onClick={(e) => { e.stopPropagation(); callbacks.onToggleStemMute(m.id); }}
                >
                  <span class="lbl">
                    {m.body ? <span class="body">{m.body} · </span> : null}{m.label}
                  </span>
                  <span class="bar"><span class="fill" style={{ width: `${m.muted ? 0 : pct}%` }}></span></span>
                  <span class="pct">{m.muted ? 'off' : pct}</span>
                </button>
              );
            };
            return (
              <div class="panel">
                <div class="zi-name" style={{ color: body.identityColor ?? 'var(--text)' }}>
                  {body.name.toLowerCase()}
                </div>
                <div class="zi-row">{body.type.replace('-', ' ')} · radius {body.radiusKm.toLocaleString()} km</div>
                {facts && <div class="zi-tagline">{facts.tagline}</div>}
                {facts?.factoids.map((f) => <div class="zi-fact">{f}</div>)}
                {facts?.stats?.map((st) => (
                  <div class="zi-stat">{st.label}<b>{st.value}</b></div>
                ))}
                <div class="zi-mix-title">now playing</div>
                {hasStems && ownRows.length === 0 && (
                  <div class="zi-mix-row"><span class="lbl">stems loading…</span></div>
                )}
                {!hasStems && ownRows.length === 0 && (
                  <div class="zi-mix-row"><span class="lbl">no stems yet</span></div>
                )}
                {ownRows.map(renderMixRow)}
                {nearbyRows.length > 0 && <div class="zi-mix-sub">nearby</div>}
                {nearbyRows.map(renderMixRow)}
                {(() => {
                  const dpct = Math.min(100, Math.round((s.droneLevel / DEEP_SPACE_DRONE_MAX_GAIN) * 100));
                  return (
                    <div class="zi-mix-row">
                      <span class="lbl">deep space drone</span>
                      <span class="bar"><span class="fill" style={{ width: `${dpct}%` }}></span></span>
                      <span class="pct">{dpct}</span>
                    </div>
                  );
                })()}
                <button
                  class="zi-close"
                  onClick={() => {
                    hudState = { ...hudState, selectedBody: null };
                    rerenderHUD?.();
                  }}
                >close</button>
              </div>
            );
          })()}
          {s.started && (
            <div class={`zi-row live${performance.now() < s.speedFlashUntil ? ' flash' : ''}`}>
              {s.nearestBody
                ? `${s.nearestBody} · ${formatDistance(s.distanceKm)}`
                : 'deep space'}
              {' · '}{formatSpeed(s.speedUnitsPerSec)}
            </div>
          )}
        </div>

        {navHelp && <NavHelp />}

        {s.started && settings.timeBar && <TimeBar callbacks={callbacks} />}

        {s.started && onboardOpen && (
          <Onboarding
            onDone={() => {
              try { localStorage.setItem(ONBOARD_KEY, '1'); } catch { /* ignore */ }
              setOnboardOpen(false);
            }}
          />
        )}

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
            <span class="orb-lbl">journeys</span>
          </div>
        </div>

        {sheetOpen && (
          <div class="zen-drop" onClick={(e) => e.stopPropagation()}>
              <div class="sh-row">
                <span class="k">volume<output>{settings.volume}</output></span>
                <input
                  type="range" min="0" max="100" value={settings.volume}
                  onInput={(e) => {
                    const v = Number((e.target as HTMLInputElement).value);
                    setSettings(saveSettings({ volume: v }));
                    callbacks.onVolumeChange(v / 100);
                  }}
                />
              </div>
              <div class="sh-row">
                <span class="k">glow<output>{settings.bloom}</output></span>
                <input
                  type="range" min="0" max="200" value={settings.bloom}
                  onInput={(e) => {
                    const v = Number((e.target as HTMLInputElement).value);
                    setSettings(saveSettings({ bloom: v }));
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
              <div class="sh-row sh-layers">
                <span class="k">layers</span>
                <ZenCheck label="labels" checked={settings.labels}
                  onToggle={() => toggleSetting('labels', callbacks.onToggleLabels)} />
                <ZenCheck label="orbit lines" checked={settings.orbitLines}
                  onToggle={() => toggleSetting('orbitLines', callbacks.onToggleOrbits)} />
                <ZenCheck label="star field" checked={settings.starField}
                  onToggle={() => toggleSetting('starField', callbacks.onToggleStarfield)} />
                <ZenCheck label="asteroid belts" checked={settings.belts}
                  onToggle={() => toggleSetting('belts', callbacks.onToggleBelts)} />
                <ZenCheck label="time bar" checked={settings.timeBar}
                  onToggle={() => toggleSetting('timeBar', () => {})} />
                <ZenCheck label="flood lighting" checked={settings.floodLighting}
                  onToggle={() => toggleSetting('floodLighting', callbacks.onToggleFlood)} />
                <ZenCheck label="background audio" checked={settings.backgroundAudio}
                  onToggle={() => toggleSetting('backgroundAudio', callbacks.onToggleBackgroundAudio)} />
              </div>
              <button class="whisper close" onClick={() => setSheetOpen(false)}>close</button>
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
    onMoonTour: () => {},
    onTopView: () => {},
    onToggleLabels: () => {},
    onToggleOrbits: () => {},
    onToggleStarfield: () => {},
    onToggleBelts: () => {},
    onToggleFlood: () => {},
    onTimeStep: () => {},
    onTimeLive: () => {},
    onToggleDebug: () => {},
    onToggleBackgroundAudio: () => {},
    onVolumeChange: () => {},
    onBloomStrengthChange: () => {},
    onSpeedChange: () => {},
    onToggleStemMute: () => {},
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

  /** Update the sim-time readout (date, rate label, live state). */
  updateTime(simDate: Date, timeRateLabel: string, timeLive: boolean): void {
    hudState = { ...hudState, simDate, timeRateLabel, timeLive };
    rerenderHUD?.();
  }

  /** Briefly highlight the speed readout (1-9 preset feedback). */
  flashSpeed(): void {
    hudState = { ...hudState, speedFlashUntil: performance.now() + 1200 };
    rerenderHUD?.();
  }

  /** Live audio mix for the selected body's info panel. */
  updateMix(mix: MixRow[], droneLevel: number): void {
    hudState = { ...hudState, mix, droneLevel };
    rerenderHUD?.();
  }

  /** Body id of the open info panel, or null. */
  getSelectedBodyId(): string | null {
    return hudState.selectedBody?.id ?? null;
  }

  showBodyInfo(body: CelestialBodyConfig): void {
    hudState = { ...hudState, selectedBody: body };
    rerenderHUD?.();
  }

  setCallbacks(callbacks: Partial<HUDCallbacks>): void {
    Object.assign(this.callbacks, callbacks);
  }
}
