# tools

Things that run on a PC, not on the phone.

## qed-prices.py

Writes the price file CE Bids imports (Settings › Catalog › Import prices).

1. On the phone: Settings › Catalog, tap a part, **QED part #**, type the number off the receipt. Do the parts he buys.
2. On the phone: Settings › Backup › Send a backup, to Adrian.
3. On the PC: `python tools/qed-prices.py --backup ce-bids-backup-YYYY-MM-DD.json --out qed-prices.json`
   One page every 4 seconds, at most 150 parts a run, stops after three misses. Prints each price as it goes.
4. Send `qed-prices.json` to the phone (mail, AirDrop, iCloud) and import it. The app says what moved before it writes.

It reads QED's public list price. The app itself never contacts QED, so if QED asks us to stop, we stop running this and nothing else changes.
