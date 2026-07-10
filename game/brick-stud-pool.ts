import * as THREE from 'three';
import { ABS_STUD_MATERIAL } from './brick-material';
import { STUD_LOD_DISTANCE } from './constants';

const CELL_SIZE = 128;
const MOVE_THRESHOLD = 32;
const RESIDENT_RADIUS = STUD_LOD_DISTANCE + MOVE_THRESHOLD;
const MAX_ACTIVE_STUDS = 12000;

interface StudSurface {
  center: THREE.Vector3;
  axisX: THREE.Vector3;
  axisY: THREE.Vector3;
  axisZ: THREE.Vector3;
  quaternion: THREE.Quaternion;
  width: number;
  depth: number;
  pitch: number;
  diameter: number;
  studHeight: number;
  nx: number;
  nz: number;
  color: THREE.Color;
}

export interface StudSurfaceInput {
  /** Center of the exposed top plane in world space. */
  center: THREE.Vector3;
  /** World-space local +X, +Y (top normal), and +Z axes. */
  axisX: THREE.Vector3;
  axisY: THREE.Vector3;
  axisZ: THREE.Vector3;
  width: number;
  depth: number;
  bodyHeight: number;
  pitch: number;
  color: THREE.Color;
}

/** Fixed-pitch stud count that keeps the full cylinder inside the top face. */
export function studCountForSpan(span: number, pitch: number): number {
  const diameter = pitch * 0.6;
  if (span + 1e-5 < diameter) return 0;
  return Math.max(1, Math.floor((span - diameter + 1e-5) / pitch) + 1);
}

/**
 * One draw call for every static near-field stud in the world. Brick builders
 * register top surfaces once; only the camera's resident cells are expanded
 * into cylinder instances when the view moves at least 32 world units.
 */
export class BrickStudPool {
  readonly mesh: THREE.InstancedMesh;

  private surfaces: StudSurface[] = [];
  private cells = new Map<string, number[]>();
  private marks = new Uint32Array(0);
  private markGeneration = 1;
  private lastAnchor = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0);
  private enabled = true;
  private dirty = true;

  private candidateIds: number[] = [];
  private matrix = new THREE.Matrix4();
  private rotationMatrix = new THREE.Matrix4();
  private position = new THREE.Vector3();
  private relative = new THREE.Vector3();
  private scale = new THREE.Vector3();

  constructor() {
    const geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 16, 1, false);
    this.mesh = new THREE.InstancedMesh(geometry, ABS_STUD_MATERIAL, MAX_ACTIVE_STUDS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ACTIVE_STUDS * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }

  registerSurface(input: StudSurfaceInput): void {
    const nx = studCountForSpan(input.width, input.pitch);
    const nz = studCountForSpan(input.depth, input.pitch);
    if (nx === 0 || nz === 0) return;

    const axisX = input.axisX.clone().normalize();
    const axisY = input.axisY.clone().normalize();
    const axisZ = input.axisZ.clone().normalize();
    this.rotationMatrix.makeBasis(axisX, axisY, axisZ);

    const diameter = input.pitch * 0.6;
    const surface: StudSurface = {
      center: input.center.clone(),
      axisX,
      axisY,
      axisZ,
      quaternion: new THREE.Quaternion().setFromRotationMatrix(this.rotationMatrix),
      width: input.width,
      depth: input.depth,
      pitch: input.pitch,
      diameter,
      // Thin plates keep a proportionally shorter stud; tall authored macro
      // blocks are capped at the standard ABS module height.
      studHeight: Math.min(input.bodyHeight * 0.3, input.pitch * 0.375),
      nx,
      nz,
      color: input.color.clone()
    };

    const id = this.surfaces.length;
    this.surfaces.push(surface);
    this.insertSurfaceCells(id, surface);
    this.dirty = true;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.dirty = true;
    if (!enabled) this.mesh.count = 0;
  }

  update(cameraPosition: THREE.Vector3): void {
    if (!this.enabled) return;
    if (!this.dirty && cameraPosition.distanceToSquared(this.lastAnchor) < MOVE_THRESHOLD * MOVE_THRESHOLD) return;

    this.dirty = false;
    this.lastAnchor.copy(cameraPosition);
    this.collectCandidateSurfaces(cameraPosition);

    // Work from the nearest top planes first so the capacity limit, if ever
    // reached in a dense city, cannot evict the cylinders closest to camera.
    this.candidateIds.sort((a, b) => {
      const da = this.surfaces[a].center.distanceToSquared(cameraPosition);
      const db = this.surfaces[b].center.distanceToSquared(cameraPosition);
      return da - db;
    });

    const residentSq = RESIDENT_RADIUS * RESIDENT_RADIUS;
    let count = 0;

    outer:
    for (const id of this.candidateIds) {
      const surface = this.surfaces[id];
      this.relative.subVectors(cameraPosition, surface.center);
      const cameraX = this.relative.dot(surface.axisX);
      const cameraZ = this.relative.dot(surface.axisZ);
      const startX = -((surface.nx - 1) * surface.pitch) / 2;
      const startZ = -((surface.nz - 1) * surface.pitch) / 2;

      const minX = THREE.MathUtils.clamp(
        Math.ceil((cameraX - RESIDENT_RADIUS - startX) / surface.pitch),
        0,
        surface.nx - 1
      );
      const maxX = THREE.MathUtils.clamp(
        Math.floor((cameraX + RESIDENT_RADIUS - startX) / surface.pitch),
        0,
        surface.nx - 1
      );
      const minZ = THREE.MathUtils.clamp(
        Math.ceil((cameraZ - RESIDENT_RADIUS - startZ) / surface.pitch),
        0,
        surface.nz - 1
      );
      const maxZ = THREE.MathUtils.clamp(
        Math.floor((cameraZ + RESIDENT_RADIUS - startZ) / surface.pitch),
        0,
        surface.nz - 1
      );

      if (minX > maxX || minZ > maxZ) continue;

      for (let ix = minX; ix <= maxX; ix++) {
        const x = startX + ix * surface.pitch;
        for (let iz = minZ; iz <= maxZ; iz++) {
          const z = startZ + iz * surface.pitch;
          this.position
            .copy(surface.center)
            .addScaledVector(surface.axisX, x)
            .addScaledVector(surface.axisZ, z)
            .addScaledVector(surface.axisY, surface.studHeight / 2);
          if (this.position.distanceToSquared(cameraPosition) > residentSq) continue;

          this.scale.set(surface.diameter, surface.studHeight, surface.diameter);
          this.matrix.compose(this.position, surface.quaternion, this.scale);
          this.mesh.setMatrixAt(count, this.matrix);
          this.mesh.setColorAt(count, surface.color);
          count++;
          if (count >= MAX_ACTIVE_STUDS) break outer;
        }
      }
    }

    this.mesh.count = count;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, count * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.clearUpdateRanges();
      this.mesh.instanceColor.addUpdateRange(0, count * 3);
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  private insertSurfaceCells(id: number, surface: StudSurface): void {
    const hx = surface.width / 2;
    const hz = surface.depth / 2;
    const hy = surface.studHeight;
    const ex = Math.abs(surface.axisX.x) * hx + Math.abs(surface.axisZ.x) * hz + Math.abs(surface.axisY.x) * hy;
    const ey = Math.abs(surface.axisX.y) * hx + Math.abs(surface.axisZ.y) * hz + Math.abs(surface.axisY.y) * hy;
    const ez = Math.abs(surface.axisX.z) * hx + Math.abs(surface.axisZ.z) * hz + Math.abs(surface.axisY.z) * hy;
    const minX = Math.floor((surface.center.x - ex) / CELL_SIZE);
    const maxX = Math.floor((surface.center.x + ex) / CELL_SIZE);
    const minY = Math.floor((surface.center.y - ey) / CELL_SIZE);
    const maxY = Math.floor((surface.center.y + ey) / CELL_SIZE);
    const minZ = Math.floor((surface.center.z - ez) / CELL_SIZE);
    const maxZ = Math.floor((surface.center.z + ez) / CELL_SIZE);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const key = `${x}|${y}|${z}`;
          const cell = this.cells.get(key);
          if (cell) cell.push(id);
          else this.cells.set(key, [id]);
        }
      }
    }
  }

  private collectCandidateSurfaces(cameraPosition: THREE.Vector3): void {
    if (this.marks.length < this.surfaces.length) this.marks = new Uint32Array(this.surfaces.length);
    this.markGeneration++;
    if (this.markGeneration === 0xffffffff) {
      this.marks.fill(0);
      this.markGeneration = 1;
    }
    this.candidateIds.length = 0;

    const cellRadius = Math.ceil(RESIDENT_RADIUS / CELL_SIZE);
    const cx = Math.floor(cameraPosition.x / CELL_SIZE);
    const cy = Math.floor(cameraPosition.y / CELL_SIZE);
    const cz = Math.floor(cameraPosition.z / CELL_SIZE);

    for (let x = cx - cellRadius; x <= cx + cellRadius; x++) {
      for (let y = cy - cellRadius; y <= cy + cellRadius; y++) {
        for (let z = cz - cellRadius; z <= cz + cellRadius; z++) {
          const cell = this.cells.get(`${x}|${y}|${z}`);
          if (!cell) continue;
          for (const id of cell) {
            if (this.marks[id] === this.markGeneration) continue;
            this.marks[id] = this.markGeneration;
            this.candidateIds.push(id);
          }
        }
      }
    }
  }
}
