import * as THREE from 'three';
import { PLANET_R, BRICK_SIZE, BRICK_H, STUD_R, STUD_H } from './constants';
import { Terrain } from './terrain';
import { QualityPreset } from './settings';
import { latLonToDir, dirToLatLon, tangentBasis, basisQuat, hash2, makeAOBox } from './util';

const MAX_LAND = 9500;
const MAX_STUDS = 12500;
const MAX_WATER = 1100;

const ANG_STEP = BRICK_SIZE / PLANET_R;
const LAT_LIMIT = 1.45;

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
  private water: THREE.InstancedMesh;

  private preset: QualityPreset;
  private lastRow = Number.MIN_SAFE_INTEGER;
  private lastCol = Number.MIN_SAFE_INTEGER;
  private cooldown = 0;
  private dirty = true;

  constructor(private terrain: Terrain, preset: QualityPreset) {
    this.preset = preset;

    const brickGeo = makeAOBox();
    const brickMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.34,
      metalness: 0.04
    });
    this.land = new THREE.InstancedMesh(brickGeo, brickMat, MAX_LAND);

    const studGeo = new THREE.CylinderGeometry(STUD_R, STUD_R, STUD_H, 10);
    const studMat = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.04 });
    this.studs = new THREE.InstancedMesh(studGeo, studMat, MAX_STUDS);

    const waterGeo = makeAOBox();
    const waterMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      color: 0xffffff,
      transparent: true,
      opacity: 0.62,
      roughness: 0.18,
      metalness: 0
    });
    this.water = new THREE.InstancedMesh(waterGeo, waterMat, MAX_WATER);

    for (const mesh of [this.land, this.studs, this.water]) {
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.group.add(mesh);
    }
    this.land.receiveShadow = true;
  }

  setQuality(preset: QualityPreset): void {
    this.preset = preset;
    this.dirty = true;
  }

  setShadows(enabled: boolean): void {
    this.land.castShadow = enabled;
  }

  update(dt: number, playerDir: THREE.Vector3): void {
    this.cooldown -= dt;
    if (this.cooldown > 0 && !this.dirty) return;

    const { lat, lon } = dirToLatLon(playerDir);
    const row = Math.floor((lat + Math.PI / 2) / ANG_STEP);
    const latC = -Math.PI / 2 + (row + 0.5) * ANG_STEP;
    const cols = Math.max(8, Math.round((2 * Math.PI * Math.cos(latC)) / ANG_STEP));
    const col = Math.floor((((lon % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / ((2 * Math.PI) / cols));

    const moved = Math.abs(row - this.lastRow) > 2 || Math.abs(col - this.lastCol) > 2;
    if (!moved && !this.dirty) {
      this.cooldown = 0.2;
      return;
    }

    this.lastRow = row;
    this.lastCol = col;
    this.dirty = false;
    this.cooldown = 0.25;
    this.rebuild(row, lon);
  }

  private rebuild(rowCenter: number, lonCenter: number): void {
    const { fieldN, studN, waterN } = this.preset;
    const terrain = this.terrain;

    let li = 0;
    let si = 0;
    let wi = 0;

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

        tmpUp.copy(tmpDir);
        tangentBasis(tmpUp, tmpEast, tmpNorth);
        basisQuat(tmpEast, tmpUp, tmpNorth, tmpQuat);

        if (h > 0.6) {
          if (li >= MAX_LAND) continue;
          const hq = Math.ceil(h / BRICK_H) * BRICK_H;
          tmpPos.copy(tmpDir).multiplyScalar(PLANET_R + hq - BRICK_H / 2);
          tmpScale.set(cellW * 1.03, BRICK_H, cellD * 1.03);
          tmpMat.compose(tmpPos, tmpQuat, tmpScale);
          this.land.setMatrixAt(li, tmpMat);

          terrain.colorAt(tmpDir, h, tmpCol);
          tmpCol.multiplyScalar(0.92 + hash2(row, c) * 0.16);
          this.land.setColorAt(li, tmpCol);
          li++;

          if (studN > 0 && Math.abs(dr) <= studN && Math.abs(dc) <= studN && si + 4 <= MAX_STUDS) {
            const topR = PLANET_R + hq + STUD_H / 2;
            for (let sx = -1; sx <= 1; sx += 2) {
              for (let sz = -1; sz <= 1; sz += 2) {
                tmpPos
                  .copy(tmpDir)
                  .multiplyScalar(topR)
                  .addScaledVector(tmpEast, (sx * cellW) / 4)
                  .addScaledVector(tmpNorth, (sz * cellD) / 4);
                tmpScale.set(1, 1, 1);
                tmpMat.compose(tmpPos, tmpQuat, tmpScale);
                this.studs.setMatrixAt(si, tmpMat);
                this.studs.setColorAt(si, tmpCol);
                si++;
              }
            }
          }
        } else if (Math.abs(dr) <= waterN && Math.abs(dc) <= waterN && wi < MAX_WATER) {
          tmpPos.copy(tmpDir).multiplyScalar(PLANET_R + 0.2);
          tmpScale.set(cellW * 1.02, 2.4, cellD * 1.02);
          tmpMat.compose(tmpPos, tmpQuat, tmpScale);
          this.water.setMatrixAt(wi, tmpMat);
          const shade = 0.9 + hash2(row, c) * 0.2;
          tmpCol.setRGB(0.24 * shade, 0.55 * shade, 0.95 * shade);
          this.water.setColorAt(wi, tmpCol);
          wi++;
        }
      }
    }

    this.land.count = li;
    this.studs.count = si;
    this.water.count = wi;
    this.land.instanceMatrix.needsUpdate = true;
    this.studs.instanceMatrix.needsUpdate = true;
    this.water.instanceMatrix.needsUpdate = true;
    if (this.land.instanceColor) this.land.instanceColor.needsUpdate = true;
    if (this.studs.instanceColor) this.studs.instanceColor.needsUpdate = true;
    if (this.water.instanceColor) this.water.instanceColor.needsUpdate = true;
  }
}
