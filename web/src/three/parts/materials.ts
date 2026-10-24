import * as THREE from "three";
import type { MaterialPreset, PartMaterial } from "@wishit/shared";

/**
 * Textured material presets (CC0 scans from Poly Haven / ambientCG plus procedural maps, see
 * public/textures/CREDITS.md).
 *
 * Every textured preset has up to three maps in /textures/<set>/:
 *  - albedo.jpg: a near-neutral luminance "detail" map (linear mean ~0.85). material.color = the part
 *    color multiplies it, so any hex tints the material while keeping weave, grain and veins.
 *  - normal.jpg: OpenGL tangent-space normals.
 *  - orm.jpg:    R = ambient occlusion, G = roughness modulation normalized to mean ROUGH_MAP_MEAN.
 * UVs on every part are in meters (see uv.ts), so texture.repeat = 1 / tile size in meters.
 *
 * Textures load lazily per preset (or all at once via preloadMaterials) and are shared by every
 * material instance; instances created before their textures arrive get them assigned on load.
 */

export const ENV_HDRI_URL = "/hdri/studio.hdr";

const TEX_ROOT = "/textures";
/** Mean of the G channel of every orm.jpg (roughness modulation). */
const ROUGH_MAP_MEAN = 0.75;
const MAX_ANISOTROPY = 8;

type TexSet =
  | "nylon" | "leather" | "canvas" | "metal_brushed" | "plastic_matte" | "rubber" | "wood" | "cotton" | "knit"
  | "satin" | "denim" | "suede" | "concrete" | "marble" | "cork" | "smooth";

interface Textures {
  set: TexSet;
  /** Physical tile size in meters [u, v]. */
  tile: [number, number];
  albedo?: boolean;
  normal?: boolean;
  orm?: boolean;
  /** Use the orm R channel as ambient occlusion. */
  ao?: number;
  /** Also drive clearcoat roughness from the orm G channel. */
  coatRough?: boolean;
}

interface PresetDef {
  label: string;
  /** A representative color for UI chips. */
  swatch: string;
  tex?: Textures;
  roughness: number;
  metalness: number;
  normalScale?: number;
  specularIntensity?: number;
  ior?: number;
  /** Fabric sheen: sheenColor = mix(color, white, lift) * amount. */
  sheen?: { amount: number; roughness: number; lift: number };
  clearcoat?: { amount: number; roughness: number };
  /**
   * Anisotropic specular; rotation in radians from the U axis. axial: brush around the part's
   * local Y axis instead of along UV tangents (seamless across box-projected faces).
   */
  anisotropy?: { strength: number; rotation: number; axial?: boolean };
  /** Thin-walled glass (see GLASS_TRANSMISSION). thickness in local units, before the silhouette boost. */
  glass?: { thickness: number; attenuationDistance: number };
  envMapIntensity?: number;
  /** Contrast exponent on the environment reflection (polished metals), 0 = off. */
  envContrast?: number;
}

const PRESETS: Record<MaterialPreset, PresetDef> = {
  nylon: {
    label: "Nylon", swatch: "#2F4A6D",
    tex: { set: "nylon", tile: [0.3, 0.3], albedo: true, normal: true, orm: true, ao: 1 },
    roughness: 0.62, metalness: 0, normalScale: 1.5, specularIntensity: 0.5,
    sheen: { amount: 0.8, roughness: 0.4, lift: 0.35 },
  },
  leather: {
    label: "Leather", swatch: "#7B4A2D",
    tex: { set: "leather", tile: [0.3, 0.3], albedo: true, normal: true, orm: true, ao: 1 },
    roughness: 0.55, metalness: 0, normalScale: 1.6, specularIntensity: 0.8,
    clearcoat: { amount: 0.2, roughness: 0.25 },
  },
  canvas: {
    label: "Canvas", swatch: "#C9B48A",
    tex: { set: "canvas", tile: [0.07, 0.07], albedo: true, normal: true, orm: true, ao: 0.8 },
    roughness: 0.92, metalness: 0, normalScale: 0.9, specularIntensity: 0.45,
    sheen: { amount: 0.5, roughness: 0.75, lift: 0.4 },
  },
  metal_brushed: {
    label: "Brushed metal", swatch: "#B8BCC2",
    tex: { set: "metal_brushed", tile: [0.2, 0.2], normal: true, orm: true },
    roughness: 0.4, metalness: 1, normalScale: 0.6,
    anisotropy: { strength: 0.35, rotation: 0, axial: true },
    envContrast: 0.25,
  },
  plastic_matte: {
    label: "Matte plastic", swatch: "#8A8D93",
    tex: { set: "plastic_matte", tile: [0.05, 0.05], normal: true, orm: true },
    roughness: 0.62, metalness: 0, normalScale: 0.15, specularIntensity: 0.9,
  },
  plastic_gloss: {
    label: "Gloss plastic", swatch: "#D7263D",
    tex: { set: "smooth", tile: [0.3, 0.3], normal: true, orm: true, coatRough: true },
    roughness: 0.28, metalness: 0, normalScale: 0.12,
    clearcoat: { amount: 0.9, roughness: 0.06 },
  },
  rubber: {
    label: "Rubber", swatch: "#2A2B2E",
    tex: { set: "rubber", tile: [0.06, 0.06], albedo: true, normal: true, orm: true, ao: 0.5 },
    roughness: 0.72, metalness: 0, normalScale: 0.6, specularIntensity: 0.6,
    sheen: { amount: 0.25, roughness: 0.6, lift: 0.5 },
  },
  wood: {
    label: "Wood", swatch: "#B98B57",
    tex: { set: "wood", tile: [0.7, 0.7], albedo: true, normal: true, orm: true, ao: 0.4, coatRough: true },
    roughness: 0.55, metalness: 0, normalScale: 0.6, specularIntensity: 0.7,
    clearcoat: { amount: 0.25, roughness: 0.3 },
  },
  glass: {
    label: "Glass", swatch: "#DCEFF2",
    tex: { set: "smooth", tile: [0.3, 0.3], orm: true },
    roughness: 0.03, metalness: 0, ior: 1.5,
    glass: { thickness: 0.015, attenuationDistance: 0.12 },
    envMapIntensity: 2,
  },
  metal_polished: {
    label: "Polished metal", swatch: "#D8DCE2",
    tex: { set: "smooth", tile: [0.3, 0.3], orm: true },
    roughness: 0.1, metalness: 1,
    envContrast: 0.7,
  },
  ceramic: {
    label: "Ceramic", swatch: "#F1EEE6",
    tex: { set: "smooth", tile: [0.25, 0.25], normal: true, orm: true, coatRough: true },
    roughness: 0.4, metalness: 0, normalScale: 0.12,
    clearcoat: { amount: 1, roughness: 0.04 },
  },
  cotton: {
    label: "Cotton", swatch: "#E8E2D4",
    tex: { set: "cotton", tile: [0.22, 0.22], albedo: true, normal: true, orm: true, ao: 1 },
    roughness: 0.9, metalness: 0, normalScale: 1.4, specularIntensity: 0.4,
    sheen: { amount: 0.6, roughness: 0.7, lift: 0.4 },
  },
  knit: {
    label: "Knit", swatch: "#9CAF88",
    tex: { set: "knit", tile: [0.45, 0.45], albedo: true, normal: true, orm: true, ao: 1 },
    roughness: 0.95, metalness: 0, normalScale: 1.6, specularIntensity: 0.3,
    sheen: { amount: 0.8, roughness: 0.6, lift: 0.45 },
  },
  satin: {
    label: "Satin", swatch: "#B0102D",
    tex: { set: "satin", tile: [0.12, 0.12], albedo: true, normal: true, orm: true, ao: 0.3 },
    roughness: 0.27, metalness: 0, normalScale: 0.35, specularIntensity: 1,
    sheen: { amount: 1, roughness: 0.28, lift: 0.5 },
    anisotropy: { strength: 0.7, rotation: 0 },
  },
  denim: {
    label: "Denim", swatch: "#2F4F7F",
    tex: { set: "denim", tile: [0.28, 0.28], albedo: true, normal: true, orm: true, ao: 1 },
    roughness: 0.88, metalness: 0, normalScale: 1.4, specularIntensity: 0.4,
    sheen: { amount: 0.5, roughness: 0.7, lift: 0.45 },
  },
  suede: {
    label: "Suede", swatch: "#A8794F",
    tex: { set: "suede", tile: [0.25, 0.25], albedo: true, normal: true, orm: true, ao: 0.8 },
    roughness: 0.95, metalness: 0, normalScale: 0.8, specularIntensity: 0.3,
    sheen: { amount: 1, roughness: 0.5, lift: 0.35 },
  },
  concrete: {
    label: "Concrete", swatch: "#A7A39B",
    tex: { set: "concrete", tile: [0.6, 0.6], albedo: true, normal: true, orm: true, ao: 0.8 },
    roughness: 0.85, metalness: 0, normalScale: 0.8, specularIntensity: 0.6,
  },
  marble: {
    label: "Marble", swatch: "#EDEBE6",
    tex: { set: "marble", tile: [0.45, 0.45], albedo: true, normal: true, orm: true, coatRough: true },
    roughness: 0.22, metalness: 0, normalScale: 0.2,
    clearcoat: { amount: 0.6, roughness: 0.05 },
  },
  cork: {
    label: "Cork", swatch: "#C08A55",
    tex: { set: "cork", tile: [0.2, 0.2], albedo: true, normal: true, orm: true, ao: 0.7 },
    roughness: 0.85, metalness: 0, normalScale: 1.0, specularIntensity: 0.5,
  },
};

/** Labels and swatch colors for UI chips. */
export const PRESET_INFO: Record<MaterialPreset, { label: string; swatch: string }> = Object.fromEntries(
  Object.entries(PRESETS).map(([k, v]) => [k, { label: v.label, swatch: v.swatch }]),
) as Record<MaterialPreset, { label: string; swatch: string }>;

// ---------- Textures ----------

type MapKind = "albedo" | "normal" | "orm";

/** One decoded image per file, shared across presets (clones share the GPU upload). */
const sources = new Map<string, Promise<THREE.Texture | null>>();
/** Per-preset texture objects (own repeat), resolved once loaded. */
interface PresetMaps { albedo: THREE.Texture | null; normal: THREE.Texture | null; orm: THREE.Texture | null }
const presetMaps = new Map<MaterialPreset, PresetMaps>();
const presetLoads = new Map<MaterialPreset, Promise<void>>();
const loader = new THREE.TextureLoader();

function loadSource(set: TexSet, kind: MapKind): Promise<THREE.Texture | null> {
  const url = `${TEX_ROOT}/${set}/${kind}.jpg`;
  let p = sources.get(url);
  if (!p) {
    p = loader.loadAsync(url).then(
      (t) => {
        t.colorSpace = kind === "albedo" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = MAX_ANISOTROPY;
        return t;
      },
      (err) => {
        console.warn(`[materials] failed to load ${url}`, err);
        return null;
      },
    );
    sources.set(url, p);
  }
  return p;
}

function loadPreset(preset: MaterialPreset): Promise<void> {
  let p = presetLoads.get(preset);
  if (p) return p;
  const tex = PRESETS[preset].tex;
  if (!tex) {
    p = Promise.resolve();
  } else {
    const want = (k: MapKind) => (tex[k] ? loadSource(tex.set, k) : Promise.resolve(null));
    p = Promise.all([want("albedo"), want("normal"), want("orm")]).then(([a, n, o]) => {
      const own = (t: THREE.Texture | null) => {
        if (!t) return null;
        const c = t.clone();
        c.repeat.set(1 / tex.tile[0], 1 / tex.tile[1]);
        c.needsUpdate = true;
        return c;
      };
      presetMaps.set(preset, { albedo: own(a), normal: own(n), orm: own(o) });
      for (const ref of live) {
        const mat = ref.deref();
        if (!mat) live.delete(ref);
        else if (state.get(mat)?.spec?.preset === preset) sync(mat);
      }
    });
  }
  presetLoads.set(preset, p);
  return p;
}

/** Start loading every texture so the first product renders fully textured. */
export function preloadMaterials(): Promise<void> {
  return Promise.all((Object.keys(PRESETS) as MaterialPreset[]).map(loadPreset)).then(() => undefined);
}

// ---------- Materials ----------

interface MatData {
  spec?: PartMaterial;
  variant?: string;
  /** Color the derived colors were computed from. */
  derivedFrom?: THREE.Color;
}

/** Per-instance bookkeeping, kept off userData so cloning/serializing a material stays safe. */
const state = new WeakMap<THREE.MeshPhysicalMaterial, MatData>();
const live = new Set<WeakRef<THREE.MeshPhysicalMaterial>>();

/** Studio reflections (HDRI + softboxes), set by StudioEnvironment once rendered. */
let studioEnv: THREE.Texture | null = null;
// Mirror-like finishes only: on rougher or bright ones (brushed, ceramic, glass) the panels blow out flat faces.
const STUDIO_PRESETS = new Set<MaterialPreset>(["metal_polished", "plastic_gloss"]);
/** Must match the scene environment in StudioEnv.tsx. */
export const STUDIO_ENV_ROTATION = Math.PI * 0.35;
export const STUDIO_ENV_INTENSITY = 0.62;

export function setStudioReflections(tex: THREE.Texture | null): void {
  if (tex === studioEnv) return;
  studioEnv = tex;
  for (const ref of live) {
    const mat = ref.deref();
    if (!mat) continue;
    sync(mat);
    mat.needsUpdate = true;
  }
}
const WHITE = new THREE.Color(1, 1, 1);

/** Sheen and glass attenuation follow material.color, even while the renderer animates it. */
function updateDerived(mat: THREE.MeshPhysicalMaterial) {
  const data = state.get(mat);
  const def = data?.spec ? PRESETS[data.spec.preset] : undefined;
  if (!data || !def) return;
  if (data.derivedFrom && data.derivedFrom.equals(mat.color)) return;
  (data.derivedFrom ??= new THREE.Color()).copy(mat.color);
  if (def.sheen) mat.sheenColor.copy(mat.color).lerp(WHITE, def.sheen.lift).multiplyScalar(def.sheen.amount);
  if (def.glass) mat.attenuationColor.copy(mat.color).lerp(WHITE, 0.6);
}

function onBeforeRender(this: THREE.MeshPhysicalMaterial) {
  updateDerived(this);
}

// ---------- Shader tweaks ----------

/**
 * Glass, written for a transparent canvas over a CSS backdrop as well as an opaque one.
 *  - three tints transmitted light by the full material color, which makes saturated glass read as
 *    opaque plastic: tint by a lighter version and let Beer attenuation add depth color.
 *  - Thin wall: the path through the glass grows toward the silhouette (more refraction and tint
 *    there), and internal reflection darkens the silhouette, the cue that reads as glass in a bright
 *    studio.
 *  - Where nothing opaque is behind the glass, three's transmission buffer holds its clear value
 *    (white, alpha 0.5 on a transparent canvas), so stock glass turns milky white. There we output
 *    premultiplied "see-through" instead: alpha lets the page show through, scaled by the
 *    transmittance, and only the tint's color excess is added.
 */
const GLASS_TRANSMISSION = /* glsl */ `
#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;

	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	float nv = abs( dot( n, v ) );

	vec3 ray = getVolumeTransmissionRay( n, v, material.thickness / max( nv, 0.2 ), material.ior, modelMatrix );
	vec4 ndc = projectionMatrix * viewMatrix * vec4( pos + ray, 1.0 );
	vec4 behind = getTransmissionSample( ndc.xy / ndc.w * 0.5 + 0.5, material.roughness, material.ior );

	// Body tint: the color's hue at full brightness (so pale "clear" glass stays clear), deepening
	// toward the silhouette where the light crosses more glass. Scale-independent on purpose.
	vec3 hue = material.diffuseColor / max( max3( material.diffuseColor ), 1e-3 );
	vec3 tint = mix( vec3( 1.0 ), hue, clamp( 0.2 / max( nv, 0.1 ), 0.0, 0.9 ) );
	tint *= mix( 0.3, 1.0, smoothstep( 0.05, 0.7, nv ) );
	// Dark colors mean smoked glass (sunglasses, phone screens): pale and mid colors stay clear.
	tint *= mix( 0.1, 1.0, smoothstep( 0.008, 0.25, max3( material.diffuseColor ) ) );
	// Light leaves through two surfaces, and real glass absorbs a little even when "clear".
	tint *= 0.95 * pow2( 1.0 - EnvironmentBRDF( n, v, material.specularColor, material.specularF90, material.roughness ) );

	// Opaque geometry writes alpha 1 into the transmission buffer, its clear value is 0.5 (or 1 on an
	// opaque canvas). The back walls of the glass itself (drawn into that buffer first, see
	// side = DoubleSide) encode how much they hide as 0.5..1, so the front sees them partly.
	float cover = saturate( behind.a * 2.0 - 1.0 );
	float clearT = min( tint.r, min( tint.g, tint.b ) );
	vec3 seen = cover * tint * behind.rgb + ( 1.0 - cover ) * 0.9 * ( tint - clearT );
	totalDiffuse = mix( totalDiffuse, seen, material.transmission );
	material.transmissionAlpha = mix( 1.0, 1.0 - ( 1.0 - cover ) * clearT, material.transmission );
	if ( ! gl_FrontFacing ) {
		totalDiffuse = mix( totalDiffuse, 0.9 * tint * mix( vec3( 1.0 ), behind.rgb, cover ), material.transmission );
		totalSpecular *= 0.5;
		material.transmissionAlpha = 0.5 + 0.5 * max( cover, 1.0 - clearT );
	}
#endif
`;

/**
 * Brushed metal: anisotropy from UV tangents flips direction wherever box-projected UVs switch
 * faces, which shows as seams. Brush around the part's local Y axis instead (lathe / band
 * brushing): seamless on boxes, cylinders and spheres, fading to isotropic on faces that look
 * along the axis.
 */
const BRUSH_FRAGMENT = /* glsl */ `
	{
		vec3 groove = cross( vBrushAxis, normal );
		float g = length( groove );
		material.anisotropy *= smoothstep( 0.2, 0.75, g );
		material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
		if ( g > 1e-4 ) {
			material.anisotropyB = groove / g;
			material.anisotropyT = cross( material.anisotropyB, normal );
		}
	}`;

/**
 * Studio "flags" for polished metal: a soft contrast curve on the environment reflection darkens
 * the walls and the dim parts of the room and keeps the softboxes bright, so chrome reads as a mirror with crisp
 * highlights instead of a flat light-gray surface.
 */
const envContrast = (k: number) => /* glsl */ `
	#if defined( RE_IndirectSpecular )
	{
		float envL = dot( radiance, vec3( 0.2126, 0.7152, 0.0722 ) );
		radiance *= clamp( pow( max( envL, 1e-5 ) / 0.8, ${k.toFixed(3)} ), 0.12, 2.5 );
	}
	#endif
	#include <lights_fragment_end>`;

interface ShaderMod {
  compile: (shader: THREE.WebGLProgramParametersWithUniforms) => void;
  key: () => string;
}
const shaderMods = new Map<string, ShaderMod>();
const noCompile = () => {};
const baseKey = THREE.Material.prototype.customProgramCacheKey;

function shaderMod(def: PresetDef): ShaderMod | null {
  const glass = !!def.glass;
  const brush = !!def.anisotropy?.axial;
  const contrast = def.envContrast ?? 0;
  if (!glass && !brush && !contrast) return null;
  const id = `wishit-${glass ? "glass" : ""}-${brush ? "brush" : ""}-${contrast}`;
  let mod = shaderMods.get(id);
  if (!mod) {
    mod = {
      key: () => id,
      compile: (shader) => {
        let vs = shader.vertexShader;
        let fs = shader.fragmentShader;
        if (glass) fs = fs.replace("#include <transmission_fragment>", GLASS_TRANSMISSION);
        if (brush) {
          vs = vs
            .replace("#include <common>", "#include <common>\nvarying vec3 vBrushAxis;")
            .replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvBrushAxis = normalize( ( modelViewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );");
          fs = fs
            .replace("#include <common>", "#include <common>\nvarying vec3 vBrushAxis;")
            .replace("#include <lights_physical_fragment>", THREE.ShaderChunk.lights_physical_fragment.replace(
              "material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;",
              "material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;" + BRUSH_FRAGMENT,
            ));
        }
        if (contrast) fs = fs.replace("#include <lights_fragment_end>", envContrast(contrast));
        shader.vertexShader = vs;
        shader.fragmentShader = fs;
      },
    };
    shaderMods.set(id, mod);
  }
  return mod;
}

/** Apply everything that depends on the spec and on which textures have loaded. */
function sync(mat: THREE.MeshPhysicalMaterial) {
  const data = state.get(mat);
  const m = data?.spec;
  if (!data || !m) return;
  const def = PRESETS[m.preset] ?? PRESETS.plastic_matte;
  const tex = def.tex;
  const maps = presetMaps.get(m.preset);

  mat.map = maps?.albedo ?? null;
  mat.normalMap = maps?.normal ?? null;
  const orm = maps?.orm ?? null;
  mat.roughnessMap = orm;
  mat.aoMap = orm && tex?.ao ? orm : null;
  mat.aoMapIntensity = tex?.ao ?? 1;
  mat.clearcoatRoughnessMap = orm && tex?.coatRough && def.clearcoat ? orm : null;
  mat.normalScale.setScalar(def.normalScale ?? 1);

  const rough = m.roughness ?? def.roughness;
  mat.roughness = orm ? Math.min(rough / ROUGH_MAP_MEAN, 1 / ROUGH_MAP_MEAN) : rough;
  mat.metalness = m.metalness ?? def.metalness;

  mat.specularIntensity = def.specularIntensity ?? 1;
  mat.specularColor.set(1, 1, 1);
  mat.ior = def.ior ?? 1.5;

  mat.sheen = def.sheen ? 1 : 0;
  mat.sheenRoughness = def.sheen?.roughness ?? 1;
  if (!def.sheen) mat.sheenColor.set(0, 0, 0);

  mat.clearcoat = def.clearcoat?.amount ?? 0;
  const coatRough = def.clearcoat?.roughness ?? 0;
  mat.clearcoatRoughness = mat.clearcoatRoughnessMap ? coatRough / ROUGH_MAP_MEAN : coatRough;

  mat.anisotropy = def.anisotropy?.strength ?? 0;
  mat.anisotropyRotation = def.anisotropy?.rotation ?? 0;

  mat.transmission = def.glass ? 1 : 0;
  mat.thickness = def.glass?.thickness ?? 0;
  mat.attenuationDistance = def.glass?.attenuationDistance ?? Infinity;
  mat.dispersion = 0;
  if (!def.glass) mat.attenuationColor.set(1, 1, 1);

  // Shiny finishes reflect the studio softboxes; everything else (and the pedestal) the plain HDRI.
  const studio = studioEnv && STUDIO_PRESETS.has(m.preset) ? studioEnv : null;
  if (mat.envMap !== studio) {
    mat.envMap = studio;
    mat.envMapRotation.set(0, studio ? STUDIO_ENV_ROTATION : 0, 0);
  }
  // scene.environmentIntensity only applies to the scene's map, so carry it over here.
  mat.envMapIntensity = (def.envMapIntensity ?? 1) * (studio ? STUDIO_ENV_INTENSITY : 1);
  const mod = shaderMod(def);
  mat.onBeforeCompile = mod?.compile ?? noCompile;
  mat.customProgramCacheKey = mod?.key ?? baseKey;

  mat.emissive.set(m.emissive ?? "#000000");
  mat.emissiveIntensity = m.emissive ? m.emissiveIntensity ?? 1.5 : 0;

  const opacity = m.opacity ?? 1;
  mat.opacity = opacity;
  mat.transparent = opacity < 1;
  mat.depthWrite = opacity >= 0.6;

  data.derivedFrom = undefined;
  updateDerived(mat);

  // Only recompile when something that changes the shader changed.
  const variant = [mod?.key() ?? "", !!mat.map, !!mat.normalMap, !!mat.roughnessMap, !!mat.aoMap, !!mat.clearcoatRoughnessMap, mat.transparent].join();
  if (variant !== data.variant) {
    data.variant = variant;
    mat.needsUpdate = true;
  }
}

/** Re-apply a spec to an existing instance (preset swap, roughness, emissive...). Color included. */
export function applyMaterial(mat: THREE.MeshPhysicalMaterial, m: PartMaterial): void {
  let data = state.get(mat);
  if (!data) state.set(mat, (data = {}));
  const preset: MaterialPreset = PRESETS[m.preset] ? m.preset : "plastic_matte";
  data.spec = { ...m, preset };
  mat.userData.preset = preset;
  mat.color.set(m.color);
  // Glass draws its back walls into the transmission buffer, so they show through the front.
  mat.side = PRESETS[preset].glass ? THREE.DoubleSide : THREE.FrontSide;
  if (mat.onBeforeRender !== onBeforeRender) {
    mat.onBeforeRender = onBeforeRender;
    const ref = new WeakRef(mat);
    live.add(ref);
    mat.addEventListener("dispose", () => live.delete(ref));
  }
  sync(mat);
  void loadPreset(preset);
}

/** A new material instance for a part (textures shared). The renderer animates its color. */
export function createMaterial(m: PartMaterial): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial();
  applyMaterial(mat, m);
  return mat;
}

const cache = new Map<string, THREE.MeshPhysicalMaterial>();
/** Shared, cached material for fixed finishes (kit hardware). Never mutate the returned material. */
export function getMaterial(m: PartMaterial): THREE.MeshPhysicalMaterial {
  const key = JSON.stringify([m.preset, m.color, m.roughness, m.metalness, m.emissive, m.emissiveIntensity, m.opacity]);
  let mat = cache.get(key);
  if (!mat) cache.set(key, (mat = createMaterial(m)));
  return mat;
}
