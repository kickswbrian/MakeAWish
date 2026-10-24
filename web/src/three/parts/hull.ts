import * as THREE from "three";

/**
 * Selection outline: an inverted hull pushed out along normals by a constant number of screen
 * pixels, drawn back-faced in gold so only the silhouette shows. Works for any mesh, including
 * kit parts built from several meshes. One shared material, pulsed every frame.
 */
export const hullMaterial = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  transparent: true,
  depthWrite: false,
  uniforms: {
    uColor: { value: new THREE.Color("#E2A93B") },
    uWidth: { value: 3.0 },
    uOpacity: { value: 1 },
    uResolution: { value: new THREE.Vector2(800, 800) },
  },
  vertexShader: /* glsl */ `
    uniform float uWidth;
    uniform vec2 uResolution;
    void main() {
      vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      vec3 n = normalize(normalMatrix * normal);
      vec4 clipN = projectionMatrix * vec4(n, 0.0);
      vec2 dir = clipN.xy;
      float l = length(dir);
      if (l > 1e-5) clip.xy += (dir / l) * uWidth * 2.0 / uResolution * clip.w;
      gl_Position = clip;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uOpacity;
    void main() { gl_FragColor = vec4(uColor, uOpacity); }`,
});
hullMaterial.toneMapped = false;

/** Clone hull meshes for every mesh under `root` (parented to each mesh so they follow it). */
export function addHulls(root: THREE.Object3D): () => void {
  const added: [THREE.Mesh, THREE.Mesh][] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.isHull || !m.geometry?.attributes.normal) return;
    const h = new THREE.Mesh(m.geometry, hullMaterial);
    h.userData.isHull = true;
    h.raycast = () => {};
    h.renderOrder = 2;
    added.push([m, h]);
  });
  for (const [m, h] of added) m.add(h);
  return () => {
    for (const [m, h] of added) m.remove(h);
  };
}
