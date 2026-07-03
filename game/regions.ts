import * as THREE from 'three';
import { latLonToDir, clamp, DEG2RAD } from './util';

interface RegionDef {
  name: string;
  lat: number;
  lon: number;
  /** Angular radius in radians. */
  r: number;
}

const CITIES: RegionDef[] = [
  { name: 'Paris', lat: 48.86, lon: 2.29, r: 0.035 },
  { name: 'London', lat: 51.5, lon: -0.12, r: 0.035 },
  { name: 'New York', lat: 40.71, lon: -74.0, r: 0.04 },
  { name: 'Tokyo', lat: 35.68, lon: 139.7, r: 0.04 },
  { name: 'Rome', lat: 41.9, lon: 12.5, r: 0.032 },
  { name: 'Sydney', lat: -33.86, lon: 151.2, r: 0.04 },
  { name: 'Dubai', lat: 25.2, lon: 55.3, r: 0.035 },
  { name: 'Cairo', lat: 30.04, lon: 31.24, r: 0.035 },
  { name: 'Agra', lat: 27.18, lon: 78.02, r: 0.03 },
  { name: 'Beijing', lat: 39.9, lon: 116.4, r: 0.04 },
  { name: 'Los Angeles', lat: 34.05, lon: -118.24, r: 0.04 },
  { name: 'San Francisco', lat: 37.77, lon: -122.42, r: 0.035 },
  { name: 'Rio de Janeiro', lat: -22.9, lon: -43.2, r: 0.04 },
  { name: 'Moscow', lat: 55.75, lon: 37.62, r: 0.04 },
  { name: 'Mumbai', lat: 19.08, lon: 72.88, r: 0.035 },
  { name: 'Istanbul', lat: 41.0, lon: 28.98, r: 0.035 },
  { name: 'Singapore', lat: 1.35, lon: 103.82, r: 0.03 },
  { name: 'Toronto', lat: 43.65, lon: -79.38, r: 0.035 }
];

const COUNTRIES: RegionDef[] = [
  { name: 'France', lat: 47, lon: 2, r: 0.075 },
  { name: 'United Kingdom', lat: 54, lon: -2, r: 0.07 },
  { name: 'Spain', lat: 40, lon: -4, r: 0.075 },
  { name: 'Germany', lat: 51, lon: 10, r: 0.06 },
  { name: 'Italy', lat: 43, lon: 12, r: 0.07 },
  { name: 'Scandinavia', lat: 63, lon: 15, r: 0.11 },
  { name: 'Greece', lat: 39, lon: 22, r: 0.05 },
  { name: 'Turkey', lat: 39, lon: 35, r: 0.08 },
  { name: 'Russia', lat: 60, lon: 60, r: 0.35 },
  { name: 'Egypt', lat: 27, lon: 30, r: 0.08 },
  { name: 'Morocco', lat: 32, lon: -6, r: 0.07 },
  { name: 'Nigeria', lat: 9, lon: 8, r: 0.08 },
  { name: 'Kenya', lat: 0, lon: 38, r: 0.07 },
  { name: 'South Africa', lat: -30, lon: 25, r: 0.09 },
  { name: 'Madagascar', lat: -19, lon: 47, r: 0.06 },
  { name: 'Saudi Arabia', lat: 24, lon: 45, r: 0.1 },
  { name: 'United Arab Emirates', lat: 24, lon: 54, r: 0.04 },
  { name: 'Iran', lat: 32, lon: 54, r: 0.09 },
  { name: 'India', lat: 22, lon: 79, r: 0.13 },
  { name: 'China', lat: 33, lon: 105, r: 0.17 },
  { name: 'Mongolia', lat: 46, lon: 105, r: 0.08 },
  { name: 'Japan', lat: 36, lon: 138, r: 0.08 },
  { name: 'Thailand', lat: 15, lon: 101, r: 0.06 },
  { name: 'Vietnam', lat: 16, lon: 107, r: 0.05 },
  { name: 'Indonesia', lat: -2, lon: 118, r: 0.1 },
  { name: 'Australia', lat: -25, lon: 134, r: 0.16 },
  { name: 'New Zealand', lat: -42, lon: 172, r: 0.06 },
  { name: 'United States', lat: 39, lon: -98, r: 0.16 },
  { name: 'United States', lat: 39, lon: -76, r: 0.09 },
  { name: 'Canada', lat: 58, lon: -100, r: 0.2 },
  { name: 'Alaska', lat: 64, lon: -152, r: 0.08 },
  { name: 'Mexico', lat: 23, lon: -102, r: 0.09 },
  { name: 'Colombia', lat: 4, lon: -73, r: 0.07 },
  { name: 'Peru', lat: -10, lon: -76, r: 0.08 },
  { name: 'Brazil', lat: -10, lon: -53, r: 0.15 },
  { name: 'Argentina', lat: -35, lon: -65, r: 0.11 },
  { name: 'Chile', lat: -30, lon: -71, r: 0.06 },
  { name: 'Greenland', lat: 72, lon: -40, r: 0.1 },
  { name: 'Iceland', lat: 65, lon: -19, r: 0.035 },
  { name: 'Antarctica', lat: -80, lon: 0, r: 0.3 }
];

const OCEANS: RegionDef[] = [
  { name: 'Mediterranean Sea', lat: 36, lon: 15, r: 0.1 },
  { name: 'Caribbean Sea', lat: 16, lon: -75, r: 0.08 },
  { name: 'North Atlantic', lat: 35, lon: -40, r: 0.45 },
  { name: 'South Atlantic', lat: -25, lon: -15, r: 0.45 },
  { name: 'North Pacific', lat: 30, lon: -170, r: 0.55 },
  { name: 'South Pacific', lat: -30, lon: -135, r: 0.6 },
  { name: 'Indian Ocean', lat: -15, lon: 80, r: 0.5 },
  { name: 'Arctic Ocean', lat: 87, lon: 0, r: 0.45 },
  { name: 'Southern Ocean', lat: -62, lon: 0, r: 0.3 },
  { name: 'Southern Ocean', lat: -62, lon: 120, r: 0.3 },
  { name: 'Southern Ocean', lat: -62, lon: -120, r: 0.3 }
];

interface Located extends RegionDef {
  dir: THREE.Vector3;
}

const locate = (defs: RegionDef[]): Located[] =>
  defs.map((d) => ({ ...d, dir: latLonToDir(d.lat * DEG2RAD, d.lon * DEG2RAD) }));

const cities = locate(CITIES);
const countries = locate(COUNTRIES);
const oceans = locate(OCEANS);

export interface RegionInfo {
  primary: string;
  secondary: string | null;
}

function match(list: Located[], dir: THREE.Vector3): Located | null {
  let best: Located | null = null;
  let bestScore = Infinity;
  for (const item of list) {
    const ang = Math.acos(clamp(dir.dot(item.dir), -1, 1));
    if (ang < item.r && ang / item.r < bestScore) {
      bestScore = ang / item.r;
      best = item;
    }
  }
  return best;
}

/** Human-readable location for a point on the globe. */
export function regionAt(dir: THREE.Vector3, overLand: boolean): RegionInfo {
  const city = match(cities, dir);
  const country = match(countries, dir);
  if (city) return { primary: city.name, secondary: country ? country.name : null };
  if (country) return { primary: country.name, secondary: null };
  if (!overLand) {
    const ocean = match(oceans, dir);
    return { primary: ocean ? ocean.name : 'Open Ocean', secondary: null };
  }
  return { primary: 'Uncharted Land', secondary: null };
}
