import * as THREE from 'three';
import { PLANET_R } from './constants';

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

export function hash2(i: number, j: number): number {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function latLonToDir(latRad: number, lonRad: number, out = new THREE.Vector3()): THREE.Vector3 {
  const c = Math.cos(latRad);
  return out.set(c * Math.cos(lonRad), Math.sin(latRad), -c * Math.sin(lonRad));
}

export function dirToLatLon(d: THREE.Vector3): { lat: number; lon: number } {
  return { lat: Math.asin(clamp(d.y, -1, 1)), lon: -Math.atan2(d.z, d.x) };
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const FALLBACK_EAST = new THREE.Vector3(1, 0, 0);

export function tangentBasis(up: THREE.Vector3, east: THREE.Vector3, north: THREE.Vector3): void {
  east.crossVectors(Y_AXIS, up);
  if (east.lengthSq() < 1e-8) east.copy(FALLBACK_EAST);
  east.normalize();
  north.crossVectors(up, east).normalize();
}

const basisMat = new THREE.Matrix4();
const basisZ = new THREE.Vector3();

export function basisQuat(
  east: THREE.Vector3,
  up: THREE.Vector3,
  _north: THREE.Vector3,
  out = new THREE.Quaternion()
): THREE.Quaternion {
  // tangentBasis returns north = up x east, which makes (east, up, north) a
  // LEFT-handed basis (determinant -1). Feeding that improper matrix to
  // setFromRotationMatrix yields a bogus quaternion that tilts everything
  // oriented with it. Rebuild the third axis as east x up so the matrix is a
  // proper rotation and local +Y maps exactly onto `up`.
  basisZ.crossVectors(east, up);
  basisMat.makeBasis(east, up, basisZ);
  return out.setFromRotationMatrix(basisMat);
}

/** Box geometry with a baked vertical AO gradient in vertex colors. */
export function makeAOBox(): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const shade = 0.72 + 0.28 * (pos.getY(i) + 0.5);
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** World-space drop of a tangent-plane point back onto the sphere surface. */
export function curvatureDrop(x: number, z: number): number {
  return (x * x + z * z) / (2 * PLANET_R);
}

const mapUp = new THREE.Vector3();

/**
 * Exact spherical mapping of a tangent-frame point. Treats local (x, z) as
 * arc-length coordinates on a sphere of radius `r` whose surface passes
 * through the local origin, and `y` as height above that surface. Writes the
 * curved position to `outPos` and (optionally) the tilt that re-aligns local
 * +Y with the sphere normal to `outTilt`. Unlike curvatureDrop, this also
 * fixes ORIENTATION: without the tilt, tall objects far from a city's anchor
 * lean off vertical (≈ dist/r radians — 14° at Manhattan's island tips).
 */
export function sphereMap(
  x: number,
  y: number,
  z: number,
  r: number,
  outPos: THREE.Vector3,
  outTilt?: THREE.Quaternion
): void {
  const rho = Math.hypot(x, z);
  if (rho < 1e-6) {
    outPos.set(0, y, 0);
    if (outTilt) outTilt.identity();
    return;
  }
  const s = Math.sin(rho / r) / rho;
  mapUp.set(x * s, Math.cos(rho / r), z * s);
  outPos.copy(mapUp).multiplyScalar(r + y);
  outPos.y -= r;
  if (outTilt) outTilt.setFromUnitVectors(Y_AXIS, mapUp);
}
