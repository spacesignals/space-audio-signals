import type { CelestialBodyConfig } from '../types';
import { KM_PER_UNIT } from '../data/constants';

/**
 * HUD renders overlay UI: distance readout, body selector, speed indicator.
 * Pure DOM — no framework needed for this minimal v1 HUD.
 */
export class HUD {
  private container: HTMLDivElement;
  private distanceEl: HTMLDivElement;
  private speedEl: HTMLDivElement;
  private bodyListEl: HTMLDivElement;
  private infoEl: HTMLDivElement;
  private startOverlay: HTMLDivElement;

  private onBodySelect: ((bodyId: string) => void) | null = null;
  private onStart: (() => void) | null = null;
  private onTour: (() => void) | null = null;
  private onTopView: (() => void) | null = null;
  private onToggleLabels: ((visible: boolean) => void) | null = null;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'hud';
    this.container.innerHTML = `
      <style>
        #hud {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          pointer-events: none;
          font-family: system-ui, -apple-system, sans-serif;
          color: white;
          z-index: 10;
        }
        #hud > * { pointer-events: auto; }
        .hud-distance {
          position: absolute;
          bottom: 20px; left: 20px;
          background: rgba(0,0,0,0.5);
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 14px;
          backdrop-filter: blur(4px);
        }
        .hud-speed {
          position: absolute;
          bottom: 20px; right: 20px;
          background: rgba(0,0,0,0.5);
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 14px;
          backdrop-filter: blur(4px);
        }
        .hud-body-list {
          position: absolute;
          top: 20px; right: 20px;
          background: rgba(0,0,0,0.5);
          padding: 8px;
          border-radius: 8px;
          backdrop-filter: blur(4px);
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
          background: rgba(0,0,0,0.5);
          padding: 12px 16px;
          border-radius: 8px;
          font-size: 13px;
          backdrop-filter: blur(4px);
          max-width: 250px;
          display: none;
        }
        .hud-info h3 { margin: 0 0 8px 0; font-size: 16px; }
        .hud-info p { margin: 4px 0; opacity: 0.8; }
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
          background: rgba(0,0,0,0.5);
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 12px;
          opacity: 0.6;
          backdrop-filter: blur(4px);
          white-space: nowrap;
        }
      </style>
    `;

    this.distanceEl = document.createElement('div');
    this.distanceEl.className = 'hud-distance';
    this.container.appendChild(this.distanceEl);

    this.speedEl = document.createElement('div');
    this.speedEl.className = 'hud-speed';
    this.container.appendChild(this.speedEl);

    this.bodyListEl = document.createElement('div');
    this.bodyListEl.className = 'hud-body-list';
    this.container.appendChild(this.bodyListEl);

    this.infoEl = document.createElement('div');
    this.infoEl.className = 'hud-info';
    this.container.appendChild(this.infoEl);

    // Controls hint
    const hint = document.createElement('div');
    hint.className = 'controls-hint';
    hint.textContent = 'WASD / Arrows to move | Mouse drag to look | Scroll to change speed | Click planet to fly there';
    this.container.appendChild(hint);

    // Start overlay (needed for audio autoplay policy)
    this.startOverlay = document.createElement('div');
    this.startOverlay.className = 'start-overlay';
    this.startOverlay.innerHTML = `
      <h1>GALAXYMUSIC</h1>
      <p>Navigate the solar system. Hear it change.</p>
      <div class="start-btn">Click anywhere to begin</div>
    `;
    this.startOverlay.addEventListener('click', () => {
      this.startOverlay.style.display = 'none';
      this.onStart?.();
    });

    document.body.appendChild(this.startOverlay);
    document.body.appendChild(this.container);
  }

  initBodyList(bodies: CelestialBodyConfig[]): void {
    this.bodyListEl.innerHTML = '<div style="font-size:11px;opacity:0.5;margin-bottom:4px;">FLY TO</div>';

    // Special buttons at the top
    const tourBtn = document.createElement('button');
    tourBtn.textContent = 'Sun and Outwards';
    tourBtn.style.borderColor = 'rgba(100,180,255,0.4)';
    tourBtn.addEventListener('click', () => {
      this.onTour?.();
    });
    this.bodyListEl.appendChild(tourBtn);

    const topViewBtn = document.createElement('button');
    topViewBtn.textContent = 'Top View';
    topViewBtn.style.borderColor = 'rgba(100,180,255,0.4)';
    topViewBtn.addEventListener('click', () => {
      this.onTopView?.();
    });
    this.bodyListEl.appendChild(topViewBtn);

    const labelToggle = document.createElement('label');
    labelToggle.className = 'hud-toggle';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.addEventListener('change', () => {
      this.onToggleLabels?.(checkbox.checked);
    });
    labelToggle.appendChild(checkbox);
    labelToggle.appendChild(document.createTextNode('Labels'));
    this.bodyListEl.appendChild(labelToggle);

    for (const body of bodies) {
      const btn = document.createElement('button');
      btn.textContent = body.name;
      btn.addEventListener('click', () => {
        this.onBodySelect?.(body.id);
      });
      this.bodyListEl.appendChild(btn);
    }
  }

  updateDistance(nearestBody: string | null, distanceKm: number): void {
    if (!nearestBody) {
      this.distanceEl.textContent = 'Deep Space';
      return;
    }

    let distStr: string;
    if (distanceKm > 1e9) {
      distStr = `${(distanceKm / 149_597_870.7).toFixed(2)} AU`;
    } else if (distanceKm > 1e6) {
      distStr = `${(distanceKm / 1e6).toFixed(1)}M km`;
    } else {
      distStr = `${Math.round(distanceKm).toLocaleString()} km`;
    }

    this.distanceEl.textContent = `${nearestBody} — ${distStr}`;
  }

  updateSpeed(speedUnitsPerSec: number): void {
    const kmPerSec = speedUnitsPerSec * KM_PER_UNIT;
    let speedStr: string;
    if (kmPerSec > 1e6) {
      speedStr = `${(kmPerSec / 149_597_870.7 * 60).toFixed(1)} AU/min`;
    } else {
      speedStr = `${(kmPerSec / 1000).toFixed(0)}k km/s`;
    }
    this.speedEl.textContent = `Speed: ${speedStr}`;
  }

  showBodyInfo(body: CelestialBodyConfig): void {
    this.infoEl.style.display = 'block';
    this.infoEl.innerHTML = `
      <h3>${body.name}</h3>
      <p>Type: ${body.type}</p>
      <p>Radius: ${body.radiusKm.toLocaleString()} km</p>
      <p>Audio stems: ${body.stems.length}</p>
    `;
  }

  hideBodyInfo(): void {
    this.infoEl.style.display = 'none';
  }

  setOnBodySelect(cb: (bodyId: string) => void): void {
    this.onBodySelect = cb;
  }

  setOnStart(cb: () => void): void {
    this.onStart = cb;
  }

  setOnTour(cb: () => void): void {
    this.onTour = cb;
  }

  setOnTopView(cb: () => void): void {
    this.onTopView = cb;
  }

  setOnToggleLabels(cb: (visible: boolean) => void): void {
    this.onToggleLabels = cb;
  }

  setVisible(visible: boolean): void {
    this.container.style.display = visible ? 'block' : 'none';
  }
}
