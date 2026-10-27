import type { ModuleCategory } from "../../kit.ts";
import { MESH_MODELS } from "../../meshes.ts";
import type { Part, PartMaterial } from "../../product.ts";
import { deformNormal, deformPoint, type DeformParams } from "../deform.ts";
import type { ControlSpec, FashionTemplate, ModulePlacement, V3, Zone } from "../types.ts";

/**
 * Fashion templates over a prepared base model (tools/prep-garments): every model node becomes a
 * kind "mesh" part (body, sleeve_l, collar...), controls become per-node deformer params, and the
 * zones the prep script found on the surface follow the same deformation. Returns null when the
 * model has not been prepared yet, so a missing download just means no template.
 */
export interface MeshTemplateSpec {
  id: string;
  model: string;
  name: string;
  category: string;
  kind: ModuleCategory;
  keywords: string[];
  description: string;
  targetPriceUsd: number;
  controls: Record<string, ControlSpec>;
  /** Slot -> nodes it covers (base parts), description and default material. */
  slots: Record<string, { description: string; nodes: string[]; default: PartMaterial; follows?: string[] }>;
  /** The node that is the root part (every other node is its child, all in the model frame). */
  root: string;
  /** Deformer params for one node at these control values (see deform.ts). */
  deform: (controls: Record<string, string>, node: string) => DeformParams;
  /** Nodes left out at these control values (collar "none"), with every zone on them. */
  hide?: (controls: Record<string, string>) => string[];
  /** Readable names for nodes ("sleeve_l" -> "Left sleeve"). */
  names?: Record<string, string>;
  modules: ModulePlacement[];
  display: FashionTemplate["display"];
  /**
   * Display form overrides (model frame, meters). By default the form is fitted from the root node's
   * bounds: tops/outerwear/dresses on a dress form torso on a stand, skirts on a hip form on a stand,
   * bottoms with a hip form inside the waistband.
   */
  form?: Partial<FormFit> | false;
  /** Extra zones computed from the model's own (e.g. a zone placed relative to another). */
  extraZones?: (zones: Record<string, Zone>, controls: Record<string, string>) => Record<string, Zone>;
}

export interface FormFit {
  /** Form width and depth at its widest. */
  width: number;
  depth: number;
  /** Bottom of the form and its top (torso: the shoulder line; hip form: the waist cap). */
  bottom: number;
  top: number;
  /** Neck length above the shoulder line (torso only). */
  neck: number;
  /** Form center along z. */
  z: number;
  /** How far the garment is raised so the stand shows under it (0 = it stands on the floor). */
  lift: number;
}

const DISPLAY_MATERIAL: PartMaterial = { preset: "linen", color: "#E8E0D2" };
const STAND_MATERIAL: PartMaterial = { preset: "metal_brushed", color: "#B9BCC2" };

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const v4 = (p: V3): V3 => [r4(p[0]), r4(p[1]), r4(p[2])];

const pretty = (node: string) =>
  node
    .replace(/_l$/, " left").replace(/_r$/, " right").replace(/_left$/, " left").replace(/_right$/, " right")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());

/** The display form for a template: which form, and its fit from the model's bounds. */
function formFit(spec: MeshTemplateSpec, bounds: Record<string, { min: [number, number, number]; max: [number, number, number] }>): { kind: "torso" | "hip" | "waist"; fit: FormFit } | null {
  if (spec.form === false || spec.display !== "form") return null;
  const kind = spec.kind === "skirt" ? "hip" : spec.kind === "bottom" ? "waist" : spec.kind === "top" || spec.kind === "outerwear" || spec.kind === "dress" ? "torso" : null;
  if (!kind) return null;
  const b = (kind === "waist" && bounds.waistband) || bounds[spec.root];
  if (!b) return null;
  const W = b.max[0] - b.min[0], D = b.max[2] - b.min[2];
  const z = (b.min[2] + b.max[2]) / 2;
  const base: FormFit =
    kind === "torso"
      ? { width: W * 0.62, depth: D * 0.62, bottom: b.min[1] - 0.03, top: b.max[1] - 0.07, neck: 0.1, z, lift: 0.38 }
      : kind === "hip"
        ? { width: W * 0.8, depth: D * 0.8, bottom: b.max[1] - 0.25, top: b.max[1] - 0.012, neck: 0, z, lift: 0.32 }
        : { width: W * 0.86, depth: D * 0.86, bottom: b.max[1] - 0.16, top: b.max[1] - 0.012, neck: 0, z, lift: 0 };
  return { kind, fit: { ...base, ...(spec.form || {}) } };
}

/** The form (and its stand) as base parts in the "display" slot, children of the root. */
function displayParts(form: { kind: "torso" | "hip" | "waist"; fit: FormFit }, root: string, cover: PartMaterial): Part[] {
  const f = form.fit;
  const h = Math.max(0.06, f.top - f.bottom);
  const out: Part[] = [
    {
      id: "display_form",
      name: form.kind === "torso" ? "Dress form" : "Hip form",
      kind: "kit",
      kitAsset: form.kind === "torso" ? "form_torso" : "form_hip",
      kitParams: form.kind === "torso"
        ? { width: r4(f.width), depth: r4(f.depth), height: r4(h), neck: r4(f.neck) }
        : { width: r4(f.width), depth: r4(f.depth), height: r4(h), waist: form.kind === "waist" ? 0.94 : 0.82 },
      parent: root,
      transform: { position: [0, r4(f.bottom), r4(f.z)], rotation: [0, 0, 0], scale: [1, 1, 1] },
      material: { ...cover },
    },
  ];
  if (f.lift > 0)
    out.push({
      id: "display_stand",
      name: "Form stand",
      kind: "kit",
      kitAsset: "form_stand",
      kitParams: { height: r4(f.lift + f.bottom), base: 0.17, style: "round" },
      parent: root,
      transform: { position: [0, r4(-f.lift), r4(f.z)], rotation: [0, 0, 0], scale: [1, 1, 1] },
      material: { ...STAND_MATERIAL },
    });
  return out;
}

export function meshTemplate(spec: MeshTemplateSpec): FashionTemplate | null {
  const model = MESH_MODELS[spec.model];
  if (!model || !model.nodes.includes(spec.root)) return null;
  const form = formFit(spec, model.bounds);
  const nodeSlot = new Map<string, string>();
  for (const [slot, s] of Object.entries(spec.slots)) for (const n of s.nodes) nodeSlot.set(n, slot);
  const firstSlot = Object.keys(spec.slots)[0];

  const build = (controls: Record<string, string>): Part[] => {
    const hidden = new Set(spec.hide?.(controls) ?? []);
    const nodes = [spec.root, ...model.nodes.filter((n) => n !== spec.root && !hidden.has(n))];
    const garment = nodes.map((node) => {
      const params = spec.deform(controls, node);
      const clean: Record<string, number> = {};
      for (const [k, v] of Object.entries(params)) if (typeof v === "number" && Number.isFinite(v)) clean[k] = r4(v);
      const slot = nodeSlot.get(node) ?? firstSlot;
      return {
        id: node,
        name: spec.names?.[node] ?? pretty(node),
        kind: "mesh",
        meshAsset: `${spec.model}/${node}`,
        ...(Object.keys(clean).length ? { kitParams: clean } : {}),
        parent: node === spec.root ? null : spec.root,
        // The root carries the lift onto the stand; every other node (and detail) rides on it.
        transform: { position: [0, node === spec.root && form ? form.fit.lift : 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        material: { ...spec.slots[slot].default },
      } satisfies Part;
    });
    return form ? [...garment, ...displayParts(form, spec.root, DISPLAY_MATERIAL)] : garment;
  };

  const zones = (controls: Record<string, string>): Record<string, Zone> => {
    const out: Record<string, Zone> = {};
    const hidden = new Set(spec.hide?.(controls) ?? []);
    for (const [name, z] of Object.entries(model.zones ?? {})) {
      if (hidden.has(z.part)) continue;
      const params = spec.deform(controls, z.part);
      const zone: Zone = { part: z.part, label: z.label };
      if (z.at) {
        zone.at = v4(deformPoint(z.at, params));
        zone.normal = v4(deformNormal(z.at, z.normal ?? [0, 0, 1], params));
      }
      if (z.path) {
        zone.path = z.path.map((p) => v4(deformPoint(p, params)));
        zone.normals = z.path.map((p, i) => v4(deformNormal(p, z.normals?.[i] ?? [0, 0, 1], params)));
      }
      if (z.room) zone.room = z.room;
      if (z.bend) zone.bend = z.bend;
      out[name] = zone;
    }
    return spec.extraZones ? { ...out, ...spec.extraZones(out, controls) } : out;
  };

  return {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    kind: spec.kind,
    keywords: spec.keywords,
    description: spec.description,
    targetPriceUsd: spec.targetPriceUsd,
    controls: spec.controls,
    slots: {
      ...Object.fromEntries(Object.entries(spec.slots).map(([k, s]) => [k, { description: s.description, parts: s.nodes.filter((n) => model.nodes.includes(n)), default: s.default, ...(s.follows ? { follows: s.follows } : {}) }])),
      ...(form ? { display: { description: "the display form's cover (presentation, not part of the product)", parts: ["display_form"], default: DISPLAY_MATERIAL } } : {}),
    },
    build,
    zones,
    modules: spec.modules,
    display: spec.display,
  };
}
