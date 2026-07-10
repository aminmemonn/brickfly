import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { STUD_H, STUD_LOD_DISTANCE, STUD_R } from './constants';

/**
 * The visual constants in this module describe injection-moulded ABS, not a
 * generic PBR surface. Keeping them here also stops the cloud/prop materials
 * from inheriting brick-only shading changes.
 */
const ABS_SHININESS = 96;
const STUD_FADE_START = STUD_LOD_DISTANCE - 28;

const absLightUniforms = {
  uKeyDirection: { value: new THREE.Vector3(0.35, 0.82, 0.45).normalize() },
  uKeyColor: { value: new THREE.Color(0xffd29b) },
  uKeyIntensity: { value: 2.1 },
  uFillDirection: { value: new THREE.Vector3(-0.45, 0.35, -0.82).normalize() },
  uFillColor: { value: new THREE.Color(0x9ec9ff) },
  uFillIntensity: { value: 0.63 },
  uAmbientColor: { value: new THREE.Color(0x536275).multiplyScalar(0.32) },
  uShininess: { value: ABS_SHININESS },
  uStudFadeStart: { value: STUD_FADE_START },
  uStudFadeEnd: { value: STUD_LOD_DISTANCE }
};

const vertexShader = /* glsl */ `
  #include <common>
  #include <color_pars_vertex>
  #include <fog_pars_vertex>
  #include <shadowmap_pars_vertex>

  #ifdef ABS_DISTANT_STUDS
    #ifdef USE_INSTANCING
      attribute vec2 instanceStudGrid;
    #endif
  #endif

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vWorldTangent;
  varying vec3 vLocalPosition;
  varying vec3 vLocalNormal;

  #ifdef ABS_DISTANT_STUDS
    varying vec2 vStudGrid;
  #endif

  void main() {
    #include <color_vertex>
    #include <beginnormal_vertex>
    #include <defaultnormal_vertex>
    #include <begin_vertex>
    #include <project_vertex>

    vec4 worldPosition = vec4(transformed, 1.0);
    vec3 worldTangent = vec3(1.0, 0.0, 0.0);

    #ifdef USE_INSTANCING
      worldPosition = instanceMatrix * worldPosition;
      worldTangent = mat3(instanceMatrix) * worldTangent;
    #endif

    worldPosition = modelMatrix * worldPosition;
    worldTangent = mat3(modelMatrix) * worldTangent;

    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(inverseTransformDirection(transformedNormal, viewMatrix));
    vWorldTangent = normalize(worldTangent);
    vLocalPosition = position;
    vLocalNormal = normal;

    #ifdef ABS_DISTANT_STUDS
      #ifdef USE_INSTANCING
        vStudGrid = instanceStudGrid;
      #else
        vStudGrid = vec2(0.0);
      #endif
    #endif

    #include <shadowmap_vertex>
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uKeyDirection;
  uniform vec3 uKeyColor;
  uniform float uKeyIntensity;
  uniform vec3 uFillDirection;
  uniform vec3 uFillColor;
  uniform float uFillIntensity;
  uniform vec3 uAmbientColor;
  uniform float uShininess;
  uniform float uStudFadeStart;
  uniform float uStudFadeEnd;
  uniform vec3 uBaseColor;
  uniform bool receiveShadow;

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vWorldTangent;
  varying vec3 vLocalPosition;
  varying vec3 vLocalNormal;

  #ifdef ABS_DISTANT_STUDS
    varying vec2 vStudGrid;
  #endif

  #include <common>
  #include <packing>
  #include <color_pars_fragment>
  #include <dithering_pars_fragment>
  #include <fog_pars_fragment>
  #include <shadowmap_pars_fragment>
  #include <shadowmask_pars_fragment>

  float screenDoor(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
  }

  float elongatedBlinn(
    vec3 normal,
    vec3 viewDir,
    vec3 lightDir,
    vec3 tangent,
    vec3 bitangent,
    float shininess
  ) {
    vec3 halfDir = normalize(viewDir + lightDir);
    float nDotH = max(dot(normal, halfDir), 0.0);
    float along = dot(halfDir, tangent);
    float across = dot(halfDir, bitangent);
    float stretched = clamp(nDotH + 0.055 * along * along - 0.105 * across * across, 0.0, 1.0);
    return pow(stretched, shininess);
  }

  void main() {
    float cameraDistance = distance(cameraPosition, vWorldPosition);

    #ifdef ABS_PHYSICAL_STUD
      float physicalStud = 1.0 - smoothstep(
        uStudFadeStart,
        uStudFadeEnd,
        cameraDistance
      );
      if (screenDoor(gl_FragCoord.xy) > physicalStud) discard;
    #endif

    vec4 diffuseColor = vec4(1.0);
    #include <color_fragment>

    #ifdef ABS_UNIFORM_COLOR
      diffuseColor.rgb *= uBaseColor;
    #endif

    // ABS pigment scatters a little, so production bricks are fractionally
    // less saturated than their authored swatches.
    float luminance = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 baseColor = mix(vec3(luminance), diffuseColor.rgb, 0.86);

    vec3 normal = normalize(vWorldNormal);
    vec3 tangentCandidate = normalize(vWorldTangent);
    vec3 tangent = tangentCandidate - normal * dot(tangentCandidate, normal);
    if (dot(tangent, tangent) < 0.0001) {
      tangent = cross(abs(normal.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), normal);
    }
    tangent = normalize(tangent);
    vec3 bitangent = normalize(cross(normal, tangent));
    float studSurface = 0.0;

    #ifdef ABS_DISTANT_STUDS
      float farStud = smoothstep(
        uStudFadeStart,
        uStudFadeEnd,
        cameraDistance
      );
      float topFace = smoothstep(0.72, 0.96, vLocalNormal.y);
      float hasStuds = step(0.5, min(vStudGrid.x, vStudGrid.y));
      vec2 studCell = fract((vLocalPosition.xz + 0.5) * max(vStudGrid, vec2(1.0))) - 0.5;
      float studRadius = length(studCell);
      float studRing = 1.0 - smoothstep(0.035, 0.085, abs(studRadius - 0.30));
      float studCap = 1.0 - smoothstep(0.275, 0.31, studRadius);
      float studBlend = farStud * topFace * hasStuds;

      // This is the distant LOD: a circular tangent-space normal fold plus a
      // shallow contact ring. At this screen size it reads as a cylinder
      // without paying the cylinder vertex cost.
      vec2 radial = studCell / max(studRadius, 0.001);
      normal = normalize(normal + (tangent * radial.x + bitangent * radial.y) * studRing * studBlend * 0.42);
      baseColor *= 1.0 - studRing * studBlend * 0.075;
      studSurface = studCap * studBlend;
    #endif

    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    vec3 keyDir = normalize(uKeyDirection);
    vec3 fillDir = normalize(uFillDirection);
    float keyDiffuse = max(dot(normal, keyDir), 0.0);
    float fillDiffuse = max(dot(normal, fillDir), 0.0);
    float shadow = getShadowMask();

    vec3 diffuseLight = uAmbientColor;
    diffuseLight += uKeyColor * (uKeyIntensity * keyDiffuse * shadow);
    diffuseLight += uFillColor * (uFillIntensity * fillDiffuse);

    float mouldVariation = 0.96 + 0.04 * sin(dot(vWorldPosition, vec3(0.77, 1.13, 0.49)) * 0.31);
    float shininess = uShininess * mouldVariation;
    float keySpec = elongatedBlinn(normal, viewDir, keyDir, tangent, bitangent, shininess) * shadow;
    float fillSpec = elongatedBlinn(normal, viewDir, fillDir, tangent, bitangent, shininess * 0.9);
    vec3 specular = vec3(1.0, 0.985, 0.955) * keySpec * uKeyIntensity * 1.42;
    specular += uFillColor * fillSpec * uFillIntensity * 0.72;
    specular *= 0.92 + studSurface * 0.16;

    float nDotV = max(dot(normal, viewDir), 0.0);
    float fresnel = pow(1.0 - nDotV, 4.0);
    vec3 rim = mix(uFillColor, uKeyColor, 0.42) * fresnel * 0.13;

    // Just enough transmission on backlit, grazing edges to keep the plastic
    // from reading as painted stone. It remains deliberately imperceptible on
    // broad front-facing surfaces.
    float backLight = pow(max(dot(-normal, keyDir), 0.0), 3.0);
    vec3 subsurface = baseColor * uKeyColor * (backLight * fresnel * 0.028 + fresnel * 0.008);

    vec3 directLight = diffuseLight - uAmbientColor;
    vec3 outgoingLight = baseColor * (uAmbientColor + directLight * 0.76) + specular + rim + subsurface;
    gl_FragColor = vec4(outgoingLight, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
    #include <dithering_fragment>
  }
`;

function createMaterial(defines: Record<string, number>, color = 0xffffff): THREE.ShaderMaterial {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog]);
  Object.assign(uniforms, absLightUniforms);
  uniforms.uBaseColor = { value: new THREE.Color(color) };

  const material = new THREE.ShaderMaterial({
    name: 'BrickFly ABS Plastic',
    defines,
    uniforms,
    vertexShader,
    fragmentShader,
    vertexColors: true,
    lights: true,
    fog: true,
    dithering: true
  });
  material.toneMapped = true;
  return material;
}

export const ABS_BRICK_MATERIAL = createMaterial({ ABS_DISTANT_STUDS: 1 });
export const ABS_STUD_MATERIAL = createMaterial({ ABS_PHYSICAL_STUD: 1 });
export const ABS_SOLID_MATERIAL = createMaterial({});

export function createABSColoredMaterial(color: number): THREE.ShaderMaterial {
  return createMaterial({ ABS_UNIFORM_COLOR: 1 }, color);
}

/** Rounded unit brick with per-vertex contact/gap AO baked into its color. */
export function makeABSBrickGeometry(): THREE.BufferGeometry {
  const geometry = new RoundedBoxGeometry(1, 1, 1, 1, 0.025);
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const colors = new Float32Array(position.count * 3);

  for (let i = 0; i < position.count; i++) {
    const x = Math.abs(position.getX(i));
    const y = position.getY(i);
    const z = Math.abs(position.getZ(i));
    const ny = normal.getY(i);
    const vertical = THREE.MathUtils.smoothstep(y, -0.5, 0.38);
    const edge = THREE.MathUtils.smoothstep(Math.max(x, z), 0.39, 0.5);
    const corner = THREE.MathUtils.smoothstep(Math.min(x, z), 0.40, 0.5);
    const top = THREE.MathUtils.smoothstep(ny, 0.45, 0.95);
    const bottom = THREE.MathUtils.smoothstep(-ny, 0.45, 0.95);

    // The bottom seam and vertical corners retain the dark mould-contact line
    // that visually separates adjacent bricks. Top planes stay clean so their
    // coloured pigment is not muddied.
    let ao = 0.74 + vertical * 0.22;
    ao *= 1.0 - edge * (1.0 - top) * 0.075;
    ao *= 1.0 - corner * (1.0 - top) * 0.055;
    ao = THREE.MathUtils.lerp(ao, 0.985, top);
    ao = THREE.MathUtils.lerp(ao, 0.66, bottom);

    colors[i * 3] = ao;
    colors[i * 3 + 1] = ao;
    colors[i * 3 + 2] = ao;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** One real, shared cylinder for all near-field stud instances. */
export function makeABSStudGeometry(segments = 16): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(STUD_R, STUD_R, STUD_H, segments, 1, false);
}

export function makeStudGridAttribute(capacity: number): THREE.InstancedBufferAttribute {
  return new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
}

export interface ABSStudioLighting {
  keyDirection: THREE.Vector3;
  keyColor: THREE.Color;
  keyIntensity: number;
  fillDirection: THREE.Vector3;
  fillColor: THREE.Color;
  fillIntensity: number;
  ambientColor: THREE.Color;
}

/** Updates every ABS material through shared uniform objects. */
export function updateABSStudioLighting(lighting: ABSStudioLighting): void {
  absLightUniforms.uKeyDirection.value.copy(lighting.keyDirection).normalize();
  absLightUniforms.uKeyColor.value.copy(lighting.keyColor);
  absLightUniforms.uKeyIntensity.value = lighting.keyIntensity;
  absLightUniforms.uFillDirection.value.copy(lighting.fillDirection).normalize();
  absLightUniforms.uFillColor.value.copy(lighting.fillColor);
  absLightUniforms.uFillIntensity.value = lighting.fillIntensity;
  absLightUniforms.uAmbientColor.value.copy(lighting.ambientColor);
}
