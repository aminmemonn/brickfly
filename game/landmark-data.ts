export interface LandmarkDef {
  id: string;
  name: string;
  location: string;
  lat: number;
  lon: number;
  fact: string;
  /** Discovery/proximity trigger radius in world units. */
  radius: number;
  /** Radius of terrain flattening around the landmark, in world units. */
  flat?: number;
  /** Height of the flattened plateau above sea level. */
  plateau?: number;
}

export const LANDMARKS: LandmarkDef[] = [
  {
    id: 'eiffel',
    name: 'Eiffel Tower',
    location: 'Paris, France',
    lat: 48.858,
    lon: 2.294,
    fact: 'Rebuilt here from lattice bricks — the real one has 2.5 million rivets. Ours needs zero.',
    radius: 3400,
    flat: 2100,
    plateau: 10
  },
  {
    id: 'nyc',
    name: 'New York Skyline',
    location: 'Manhattan, USA',
    lat: 40.712,
    lon: -74.006,
    fact: 'A full brick Manhattan — colourful glass and brick towers, Central Park, rivers and a blazing Times Square.',
    radius: 4400,
    // Snug pad around the island; the surrounding water is the global ocean
    // sphere (see game/water.ts), not a flat brick plate.
    flat: 3000,
    plateau: 4
  },
  {
    id: 'cali',
    name: 'California Beach',
    location: 'Santa Monica, USA',
    lat: 34,
    lon: -120.5,
    fact: 'Sun, surf and a brick pier with a Ferris wheel. The lifeguards never blink — they are made of bricks.',
    radius: 2600,
    // Fully-flat pad covers the sea + sand plates (corners ~2345 world) so the
    // ocean plate stays flush instead of getting pierced by natural terrain.
    flat: 2800,
    plateau: 2
  },
  {
    id: 'taj',
    name: 'Taj Mahal',
    location: 'Agra, India',
    lat: 27.175,
    lon: 78.042,
    fact: 'White bricks, teal accents, perfect symmetry — a monument you could take apart and rebuild forever.',
    radius: 2800,
    flat: 1600,
    plateau: 9
  },
  {
    id: 'wall',
    name: 'Great Wall',
    location: 'China',
    lat: 40.432,
    lon: 116.57,
    fact: 'It winds over every brick hill in sight. Legend says you can see it from the menu screen.',
    radius: 1400
  },
  {
    id: 'sydney',
    name: 'Sydney Opera House',
    location: 'Sydney, Australia',
    lat: -33.857,
    lon: 151.215,
    fact: 'Those white sail shells took the real architects 14 years. These bricks clicked together in seconds.',
    radius: 2800,
    flat: 1600,
    plateau: 6
  },
  {
    id: 'colosseum',
    name: 'Colosseum',
    location: 'Rome, Italy',
    lat: 41.89,
    lon: 12.492,
    fact: 'Two thousand years old and still standing — mostly because nobody found the brick separator.',
    radius: 3400,
    flat: 2000,
    plateau: 10
  },
  {
    id: 'fuji',
    name: 'Mount Fuji',
    location: 'Honshu, Japan',
    lat: 35.361,
    lon: 138.728,
    fact: 'A perfect cone with a snow-white cap. The bravest pilots buzz the crater rim.',
    radius: 1500,
    flat: 700,
    plateau: 8
  },
  {
    id: 'giza',
    name: 'Pyramids of Giza',
    location: 'Giza, Egypt',
    lat: 29.979,
    lon: 31.134,
    fact: 'Colossal step pyramids with a watchful Sphinx and glyph-carved obelisks. Built one brick at a time.',
    radius: 3200,
    flat: 2400,
    plateau: 8
  },
  {
    id: 'bigben',
    name: 'Big Ben',
    location: 'London, UK',
    lat: 51.5,
    lon: -0.124,
    fact: 'The clock tower of Westminster in warm tan brick. It is always brick o’clock somewhere.',
    radius: 3400,
    flat: 2000,
    plateau: 8
  },
  {
    id: 'burj',
    name: 'Burj Khalifa',
    location: 'Dubai, UAE',
    lat: 25.197,
    lon: 55.274,
    fact: 'The tallest stack on the planet — 828 metres of glass, or about 270 bricks straight up.',
    radius: 3000,
    flat: 1700,
    plateau: 5
  }
];
