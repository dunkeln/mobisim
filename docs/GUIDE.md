## Purpose

This file is the shortest safe handoff for the next agent.

Read this before scanning the repo. The goal is to avoid re-deriving the product intent, the main state boundaries, and the known footguns from scratch.

If a task conflicts with this guide, [AGENTS.md](/Users/prateek/code/robotics/mobisim/AGENTS.md) wins.

## Product In One Page

Mobisim is a Chrome-first 3D vehicle inspection workspace.

- The main surface is a realistic GLB/GLTF inspection viewport.
- FRIDAY is the inspection copilot, not a general chatbot.
- FRIDAY should operate on one active asset at a time.
- The user can interact by orbiting, clicking/selecting, typing in footer chat, or using the voice orb.
- The viewport should only change through deterministic patch operations or deterministic semantic mutations.
- The UI should feel restrained, technical, and Jarvis/Griot-like, not demo-noisy.

The core loop is:

1. user opens one asset
2. user inspects visually
3. user selects or refers naturally
4. FRIDAY resolves intent against real scene state
5. deterministic operations mutate presentation or semantics
6. viewport proves the result immediately

## What Not To Do

- Do not treat this as a generic assistant app.
- Do not add broad new abstractions before checking whether the existing connector/store already owns the concern.
- Do not let chat invent state that is not backed by the active asset, selection, presentation, or semantic overlay.
- Do not bypass the existing patch/selection/semantic flows with ad hoc client mutations.
- Do not silently mix cross-asset UI state.
- Do not rebuild semantic overlays automatically during ordinary requests unless the existing path already does so by explicit design.

## Read Order

For most tasks, read in this order only:

1. [AGENTS.md](/Users/prateek/code/robotics/mobisim/AGENTS.md)
2. [docs/GUIDE.md](/Users/prateek/code/robotics/mobisim/docs/GUIDE.md)
3. [docs/STATE.md](/Users/prateek/code/robotics/mobisim/docs/STATE.md)
4. [README.md](/Users/prateek/code/robotics/mobisim/README.md)

Then branch by task:

- Product or UX behavior:
  [src/lib/server/connectors/openai-chat/prompt.ts](/Users/prateek/code/robotics/mobisim/src/lib/server/connectors/openai-chat/prompt.ts)
- Main app entry:
  [src/routes/(app)/app/inspect/[assetId]/+page.svelte](/Users/prateek/code/robotics/mobisim/src/routes/(app)/app/inspect/[assetId]/+page.svelte)
- 3D viewport:
  [src/lib/components/threlte/inspection-viewport.svelte](/Users/prateek/code/robotics/mobisim/src/lib/components/threlte/inspection-viewport.svelte)
- Footer/orb/chat app layer:
  [src/lib/components/ui/footer-orb.svelte](/Users/prateek/code/robotics/mobisim/src/lib/components/ui/footer-orb.svelte)
  [src/lib/components/chat/footer-chat-client.ts](/Users/prateek/code/robotics/mobisim/src/lib/components/chat/footer-chat-client.ts)
- Chat executor:
  [src/lib/server/connectors/openai-chat/index.ts](/Users/prateek/code/robotics/mobisim/src/lib/server/connectors/openai-chat/index.ts)
  [src/lib/server/connectors/openai-chat/execution.ts](/Users/prateek/code/robotics/mobisim/src/lib/server/connectors/openai-chat/execution.ts)
  [src/lib/server/connectors/openai-chat/semantic-execution.ts](/Users/prateek/code/robotics/mobisim/src/lib/server/connectors/openai-chat/semantic-execution.ts)
- Semantic overlay storage and mutation:
  [src/lib/server/connectors/vehicle-semantic-overlay/index.ts](/Users/prateek/code/robotics/mobisim/src/lib/server/connectors/vehicle-semantic-overlay/index.ts)
- Shared semantic definitions:
  [src/lib/server/connectors/semantic-groups/index.ts](/Users/prateek/code/robotics/mobisim/src/lib/server/connectors/semantic-groups/index.ts)

If your change does not touch one of those areas, stop and confirm you are not about to wander.

## Architecture Map

### 1. Routes and shell

- `/app` redirects to the default asset.
- `/app/inspect/[assetId]` is the real viewer route.
- The inspection page is intentionally thin and mostly mounts the viewport plus request gate.

Key files:

- [src/routes/(app)/app/+page.server.ts](/Users/prateek/code/robotics/mobisim/src/routes/(app)/app/+page.server.ts)
- [src/routes/(app)/app/inspect/[assetId]/+page.ts](/Users/prateek/code/robotics/mobisim/src/routes/(app)/app/inspect/[assetId]/+page.ts)
- [src/routes/(app)/app/inspect/[assetId]/+page.svelte](/Users/prateek/code/robotics/mobisim/src/routes/(app)/app/inspect/[assetId]/+page.svelte)

### 2. Viewport and runtime scene behavior

The viewport owns:

- loading the active asset
- orbit inspection
- runtime node selection
- visual application of patch operations
- semantic status polling for the active asset

It should not own chat orchestration or semantic persistence policy.

Key file:

- [src/lib/components/threlte/inspection-viewport.svelte](/Users/prateek/code/robotics/mobisim/src/lib/components/threlte/inspection-viewport.svelte)

### 3. Footer/orb app layer

This layer bridges the UI and the server response contract.

It owns:

- packaging request context
- approval gating
- applying chat responses into stores
- maintaining footer chrome state

Key files:

- [src/lib/components/ui/footer-orb.svelte](/Users/prateek/code/robotics/mobisim/src/lib/components/ui/footer-orb.svelte)
- [src/lib/components/chat/footer-chat-client.ts](/Users/prateek/code/robotics/mobisim/src/lib/components/chat/footer-chat-client.ts)
- [src/lib/components/ui/viewport-footer-blueprint.svelte](/Users/prateek/code/robotics/mobisim/src/lib/components/ui/viewport-footer-blueprint.svelte)

### 4. Chat executor

This is the model-facing orchestration layer.

It owns:

- request normalization
- prompt construction
- tool schema exposure
- tool execution
- routing between direct deterministic execution and LLM tool loops

Key files:

- [src/lib/server/connectors/openai-chat/index.ts](/Users/prateek/code/robotics/mobisim/src/lib/server/connectors/openai-chat/index.ts)
- [src/lib/server/connectors/openai-chat/prompt.ts](/Users/prateek/code/robotics/mobisim/src/lib/server/connectors/openai-chat/prompt.ts)
- [src/lib/server/connectors/openai-chat/tool-definitions.ts](/Users/prateek/code/robotics/mobisim/src/lib/server/connectors/openai-chat/tool-definitions.ts)
- [src/lib/server/connectors/openai-chat/execution.ts](/Users/prateek/code/robotics/mobisim/src/lib/server/connectors/openai-chat/execution.ts)
- [src/lib/server/connectors/openai-chat/semantic-execution.ts](/Users/prateek/code/robotics/mobisim/src/lib/server/connectors/openai-chat/semantic-execution.ts)

### 5. Deterministic state stores

These are the client-side source-of-truth stores for active runtime state.

- presentation patch history and derived visual state:
  [src/lib/stores/vehicle-patches.ts](/Users/prateek/code/robotics/mobisim/src/lib/stores/vehicle-patches.ts)
- runtime selection:
  [src/lib/stores/vehicle-node-selection.ts](/Users/prateek/code/robotics/mobisim/src/lib/stores/vehicle-node-selection.ts)
- semantic runtime snapshot and selected group:
  [src/lib/stores/semantic-runtime.ts](/Users/prateek/code/robotics/mobisim/src/lib/stores/semantic-runtime.ts)
- asset-scoped assistant sidebar:
  [src/lib/stores/inspector-sidebar.ts](/Users/prateek/code/robotics/mobisim/src/lib/stores/inspector-sidebar.ts)
- asset-scoped supplementary footer list:
  [src/lib/stores/footer-supplementary-list.ts](/Users/prateek/code/robotics/mobisim/src/lib/stores/footer-supplementary-list.ts)

## State Ownership

This is the most important section for avoiding side effects.

### Active asset

- Route param is canonical for the current asset.
- Asset selection dropdown navigates by route, not hidden app state.

### Presentation state

- Client-side presentation state is local and reversible.
- It lives in `vehiclePatchState`.
- Viewport rendering reflects this state.
- Chat and voice may request changes, but they do not directly mutate Three.js scene state without going through patch application.

### Selection state

- Runtime selection lives in `vehicleNodeSelection`.
- Selection is asset-scoped.
- FRIDAY should use current selection as first-order grounding when the prompt contract says “this”, “these”, or “selected”.

### Semantic runtime state

- `semanticRuntimeState` holds the currently loaded overlay snapshot, overlay status, ingress bindings, and selected semantic group for each asset.
- This is runtime cache, not the persistent semantic source of truth.

### Assistant chrome

- Sidebar and supplementary list are asset-scoped.
- They are optional UI memory for the current asset, not global chat memory.
- If you add or change a caller, preserve asset scoping.

### Persistent semantic truth

- The mutable semantic overlay file is the current source of truth for accepted semantic state.
- Structural GLB manifests remain canonical for structure, IDs, node paths, mesh IDs, and validation.
- Shared group definitions are stored separately.

## Semantic Storage Model

The semantic system has three different layers. Do not collapse them casually.

### Structural layer

Canonical structural data comes from preprocessing and structural snapshot connectors.

Key files:

- [src/lib/server/connectors/gltf-structure/index.ts](/Users/prateek/code/robotics/mobisim/src/lib/server/connectors/gltf-structure/index.ts)
- [src/lib/server/connectors/gltf-preprocess/index.ts](/Users/prateek/code/robotics/mobisim/src/lib/server/connectors/gltf-preprocess/index.ts)

### Overlay layer

Persistent accepted semantic overlay for an asset.

- file-backed
- mutable
- shared across sessions
- used by planners and semantic tools

Key file:

- [src/lib/server/connectors/vehicle-semantic-overlay/index.ts](/Users/prateek/code/robotics/mobisim/src/lib/server/connectors/vehicle-semantic-overlay/index.ts)

### Definitions / reviewed examples / proposals

These support semantic grounding and authoring, but do not replace the overlay.

- group definitions:
  [src/lib/server/connectors/semantic-groups/index.ts](/Users/prateek/code/robotics/mobisim/src/lib/server/connectors/semantic-groups/index.ts)
- reviewed assignments:
  [src/lib/server/connectors/asset-semantic-assignments/index.ts](/Users/prateek/code/robotics/mobisim/src/lib/server/connectors/asset-semantic-assignments/index.ts)
- pending proposals:
  [src/lib/server/connectors/asset-semantic-proposals/index.ts](/Users/prateek/code/robotics/mobisim/src/lib/server/connectors/asset-semantic-proposals/index.ts)

### Storage paths

See:

- [src/lib/server/connectors/vehicle-registry/storage.ts](/Users/prateek/code/robotics/mobisim/src/lib/server/connectors/vehicle-registry/storage.ts)

Important defaults:

- assets: `storage/vehicle-assets`
- semantic overlay root: `storage/vehicle-semantic-overlays` or `SEMANTIC_MANIFEST_LOCAL_DIR`
- semantic definitions and related stores: under `storage/`

## REST Surface You Will Actually Touch

Vehicle inspection and asset routes:

- `GET /api/vehicle-assets`
- `GET /api/vehicle-assets/[assetId]/download`
- `GET /api/vehicle-assets/[assetId]/inspection`
- `POST /api/vehicle-assets/[assetId]/intent`
- `POST /api/vehicle-assets/[assetId]/highlight`
- `POST /api/vehicle-assets/[assetId]/paint`
- `POST /api/vehicle-assets/[assetId]/window-tint`
- `GET|POST /api/vehicle-assets/[assetId]/semantic-overlay`
- `GET|POST /api/vehicle-assets/[assetId]/semantic-ingress...`

Chat routes:

- `POST /api/chat`
- `POST /api/chat/audio`
- `POST /api/chat/audio/realtime`

If you are adding behavior, prefer extending an existing route or connector over creating another sibling endpoint.

## FRIDAY Behavior Contract

FRIDAY is defined primarily by the prompt contract in:

- [src/lib/server/connectors/openai-chat/prompt.ts](/Users/prateek/code/robotics/mobisim/src/lib/server/connectors/openai-chat/prompt.ts)

Required behavior:

- be scoped to the active asset only
- stay calm, concise, technical, understated
- prefer deterministic execution over vague narration
- distinguish known vs inferred vs unavailable
- use sidebar and supplementary list only when they materially help
- rely on selection, highlight, material, hidden, and semantic overlay context when resolving ambiguous natural language

If you change behavior, update the prompt, the executor, and tests together. Do not change one in isolation.

## Known Working Conventions

### Chat and voice

- text chat and voice orb should drive the same executor contract
- voice is an alternate input/output surface, not a second logic stack

### Semantic freshness

- stale semantic overlays are still actionable by design
- explicit refresh requests are special
- structural freshness and “best available overlay” are not the same concept

### Assistant chrome

- sidebar and supplementary list are scoped by asset
- `beginFooterResponseCycle(assetId)` clears only the supplementary list for that asset at the start of a new request cycle
- callers should pass `assetId` through when reading or writing assistant chrome

## Current Known Footguns

These are good places to look before introducing “small” changes.

### 1. Semantic overlay status is not uniformly sourced

- `/inspection` derives freshness from structural generation time
- `/semantic-overlay` returns the overlay snapshot shape directly
- do not assume every `overlayStatus` you see is equally authoritative for freshness semantics

### 2. Overlay persistence is mutable and shared

- refreshes and semantic mutations both write the same overlay file
- avoid adding more write paths casually
- if you touch persistence, inspect for last-write-wins behavior first

### 3. Selection-vs-material ambiguity is real

- semantic actions may need to preserve node-backed versus material-backed meaning
- do not flatten that distinction unless the request explicitly broadens scope

### 4. The viewport should remain the proof surface

- sidebars, labels, and chat summaries are secondary
- if a change only updates text/UI but leaves the viewport inconsistent, treat it as broken

## Recommended Workflow For Most Tasks

1. Confirm the task strengthens a base criterion from `AGENTS.md`.
2. Identify which layer owns the concern:
   route, viewport, footer client, chat executor, store, or semantic storage.
3. Read only the owning files and their tests.
4. Make the smallest vertical change that preserves the current contract.
5. Run the narrowest relevant tests first.
6. Run `npm test` if you changed executable code and the environment supports it.
7. Update [docs/STATE.md](/Users/prateek/code/robotics/mobisim/docs/STATE.md) only if task tracking actually changed.

## Testing Notes

Main command:

```sh
npm test
```

Targeted Vitest runs are often faster and more informative for store/executor work.

If `npm` is missing on the default shell `PATH`, try:

```sh
PATH=/opt/homebrew/bin:/usr/local/bin:$PATH npm test
```

Do not assume the full suite is green before your change. Check what failed and whether the failure is pre-existing.

## Anti-Bloat Guardrails

- Keep one source of truth per contract, schema, adapter, and state model.
- Do not create a new file or module until an existing one has been ruled out as a clean extension point.
- Do not create sibling utility layers for the same concern.
- Do not keep temporary wrappers, migration helpers, compatibility paths, or placeholders without a matching cleanup task in `docs/STATE.md`.
- Prefer deleting dead code and collapsing duplicate paths immediately over preserving them just in case.
- A new abstraction must have at least two real callers; otherwise keep the logic inline in the current module.
- A task is not complete until obvious temporary code and duplicate paths introduced by that task are removed.

## Svelte MCP Reminder

If a task is specifically about Svelte or SvelteKit behavior:

1. use the Svelte MCP `list-sections` tool first
2. fetch the relevant sections with `get-documentation`
3. run `svelte-autofixer` before closing out Svelte code changes

Do not use the playground link tool for project file edits.

## STATE.md Workflow

Use [STATE.md](/Users/prateek/code/robotics/mobisim/docs/STATE.md) as the shared progress board.

- Do not turn `STATE.md` into prose.
- Only use the existing sections.
- Keep one task per bullet with a stable `T-###` id.
- Every active task needs `next:` or `blocked_on:`.
- Mirror every movement between columns in `Updates`.

Canonical cards:

```md
- [ ] T-001 | Short task title | next: smallest next action
- [ ] T-001 | Short task title | blocked_on: concrete blocker
- [x] T-001 | Short task title | completed: 2026-04-04
```
