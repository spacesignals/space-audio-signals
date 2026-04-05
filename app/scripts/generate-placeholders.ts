/**
 * Generate placeholder texture images for development.
 * Run: npx tsx scripts/generate-placeholders.ts
 *
 * In production, replace with real NASA texture maps from:
 * https://svs.gsfc.nasa.gov/cgi-bin/search?value=texture+map
 */

import { writeFileSync, mkdirSync } from 'fs';

const BODIES = [
  { id: 'sun', color: '#FDB813' },
  { id: 'mercury', color: '#8C7E6D' },
  { id: 'venus', color: '#C4A882' },
  { id: 'earth', color: '#4B7BE5' },
  { id: 'mars', color: '#C1440E' },
  { id: 'jupiter', color: '#C88B3A' },
  { id: 'saturn', color: '#E8D191' },
  { id: 'uranus', color: '#73C2CB' },
  { id: 'neptune', color: '#3E54E8' },
];

// Generate a simple 64x32 colored PNG-like SVG for each body as a placeholder
// (Real textures would be 2K+ JPGs from NASA)
for (const body of BODIES) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="256">
  <rect width="512" height="256" fill="${body.color}"/>
  <text x="256" y="128" text-anchor="middle" fill="white" font-size="32" font-family="sans-serif">${body.id}</text>
</svg>`;

  mkdirSync('public/textures', { recursive: true });
  // Write as SVG (Three.js can load SVG textures)
  writeFileSync(`public/textures/${body.id}.svg`, svg);
  console.log(`Generated placeholder: ${body.id}.svg`);
}

console.log('\nReplace these with real NASA JPG textures for production.');
console.log('Update body configs in src/data/bodies.ts to use .jpg extension.');
