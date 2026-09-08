"""Measure, and optionally drop, geometry parked far from the building.

The SketchUp file keeps imported CAD linework beside the building. It is flat
at z = 0 and six times wider than the site, so the viewer's fit-to-model leaves
the building a thumbnail in the corner. Nothing references it, so the export
copy in the repo drops it.

Run it without --apply first and read the two bounding boxes: "kept" should be
the site, "far" should be the scrap. Only then re-run with --apply.

Usage: python tools/strip-far-geometry.py <file.dae> [--apply] [--cut 8000]
"""
import sys
import numpy as np
import xml.etree.ElementTree as ET

NS = 'http://www.collada.org/2005/11/COLLADASchema'
Q = '{%s}' % NS

PATH = sys.argv[1]
APPLY = '--apply' in sys.argv
CUT_X = float(sys.argv[sys.argv.index('--cut') + 1]) if '--cut' in sys.argv else 8000.0

ET.register_namespace('', NS)
tree = ET.parse(PATH)
root = tree.getroot()


def tag(e):
    return e.tag.split('}')[-1]


geo_bounds = {}
for g in root.iter(Q + 'geometry'):
    mesh = g.find(Q + 'mesh')
    if mesh is None:
        continue
    verts = mesh.find(Q + 'vertices')
    if verts is None:
        continue
    src_id = next((i.get('source')[1:] for i in verts.findall(Q + 'input')
                   if i.get('semantic') == 'POSITION'), None)
    src = mesh.find(f"{Q}source[@id='{src_id}']") if src_id else None
    if src is None:
        continue
    v = np.fromstring(src.find(Q + 'float_array').text, sep=' ')
    v = v[:len(v) // 3 * 3].reshape(-1, 3)
    if len(v):
        geo_bounds[g.get('id')] = (v.min(0), v.max(0))

# Nodes reachable through <instance_node>, which SketchUp uses for components.
lib_nodes = {}
for ln in root.iter(Q + 'library_nodes'):
    for n in ln.iter(Q + 'node'):
        if n.get('id'):
            lib_nodes[n.get('id')] = n


def local_matrix(node):
    M = np.eye(4)
    for ch in node:
        if tag(ch) == 'matrix':
            M = M @ np.fromstring(ch.text, sep=' ').reshape(4, 4)
    return M


def corners_world(mn, mx, T):
    c = np.array([[x, y, z, 1.0]
                  for x in (mn[0], mx[0])
                  for y in (mn[1], mx[1])
                  for z in (mn[2], mx[2])])
    return (T @ c.T).T[:, :3]


def bounds_of(node, M, seen=()):
    """World bbox of everything `node` draws, or None."""
    T = M @ local_matrix(node)
    mins, maxs = [], []

    def take(b):
        if b is not None:
            mins.append(b[0])
            maxs.append(b[1])

    for ch in node:
        t = tag(ch)
        if t == 'node':
            take(bounds_of(ch, T, seen))
        elif t == 'instance_geometry':
            gid = (ch.get('url') or '')[1:]
            if gid in geo_bounds:
                w = corners_world(*geo_bounds[gid], T)
                take((w.min(0), w.max(0)))
        elif t == 'instance_node':
            nid = (ch.get('url') or '')[1:]
            if nid in lib_nodes and nid not in seen:
                take(bounds_of(lib_nodes[nid], T, seen + (nid,)))

    if not mins:
        return None
    return np.array(mins).min(0), np.array(maxs).max(0)


kept, far, dropped = [], [], 0


def scan(parent, M):
    """Walk the visual scene, recording (and optionally removing) far draws."""
    global dropped
    T = M @ local_matrix(parent)

    for ch in list(parent):
        t = tag(ch)
        b = None
        if t == 'node':
            b = bounds_of(ch, T)
            if b is not None and b[0][0] > CUT_X:
                far.append(b)
                if APPLY:
                    parent.remove(ch)
                    dropped += 1
            else:
                scan(ch, T)
            continue
        if t == 'instance_geometry':
            gid = (ch.get('url') or '')[1:]
            if gid in geo_bounds:
                w = corners_world(*geo_bounds[gid], T)
                b = (w.min(0), w.max(0))
        elif t == 'instance_node':
            nid = (ch.get('url') or '')[1:]
            if nid in lib_nodes:
                b = bounds_of(lib_nodes[nid], T, (nid,))
        if b is None:
            continue
        if b[0][0] > CUT_X:
            far.append(b)
            if APPLY:
                parent.remove(ch)
                dropped += 1
        else:
            kept.append(b)


for vs in root.iter(Q + 'visual_scene'):
    scan(vs, np.eye(4))


def report(name, boxes):
    if not boxes:
        print(f'{name}: none')
        return
    mn = np.array([b[0] for b in boxes]).min(0)
    mx = np.array([b[1] for b in boxes]).max(0)
    print(f'{name}: {len(boxes)} draws  min {np.round(mn, 1)}  max {np.round(mx, 1)}')


report('kept', kept)
report(f'far (x > {CUT_X:.0f})', far)

if APPLY:
    tree.write(PATH, encoding='utf-8', xml_declaration=True)
    print('dropped', dropped, 'draws')
