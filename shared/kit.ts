/**
 * The parts kit: ready-made hardware the genie places by id (kind "kit", kitAsset = id).
 * Every kit part is procedural (no downloads), built at real-world size in meters.
 *
 * Mount convention for every entry: the part's local origin sits on the surface it attaches to,
 * +Z points out of that surface, +Y is "up" along the surface. So placing a kit part on a panel's
 * front face means position = a point on that face, rotation that maps +Z to the face normal.
 * "free" parts (wheels, knobs on an axis) say so in their description.
 *
 * `size` is the bounding box [x, y, z] at scale 1 with default params; `attach` names points in the
 * part's local frame where other parts can be attached; `params` are optional kitParams.
 * The part's material colors the main body; hardware details (teeth, rivets) keep their own finish.
 */

export interface KitParamSpec {
  default: number;
  min: number;
  max: number;
  description: string;
}

export interface KitEntry {
  id: string;
  name: string;
  description: string;
  size: [number, number, number];
  attach: Record<string, [number, number, number]>;
  params?: Record<string, KitParamSpec>;
  /** Suggested material preset for the main body. */
  material: string;
}

export const KIT: KitEntry[] = [
  {
    id: "zipper",
    name: "Zipper",
    description: "Straight zipper: fabric tape, metal teeth along X, slider with pull tab at the +X end. Lay it along a seam.",
    size: [0.3, 0.024, 0.008],
    attach: { start: [-0.15, 0, 0], end: [0.15, 0, 0], slider: [0.13, 0, 0.006] },
    params: { length: { default: 0.3, min: 0.04, max: 1.5, description: "zipper length along X in meters" } },
    material: "nylon",
  },
  {
    id: "zipper_pull",
    name: "Zipper pull",
    description: "Single zipper slider with a dangling pull tab hanging down -Y.",
    size: [0.014, 0.04, 0.01],
    attach: { top: [0, 0.006, 0] },
    material: "metal_brushed",
  },
  {
    id: "buckle_side_release",
    name: "Side-release buckle",
    description: "Plastic backpack/strap buckle, strap runs along Y through both ends.",
    size: [0.04, 0.07, 0.012],
    attach: { strap_top: [0, 0.035, 0.006], strap_bottom: [0, -0.035, 0.006] },
    material: "plastic_matte",
  },
  {
    id: "buckle_belt",
    name: "Belt buckle",
    description: "Rectangular metal frame buckle with a center prong; strap runs along X.",
    size: [0.05, 0.045, 0.01],
    attach: { strap_left: [-0.025, 0, 0.004], strap_right: [0.025, 0, 0.004] },
    material: "metal_polished",
  },
  {
    id: "d_ring",
    name: "D-ring",
    description: "Metal D-shaped ring with a fabric tab sewn to the surface; ring hangs at -Y.",
    size: [0.035, 0.04, 0.008],
    attach: { ring: [0, -0.025, 0.004] },
    material: "metal_polished",
  },
  {
    id: "carabiner",
    name: "Carabiner clip",
    description: "Free-hanging aluminium carabiner, long axis Y, gate on +X side.",
    size: [0.035, 0.07, 0.008],
    attach: { top: [0, 0.033, 0], bottom: [0, -0.033, 0] },
    material: "metal_brushed",
  },
  {
    id: "handle_grip",
    name: "Grab handle",
    description: "Padded arched carry handle: two end tabs on the surface at ±X, arch rising along +Z.",
    size: [0.16, 0.03, 0.05],
    attach: { left: [-0.08, 0, 0], right: [0.08, 0, 0], top: [0, 0, 0.05] },
    params: { length: { default: 0.16, min: 0.06, max: 0.6, description: "distance between the two ends" } },
    material: "rubber",
  },
  {
    id: "handle_telescoping",
    name: "Telescoping handle",
    description: "Luggage pull handle: two aluminium rails rising along +Y with a crossbar grip on top. Origin at the base between the rails.",
    size: [0.26, 0.45, 0.03],
    attach: { grip: [0, 0.45, 0] },
    params: { height: { default: 0.45, min: 0.15, max: 1.2, description: "extended height" } },
    material: "metal_brushed",
  },
  {
    id: "wheel",
    name: "Wheel",
    description: "Free wheel: rubber tire on a spoked rim, axle along X, centered on its origin.",
    size: [0.04, 0.12, 0.12],
    attach: { axle_left: [-0.02, 0, 0], axle_right: [0.02, 0, 0] },
    params: {
      radius: { default: 0.06, min: 0.01, max: 0.6, description: "outer radius" },
      width: { default: 0.04, min: 0.005, max: 0.3, description: "tire width along X" },
    },
    material: "rubber",
  },
  {
    id: "wheel_caster",
    name: "Caster wheel",
    description: "Swivel caster for luggage/furniture: mounting plate at the origin facing -Y (bolt it to an underside), wheel below.",
    size: [0.05, 0.07, 0.05],
    attach: { plate: [0, 0, 0], wheel_center: [0, -0.045, 0] },
    material: "plastic_matte",
  },
  {
    id: "screw",
    name: "Screw",
    description: "Countersunk Phillips screw head flush on the surface.",
    size: [0.008, 0.008, 0.002],
    attach: {},
    material: "metal_brushed",
  },
  {
    id: "button_sewn",
    name: "Sewn button",
    description: "Four-hole clothing button with thread.",
    size: [0.016, 0.016, 0.004],
    attach: {},
    params: { radius: { default: 0.008, min: 0.003, max: 0.04, description: "button radius" } },
    material: "plastic_gloss",
  },
  {
    id: "snap_button",
    name: "Snap button",
    description: "Metal press-stud snap with a domed cap.",
    size: [0.014, 0.014, 0.005],
    attach: {},
    material: "metal_polished",
  },
  {
    id: "hinge",
    name: "Hinge",
    description: "Barrel hinge with two leaves lying on the surface; barrel axis along X just above the origin (z≈0.004), leaves along ±Y.",
    size: [0.06, 0.04, 0.008],
    attach: { leaf_top: [0, 0.015, 0], leaf_bottom: [0, -0.015, 0] },
    params: { length: { default: 0.06, min: 0.015, max: 1, description: "barrel length along X" } },
    material: "metal_brushed",
  },
  {
    id: "strap_end",
    name: "Strap tip",
    description: "Webbing strap end with a metal tip cap at -Y.",
    size: [0.03, 0.08, 0.006],
    attach: { root: [0, 0.04, 0] },
    material: "nylon",
  },
  {
    id: "screw_cap",
    name: "Screw cap",
    description: "Threaded bottle/jar lid, ridged grip, axis along Y, origin at its bottom rim (sit it on a bottle neck).",
    size: [0.05, 0.03, 0.05],
    attach: { top: [0, 0.03, 0] },
    params: { radius: { default: 0.025, min: 0.008, max: 0.2, description: "cap radius" } },
    material: "plastic_matte",
  },
  {
    id: "knob",
    name: "Knob",
    description: "Knurled control knob with an indicator line, axis along +Z out of the surface.",
    size: [0.03, 0.03, 0.018],
    attach: { face: [0, 0, 0.018] },
    params: { radius: { default: 0.015, min: 0.004, max: 0.1, description: "knob radius" } },
    material: "metal_brushed",
  },
  {
    id: "rivet",
    name: "Rivet",
    description: "Small domed metal rivet.",
    size: [0.008, 0.008, 0.003],
    attach: {},
    material: "metal_polished",
  },
  {
    id: "grommet",
    name: "Grommet",
    description: "Metal eyelet ring around a hole, axis along Z.",
    size: [0.016, 0.016, 0.003],
    attach: { hole: [0, 0, 0] },
    material: "metal_polished",
  },
  {
    id: "cord_lock",
    name: "Cord lock",
    description: "Drawstring toggle stopper with cord loop, cord runs along Y.",
    size: [0.016, 0.03, 0.012],
    attach: { cord: [0, 0.015, 0.006] },
    material: "plastic_matte",
  },
  {
    id: "led",
    name: "LED indicator",
    description: "Small glowing status light in a bezel. Its emissive color comes from the part material's color.",
    size: [0.008, 0.008, 0.003],
    attach: {},
    material: "plastic_gloss",
  },
  {
    id: "speaker_grille",
    name: "Speaker grille",
    description: "Round perforated speaker grille with a rim, facing +Z.",
    size: [0.06, 0.06, 0.006],
    attach: {},
    params: { radius: { default: 0.03, min: 0.005, max: 0.4, description: "grille radius" } },
    material: "metal_brushed",
  },
  {
    id: "usb_port",
    name: "USB-C port",
    description: "USB-C socket recessed into the surface.",
    size: [0.01, 0.0035, 0.0005],
    attach: {},
    material: "metal_polished",
  },
  {
    id: "toggle_switch",
    name: "Toggle switch",
    description: "Rocker switch in a bezel.",
    size: [0.02, 0.012, 0.006],
    attach: {},
    material: "plastic_gloss",
  },
  {
    id: "screen",
    name: "Display screen",
    description: "Glass display with a glowing UI, rounded corners, facing +Z. Glow color comes from the part material's emissive (or color).",
    size: [0.07, 0.12, 0.004],
    attach: {},
    params: {
      width: { default: 0.07, min: 0.01, max: 2, description: "screen width" },
      height: { default: 0.12, min: 0.01, max: 2, description: "screen height" },
    },
    material: "glass",
  },
  {
    id: "solar_panel",
    name: "Solar panel",
    description: "Photovoltaic panel with a cell grid and aluminium frame, facing +Z.",
    size: [0.2, 0.14, 0.006],
    attach: {},
    params: {
      width: { default: 0.2, min: 0.03, max: 2, description: "panel width" },
      height: { default: 0.14, min: 0.03, max: 2, description: "panel height" },
    },
    material: "glass",
  },
  {
    id: "camera_lens",
    name: "Camera lens",
    description: "Camera lens module with glass element and ring, facing +Z.",
    size: [0.016, 0.016, 0.005],
    attach: {},
    params: { radius: { default: 0.008, min: 0.002, max: 0.1, description: "lens radius" } },
    material: "glass",
  },
  {
    id: "rubber_foot",
    name: "Rubber foot",
    description: "Small rubber bumper foot; stick it to an underside (its +Z points down when rotated to face -Y).",
    size: [0.02, 0.02, 0.006],
    attach: {},
    material: "rubber",
  },
  {
    id: "stitching",
    name: "Stitch line",
    description: "Row of thread stitches along X, for seams and panel edges.",
    size: [0.3, 0.002, 0.001],
    attach: { start: [-0.15, 0, 0], end: [0.15, 0, 0] },
    params: { length: { default: 0.3, min: 0.02, max: 2, description: "seam length along X" } },
    material: "cotton",
  },
  {
    id: "brand_patch",
    name: "Brand patch",
    description: "Stitched woven label patch with a sparkle emblem, facing +Z.",
    size: [0.06, 0.035, 0.003],
    attach: {},
    params: {
      width: { default: 0.06, min: 0.015, max: 0.4, description: "patch width" },
      height: { default: 0.035, min: 0.01, max: 0.3, description: "patch height" },
    },
    material: "canvas",
  },
  {
    id: "mesh_pocket",
    name: "Mesh pocket",
    description: "Stretch mesh side pocket with an elastic rim, open at +Y, bulging out along +Z.",
    size: [0.12, 0.14, 0.04],
    attach: { rim: [0, 0.07, 0.03] },
    params: {
      width: { default: 0.12, min: 0.03, max: 0.6, description: "pocket width" },
      height: { default: 0.14, min: 0.03, max: 0.6, description: "pocket height" },
    },
    material: "nylon",
  },
  {
    id: "bulb",
    name: "Light bulb",
    description: "Glowing light bulb with a screw base; base at the origin, bulb rising along +Y. Glow color = material color.",
    size: [0.06, 0.11, 0.06],
    attach: { base: [0, 0, 0] },
    material: "glass",
  },
];

export const KIT_IDS = new Set(KIT.map((k) => k.id));
export const kitById = (id: string) => KIT.find((k) => k.id === id);
