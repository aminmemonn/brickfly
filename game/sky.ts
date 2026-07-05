import * as THREE from 'three';
import { DAY_LENGTH } from './constants';
import { clamp, lerp, smoothstep } from './util';

const SKY_RADIUS = 36000;

// Fixed sky direction for the Andromeda galaxy.
const GALAXY_DIR = new THREE.Vector3(-0.55, 0.5, -0.67).normalize();

/**
 * Paint a soft spiral galaxy: a bright core, a couple of sweeping arms, and a
 * dusting of stars, on a transparent canvas so it reads as a glowing patch of
 * sky rather than a hard disc.
 */
function galaxyTexture(): THREE.CanvasTexture {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const cx = S / 2;
  const cy = S / 2;

  // Faint elliptical halo.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, 0.5);
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, S * 0.48);
  halo.addColorStop(0, 'rgba(214, 226, 255, 0.85)');
  halo.addColorStop(0.28, 'rgba(150, 170, 255, 0.45)');
  halo.addColorStop(0.6, 'rgba(120, 110, 210, 0.16)');
  halo.addColorStop(1, 'rgba(90, 80, 160, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, S * 0.48, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Spiral arms drawn as fading star specks along logarithmic curves.
  for (let arm = 0; arm < 2; arm++) {
    const base = arm * Math.PI;
    for (let i = 0; i < 900; i++) {
      const t = i / 900;
      const ang = base + t * Math.PI * 3.2;
      const rad = t * S * 0.46;
      const jitter = (Math.random() - 0.5) * rad * 0.16;
      const x = cx + Math.cos(ang) * (rad + jitter);
      const y = cy + Math.sin(ang) * (rad + jitter) * 0.5;
      const a = (1 - t) * 0.7 * Math.random();
      const shade = 200 + Math.floor(Math.random() * 55);
      ctx.fillStyle = `rgba(${shade}, ${shade}, 255, ${a})`;
      const sz = Math.random() * 1.8 + 0.4;
      ctx.fillRect(x, y, sz, sz);
    }
  }

  // Bright core.
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.12);
  core.addColorStop(0, 'rgba(255, 252, 240, 0.95)');
  core.addColorStop(0.5, 'rgba(255, 236, 200, 0.5)');
  core.addColorStop(1, 'rgba(255, 220, 180, 0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, S * 0.12, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(cv);
  tex.center.set(0.5, 0.5);
  tex.needsUpdate = true;
  return tex;
}

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uUp;
uniform vec3 uSun;
uniform float uDay;
uniform float uGolden;
varying vec3 vDir;

void main() {
  float t = clamp(dot(vDir, uUp) * 0.5 + 0.5, 0.0, 1.0);

  vec3 dayZenith = vec3(0.24, 0.545, 0.91);
  vec3 dayHorizon = vec3(0.75, 0.89, 1.0);
  vec3 nightZenith = vec3(0.016, 0.03, 0.09);
  vec3 nightHorizon = vec3(0.05, 0.09, 0.19);

  vec3 zenith = mix(nightZenith, dayZenith, uDay);
  vec3 horizon = mix(nightHorizon, dayHorizon, uDay);
  horizon = mix(horizon, vec3(1.0, 0.62, 0.34), uGolden * 0.85);

  vec3 col = mix(horizon, zenith, pow(t, 1.35));

  float sunDot = max(dot(vDir, uSun), 0.0);
  vec3 sunColor = mix(vec3(1.0, 0.97, 0.9), vec3(1.0, 0.58, 0.28), uGolden);
  col += sunColor * pow(sunDot, 350.0) * 2.4 * max(uDay, 0.08);
  col += sunColor * pow(sunDot, 9.0) * 0.28 * max(uDay, 0.05);

  gl_FragColor = vec4(col, 1.0);
}
`;

export class Sky {
  readonly group = new THREE.Group();
  readonly sunDir = new THREE.Vector3(1, 0.2, 0).normalize();
  dayMix = 1;
  golden = 0;

  private dome: THREE.Mesh;
  private uniforms: {
    uUp: { value: THREE.Vector3 };
    uSun: { value: THREE.Vector3 };
    uDay: { value: number };
    uGolden: { value: number };
  };
  private stars: THREE.Points;
  private starsMat: THREE.PointsMaterial;
  private starsFar: THREE.Points;
  private starsFarMat: THREE.PointsMaterial;
  private moon: THREE.Mesh;
  private moonMat: THREE.MeshBasicMaterial;
  private moonGlow: THREE.Mesh;
  private moonGlowMat: THREE.MeshBasicMaterial;
  private galaxy: THREE.Mesh;
  private galaxyMat: THREE.MeshBasicMaterial;
  private time = 4;

  constructor() {
    this.uniforms = {
      uUp: { value: new THREE.Vector3(0, 1, 0) },
      uSun: { value: this.sunDir.clone() },
      uDay: { value: 1 },
      uGolden: { value: 0 }
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false
    });

    this.dome = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 32, 20), mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    this.group.add(this.dome);

    // Two star layers: many faint distant stars plus fewer big bright ones,
    // with a denser band to suggest a milky way.
    const makeStars = (count: number, radiusMul: number, band: boolean) => {
      const positions = new Float32Array(count * 3);
      const v = new THREE.Vector3();
      for (let i = 0; i < count; i++) {
        v.randomDirection();
        if (band) {
          // pull toward a great-circle band for a milky-way streak
          v.y *= 0.35;
          v.normalize();
        }
        v.multiplyScalar(SKY_RADIUS * radiusMul);
        positions[i * 3] = v.x;
        positions[i * 3 + 1] = v.y;
        positions[i * 3 + 2] = v.z;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      return geo;
    };

    this.starsFarMat = new THREE.PointsMaterial({
      color: 0xeef2ff,
      size: 3.2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.starsFar = new THREE.Points(makeStars(3400, 0.97, false), this.starsFarMat);
    this.starsFar.frustumCulled = false;
    this.starsFar.renderOrder = -9;
    this.group.add(this.starsFar);

    this.starsMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 6.5,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.stars = new THREE.Points(makeStars(1500, 0.95, true), this.starsMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -9;
    this.group.add(this.stars);

    // Moon: a bright pale disc opposite the sun, with a soft halo.
    this.moonMat = new THREE.MeshBasicMaterial({ color: 0xf3f0e2, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(300, 28, 18), this.moonMat);
    this.moon.frustumCulled = false;
    this.moon.renderOrder = -8;
    this.group.add(this.moon);

    this.moonGlowMat = new THREE.MeshBasicMaterial({
      color: 0xa9c2ff,
      transparent: true,
      opacity: 0,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false
    });
    this.moonGlow = new THREE.Mesh(new THREE.SphereGeometry(520, 24, 16), this.moonGlowMat);
    this.moonGlow.frustumCulled = false;
    this.moonGlow.renderOrder = -8;
    this.group.add(this.moonGlow);

    // Andromeda: a large glowing spiral fixed high in the night sky.
    this.galaxyMat = new THREE.MeshBasicMaterial({
      map: galaxyTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false
    });
    const galaxySize = SKY_RADIUS * 1.5;
    this.galaxy = new THREE.Mesh(new THREE.PlaneGeometry(galaxySize, galaxySize), this.galaxyMat);
    this.galaxy.position.copy(GALAXY_DIR).multiplyScalar(SKY_RADIUS * 0.92);
    this.galaxy.lookAt(0, 0, 0);
    this.galaxy.frustumCulled = false;
    this.galaxy.renderOrder = -9;
    this.group.add(this.galaxy);
  }

  update(dt: number, camPos: THREE.Vector3, playerUp: THREE.Vector3): void {
    // Nights pass faster than days so the world spends most time lit.
    this.time += dt * (this.dayMix < 0.25 ? 2.4 : 1);
    const angle = (this.time / DAY_LENGTH) * Math.PI * 2;
    this.sunDir.set(Math.cos(angle), 0.22, Math.sin(angle)).normalize();

    const sunUp = this.sunDir.dot(playerUp);
    this.dayMix = smoothstep(-0.14, 0.24, sunUp);
    this.golden = clamp(1 - Math.abs(sunUp) * 3.2, 0, 1) * this.dayMix;

    this.group.position.copy(camPos);
    this.uniforms.uUp.value.copy(camPos).normalize();
    this.uniforms.uSun.value.copy(this.sunDir);
    this.uniforms.uDay.value = this.dayMix;
    this.uniforms.uGolden.value = this.golden;
    const night = clamp(1 - this.dayMix * 1.6, 0, 1);
    // Stars ramp in strongly and early so dusk skies already sparkle.
    const starGlow = Math.pow(night, 0.6);
    this.starsFarMat.opacity = starGlow * 0.95;
    this.starsMat.opacity = starGlow;
    this.galaxyMat.opacity = starGlow * 0.9;
    const gmap = this.galaxyMat.map;
    if (gmap) gmap.rotation = this.time * 0.02;

    // Moon rides opposite the sun so it climbs as the sun sets.
    this.moon.position.copy(this.sunDir).multiplyScalar(-SKY_RADIUS * 0.9);
    this.moonGlow.position.copy(this.moon.position);
    const moonUp = clamp(-this.sunDir.dot(playerUp) + 0.3, 0, 1);
    this.moonMat.opacity = lerp(0.15, 1, night) * clamp(moonUp * 2, 0, 1);
    this.moonGlowMat.opacity = this.moonMat.opacity * 0.45;
  }
}
