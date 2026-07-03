import * as THREE from 'three';
import { PLANET_R } from './constants';

/** Translucent global ocean with a gentle vertex-wave animation. */
export class Water {
  readonly mesh: THREE.Mesh;
  private shader: { uniforms: { uTime: { value: number } } } | null = null;

  constructor() {
    const geo = new THREE.SphereGeometry(PLANET_R + 0.5, 128, 72);
    const mat = new THREE.MeshPhongMaterial({
      color: 0x2b7fe0,
      transparent: true,
      opacity: 0.8,
      shininess: 110,
      specular: 0x9fccff
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          [
            '#include <begin_vertex>',
            'float wave = sin(uTime * 1.6 + position.x * 0.021) * 0.5',
            '  + cos(uTime * 1.1 + position.z * 0.019 + position.y * 0.016) * 0.5;',
            'transformed += normal * wave * 0.9;'
          ].join('\n')
        );
      this.shader = shader as unknown as { uniforms: { uTime: { value: number } } };
    };

    this.mesh = new THREE.Mesh(geo, mat);
  }

  update(t: number): void {
    if (this.shader) this.shader.uniforms.uTime.value = t;
  }
}
