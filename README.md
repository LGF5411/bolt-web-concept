# Answers before the app: a bolt.eu redesign concept

Product design case study by Andrii (October 2026).

- **Case study:** `index.html`
- **Prototype:** `prototype/index.html` (Home), `prototype/rides.html`, `prototype/scooters.html`, `prototype/drive.html` (Car-sharing), `prototype/bolt7.html` (Bolt 7 launch page)
- **First version, kept for comparison:** `v1/`
- **Figma (tokens, components, Drive handoff):** https://www.figma.com/design/fLN2qOjjAF8B5WLSsILCOb/Bolt-web-concept-%C2%B7-components---handoff

Turn on **Design notes** in the top bar of any prototype page to see why each part is built the way it is, how to build it and how to test it.

Independent portfolio concept. Not affiliated with, commissioned or endorsed by Bolt Technology OÜ.
Prices, wait times and vehicles in the prototype are examples. Map data © OpenStreetMap contributors (ODbL).
Photos are Bolt's own, from bolt.eu, used for a non-commercial portfolio. Illustrations, the ride-type car images and the Drive studio frames are AI-generated. The prototype pages are marked `noindex` and are kept out of search engines.

## Run locally

The prototype loads its map data with `fetch`, so open it through a web server, not from the file system:

```
python3 -m http.server 8000
```

then visit http://localhost:8000.
