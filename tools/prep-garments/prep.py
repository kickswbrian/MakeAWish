"""
Prepare a downloaded garment/bag model as a Wish it base mesh (run headless):

  blender -b -P tools/prep-garments/prep.py -- <model id> [--inspect]

Reads assets-src/<id>/ (scene.gltf, *.glb, *.fbx or *.obj) and the model's config
(tools/prep-garments/models/<id>.json), then:
  1. imports, drops unwanted objects (mannequins, extra garments), joins the rest;
  2. orients (Y up, +Z front in glTF), scales to real size, centers (bottom at y = 0);
  3. decimates to the triangle budget;
  4. splits faces into named pieces by ordered rules (sleeve_l, collar, body...); a rule named
     "_drop" deletes its faces (an inner tee baked into the jacket mesh);
  5. finds attachment zones on the surface (rings, lines, points) with outward normals;
  6. exports build/<id>.glb (one node per piece) and build/<id>.json (nodes, bounds, zones).
     With "fold": "<material regex>", the source material's baked normal map (folds, seams,
     stitching) is kept as build/<id>_fold.jpg, and a _FOLD vertex attribute (1 on faces that came
     from that material) tells the renderer where the map applies.
--inspect prints object names, materials, size and triangle count, then exits (for writing rules).
--islands runs steps 1-3 and prints the connected pieces (center, size, source) for island rules;
--pieces prints the UV pattern pieces (bounded by UV seams) for piece rules.

Coordinates in the configs are glTF/three space (meters after scaling): x right, y up, z front.
Blender's own space is x right, y back, z up; helpers convert at the boundary.
"""

import bmesh
import bpy
import json
import math
import os
import re
import sys
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HERE = os.path.dirname(os.path.abspath(__file__))


def three_to_bl(v):
    return Vector((v[0], -v[2], v[1]))


def bl_to_three(v):
    return [round(v[0], 4), round(v[2], 4), round(-v[1], 4)]


def log(*a):
    print("[prep]", *a, flush=True)


# ---------- Import ----------


def import_model(src):
    files = os.listdir(src)
    pick = None
    for ext in (".glb", ".gltf", ".fbx", ".obj"):
        found = sorted(f for f in files if f.lower().endswith(ext))
        if found:
            pick = os.path.join(src, found[0])
            break
    if not pick:
        # Sketchfab zips sometimes nest a folder.
        for d in files:
            p = os.path.join(src, d)
            if os.path.isdir(p):
                return import_model(p)
        raise SystemExit(f"no model file in {src}")
    log("importing", pick)
    if pick.endswith((".glb", ".gltf")):
        bpy.ops.import_scene.gltf(filepath=pick)
    elif pick.endswith(".fbx"):
        bpy.ops.import_scene.fbx(filepath=pick)
    else:
        bpy.ops.wm.obj_import(filepath=pick)


def mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def tri_count(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)


def world_bbox(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi


def inspect():
    objs = mesh_objects()
    lo, hi = world_bbox(objs)
    log("size (blender x,y,z):", [round(v, 3) for v in (hi - lo)], "tris:", tri_count(objs))
    for o in objs:
        olo, ohi = world_bbox([o])
        mats = [m.name for m in o.data.materials if m]
        log(f"  {o.name!r} tris={tri_count([o])} mats={mats} min={[round(v,3) for v in olo]} max={[round(v,3) for v in ohi]}")


# ---------- Clean up ----------


def fold_source(cfg, model_id):
    """Mark faces from the fold material (_FOLD = 1) and save its normal map as build/<id>_fold.jpg."""
    pat = cfg.get("fold")
    if not pat:
        return None
    rx = re.compile(pat, re.I)
    image = None
    for o in mesh_objects():
        mats = [m for m in o.data.materials if m]
        hit = any(rx.search(m.name) for m in mats)
        attr = o.data.attributes.get("_FOLD") or o.data.attributes.new("_FOLD", "FLOAT", "POINT")
        if hit:
            on = set()
            for poly in o.data.polygons:
                m = o.data.materials[poly.material_index] if poly.material_index < len(o.data.materials) else None
                if m and rx.search(m.name):
                    on.update(poly.vertices)
            for i in on:
                attr.data[i].value = 1.0
        for m in mats:
            if image or not rx.search(m.name) or not m.use_nodes:
                continue
            for n in m.node_tree.nodes:
                if n.type == "NORMAL_MAP" and n.inputs["Color"].is_linked:
                    src = n.inputs["Color"].links[0].from_node
                    if src.type == "TEX_IMAGE" and src.image:
                        image = src.image
    if not image:
        log("fold: no normal map found on", pat)
        return None
    size = cfg.get("fold_size", 1024)
    img = image.copy()
    w, h = img.size
    if max(w, h) > size:
        img.scale(size, max(1, round(h * size / w)) if w >= h else size)
    os.makedirs(os.path.join(HERE, "build"), exist_ok=True)
    out = os.path.join(HERE, "build", f"{model_id}_fold.jpg")
    img.filepath_raw = out
    img.file_format = "JPEG"
    q = cfg.get("fold_quality", 85)
    bpy.context.scene.render.image_settings.quality = q
    img.save(filepath=out, quality=q)
    log("fold map", image.name, list(image.size), "->", out, list(img.size))
    return f"{model_id}_fold.jpg"


SOURCES = []


def drop_and_join(cfg):
    drop = [re.compile(p, re.I) for p in cfg.get("drop", [])]
    keep = [re.compile(p, re.I) for p in cfg.get("keep", [])]
    for o in list(mesh_objects()):
        name = o.name + " " + " ".join(m.name for m in o.data.materials if m)
        if (drop and any(r.search(name) for r in drop)) or (keep and not any(r.search(name) for r in keep)):
            bpy.data.objects.remove(o, do_unlink=True)
    objs = mesh_objects()
    if not objs:
        raise SystemExit("nothing left after drop/keep")
    # Bake parents/armatures away so world transforms are in the mesh data.
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
        for m in list(o.modifiers):
            if m.type == "ARMATURE":
                o.modifiers.remove(m)
    # Remember each face's source object and material for the split rules (src, mat).
    global SOURCES
    SOURCES = []
    for o in objs:
        attr = o.data.attributes.get("_SRC") or o.data.attributes.new("_SRC", "INT", "FACE")
        base = len(SOURCES)
        mats = [m.name if m else "" for m in o.data.materials] or [""]
        SOURCES.extend(f"{o.name}|{m}" for m in mats)
        for poly in o.data.polygons:
            attr.data[poly.index].value = base + min(poly.material_index, len(mats) - 1)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    for o in list(bpy.context.scene.objects):
        if o != obj:
            bpy.data.objects.remove(o, do_unlink=True)
    return obj


def orient_scale(obj, cfg):
    rot = cfg.get("rotate")  # degrees, three-space XYZ, applied before scaling
    if rot:
        r = Matrix.Rotation(math.radians(rot[0]), 4, "X") @ Matrix.Rotation(math.radians(-rot[2]), 4, "Y") @ Matrix.Rotation(math.radians(rot[1]), 4, "Z")
        obj.data.transform(r)
    me = obj.data
    lo = Vector((min(v.co.x for v in me.vertices), min(v.co.y for v in me.vertices), min(v.co.z for v in me.vertices)))
    hi = Vector((max(v.co.x for v in me.vertices), max(v.co.y for v in me.vertices), max(v.co.z for v in me.vertices)))
    size = hi - lo
    s = cfg["height"] / size.z
    cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
    if "center_x" in cfg:
        cx = lo.x + cfg["center_x"] * size.x
    me.transform(Matrix.Scale(s, 4) @ Matrix.Translation((-cx, -cy, -lo.z)))
    me.update()
    log("scaled by", round(s, 5), "-> size (three x,y,z):", [round(size.x * s, 3), round(size.z * s, 3), round(size.y * s, 3)])


def warp(obj, cfg):
    """
    "warp": {"x": expr, "y": expr, "z": expr} reshapes the base in three space (x, y, z of each vertex,
    math available) before splitting, so zones follow: e.g. flatten a blousy front into a knit's drape.
    """
    w = cfg.get("warp")
    if not w:
        return
    env = {"abs": abs, "min": min, "max": max, "math": math}
    code = {k: compile(w[k], f"warp.{k}", "eval") for k in ("x", "y", "z") if k in w}
    for v in obj.data.vertices:
        loc = dict(env, x=v.co.x, y=v.co.z, z=-v.co.y)
        x, y, z = (eval(code[k], {"__builtins__": {}}, loc) if k in code else loc[k] for k in ("x", "y", "z"))
        v.co = (x, -z, y)
    obj.data.update()
    log("warped", ", ".join(code))


def decimate(obj, budget):
    tris = tri_count([obj])
    if tris <= budget:
        return
    mod = obj.modifiers.new("dec", "DECIMATE")
    mod.ratio = budget / tris
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier="dec")
    log("decimated", tris, "->", tri_count([obj]))


# ---------- Splitting ----------


def islands(obj):
    """Connected face islands (pattern pieces): per-face island index, and per island its three-space
    bbox center/size and triangle count."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    of = [-1] * len(bm.faces)
    info = []
    for f0 in bm.faces:
        if of[f0.index] >= 0:
            continue
        k = len(info)
        stack = [f0]
        of[f0.index] = k
        lo = [1e9] * 3
        hi = [-1e9] * 3
        tris = 0
        while stack:
            f = stack.pop()
            tris += len(f.verts) - 2
            for v in f.verts:
                c = (v.co.x, v.co.z, -v.co.y)
                for i in range(3):
                    lo[i] = min(lo[i], c[i])
                    hi[i] = max(hi[i], c[i])
            for e in f.edges:
                for g in e.link_faces:
                    if of[g.index] < 0:
                        of[g.index] = k
                        stack.append(g)
        info.append({"c": [(lo[i] + hi[i]) / 2 for i in range(3)], "s": [hi[i] - lo[i] for i in range(3)], "tris": tris})
    bm.free()
    return of, info


def uv_pieces(obj):
    """
    Pattern pieces from the source UV layout: faces connected across edges whose UVs match on both
    sides (a UV seam is a sewing seam). Per-face piece index, and per piece its three-space bbox
    center/size, UV center and triangle count.
    """
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    uvl = bm.loops.layers.uv.active
    if uvl is None:
        bm.free()
        return None
    def luv(f, v):
        for l in f.loops:
            if l.vert == v:
                return l[uvl].uv
    of = [-1] * len(bm.faces)
    info = []
    for f0 in bm.faces:
        if of[f0.index] >= 0:
            continue
        k = len(info)
        stack = [f0]
        of[f0.index] = k
        lo = [1e9] * 3
        hi = [-1e9] * 3
        su = sv = 0.0
        n = 0
        tris = 0
        while stack:
            f = stack.pop()
            tris += len(f.verts) - 2
            for l in f.loops:
                c = (l.vert.co.x, l.vert.co.z, -l.vert.co.y)
                for i in range(3):
                    lo[i] = min(lo[i], c[i])
                    hi[i] = max(hi[i], c[i])
                su += l[uvl].uv.x
                sv += l[uvl].uv.y
                n += 1
            for e in f.edges:
                a, b = e.verts
                for g in e.link_faces:
                    if of[g.index] >= 0 or g is f:
                        continue
                    if (luv(f, a) - luv(g, a)).length < 1e-4 and (luv(f, b) - luv(g, b)).length < 1e-4:
                        of[g.index] = k
                        stack.append(g)
        info.append({"c": [(lo[i] + hi[i]) / 2 for i in range(3)], "s": [hi[i] - lo[i] for i in range(3)], "uv": [su / n, sv / n], "tris": tris})
    bm.free()
    return of, info


def log_islands(info, src_of=None):
    order = sorted(range(len(info)), key=lambda k: -info[k]["tris"])
    log(f"{len(info)} islands (three space, center / size):")
    for k in order[:60]:
        i = info[k]
        log(f"  #{k} tris={i['tris']} c={[round(v, 3) for v in i['c']]} s={[round(v, 3) for v in i['s']]}" + (f" uv={[round(v, 3) for v in i['uv']]}" if "uv" in i else "") + (f" src={src_of[k]}" if src_of else ""))


def split(obj, rules, isl=None, pcs=None):
    """
    Assign each face to the first rule whose expression is true for it. Rule variables: x, y, z and
    nx, ny, nz (face center and normal, three space); src (source "object|material" name); island
    center icx, icy, icz, size iw, ih, idp and its triangle count itris (connected pattern piece).
    """
    names = [r["name"] for r in rules]
    me = obj.data
    srcattr = me.attributes.get("_SRC")
    srcs = [srcattr.data[p.index].value for p in me.polygons] if srcattr else None
    of, info = isl if isl else (None, None)
    me.materials.clear()
    for n in names:
        me.materials.append(bpy.data.materials.get(n) or bpy.data.materials.new(n))
    counts = {n: 0 for n in names}
    env = {"abs": abs, "min": min, "max": max, "math": math}
    compiled = [compile(r["when"], r["name"], "eval") for r in rules]
    for p in me.polygons:
        c = p.center
        x, y, z = c.x, c.z, -c.y
        nx, ny, nz = p.normal.x, p.normal.z, -p.normal.y
        loc = dict(env, x=x, y=y, z=z, nx=nx, ny=ny, nz=nz, src=SOURCES[srcs[p.index]] if srcs and srcs[p.index] < len(SOURCES) else "")
        if of:
            i = info[of[p.index]]
            loc.update(icx=i["c"][0], icy=i["c"][1], icz=i["c"][2], iw=i["s"][0], ih=i["s"][1], idp=i["s"][2], itris=i["tris"])
        if pcs:
            k = pcs[0][p.index]
            i = pcs[1][k]
            loc.update(piece=k, pcx=i["c"][0], pcy=i["c"][1], pcz=i["c"][2], pw=i["s"][0], ph=i["s"][1], pd=i["s"][2], pu=i["uv"][0], pv=i["uv"][1], ptris=i["tris"])
        idx = len(names) - 1
        for i, code in enumerate(compiled):
            if eval(code, {"__builtins__": {}}, loc):
                idx = i
                break
        p.material_index = idx
        counts[names[idx]] += 1
    log("split:", counts)
    if "_drop" in names and counts["_drop"]:
        k = names.index("_drop")
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index == k], context="FACES")
        bm.to_mesh(me)
        bm.free()
        me.update()
    return [n for n in names if counts[n] > 0 and n != "_drop"]


# ---------- Zones ----------


class Surface:
    def __init__(self, obj):
        self.obj = obj
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.faces.ensure_lookup_table()
        self.bm = bm
        self.bvh = BVHTree.FromBMesh(bm)
        self.mats = [m.name for m in obj.data.materials]

    def piece_at(self, face_index):
        return self.mats[self.bm.faces[face_index].material_index]

    def ray(self, origin3, dir3):
        """First hit from a three-space origin along a three-space direction."""
        hit = self.bvh.ray_cast(three_to_bl(origin3), three_to_bl(dir3).normalized())
        if hit[0] is None:
            return None
        loc, nrm, idx, _ = hit
        # Outward: facing back toward the ray origin.
        if nrm.dot(three_to_bl(dir3)) > 0:
            nrm = -nrm
        return bl_to_three(loc), [round(v, 4) for v in bl_to_three(nrm)], self.piece_at(idx)

    def nearest(self, p3):
        loc, nrm, idx, _ = self.bvh.find_nearest(three_to_bl(p3))
        return bl_to_three(loc), [round(v, 4) for v in bl_to_three(nrm)], self.piece_at(idx)


def zone_point(surf, z):
    """
    Cast from outside toward the surface: {"from": [x,y,z], "dir": [dx,dy,dz]}, or the closest
    surface point to {"near": [x,y,z]} (where a dropped button sat).
    """
    hit = surf.nearest(z["near"]) if "near" in z else surf.ray(z["from"], z["dir"])
    if not hit:
        return None
    p, n, piece = hit
    out = {"part": z.get("part", piece), "at": push(p, n, z.get("lift", 0.001)), "normal": n}
    if "room" in z:
        out["room"] = z["room"]
    if "bend" in z:
        out["bend"] = z["bend"]
    return out


def push(p, n, d):
    return [round(p[i] + n[i] * d, 4) for i in range(3)]


def zone_line(surf, z):
    """A line of rays: from a to b (three space) casting along dir; n samples."""
    a, b, d = z["from"], z["to"], z["dir"]
    n = z.get("samples", 16)
    pts, nrms, pieces = [], [], []
    for i in range(n):
        t = i / (n - 1)
        o = [a[k] + (b[k] - a[k]) * t for k in range(3)]
        hit = surf.ray(o, d)
        if hit:
            p, nn, piece = hit
            pts.append(push(p, nn, z.get("lift", 0.0008)))
            nrms.append(nn)
            pieces.append(piece)
    if len(pts) < 2:
        return None
    part = z.get("part") or max(set(pieces), key=pieces.count)
    return {"part": part, "path": pts, "normals": nrms}


def zone_ring(surf, z):
    """
    A closed loop around an axis: rays cast inward from a circle of radius r around center c in the
    plane perpendicular to axis (three space). Ordered so W = N x T points along +axis ("into" the garment
    when the axis points from the opening toward the body), starting at the back so @0.5 is the front.
    """
    c, ax = Vector(z["center"]), Vector(z["axis"]).normalized()
    r = z.get("radius", 0.6)
    n = z.get("samples", 36)
    # Basis in the ring plane.
    ref = Vector((0, 0, 1)) if abs(ax.z) < 0.9 else Vector((1, 0, 0))
    u = ax.cross(ref).normalized()
    v = ax.cross(u).normalized()
    pts, nrms, pieces = [], [], []
    for i in range(n):
        a = 2 * math.pi * i / n
        d = u * math.cos(a) + v * math.sin(a)
        o = c + d * r
        hit = surf.ray(list(o), list(-d))
        if hit:
            p, nn, piece = hit
            pts.append(push(p, nn, z.get("lift", 0.0008)))
            nrms.append(nn)
            pieces.append(piece)
    if len(pts) < 3:
        return None
    # Orientation: W = N x T should point along +axis.
    p0, p1 = Vector(pts[0]), Vector(pts[1])
    t = (p1 - p0).normalized()
    w = Vector(nrms[0]).cross(t)
    if w.dot(ax) < 0:
        pts.reverse()
        nrms.reverse()
    # Start at center back (by angle around the ring center, so a flat back hem doesn't shift it):
    # the ring's midpoint (@0.5) is then the front center.
    back = Vector((0, 0, -1))
    back = (back - ax * back.dot(ax)).normalized() if (back - ax * back.dot(ax)).length > 1e-6 else u

    def facing(i):
        d = Vector(pts[i]) - c
        d = d - ax * d.dot(ax)
        return d.normalized().dot(back) if d.length > 1e-9 else -1

    k = max(range(len(pts)), key=facing)
    pts = pts[k:] + pts[:k]
    nrms = nrms[k:] + nrms[:k]
    pts.append(list(pts[0]))
    nrms.append(list(nrms[0]))
    part = z.get("part") or max(set(pieces), key=pieces.count)
    return {"part": part, "path": pts, "normals": nrms}


def find_zones(obj, specs):
    surf = Surface(obj)
    out = {}
    for name, z in specs.items():
        kind = z.get("kind", "point")
        zone = {"point": zone_point, "line": zone_line, "ring": zone_ring}[kind](surf, z)
        if zone is None:
            log("  zone MISSED:", name)
            continue
        zone["label"] = z.get("label", name.replace("_", " "))
        out[name] = zone
    log("zones:", ", ".join(out))
    return out


# ---------- Export ----------


def export(obj, pieces, model_id):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="MATERIAL")
    bpy.ops.object.mode_set(mode="OBJECT")
    bounds = {}
    nodes = []
    for o in mesh_objects():
        name = o.data.materials[0].name if o.data.materials else o.name
        name = re.sub(r"\.\d+$", "", name)
        o.name = name
        o.data.name = name
        # Plain material per piece: the renderer applies fabric presets; keep only the name.
        lo, hi = world_bbox([o])
        bounds[name] = {"min": bl_to_three(Vector((lo.x, hi.y, lo.z))), "max": bl_to_three(Vector((hi.x, lo.y, hi.z)))}
        nodes.append(name)
        for poly in o.data.polygons:
            poly.use_smooth = True
    os.makedirs(os.path.join(HERE, "build"), exist_ok=True)
    glb = os.path.join(HERE, "build", f"{model_id}.glb")
    bpy.ops.export_scene.gltf(
        filepath=glb, export_format="GLB", use_selection=False, export_yup=True, export_apply=True,
        export_texcoords=True, export_normals=True, export_materials="PLACEHOLDER", export_animations=False,
        export_attributes=True, export_vertex_color="NONE",
    )
    log("exported", glb, "nodes:", nodes)
    return nodes, bounds


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    model_id = argv[0]
    own = os.path.join(HERE, "models", f"{model_id}.json")
    cfg = json.load(open(own)) if os.path.exists(own) else {}
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # "source": another download folder (one ensemble download feeding two templates).
    import_model(os.path.join(ROOT, "assets-src", cfg.get("source", model_id)))
    if "--inspect" in argv or not cfg.get("rules"):
        inspect()
        return
    fold = fold_source(cfg, model_id)
    obj = drop_and_join(cfg)
    orient_scale(obj, cfg)
    warp(obj, cfg)
    # Weld exporter splits so decimation and normals stay smooth.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=cfg.get("weld", 0.0002))
    bm.to_mesh(obj.data)
    bm.free()
    decimate(obj, cfg.get("budget", 60000))
    isl = islands(obj)
    pcs = uv_pieces(obj)
    if "--pieces" in argv and pcs:
        log_islands(pcs[1])
        return
    if "--islands" in argv:
        srcattr = obj.data.attributes.get("_SRC")
        src_of = {}
        if srcattr:
            for p in obj.data.polygons:
                src_of.setdefault(isl[0][p.index], SOURCES[srcattr.data[p.index].value] if srcattr.data[p.index].value < len(SOURCES) else "")
        log_islands(isl[1], src_of)
        return
    pieces = split(obj, cfg["rules"], isl, pcs)
    zones = find_zones(obj, cfg.get("zones", {}))
    nodes, bounds = export(obj, pieces, model_id)
    meta = {"id": model_id, "nodes": nodes, "bounds": bounds, "zones": zones, "credit": cfg.get("credit", ""), "tris": tri_count(mesh_objects())}
    if fold:
        meta["fold"] = fold
    json.dump(meta, open(os.path.join(HERE, "build", f"{model_id}.json"), "w"), indent=1)
    log("done", model_id, "tris", meta["tris"])


main()
