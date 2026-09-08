#!/usr/bin/env python3
"""qed-prices.py: read QED's public list price for each catalog part that has a
QED part number, and write the price file CE Bids imports.

    python tools/qed-prices.py --backup ce-bids-backup-2026-09-08.json --out qed-prices.json
    python tools/qed-prices.py --skus 3302434,1234567 --out qed-prices.json
    python tools/qed-prices.py --selftest

The app never talks to QED; this does, by hand, from Adrian's PC. It is
deliberately slow and small: one page every PAUSE seconds, at most MAX_PARTS
per run, a normal browser user agent, and it stops after three failures in a
row. If QED ever asks us to stop, we stop running this and the app is
unchanged: it only ever reads the file this writes.

Standard library only. Python 3.8+.
"""
import argparse
import html
import json
import re
import sys
import time
import urllib.request
import urllib.error
from datetime import date

DETAIL = 'https://www.qedelectric.com/product/detail/{sku}/p'
UA = ('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
      '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')
PAUSE = 4.0          # seconds between requests
MAX_PARTS = 150      # per run
MAX_FAILS = 3        # in a row, then stop

# What the page carries, server-rendered (verified 2026-09-08):
#   <h1>Pass & Seymour 1597-TRWRW 15A 125V ... GFCI, White</h1>
#   Sonepar.Net1.CurrentPricing = { "customerPrice": 39.08, "normalPrice": 39.08, "sellPackQuantity": 1 };
#   <small class="priceUOM">/ea</small>
RE_NAME = re.compile(r'<h1[^>]*>(.*?)</h1>', re.S)
RE_PRICING = re.compile(r'Sonepar\.Net1\.CurrentPricing\s*=\s*(\{[^}]*\})', re.S)
RE_UOM = re.compile(r'class="priceUOM"[^>]*>\s*/?\s*([^<\s]+)')


def parse_page(text):
    """-> {'name', 'listCents', 'per'} or None when the page has no price on it."""
    m = RE_PRICING.search(text)
    if not m:
        return None
    try:
        pricing = json.loads(m.group(1))
    except ValueError:
        return None
    normal = pricing.get('normalPrice')
    if not isinstance(normal, (int, float)):
        return None
    name = RE_NAME.search(text)
    uom = RE_UOM.search(text)
    clean = html.unescape(re.sub(r'\s+', ' ', name.group(1))).strip() if name else ''
    return {
        'name': clean,
        'listCents': int(round(normal * 100)),
        'per': (uom.group(1).lower() if uom else 'ea'),
    }


def fetch(sku):
    req = urllib.request.Request(DETAIL.format(sku=sku), headers={'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9'})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode('utf-8', errors='replace')


def skus_from_backup(path):
    with open(path, encoding='utf-8') as f:
        d = json.load(f)
    out = []
    for p in d.get('catalog', []):
        sku = p.get('sku')
        if isinstance(sku, str) and sku.strip():
            out.append((sku.strip(), p.get('name', '')))
    return out


def run(pairs, out_path, pause=PAUSE):
    rows, fails = [], 0
    pairs = pairs[:MAX_PARTS]
    for i, (sku, his_name) in enumerate(pairs, 1):
        try:
            page = fetch(sku)
            got = parse_page(page)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:
            got = None
            print(f'{i}/{len(pairs)} {sku} {his_name}: error {e}', file=sys.stderr)
        if got is None:
            fails += 1
            print(f'{i}/{len(pairs)} {sku} {his_name}: no price found', file=sys.stderr)
            if fails >= MAX_FAILS:
                print('Stopping: three misses in a row. Check the part numbers, or the site changed.', file=sys.stderr)
                break
        else:
            fails = 0
            rows.append({'sku': sku, 'name': got['name'], 'listCents': got['listCents'], 'per': got['per']})
            print(f'{i}/{len(pairs)} {sku} {his_name}: ${got["listCents"] / 100:.2f} /{got["per"]}  {got["name"][:60]}')
        if i < len(pairs):
            time.sleep(pause)
    doc = {'source': 'qedelectric.com', 'checkedISO': date.today().isoformat(), 'rows': rows}
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(doc, f, indent=1)
    print(f'Wrote {len(rows)} prices to {out_path}')
    return doc


SAMPLE = '''<html><h1>Pass &amp; Seymour 1597-TRWRW 15A 125V
  Self-Test GFCI, White</h1>
<script> Sonepar.Net1.CurrentPricing = { "customerPrice": 39.08, "normalPrice": 39.08, "sellPackQuantity": 1 }; </script>
<span class="pricerPerQty" data-analytics-price="39.08"> $39.08</span> <small class="priceUOM">/ea</small></html>'''


def selftest():
    got = parse_page(SAMPLE)
    assert got == {'name': 'Pass & Seymour 1597-TRWRW 15A 125V Self-Test GFCI, White', 'listCents': 3908, 'per': 'ea'}, got
    assert parse_page('<html>no price here</html>') is None
    wire = SAMPLE.replace('"normalPrice": 39.08', '"normalPrice": 0.96').replace('/ea', '/ft')
    assert parse_page(wire)['listCents'] == 96 and parse_page(wire)['per'] == 'ft'
    hundred = SAMPLE.replace('/ea', '/C')
    assert parse_page(hundred)['per'] == 'c'
    print('selftest ok')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--backup', help='a CE Bids backup file; parts with a QED part number are read')
    ap.add_argument('--skus', help='comma-separated QED part numbers instead of a backup')
    ap.add_argument('--out', default='qed-prices.json')
    ap.add_argument('--pause', type=float, default=PAUSE)
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    if a.selftest:
        selftest()
        return
    if a.backup:
        pairs = skus_from_backup(a.backup)
    elif a.skus:
        pairs = [(s.strip(), '') for s in a.skus.split(',') if s.strip()]
    else:
        ap.error('give --backup or --skus')
    if not pairs:
        print('No parts with a QED part number. Put the numbers on the parts in Settings > Catalog first.', file=sys.stderr)
        sys.exit(1)
    run(pairs, a.out, a.pause)


if __name__ == '__main__':
    main()
