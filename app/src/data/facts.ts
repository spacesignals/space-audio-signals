/**
 * Per-body facts for the info panel — content sourced from NASA's solar
 * system pages (science.nasa.gov/solar-system/), following their page
 * template: a one-line tagline plus a few snackable factoids.
 */
export interface BodyFacts {
  tagline: string;
  factoids: string[];
  stats?: { label: string; value: string }[];
}

export const FACTS: Record<string, BodyFacts> = {
  sun: {
    tagline: 'the star at the center of the solar system',
    factoids: [
      'Holds 99.8% of the solar system’s mass.',
      'Its core fuses 600 million tons of hydrogen every second.',
      'Light from the surface takes about 8 minutes to reach Earth.',
    ],
    stats: [
      { label: 'age', value: '~4.6 billion years' },
      { label: 'surface', value: '5,500 °C' },
    ],
  },
  mercury: {
    tagline: 'the smallest planet and the closest to the sun',
    factoids: [
      'A year lasts just 88 Earth days — but one day-night cycle takes 176.',
      'Not the hottest planet, despite being closest to the Sun.',
      'Its surface swings from −180 °C at night to 430 °C by day.',
    ],
    stats: [
      { label: 'distance from sun', value: '0.39 au' },
      { label: 'moons', value: 'none' },
    ],
  },
  venus: {
    tagline: 'the hottest planet in the solar system',
    factoids: [
      'Hotter than Mercury — its CO₂ atmosphere traps heat at ~465 °C.',
      'Spins backwards, and so slowly a day outlasts its year.',
      'Has an officially named quasi-moon: Zoozve.',
    ],
    stats: [
      { label: 'distance from sun', value: '0.72 au' },
      { label: 'moons', value: 'none' },
    ],
  },
  earth: {
    tagline: 'the only planet known to support life',
    factoids: [
      'The only place in the universe where life is confirmed — so far.',
      'Oceans cover 71% of the surface and hold most of the planet’s habitat.',
      'Orbits the galactic center at 828,000 km/h, one lap per 230 million years.',
    ],
    stats: [
      { label: 'distance from sun', value: '1 au' },
      { label: 'moons', value: '1' },
    ],
  },
  mars: {
    tagline: 'the fourth planet from the sun',
    factoids: [
      'Home to Olympus Mons, the largest volcano in the solar system.',
      'Ancient rivers and lakes left their fingerprints all over its surface.',
      'More than a dozen spacecraft have explored it — more than any world but Earth.',
    ],
    stats: [
      { label: 'distance from sun', value: '1.52 au' },
      { label: 'moons', value: '2' },
    ],
  },
  jupiter: {
    tagline: 'the largest planet in the solar system',
    factoids: [
      'If it were a hollow shell, about 1,000 Earths could fit inside.',
      'The Great Red Spot is a storm larger than Earth, raging for centuries.',
      'Its moon swarm resembles a miniature solar system.',
    ],
    stats: [
      { label: 'distance from sun', value: '5.2 au' },
      { label: 'moons', value: '95+' },
    ],
  },
  saturn: {
    tagline: 'the second-largest planet, encircled by ice rings',
    factoids: [
      'All four giant planets have rings — none rival Saturn’s.',
      'The rings are mostly water ice, some pieces house-sized, some dust.',
      'Less dense than water — it would float, given a big enough ocean.',
    ],
    stats: [
      { label: 'distance from sun', value: '9.5 au' },
      { label: 'moons', value: '146+' },
    ],
  },
  uranus: {
    tagline: 'an ice giant tilted onto its side',
    factoids: [
      'Rolls around the Sun on its side — its axis tilted 98 degrees.',
      'The coldest planetary atmosphere in the solar system: −224 °C.',
      'Its faint rings were discovered before Voyager ever arrived.',
    ],
    stats: [
      { label: 'distance from sun', value: '19.2 au' },
      { label: 'moons', value: '28' },
    ],
  },
  neptune: {
    tagline: 'the farthest planet from the sun',
    factoids: [
      'Supersonic winds top 2,000 km/h — the fastest in the solar system.',
      'Found by mathematics before telescopes: its gravity tugged on Uranus.',
      'One Neptune year is 165 Earth years.',
    ],
    stats: [
      { label: 'distance from sun', value: '30 au' },
      { label: 'moons', value: '16' },
    ],
  },
  pluto: {
    tagline: 'a dwarf planet in the kuiper belt',
    factoids: [
      'Smaller than Earth’s Moon, with mountains of water ice.',
      'Charon is so large the pair wobble around a shared point.',
      'A year here lasts 248 Earth years.',
    ],
    stats: [
      { label: 'distance from sun', value: '39 au (avg)' },
      { label: 'moons', value: '5' },
    ],
  },
  moon: {
    tagline: 'earth’s only natural satellite',
    factoids: [
      'The only other world humans have walked on.',
      'Drifts away from Earth about 3.8 cm every year.',
      'Its gravity steadies Earth’s tilt — and our climate.',
    ],
  },
  io: {
    tagline: 'the most volcanically active body in the solar system',
    factoids: [
      'Hundreds of active volcanoes, some erupting lava fountains kilometers high.',
      'Jupiter’s tides knead its interior like dough, keeping it molten.',
    ],
  },
  europa: {
    tagline: 'an icy moon with an ocean beneath its crust',
    factoids: [
      'Beneath its cracked ice shell hides an ocean with more water than Earth’s.',
      'One of the most promising places to look for life beyond Earth.',
    ],
  },
  ganymede: {
    tagline: 'the largest moon in the solar system',
    factoids: [
      'Bigger than the planet Mercury.',
      'The only moon known to generate its own magnetic field.',
    ],
  },
  callisto: {
    tagline: 'the most heavily cratered body in the solar system',
    factoids: [
      'Its ancient surface has recorded impacts for 4 billion years.',
      'May hide a salty ocean deep beneath the battered crust.',
    ],
  },
  titan: {
    tagline: 'saturn’s largest moon, with a thick atmosphere',
    factoids: [
      'The only moon with a thick atmosphere — denser than Earth’s.',
      'Rain, rivers, and seas — but of liquid methane, not water.',
    ],
  },
  enceladus: {
    tagline: 'an icy moon with water geysers at its south pole',
    factoids: [
      'Geysers at its south pole jet ocean water into space.',
      'That spray becomes part of Saturn’s E ring.',
    ],
  },
  mimas: {
    tagline: 'a small moon marked by one very large crater',
    factoids: [
      'Crater Herschel spans a third of its diameter.',
      'Recent evidence hints at a young ocean beneath its ice.',
    ],
  },
  rhea: {
    tagline: 'saturn’s second-largest moon',
    factoids: [
      'A dirty snowball of ice and rock, thick with craters.',
    ],
  },
  dione: {
    tagline: 'an icy moon with bright fault cliffs',
    factoids: [
      'Bright wispy streaks are canyon walls of exposed ice.',
    ],
  },
  tethys: {
    tagline: 'a moon made almost entirely of water ice',
    factoids: [
      'So light it’s almost pure water ice.',
      'Ithaca Chasma is a canyon stretching three-quarters around it.',
    ],
  },
  iapetus: {
    tagline: 'a moon with one dark and one bright hemisphere',
    factoids: [
      'One hemisphere is coal-dark, the other bright ice.',
      'A mysterious equatorial ridge makes it look like a walnut.',
    ],
  },
  titania: {
    tagline: 'the largest moon of uranus',
    factoids: [
      'Canyons and fault valleys hint at an active past.',
    ],
  },
  oberon: {
    tagline: 'the outermost of uranus’s large moons',
    factoids: [
      'Old, dark, and heavily cratered — barely changed in eons.',
    ],
  },
  triton: {
    tagline: 'neptune’s largest moon, orbiting backwards',
    factoids: [
      'Orbits Neptune backwards — almost certainly a captured Kuiper Belt object.',
      'Nitrogen geysers erupt from its −235 °C surface.',
    ],
  },
  phobos: {
    tagline: 'the larger, inner moon of mars',
    factoids: [
      'Orbits so low it circles Mars three times a day.',
      'Spiraling inward — destined to break apart into a ring.',
    ],
  },
  charon: {
    tagline: 'the largest moon of pluto',
    factoids: [
      'Half of Pluto’s size — the pair are almost a double dwarf planet.',
      'A canyon system four times longer than the Grand Canyon.',
    ],
  },
  ceres: {
    tagline: 'a dwarf planet in the asteroid belt',
    factoids: [
      'The largest body in the asteroid belt — a third of its total mass.',
      'Bright salt deposits mark spots where briny water reached the surface.',
    ],
  },
  vesta: {
    tagline: 'one of the largest bodies in the asteroid belt',
    factoids: [
      'Sometimes visible from Earth with the naked eye.',
      'Pieces knocked off Vesta fall to Earth as meteorites.',
    ],
  },
  eros: {
    tagline: 'a near-earth asteroid, the first ever orbited',
    factoids: [
      'A near-Earth asteroid shaped like a peanut.',
      'NEAR Shoemaker landed here in 2001 — the first asteroid landing.',
    ],
  },
};
