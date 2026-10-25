import * as THREE from "three";

/**
 * Fold normals for prepared base meshes: the source model's baked normal map (drape folds, seams,
 * topstitching, pocket edges) layered over the fabric preset's tiling normal map. The fold map is
 * sampled with the model's own UVs (uv1) and only where the vertex attribute `fold` is 1 (faces that
 * came from the material the map belongs to), so presets keep their weave and the garment keeps its
 * construction detail when it is re-textured.
 */

const VERT_DECL = /* glsl */ `
#ifndef USE_UV1
attribute vec2 uv1;
#endif
attribute float fold;
varying vec2 vFoldUv;
varying float vFold;
`;

const FRAG_DECL = /* glsl */ `
uniform sampler2D foldMap;
uniform vec2 foldScale;
varying vec2 vFoldUv;
varying float vFold;
mat3 foldFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
	vec3 q0 = dFdx( eye_pos.xyz );
	vec3 q1 = dFdy( eye_pos.xyz );
	vec2 st0 = dFdx( uv.st );
	vec2 st1 = dFdy( uv.st );
	vec3 N = surf_norm;
	vec3 q1perp = cross( q1, N );
	vec3 q0perp = cross( N, q0 );
	vec3 T = q1perp * st0.x + q0perp * st1.x;
	vec3 B = q1perp * st0.y + q0perp * st1.y;
	float det = max( dot( T, T ), dot( B, B ) );
	float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
	return mat3( T * scale, B * scale, N );
}
`;

// After the preset's normal map: tilt the (already woven) normal by the fold map in the uv1 frame.
const FRAG_APPLY = /* glsl */ `
#include <normal_fragment_maps>
if ( vFold > 0.01 ) {
	vec3 fn = texture2D( foldMap, vFoldUv ).xyz * 2.0 - 1.0;
	fn.xy *= foldScale * vFold;
	normal = normalize( foldFrame( - vViewPosition, normal, vFoldUv ) * fn );
}
`;

export const FOLD_KEY = "fold";

/** Patch a compiled shader with the fold layer; the texture becomes a per-material uniform. */
export function foldCompile(shader: THREE.WebGLProgramParametersWithUniforms, map: THREE.Texture, strength = 1): void {
  shader.uniforms.foldMap = { value: map };
  // glTF normal maps sampled with flipY = false: green flips relative to three's UV frame.
  shader.uniforms.foldScale = { value: new THREE.Vector2(strength, -strength) };
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${VERT_DECL}`)
    .replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvFoldUv = uv1;\n\tvFold = fold;");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${FRAG_DECL}`)
    .replace("#include <normal_fragment_maps>", FRAG_APPLY);
}
