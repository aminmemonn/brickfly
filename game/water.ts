import * as THREE from 'three';
import { PLANET_R } from './constants';
import { Terrain } from './terrain';

const VERT = /* glsl */ `
attribute float depth;
uniform float uTime;
varying float vDepth;
varying vec3 vNormal;
varying vec3 vWorldPos;

void main() {
  vDepth = depth;
  vec3 p = position;
  float w1 = sin(uTime * 1.4 + position.x * 0.015 + position.z * 0.011);
  float w2 = cos(uTime * 1.1 + position.y * 0.017 + position.x * 0.009);
  p += normal * (w1 + w2) * 1.2;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uSun;
uniform float uDay;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
varying float vDepth;
varying vec3 vNormal;
varying vec3 vWorldPos;

void main() {
  // Only draw real ocean. vDepth encodes sea-floor depth (min ~0.015 over land);
  // discarding the shallow band keeps water off the land and away from the
  // shoreline where it would otherwise z-fight the terrain into blue squares.
  if (vDepth < 0.03) discard;

  vec3 shallow = vec3(0.22, 0.76, 0.70);
  vec3 mid = vec3(0.10, 0.47, 0.80);
  vec3 deep = vec3(0.03, 0.22, 0.52);

  float d = clamp(vDepth, 0.0, 1.0);
  vec3 col = d < 0.4 ? mix(shallow, mid, d / 0.4) : mix(mid, deep, (d - 0.4) / 0.6);

  // Drifting wave crests, denser in the shallows
  float band = sin(vWorldPos.x * 0.05 + uTime * 1.7)
    * sin(vWorldPos.z * 0.047 - uTime * 1.25)
    * sin(vWorldPos.y * 0.043 + uTime * 1.05);
  float crest = smoothstep(0.55, 0.95, band);
  col += vec3(1.0) * crest * 0.14 * (1.0 - d * 0.65);

  // Coastline foam
  float foam = smoothstep(0.09, 0.015, d);
  float foamBand = sin(vWorldPos.x * 0.22 + uTime * 2.2) * sin(vWorldPos.z * 0.2 - uTime * 1.8);
  col += vec3(1.0) * foam * (0.22 + 0.2 * smoothstep(0.2, 0.9, foamBand));

  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);

  // Fresnel toward a pale sky tint
  float fres = pow(1.0 - max(dot(V, N), 0.0), 3.0);
  col = mix(col, vec3(0.62, 0.82, 1.0), fres * 0.4);

  // Sun glints
  vec3 R = reflect(-uSun, N);
  float spec = pow(max(dot(R, V), 0.0), 90.0);
  col += vec3(1.0, 0.93, 0.78) * spec * 0.85 * uDay;

  col *= 0.16 + 0.84 * uDay;

  float fogF = smoothstep(uFogNear, uFogFar, length(cameraPosition - vWorldPos));
  col = mix(col, uFogColor, fogF);

  float alpha = mix(0.5, 0.93, pow(d, 0.5));
  gl_FragColor = vec4(col, alpha);
}
`;

/**
 * Stylized ocean: depth-tinted colors sampled from the sea floor, animated
 * swell, drifting crests, coastal foam, fresnel and sun glints.
 */
export class Water {
  readonly mesh: THREE.Mesh;
  private uniforms: {
    uTime: { value: number };
    uSun: { value: THREE.Vector3 };
    uDay: { value: number };
    uFogColor: { value: THREE.Color };
    uFogNear: { value: number };
    uFogFar: { value: number };
  };

  constructor(terrain: Terrain) {
    // Deliberately NOT the globe's exact tessellation: sharing vertices makes the
    // two spheres z-fight into a checkered grid wherever land sits near sea level.
    // Instead the fragment shader discards water over land, so the coastline is a
    // clean per-fragment boundary and this mesh only ever paints real ocean.
    const geo = new THREE.SphereGeometry(PLANET_R + 1, 256, 144);
    const pos = geo.attributes.position;
    const depths = new Float32Array(pos.count);
    const dir = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      dir.fromBufferAttribute(pos, i).normalize();
      depths[i] = Math.min(1, Math.max(0.015, -terrain.rawHeight(dir) / 110));
    }
    geo.setAttribute('depth', new THREE.BufferAttribute(depths, 1));

    this.uniforms = {
      uTime: { value: 0 },
      uSun: { value: new THREE.Vector3(1, 0, 0) },
      uDay: { value: 1 },
      uFogColor: { value: new THREE.Color(0xbfe3ff) },
      uFogNear: { value: 1400 },
      uFogFar: { value: 9000 }
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true
    });

    this.mesh = new THREE.Mesh(geo, mat);
  }

  update(
    t: number,
    sunDir: THREE.Vector3,
    dayMix: number,
    fogColor: THREE.Color,
    fogNear: number,
    fogFar: number
  ): void {
    this.uniforms.uTime.value = t;
    this.uniforms.uSun.value.copy(sunDir);
    this.uniforms.uDay.value = dayMix;
    this.uniforms.uFogColor.value.copy(fogColor);
    this.uniforms.uFogNear.value = fogNear;
    this.uniforms.uFogFar.value = fogFar;
  }
}
