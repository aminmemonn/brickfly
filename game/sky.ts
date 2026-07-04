import * as THREE from 'three';
import { DAY_LENGTH } from './constants';
import { clamp, lerp, smoothstep } from './util';

const SKY_RADIUS = 12000;

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

    const starCount = 900;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(SKY_RADIUS * 0.96);
      positions[i * 3] = v.x;
      positions[i * 3 + 1] = v.y;
      positions[i * 3 + 2] = v.z;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.starsMat = new THREE.PointsMaterial({
      color: 0xdfe8ff,
      size: 16,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false
    });
    this.stars = new THREE.Points(starGeo, this.starsMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -9;
    this.group.add(this.stars);
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
    this.starsMat.opacity = lerp(0.9, 0, this.dayMix);
  }
}
