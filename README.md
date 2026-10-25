# Answers before the app: a bolt.eu redesign concept

Product design case study by Andrii (October 2026).

- **Case study:** `index.html`
- **Prototype:** `prototype/index.html` (Home), `prototype/rides.html`, `prototype/scooters.html`, `prototype/drive.html` (Car-sharing)
- **First version, kept for comparison:** `v1/`

Independent portfolio concept. Not affiliated with, commissioned or endorsed by Bolt Technology OÜ.
Prices, wait times and vehicles in the prototype are examples. Map data © OpenStreetMap contributors (ODbL).
Photos marked "Image: Bolt" are Bolt's own, from bolt.eu; other photos and illustrations are AI-generated. The prototype pages are marked `noindex` and are kept out of search engines.

## Run locally

The prototype loads its map data with `fetch`, so open it through a web server, not from the file system:

```
python3 -m http.server 8000
```

then visit http://localhost:8000.
