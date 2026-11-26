#!/usr/bin/env python3
"""
Backup way to load Krasnoyarsk places from OpenStreetMap, run from your own PC.
Use it if `importPlacesFromOSM` in Apps Script can't reach the Overpass servers.

    python3 import_places.py            # writes places.csv next to this script

Then in the Google Sheet: open the "Places" tab → File → Import → Upload places.csv →
"Append to current sheet", separator "Comma", untick "Convert text to numbers, dates and formulas".

Standard library only, no pip install needed.
"""
import csv
import json
import sys
import time
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

BBOX = (55.94, 92.60, 56.13, 93.20)  # Krasnoyarsk: south, west, north, east
SERVERS = [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.osm.jp/api/interpreter",
]
TYPE_MAP = {"cafe": "cafe", "restaurant": "restaurant", "fast_food": "fast_food",
            "bar": "bar", "pub": "bar", "food_court": "canteen"}


def query() -> str:
    b = ",".join(map(str, BBOX))
    return ("[out:json][timeout:90];("
            f'nwr["amenity"~"^(cafe|restaurant|fast_food|bar|pub|food_court)$"]["name"]({b});'
            f'nwr["shop"="bakery"]["name"]({b});'
            ");out center tags;")


def fetch() -> list:
    data = urllib.parse.urlencode({"data": query()}).encode()
    for url in SERVERS:
        try:
            print(f"Trying {url} …")
            req = urllib.request.Request(url, data=data, headers={"User-Agent": "kotletka-import/1.0"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode("utf-8"))["elements"]
        except Exception as e:  # noqa: BLE001 — try the next server
            print(f"  failed: {e}")
            time.sleep(2)
    sys.exit("All servers failed. Try again in a few minutes.")


def to_row(el: dict, now: str):
    t = el.get("tags", {})
    lat = el.get("lat", el.get("center", {}).get("lat"))
    lng = el.get("lon", el.get("center", {}).get("lon"))
    if lat is None or lng is None or not t.get("name"):
        return None
    kind = "bakery" if t.get("shop") == "bakery" else TYPE_MAP.get(t.get("amenity"), "other")
    if kind == "cafe" and "coffee" in t.get("cuisine", ""):
        kind = "coffee"
    if "столовая" in t["name"].lower():
        kind = "canteen"
    address = ", ".join(x for x in (t.get("addr:street"), t.get("addr:housenumber")) if x)
    # same columns as the Places tab: id, name, address, lat, lng, type, osm_id, created_by, created_at
    return ["i" + uuid.uuid4().hex[:11], t["name"][:80], address[:120], lat, lng, kind,
            f'{el["type"]}/{el["id"]}', "osm", now]


def main():
    elements = fetch()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    rows, seen = [], set()
    for el in elements:
        row = to_row(el, now)
        if row and row[6] not in seen:
            seen.add(row[6])
            rows.append(row)
    out = Path(__file__).with_name("places.csv")
    with out.open("w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows(rows)  # no header row: it is appended under the existing header
    print(f"Saved {len(rows)} places to {out}")


if __name__ == "__main__":
    main()
