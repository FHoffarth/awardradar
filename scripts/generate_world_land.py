"""
Generate static/world-land.js from Natural Earth 110m land GeoJSON.

Downloads ne_110m_land.geojson from GitHub, filters tiny polygons,
simplifies to display resolution, and writes a compact JS constant.

Usage: python scripts/generate_world_land.py
"""

import json
import math
import urllib.request
import os

SRC_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson"
OUT_FILE = os.path.join(os.path.dirname(__file__), "..", "static", "world-land.js")

# At globe R≈200px, 1° ≈ 3.5px. Points <0.4° apart are sub-pixel — remove them.
MIN_DIST_DEG = 0.4
# Polygons with fewer than this many raw points are tiny islands — skip.
MIN_RING_POINTS = 12


def simplify(ring):
    """Remove consecutive points closer than MIN_DIST_DEG in either axis."""
    if not ring:
        return ring
    out = [ring[0]]
    for p in ring[1:]:
        prev = out[-1]
        if abs(p[0] - prev[0]) >= MIN_DIST_DEG or abs(p[1] - prev[1]) >= MIN_DIST_DEG:
            out.append(p)
    return out


def extract_rings(geometry):
    """Yield [lat, lon] ring arrays from a Polygon or MultiPolygon geometry."""
    gtype = geometry["type"]
    coords = geometry["coordinates"]
    if gtype == "Polygon":
        polys = [coords]
    elif gtype == "MultiPolygon":
        polys = coords
    else:
        return
    for poly in polys:
        # poly[0] is outer ring; poly[1:] are holes (ignore holes for globe display)
        outer = poly[0]
        if len(outer) < MIN_RING_POINTS:
            continue
        # GeoJSON is [lon, lat]; our projection expects [lat, lon]
        ring = [[round(pt[1], 2), round(pt[0], 2)] for pt in outer]
        simplified = simplify(ring)
        if len(simplified) >= MIN_RING_POINTS:
            yield simplified


def main():
    print(f"Downloading {SRC_URL} ...")
    with urllib.request.urlopen(SRC_URL, timeout=30) as resp:
        raw = resp.read()
    print(f"Downloaded {len(raw):,} bytes.")

    data = json.loads(raw)
    features = data.get("features", [])

    all_rings = []
    for feat in features:
        geom = feat.get("geometry")
        if not geom:
            continue
        for ring in extract_rings(geom):
            all_rings.append(ring)

    total_pts = sum(len(r) for r in all_rings)
    print(f"Extracted {len(all_rings)} polygons, {total_pts:,} coordinate pairs.")

    # Encode as compact JS — no spaces, 2-decimal precision already applied above.
    def enc_ring(ring):
        inner = ",".join(f"[{pt[0]},{pt[1]}]" for pt in ring)
        return f"[{inner}]"

    body = ",\n".join(enc_ring(r) for r in all_rings)
    js = f"// Auto-generated from Natural Earth 110m. Do not edit manually.\n// {len(all_rings)} polygons, {total_pts} points\nconst WORLD_LAND=[\n{body}\n];\n"

    out_path = os.path.abspath(OUT_FILE)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(js)

    size_kb = os.path.getsize(out_path) / 1024
    print(f"Written {out_path} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
