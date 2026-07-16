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
const MAX_FAR = 10500;

const ANG_STEP = BRICK_SIZE / PLANET_R;
// Far tier: one coarse slab stands in for a 4x4 patch of bricks, pushing the
// voxel horizon from ~440 to ~2000 units so fast flight never outruns it. At
// cruise altitude almost everything in view is beyond the fine field, so the
// slab size directly sets how "bricky" the world reads from the air.
const FAR_MULT = 4;
const ANG_STEP_FAR = ANG_STEP * FAR_MULT;
// Far slabs sit fractionally lower than their own quantized top so they can
// never be coplanar with fine-tier brick tops (no z-fighting at the seam).
const FAR_SINK = 0.4;
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
  private farRowPrev = new Float32Array(0);

  constructor(private terrain: Terrain, preset: QualityPreset) {
    this.preset = preset;

    // Terrain bricks use softened mould-contact AO (0.45) so the ground reads
    // as a clean studded surface at grazing angles instead of a field of
    // dark-edged cubes; landmarks/settlements keep the default crisp AO.
    const TERRAIN_AO = 0.45;
    const brickGeo = makeABSBrickGeometry(TERRAIN_AO);
    this.studGrid = makeStudGridAttribute(MAX_LAND);
    brickGeo.setAttribute('instanceStudGrid', this.studGrid);
    this.land = new THREE.InstancedMesh(brickGeo, ABS_BRICK_MATERIAL, MAX_LAND);

    this.studs = new THREE.InstancedMesh(makeABSStudGeometry(), ABS_STUD_MATERIAL, MAX_STUDS);

    // Coarse slabs never show stud normals — they live beyond the LOD range.
    const farGeo = makeABSBrickGeometry(TERRAIN_AO);
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
        this.rebuildFar(rowF, lat, lon);
      } else {
        this.farCooldown = 0.2;
      }
    }
  }

  /** Coarse slab terrain from the fine field's edge out to the haze. */
  private rebuildFar(rowCenter: number, latCenter: number, lonCenter: number): void {
    const { farN, fieldN } = this.preset;
    const terrain = this.terrain;

    // Angular half-extents of the fine field: far cells fully under it are
    // skipped; cells on its rim get no slope padding so they stay tucked
    // beneath the fine bricks instead of poking up through them.
    const nearHalf = (fieldN - 2) * ANG_STEP;
    const rimHalf = (fieldN + 6) * ANG_STEP;

    const rowWidth = 2 * farN + 1;
    if (this.farRowPrev.length < rowWidth) this.farRowPrev = new Float32Array(rowWidth);
    const rowPrev = this.farRowPrev;
    rowPrev.fill(Number.NaN);

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
      const cosLat = Math.cos(latC);
      let hPrev = Number.NaN;

      for (let dc = -k; dc <= k; dc++) {
        const c = (((colCenter + dc) % cols) + cols) % cols;
        const lonC = (c + 0.5) * lonStep;
        latLonToDir(latC, lonC, tmpDir);
        const h = terrain.height(tmpDir);

        // Terrain slope estimated from the neighbours we already sampled.
        // A single centre sample under-reads a 40-unit cell on any slope and
        // the smooth globe pokes above the flat slab top at the cell's uphill
        // edge; padding the top by half the local relief closes that sliver
        // without lifting the surface enough to look inflated.
        const prevRowH = rowPrev[dc + farN];
        let pad = 0.5;
        if (Number.isFinite(hPrev)) pad = Math.max(pad, Math.abs(h - hPrev) * 0.55);
        if (Number.isFinite(prevRowH)) pad = Math.max(pad, Math.abs(h - prevRowH) * 0.55);
        pad = Math.min(pad, 14);
        rowPrev[dc + farN] = h;
        hPrev = h;

        if (h <= 0.6) continue;
        if (fi >= MAX_FAR) continue;

        let dl = lonC - lonCenter;
        dl = Math.atan2(Math.sin(dl), Math.cos(dl));
        const inNearLat = Math.abs(latC - latCenter) < nearHalf;
        if (inNearLat && Math.abs(dl) * cosLat < nearHalf) continue; // hidden under the fine field
        const onRim = Math.abs(latC - latCenter) < rimHalf && Math.abs(dl) * cosLat < rimHalf;
        if (onRim) pad = 0;

        tmpUp.copy(tmpDir);
        tangentBasis(tmpUp, tmpEast, tmpNorth);
        basisQuat(tmpEast, tmpUp, tmpNorth, tmpQuat);

        // No BRICK_H quantization out here. Rounding each 40-unit cell up to a
        // brick multiple stepped neighbouring slabs apart and, viewed at the
        // grazing angle of flight, the field read as a bumpy waffle of tiles
        // rather than solid ground. Following the smooth terrain height keeps
        // gentle land flat; genuine relief (hills, pyramids) still steps.
        const top = h + pad;
        // Overlap neighbours slightly instead of leaving a BRICK_GAP: the gap
        // showed as dark grid-lines from the air. Flat neighbours share a top
        // plane so the tiny overlap only ever z-fights near-identical greens.
        const slabW = cellW + 0.8;
        const slabD = cellD + 0.8;
        // Deep enough that a slab's underside always drops below its downhill
        // neighbour's top, so a height step never opens a see-through gap.
        const bodyH = Math.min(slabW, slabD) * 0.75 + pad + 20;
        tmpPos.copy(tmpDir).multiplyScalar(PLANET_R + top - FAR_SINK - bodyH / 2);
        tmpScale.set(slabW, bodyH, slabD);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        this.farLand.setMatrixAt(fi, tmpMat);

        terrain.colorAt(tmpDir, h, tmpCol);
        // Gentler per-cell shade jitter: 8% made each tile a visibly different
        // green, reinforcing the grid; 3% just breaks up dead-flat colour.
        tmpCol.multiplyScalar(0.995 + hash2(row, c) * 0.008);
        this.farLand.setColorAt(fi, tmpCol);
        fi++;
      }
    }

    this.farLand.count = fi;
    this.farLand.instanceMatrix.needsUpdate = true;
    if (this.farLand.instanceColor) this.farLand.instanceColor.needsUpdate = true;
    this.publishDebug();
  }

  /** Live instance counts for the verification harness (window.__bf). */
  private publishDebug(): void {
    if (typeof window !== 'undefined') {
      (window as unknown as { __bf?: object }).__bf = {
        near: this.land.count,
        studs: this.studs.count,
        far: this.farLand.count
      };
    }
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

        // Follow the smooth terrain height instead of rounding up to a BRICK_H
        // step. The rounding stair-stepped adjacent rows; at the grazing angle
        // of low flight each step's vertical face read as a dark band, so the
        // ground looked like combed corduroy rather than solid brick. Studs,
        // grid seams and colour keep the brick identity without the stepping.
        const top = h;
        // Bricks touch (slight overlap) rather than leaving a BRICK_GAP: the
        // gap exposed a dark side-lip on every brick that compounded into
        // grazing-angle noise. Flush tops read as one clean studded surface.
        const brickW = cellW + 0.1;
        const brickD = cellD + 0.1;
        // Body carries the 1.6:1 brick face plus extra depth to bury the height
        // step to a downhill neighbour, so a slope never opens a see-through gap.
        const bodyH = Math.min(brickW, brickD) / BRICK_ASPECT + 12;
        tmpPos.copy(tmpDir).multiplyScalar(PLANET_R + top - bodyH / 2);
        tmpScale.set(brickW, bodyH, brickD);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        this.land.setMatrixAt(li, tmpMat);

        terrain.colorAt(tmpDir, h, tmpCol);
        // Gentle 3% shade jitter; 8% made each brick a visibly different green
        // and reinforced the grid pattern at a distance.
        tmpCol.multiplyScalar(0.995 + hash2(row, c) * 0.008);
        this.land.setColorAt(li, tmpCol);
        this.studGrid.setXY(li, studsEnabled ? 2 : 0, studsEnabled ? 2 : 0);
        li++;

        // Actual cylinders exist only in a circular 200-unit camera volume.
        // The body shader cross-fades to its procedural stud normal outside it.
        const studTopCenter = tmpPos.copy(tmpDir).multiplyScalar(PLANET_R + top + STUD_H / 2);
        if (
          studsEnabled &&
          studTopCenter.distanceToSquared(cameraPosition) <= STUD_GEOMETRY_RADIUS * STUD_GEOMETRY_RADIUS &&
          si + 4 <= MAX_STUDS
        ) {
          const topR = PLANET_R + top + STUD_H / 2;
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
    this.publishDebug();
  }
}
