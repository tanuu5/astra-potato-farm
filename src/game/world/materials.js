// 世界と生きものの材質（ShaderMaterial）。光は「空の光 × 時間帯」と「ランタンの光」の明るいほうで、
// 面の向きの陰（上 1.0／横 0.8・0.6／下 0.5）と角の暗さ（AO）を掛ける（マイクラ風の照らし方）。
// 霧もここで混ぜる。出力は線形の色（OutputPass が sRGB に直す）。
// NaN よけ：光の値は clamp、pow の底は max(…, 0.0)。
import * as THREE from 'three';

/** すべての材質が同じものを見る uniform（時間帯で毎フレーム変える）。 */
export const shared = {
  uSky: { value: 1 },                                  // 空の光の強さ（昼 1、夜 0.2）
  uSkyColor: { value: new THREE.Color(1, 1, 1) },      // 空の光の色
  uBlockColor: { value: new THREE.Color(1.0, 0.82, 0.55) }, // ランタンの光の色
  uMinLight: { value: 0.035 },
  uFogColor: { value: new THREE.Color(0.75, 0.85, 1) },
  uFogNear: { value: 30 },
  uFogFar: { value: 70 },
  uTime: { value: 0 },
};

const LIGHT_GLSL = /* glsl */ `
  uniform float uSky, uMinLight, uFogNear, uFogFar;
  uniform vec3 uSkyColor, uBlockColor, uFogColor;
  vec3 lightOf(float sky, float blk) {
    float s = clamp(sky, 0.0, 1.0);
    float b = clamp(blk, 0.0, 1.0);
    float sk = pow(max(s, 0.0), 1.6) * uSky;
    float bk = pow(max(b, 0.0), 1.7);
    vec3 L = max(uSkyColor * sk, uBlockColor * bk);
    return max(L, vec3(uMinLight));
  }
  vec3 fogged(vec3 col, float depth) {
    float f = smoothstep(uFogNear, max(uFogFar, uFogNear + 0.01), depth);
    return mix(col, uFogColor, f);
  }
`;

/** 世界のブロック。kind：'opaque'（不透明）／'cutout'（葉・草：透明な画素は捨てる）。 */
export function worldMaterial(map, kind = 'opaque') {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, map: { value: map } },
    vertexShader: /* glsl */ `
      attribute vec3 light;
      varying vec2 vUv;
      varying vec3 vLight;
      varying float vDepth;
      void main() {
        vUv = uv;
        vLight = light;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec2 vUv;
      varying vec3 vLight;
      varying float vDepth;
      ${LIGHT_GLSL}
      void main() {
        vec4 tex = texture2D(map, vUv);
        if (tex.a < 0.5) discard;
        vec3 col = tex.rgb * lightOf(vLight.y, vLight.z) * clamp(vLight.x, 0.0, 1.0);
        gl_FragColor = vec4(fogged(col, vDepth), 1.0);
      }`,
    side: kind === 'cutout' ? THREE.DoubleSide : THREE.FrontSide,
  });
}

/** 水。UV は世界の座標（くり返しのテクスチャ）で、時間で流す。 */
export function waterMaterial(map) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, map: { value: map } },
    vertexShader: /* glsl */ `
      attribute vec3 light;
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vLight;
      varying float vDepth;
      void main() {
        vUv = uv + vec2(uTime * 0.05, uTime * 0.11);
        vLight = light;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec2 vUv;
      varying vec3 vLight;
      varying float vDepth;
      ${LIGHT_GLSL}
      void main() {
        vec4 tex = texture2D(map, vUv);
        vec3 col = tex.rgb * lightOf(vLight.y, vLight.z) * clamp(vLight.x, 0.0, 1.0);
        gl_FragColor = vec4(fogged(col, vDepth), clamp(tex.a, 0.0, 1.0) * 0.92);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** 島のまわりの海（外側の大きな板）。 */
export function oceanMaterial(map) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, map: { value: map } },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying float vDepth;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vUv = wp.xz + vec2(uTime * 0.05, uTime * 0.11);
        vec4 mv = viewMatrix * wp;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec2 vUv;
      varying float vDepth;
      ${LIGHT_GLSL}
      void main() {
        vec4 tex = texture2D(map, vUv);
        vec3 deep = vec3(0.02, 0.05, 0.16);
        vec3 col = mix(deep, tex.rgb, 0.7) * lightOf(1.0, 0.0);
        gl_FragColor = vec4(fogged(col, vDepth), 1.0);
      }`,
  });
}

/**
 * 生きもの・アイテム・手に持つ物。光はその場所の明るさを uLight で渡す（毎フレーム）。
 * uFlash：白く光る（緑のアレの爆発前）、uHurt：赤くなる（たたかれたとき）。
 */
export function entityMaterial(map, { cutout = true, side = THREE.FrontSide } = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uFogColor: shared.uFogColor, uFogNear: shared.uFogNear, uFogFar: shared.uFogFar,
      uSky: shared.uSky, uSkyColor: shared.uSkyColor, uBlockColor: shared.uBlockColor, uMinLight: shared.uMinLight,
      map: { value: map },
      uLight: { value: new THREE.Vector2(1, 0) },
      uFlash: { value: 0 },
      uHurt: { value: 0 },
      uAlpha: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float shade;
      varying vec2 vUv;
      varying float vShade;
      varying float vDepth;
      void main() {
        vUv = uv;
        vShade = shade;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec2 uLight;
      uniform float uFlash, uHurt, uAlpha;
      varying vec2 vUv;
      varying float vShade;
      varying float vDepth;
      ${LIGHT_GLSL}
      void main() {
        vec4 tex = texture2D(map, vUv);
        if (tex.a < 0.5) discard;
        vec3 col = tex.rgb * lightOf(uLight.x, uLight.y) * clamp(vShade, 0.0, 1.0);
        col = mix(col, vec3(1.0, 0.25, 0.2) * max(0.35, uLight.x * uSky), clamp(uHurt, 0.0, 1.0) * 0.55);
        col = mix(col, vec3(1.0), clamp(uFlash, 0.0, 1.0) * 0.8);
        gl_FragColor = vec4(fogged(col, vDepth), clamp(uAlpha, 0.0, 1.0));
      }`,
    side,
    transparent: false,
  });
  return m;
}

/** 明るさ（0〜15 の 2 つ）を uLight に入れる。 */
export function setEntityLight(mat, sky, blk) {
  mat.uniforms.uLight.value.set(Math.max(0, Math.min(15, sky)) / 15, Math.max(0, Math.min(15, blk)) / 15);
}
