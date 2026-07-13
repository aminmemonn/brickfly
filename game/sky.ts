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

/**
 * A hand-drawn sun: white-hot core, warm corona and twelve soft rays, so the
 * star reads as an actual celestial body instead of a shader smudge.
 */
function sunTexture(): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const c = S / 2;

  ctx.save();
  ctx.translate(c, c);
  for (let i = 0; i < 12; i++) {
    ctx.rotate(Math.PI / 6);
    const ray = ctx.createLinearGradient(0, 0, S * 0.48, 0);
    ray.addColorStop(0, 'rgba(255, 238, 190, 0.30)');
    ray.addColorStop(1, 'rgba(255, 238, 190, 0)');
    ctx.fillStyle = ray;
    ctx.beginPath();
    ctx.moveTo(0, -S * 0.018);
    ctx.lineTo(S * 0.48, -S * 0.055);
    ctx.lineTo(S * 0.48, S * 0.055);
    ctx.lineTo(0, S * 0.018);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  const halo = ctx.createRadialGradient(c, c, 0, c, c, S * 0.5);
  halo.addColorStop(0, 'rgba(255, 255, 255, 1)');
  halo.addColorStop(0.16, 'rgba(255, 246, 210, 0.96)');
  halo.addColorStop(0.3, 'rgba(255, 216, 132, 0.45)');
  halo.addColorStop(0.55, 'rgba(255, 182, 92, 0.15)');
  halo.addColorStop(1, 'rgba(255, 160, 70, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(c, c, S * 0.5, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

/** A soft horizontal streak used for shooting stars. */
function streakTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 32;
  const ctx = cv.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.75, 'rgba(220,235,255,0.55)');
  grad.addColorStop(0.97, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 10, 256, 12);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

interface ShootingStar {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  vel: THREE.Vector3;
  life: number;
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

  // The drawn sun sprite carries the disc itself; the shader only supplies
  // the atmospheric glow around it.
  float sunDot = max(dot(vDir, uSun), 0.0);
  vec3 sunColor = mix(vec3(1.0, 0.97, 0.9), vec3(1.0, 0.58, 0.28), uGolden);
  col += sunColor * pow(sunDot, 350.0) * 1.2 * max(uDay, 0.08);
  col += sunColor * pow(sunDot, 9.0) * 0.3 * max(uDay, 0.05);

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
  private sunSprite: THREE.Sprite;
  private sunMat: THREE.SpriteMaterial;
  private shooters: ShootingStar[] = [];
  private shootTimer = 3;
  private time = 4;
  // Photo mode: ?night pins the world to full night (stargazing, screenshots).
  private forceNight = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('night');

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

    // The sun itself: an additive drawn sprite that swells and warms at the
    // golden hour.
    this.sunMat = new THREE.SpriteMaterial({
      map: sunTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false
    });
    this.sunSprite = new THREE.Sprite(this.sunMat);
    this.sunSprite.frustumCulled = false;
    this.sunSprite.renderOrder = -8;
    this.group.add(this.sunSprite);

    // A small pool of shooting stars that streak across clear nights.
    const streakTex = streakTexture();
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: streakTex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SKY_RADIUS * 0.14, SKY_RADIUS * 0.008), mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = -8;
      this.group.add(mesh);
      this.shooters.push({ mesh, mat, vel: new THREE.Vector3(), life: 0 });
    }
  }

  /** Launch one pooled shooting star from a random point high in the sky. */
  private spawnShooter(playerUp: THREE.Vector3): void {
    const idle = this.shooters.find((s) => s.life <= 0);
    if (!idle) return;
    const dir = new THREE.Vector3().randomDirection();
    if (dir.dot(playerUp) < 0.3) dir.negate();
    if (dir.dot(playerUp) < 0.3) return; // grazing spawn — skip this cycle
    idle.mesh.position.copy(dir).multiplyScalar(SKY_RADIUS * 0.86);
    idle.vel.randomDirection().cross(dir).normalize().multiplyScalar(SKY_RADIUS * (0.45 + Math.random() * 0.3));
    idle.life = 0.9;
    idle.mesh.visible = true;
  }

  update(dt: number, camPos: THREE.Vector3, playerUp: THREE.Vector3): void {
    // Nights pass faster than days so the world spends most time lit.
    this.time += dt * (this.dayMix < 0.25 ? 2.4 : 1);
    const angle = (this.time / DAY_LENGTH) * Math.PI * 2;
    this.sunDir.set(Math.cos(angle), 0.22, Math.sin(angle)).normalize();

    const sunUp = this.sunDir.dot(playerUp);
    this.dayMix = smoothstep(-0.14, 0.24, sunUp);
    this.golden = clamp(1 - Math.abs(sunUp) * 3.2, 0, 1) * this.dayMix;
    if (this.forceNight) {
      this.dayMix = 0;
      this.golden = 0;
    }

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

    // The drawn sun: swells and reddens toward the horizon at golden hour.
    this.sunSprite.position.copy(this.sunDir).multiplyScalar(SKY_RADIUS * 0.88);
    const sunSize = SKY_RADIUS * 0.15 * (1 + this.golden * 0.85);
    this.sunSprite.scale.set(sunSize, sunSize, 1);
    this.sunMat.color.setHex(0xffffff).lerp(SUN_GOLDEN, this.golden * 0.85);
    this.sunMat.opacity = clamp(this.dayMix * 1.4, 0, 1);

    // Shooting stars streak across deep night.
    if (night > 0.55) {
      this.shootTimer -= dt;
      if (this.shootTimer <= 0) {
        this.shootTimer = 2.5 + Math.random() * 5;
        this.spawnShooter(playerUp);
      }
    }
    for (const s of this.shooters) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.mesh.visible = false;
        s.mat.opacity = 0;
        continue;
      }
      s.mesh.position.addScaledVector(s.vel, dt);
      // Long axis along the motion, face angled back toward the viewer.
      shootX.copy(s.vel).normalize();
      shootZ.copy(s.mesh.position).multiplyScalar(-1).normalize();
      shootZ.addScaledVector(shootX, -shootX.dot(shootZ)).normalize();
      shootY.crossVectors(shootZ, shootX);
      shootMat.makeBasis(shootX, shootY, shootZ);
      s.mesh.quaternion.setFromRotationMatrix(shootMat);
      s.mat.opacity = Math.sin((s.life / 0.9) * Math.PI) * night;
    }
  }
}

const SUN_GOLDEN = new THREE.Color(0xff8a4a);
const shootX = new THREE.Vector3();
const shootY = new THREE.Vector3();
const shootZ = new THREE.Vector3();
const shootMat = new THREE.Matrix4();
