# Mobisim

Minimal SvelteKit viewer shell for a Chrome-first 360-degree vehicle inspection experience.

## Progress

![Progress](./assets/progress.png)
![Follow-up](./assets/progress_1.png)
![Progress GIF](./assets/progress_2.gif)

## Development

```sh
npm run dev
```

## Building

```sh
npm run build
```

## Tests

```sh
npm test
```

## Semantic Overlay

The GLB-derived structural manifest remains the source of truth for IDs, paths, meshes, and validation.

To generate a one-pass semantic overlay for an asset, configure `OPENAI_API_KEY` and call:

```sh
curl -X POST http://localhost:5173/api/vehicle-assets/ks_blade_runner_spinner/semantic-overlay
```

The accepted overlay is stored separately under `storage/vehicle-semantic-overlays/` by default, or `SEMANTIC_MANIFEST_LOCAL_DIR` when configured.

The footer chat tool loop now uses stale-while-revalidate semantics:

- Explicit semantic refresh requests wait for completion.
- Semantics-sensitive edit requests reuse the current overlay if present and start a deduped background refresh when the overlay is missing or stale.
- Structural validation remains synchronous and authoritative.

See [docs/GUIDE.md](/Users/prateek/code/robotics/mobisim/docs/GUIDE.md) for project conventions and [docs/STATE.md](/Users/prateek/code/robotics/mobisim/docs/STATE.md) for open work.
