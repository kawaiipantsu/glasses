# Glasses brand artwork

The final mark uses bold red acetate sunglasses, dark optical lenses, angled binary reflections, polished bevels and soft highlights. The soft edges are built from translucent vector strokes and reflection layers. The silhouette and binary remain sharp.

- **Glasses-Red-Shades.afdesign** — final editable logo master, saved in Affinity Designer 2. Frame, lenses, reflections, binary, bevels and hardware remain separate layers.
- **Glasses-App-Icon.afdesign** — editable square app icon with the same mark on a charcoal gradient tile, saved and checked in Affinity Designer 2.
- **Glasses-Red-Shades.svg** — final Affinity SVG export; binary text exported as curves. 252 vector paths, no embedded bitmap images and no external fonts.
- **glasses-preview.png** — transparent preview of that export.
- **glasses-construction.svg**, **glasses-soft-vector.svg**, **Glasses-Brand-Master.afdesign** — construction/intermediate files; use the final masters above for new revisions.

The application imports `build/glasses-mark.svg`. `npm run icons` derives it from the final Affinity SVG, applies a tighter viewBox for UI placement, and generates the shared icon artwork plus PNG, multi-resolution ICO and macOS ICNS. The ICNS conversion requires macOS; existing icon assets are checked in so other platform builds do not require Affinity.

After editing the logo in Affinity, export the whole 1200 × 440 document to `Glasses-Red-Shades.svg` with **Export text as curves** enabled and no rasterized elements. Run `npm run icons`, inspect the output at small sizes, and rebuild packages. Update the icon master to match any geometry changes.

Keep **THUGS** in the theme foreground and **red** in red. Neither the wordmark suffix nor the sunglasses should follow user accent palettes.

The application’s **Glasses** title uses Megrim Regular 400, bundled locally at `src/assets/fonts/megrim-400.woff2`. Its approved treatment is `letter-spacing: -0.05em` and `-webkit-text-stroke: 0.35px currentColor`. Use it for the brand title only; UI labels and body text retain the standard typeface. The original font copyright and SIL Open Font License are preserved in `LICENSES/OFL-Megrim.txt`.

Request/response views can use the separately bundled [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono). Its unmodified Regular WOFF2 and OFL license are stored in the application assets and `LICENSES/OFL-JetBrains-Mono.txt`. Data font settings do not alter the brand wordmark.
