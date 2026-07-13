import * as THREE from 'three';
import { BRICK_ASPECT, BRICK_H, BRICK_SIZE, PLANET_R, STUD_H, STUD_LOD_DISTANCE } from './constants';
import { Terrain } from './terrain';
import { QualityPreset } from './settings';
import { latLonToDir, dirToLatLon, tangentBasis, basisQuat, hash2 } from './util';
import {
  ABS_BRICK_MATERIAL,
  ABS_STUD_MATERIAL,
  makeABSBrickGeometry,
  makeABSStudGeometry,
  makeStudGridAttribute
} from './brick-material';

const MAX_LAND = 9500;
const MAX_STUDS = 12500;
const MAX_FAR = 7500;

const ANG_STEP = BRICK_SIZE / PLANET_R;
// Far tier: one coarse slab stands in for a 5x5 patch of bricks, pushing the
// voxel horizon from ~440 to ~2000+ units so fast flight never outruns it.
const FAR_MULT = 5;
const ANG_STEP_FAR = ANG_STEP * FAR_MULT;
// Far slabs sit fractionally lower than true brick tops so the fine tier
// always wins where the two overlap (no z-fighting at the seam).
const FAR_SINK = 1.2;
const LAT_LIMIT = 1.45;
const BRICK_GAP = 0.14;
// Includes enough travel headroom for the near-field rebuild cadence at the
// simulator's maximum speed, while physical visibility ends exactly at 200.
const STUD_GEOMETRY_RADIUS = STUD_LOD_DISTANCE + 60;

const tmpDir = new THREE.Vector3();
const tmpUp = new THREE.Vector3();
const tmpEast = new THREE.Vector3();
const tmpNorth = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpMat = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const tmpCol = new THREE.Color();

/**
 * Near-field voxel terrain: a stable global lat/lon brick grid, instanced
 * around the player and rebuilt as the player moves between cells.
 */
export class BrickField {
  readonly group = new THREE.Group();

  private land: THREE.InstancedMesh;
  private studs: THREE.InstancedMesh;
  private farLand: THREE.InstancedMesh;
  private studGrid: THREE.InstancedBufferAttribute;

  private preset: QualityPreset;
  private lastRow = Number.MIN_SAFE_INTEGER;
  private lastCol = Number.MIN_SAFE_INTEGER;
  private lastFarRow = Number.MIN_SAFE_INTEGER;
  private lastFarCol = Number.MIN_SAFE_INTEGER;
  private cooldown = 0;
  private farCooldown = 0;
  private dirty = true;
  private farDirty = true;
  private studsWereNear = false;

  constructor(private terrain: Terrain, preset: QualityPreset) {
    this.preset = preset;

    const brickGeo = makeABSBrickGeometry();
    this.studGrid = makeStudGridAttribute(MAX_LAND);
    brickGeo.setAttribute('instanceStudGrid', this.studGrid);
    this.land = new THREE.InstancedMesh(brickGeo, ABS_BRICK_MATERIAL, MAX_LAND);

    this.studs = new THREE.InstancedMesh(makeABSStudGeometry(), ABS_STUD_MATERIAL, MAX_STUDS);

    // Coarse slabs never show stud normals — they live beyond the LOD range.
    const farGeo = makeABSBrickGeometry();
    farGeo.setAttribute('instanceStudGrid', makeStudGridAttribute(MAX_FAR));
    this.farLand = new THREE.InstancedMesh(farGeo, ABS_BRICK_MATERIAL, MAX_FAR);

    for (const mesh of [this.land, this.studs, this.farLand]) {
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.group.add(mesh);
    }
    this.land.receiveShadow = true;
    this.studs.receiveShadow = true;
    this.farLand.receiveShadow = true;
  }

  setQuality(preset: QualityPreset): void {
    this.preset = preset;
    this.dirty = true;
    this.farDirty = true;
  }

  setShadows(enabled: boolean): void {
    this.land.castShadow = enabled;
    this.studs.castShadow = enabled;
  }

  update(dt: number, playerDir: THREE.Vector3, cameraPosition: THREE.Vector3): void {
    this.cooldown -= dt;
    this.farCooldown -= dt;
    const studsNear = cameraPosition.length() - PLANET_R < STUD_GEOMETRY_RADIUS + BRICK_H * 3;
    if (studsNear !== this.studsWereNear) {
      this.studsWereNear = studsNear;
      this.dirty = true;
    }

    const { lat, lon } = dirToLatLon(playerDir);
    let rebuiltNear = false;

    if (this.cooldown <= 0 || this.dirty) {
      const row = Math.floor((lat + Math.PI / 2) / ANG_STEP);
      const latC = -Math.PI / 2 + (row + 0.5) * ANG_STEP;
      const cols = Math.max(8, Math.round((2 * Math.PI * Math.cos(latC)) / ANG_STEP));
      const col = Math.floor((((lon % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / ((2 * Math.PI) / cols));

      const moved = Math.abs(row - this.lastRow) > 2 || Math.abs(col - this.lastCol) > 2;
      if (moved || this.dirty) {
        this.lastRow = row;
        this.lastCol = col;
        this.dirty = false;
        this.cooldown = this.studsWereNear ? 0.08 : 0.16;
        this.rebuild(row, lon, cameraPosition);
        rebuiltNear = true;
      } else {
        this.cooldown = 0.15;
      }
    }

    // The far tier rebuilds on its own slower cadence and never in the same
    // frame as the near tier, so the worst-case CPU spike stays bounded.
    if (!rebuiltNear && (this.farCooldown <= 0 || this.farDirty)) {
      const rowF = Math.floor((lat + Math.PI / 2) / ANG_STEP_FAR);
      const latF = -Math.PI / 2 + (rowF + 0.5) * ANG_STEP_FAR;
      const colsF = Math.max(8, Math.round((2 * Math.PI * Math.cos(latF)) / ANG_STEP_FAR));
      const colF = Math.floor((((lon % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / ((2 * Math.PI) / colsF));

      const movedF = Math.abs(rowF - this.lastFarRow) > 1 || Math.abs(colF - this.lastFarCol) > 1;
      if (movedF || this.farDirty) {
        this.lastFarRow = rowF;
        this.lastFarCol = colF;
        this.farDirty = false;
        this.farCooldown = 0.6;
        this.rebuildFar(rowF, lon);
      } else {
        this.farCooldown = 0.2;
      }
    }
  }

  /** Coarse slab terrain from the fine field's edge out to the haze. */
  private rebuildFar(rowCenter: number, lonCenter: number): void {
    const { farN } = this.preset;
    const terrain = this.terrain;

    let fi = 0;
    for (let dr = -farN; dr <= farN; dr++) {
      const row = rowCenter + dr;
      const latC = -Math.PI / 2 + (row + 0.5) * ANG_STEP_FAR;
      if (Math.abs(latC) > LAT_LIMIT) continue;

      const cols = Math.max(8, Math.round((2 * Math.PI * Math.cos(latC)) / ANG_STEP_FAR));
      const lonStep = (2 * Math.PI) / cols;
      const colCenter = Math.floor((((lonCenter % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / lonStep);
      const k = Math.min(farN, Math.floor(cols / 2));

      const cellW = lonStep * Math.cos(latC) * PLANET_R;
      const cellD = ANG_STEP_FAR * PLANET_R;

      for (let dc = -k; dc <= k; dc++) {
        const c = (((colCenter + dc) % cols) + cols) % cols;
        const lonC = (c + 0.5) * lonStep;
        latLonToDir(latC, lonC, tmpDir);
        const h = terrain.height(tmpDir);
        if (h <= 0.6) continue;
        if (fi >= MAX_FAR) continue;

        tmpUp.copy(tmpDir);
        tangentBasis(tmpUp, tmpEast, tmpNorth);
        basisQuat(tmpEast, tmpUp, tmpNorth, tmpQuat);

        const hq = Math.ceil(h / BRICK_H) * BRICK_H;
        const slabW = Math.max(0.1, cellW - BRICK_GAP * 2);
        const slabD = Math.max(0.1, cellD - BRICK_GAP * 2);
        const bodyH = Math.min(slabW, slabD) / BRICK_ASPECT;
        tmpPos.copy(tmpDir).multiplyScalar(PLANET_R + hq - FAR_SINK - bodyH / 2);
        tmpScale.set(slabW, bodyH, slabD);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        this.farLand.setMatrixAt(fi, tmpMat);

        terrain.colorAt(tmpDir, h, tmpCol);
        tmpCol.multiplyScalar(0.98 + hash2(row, c) * 0.08);
        this.farLand.setColorAt(fi, tmpCol);
        fi++;
      }
    }

    this.farLand.count = fi;
    this.farLand.instanceMatrix.needsUpdate = true;
    if (this.farLand.instanceColor) this.farLand.instanceColor.needsUpdate = true;
  }

  private rebuild(rowCenter: number, lonCenter: number, cameraPosition: THREE.Vector3): void {
    const { fieldN, studs: studsEnabled } = this.preset;
    const terrain = this.terrain;

    let li = 0;
    let si = 0;

    for (let dr = -fieldN; dr <= fieldN; dr++) {
      const row = rowCenter + dr;
      const latC = -Math.PI / 2 + (row + 0.5) * ANG_STEP;
      if (Math.abs(latC) > LAT_LIMIT) continue;

      const cols = Math.max(8, Math.round((2 * Math.PI * Math.cos(latC)) / ANG_STEP));
      const lonStep = (2 * Math.PI) / cols;
      const colCenter = Math.floor((((lonCenter % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / lonStep);
      const k = Math.min(fieldN, Math.floor(cols / 2));

      const cellW = lonStep * Math.cos(latC) * PLANET_R;
      const cellD = ANG_STEP * PLANET_R;

      for (let dc = -k; dc <= k; dc++) {
        const c = (((colCenter + dc) % cols) + cols) % cols;
        const lonC = (c + 0.5) * lonStep;
        latLonToDir(latC, lonC, tmpDir);
        const h = terrain.height(tmpDir);
        if (h <= 0.6) continue;
        if (li >= MAX_LAND) continue;

        tmpUp.copy(tmpDir);
        tangentBasis(tmpUp, tmpEast, tmpNorth);
        basisQuat(tmpEast, tmpUp, tmpNorth, tmpQuat);

        const hq = Math.ceil(h / BRICK_H) * BRICK_H;
        // A narrow physical seam is essential: overlapping the old bricks by
        // 3% fused the entire field into one continuous slab. The visible body
        // keeps the requested 1.6:1 mould proportion inside its grid pitch.
        const brickW = Math.max(0.1, cellW - BRICK_GAP);
        const brickD = Math.max(0.1, cellD - BRICK_GAP);
        const bodyH = Math.min(brickW, brickD) / BRICK_ASPECT;
        tmpPos.copy(tmpDir).multiplyScalar(PLANET_R + hq - bodyH / 2);
        tmpScale.set(brickW, bodyH, brickD);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        this.land.setMatrixAt(li, tmpMat);

        terrain.colorAt(tmpDir, h, tmpCol);
        tmpCol.multiplyScalar(0.98 + hash2(row, c) * 0.08);
        this.land.setColorAt(li, tmpCol);
        this.studGrid.setXY(li, studsEnabled ? 2 : 0, studsEnabled ? 2 : 0);
        li++;

        // Actual cylinders exist only in a circular 200-unit camera volume.
        // The body shader cross-fades to its procedural stud normal outside it.
        const studTopCenter = tmpPos.copy(tmpDir).multiplyScalar(PLANET_R + hq + STUD_H / 2);
        if (
          studsEnabled &&
          studTopCenter.distanceToSquared(cameraPosition) <= STUD_GEOMETRY_RADIUS * STUD_GEOMETRY_RADIUS &&
          si + 4 <= MAX_STUDS
        ) {
          const topR = PLANET_R + hq + STUD_H / 2;
          for (let sx = -1; sx <= 1; sx += 2) {
            for (let sz = -1; sz <= 1; sz += 2) {
              tmpPos
                .copy(tmpDir)
                .multiplyScalar(topR)
                .addScaledVector(tmpEast, (sx * brickW) / 4)
                .addScaledVector(tmpNorth, (sz * brickD) / 4);
              tmpScale.set(1, 1, 1);
              tmpMat.compose(tmpPos, tmpQuat, tmpScale);
              this.studs.setMatrixAt(si, tmpMat);
              this.studs.setColorAt(si, tmpCol);
              si++;
            }
          }
        }
      }
    }

    this.land.count = li;
    this.studs.count = si;
    this.land.instanceMatrix.needsUpdate = true;
    this.studs.instanceMatrix.needsUpdate = true;
    this.studGrid.needsUpdate = true;
    if (this.land.instanceColor) this.land.instanceColor.needsUpdate = true;
    if (this.studs.instanceColor) this.studs.instanceColor.needsUpdate = true;
  }
}
