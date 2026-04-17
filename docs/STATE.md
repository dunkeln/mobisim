# STATE.md

## Purpose

This file is the shared Kanban board for agent-visible project progress.

Do not use it as a scratchpad, design log, or place for long prose. Keep updates deterministic so multiple agents can modify it safely.

## Update Rules

- Only use the sections defined in this file.
- Keep one task per bullet.
- Use stable task IDs in the form `T-###`.
- Keep the task title short and action-oriented.
- Always include `next:` unless the task is blocked or done.
- Move a task by copying the full bullet to the new section and deleting the old one.
- If work is blocked, move the task to `Blocked` and replace `next:` with `blocked_on:`.
- When a task is complete, change `[ ]` to `[x]` and add `completed: YYYY-MM-DD`.
- Record every state change in `Updates`.
- Do not rewrite or delete past entries in `Updates`.

## Card Format

```md
- [ ] T-001 | Short task title | next: smallest next action
```

In `Blocked`:

```md
- [ ] T-001 | Short task title | blocked_on: concrete blocker
```

In `Done`:

```md
- [x] T-001 | Short task title | completed: 2026-04-04
```

## Backlog

- [ ] T-008 | Delete placeholder scene helpers after the first vertical slice lands | next: remove procedural stand-in scene code after asset-driven scene is live
- [ ] T-013 | Reduce oversized client chunk from viewer route | next: re-measure after the first real asset and split any viewer-only code if still needed
- [ ] T-023 | Add semantic overlay generation for GLB manifests | next: store reviewed LLM semantic candidates separately from structural manifests
- [ ] T-019 | Add Jarvis sub-UI components | next: define the smallest reusable control cluster for footer, inspector, and overlays
- [ ] T-020 | Add freeform-to-deterministic tool instruction layer | next: document the minimal prompt and executor contract for expressive tool use
- [ ] T-021 | Add voice agent slice | next: define one end-to-end voice command path that maps to the existing deterministic vehicle intent executor
- [ ] T-022 | Isolate JARVIS-style components | next: separate the shell, chat, inspector, and viewport chrome into modular component boundaries
- [ ] T-045 | Trim legacy chat and semantic compatibility paths | next: finish the preserved-behavior catalog and cut the first dead branch safely

## In Progress

- [ ] T-023 | Add semantic overlay generation for GLB manifests | next: finish planner reads, route wiring, and deterministic tests

## Blocked

## Review

- [ ] T-014 | Verify root shell remains no-scroll with viewport content only in routes | next: run browser check after next layout-affecting change

## Done

- [x] T-000 | Initialize project documentation scaffold | completed: 2026-04-04
- [x] T-001 | Load realistic vehicle asset into scene | completed: 2026-04-10
- [x] T-006 | Add integration test for vehicle state endpoint | completed: 2026-04-10
- [x] T-002 | Expose one REST-controlled vehicle state | completed: 2026-04-06
- [x] T-003 | Reflect controlled vehicle state in the scene | completed: 2026-04-06
- [x] T-004 | Define shared API contract for vehicle state | completed: 2026-04-06
- [x] T-005 | Establish root-only app shell and route-owned page content | completed: 2026-04-04
- [x] T-007 | Prune duplicate vehicle-state types after API wiring | completed: 2026-04-05
- [x] T-009 | Remove temporary wrappers introduced during current slice work | completed: 2026-04-05
- [x] T-010 | Lock document and app shell to no-scroll viewport behavior | completed: 2026-04-04
- [x] T-011 | Define dark-first Tailwind 4 surface tokens and color boundary | completed: 2026-04-04
- [x] T-012 | Add reusable Threlte inspection viewport placeholder | completed: 2026-04-04
- [x] T-015 | Load Audi R8 asset into the inspection viewport | completed: 2026-04-05
- [x] T-016 | Create footer voice blob placeholder | completed: 2026-04-05
- [x] T-018 | Build server-side vehicle asset registry scaffold | completed: 2026-04-05
- [x] T-017 | Wire frontend viewer to registry-backed asset selection | completed: 2026-04-05
- [x] T-025 | Split structural snapshot from preprocessing heuristics | completed: 2026-04-06
- [x] T-026 | Add semantic part-unit overlay schema | completed: 2026-04-06
- [x] T-027 | Add deterministic part-intent planner | completed: 2026-04-06
- [x] T-028 | Add validated isolate-part execution path | completed: 2026-04-06
- [x] T-029 | Add deterministic remove-part xray presentation state | completed: 2026-04-06
- [x] T-030 | Replace flat patch queue with presentation state model | completed: 2026-04-06
- [x] T-031 | Add headlight toggle and beam rendering slice | completed: 2026-04-06
- [x] T-032 | Add central semantic group definitions store | completed: 2026-04-07
- [x] T-033 | Add reviewed asset node assignment store | completed: 2026-04-07
- [x] T-034 | Rebuild semantic overlay groups from reviewed assignments | completed: 2026-04-07
- [x] T-035 | Split LLM semantic proposals from reviewed assignments | completed: 2026-04-07
- [x] T-036 | Derive reusable semantic examples from reviewed assignments | completed: 2026-04-07
- [x] T-037 | Remove overlapping semantic write tools | completed: 2026-04-08
- [x] T-038 | Remove client semantic fixup mutators | completed: 2026-04-08
- [x] T-039 | Split semantic lookup from presentation side effects | completed: 2026-04-08
- [x] T-040 | Delete dead orchestration contracts | completed: 2026-04-08
- [x] T-041 | Add reusable request gate intercept store | completed: 2026-04-09
- [x] T-042 | Push real-time selection/presentation context into live realtime session | completed: 2026-04-09
- [x] T-043 | Extend sidebar highlights when a semantic group grows after mutation | completed: 2026-04-09
- [x] T-044 | Fix resolveScopedSemanticTargets dropping node-typed highlighted targets | completed: 2026-04-09

## Updates

- 2026-04-11 09:00 PT | Added a preserved-behavior catalog and queued the trim refactor as a dedicated cleanup task
- 2026-04-04 19:45 PT | Created Kanban structure and seeded starter tasks
- 2026-04-04 19:45 PT | Added `T-004` to `In Progress`
- 2026-04-04 20:05 PT | Added anti-bloat cleanup debt tasks `T-007`, `T-008`, and `T-009`
- 2026-04-04 22:30 PT | Collapsed duplicate asset task tracking by moving `T-001` to `Blocked` and reusing `T-005` for completed shell work
- 2026-04-04 22:30 PT | Recorded completed UI baseline tasks `T-010`, `T-011`, and `T-012`
- 2026-04-04 22:30 PT | Reordered open work breadth-first around the smallest valid API-to-scene slice
- 2026-04-04 22:30 PT | Added `T-013` for viewer bundle follow-up and `T-014` for no-scroll regression review
- 2026-04-05 12:45 PT | Moved auth, demo, and scaffold cleanup into execution and kept `T-004` focused on the next real API slice
- 2026-04-05 12:45 PT | Marked `T-007` and `T-009` done after removing unused auth, demo, and wrapper paths from the active codebase
- 2026-04-05 12:31 PT | Marked `T-015` done after replacing the placeholder vehicle with the `audi_r8.glb` asset in the main inspection viewport
- 2026-04-05 12:33 PT | Marked `T-016` done after creating a self-contained Three.js shader voice blob asset and leaving it disabled in the footer
- 2026-04-05 20:30 PT | Marked `T-018` done after adding a server-side vehicle asset registry with local-to-remote URL resolution and minimal REST endpoints
- 2026-04-05 20:30 PT | Added `T-017` to `Backlog` to connect the active viewer to the new registry instead of hardcoded asset URLs
- 2026-04-05 20:48 PT | Marked `T-017` done after switching the viewer to asset metadata from the registry and serving local GLBs through a private download route
- 2026-04-06 21:35 PT | Marked `T-002`, `T-003`, and `T-004` done after unifying deterministic vehicle intent planning across chat, REST endpoints, and the active viewport patch flow
- 2026-04-06 21:35 PT | Moved `T-006` into `In Progress` to cover missing integration coverage for the new vehicle intent REST surface
- 2026-04-06 21:35 PT | Added backlog tasks `T-019`, `T-020`, `T-021`, and `T-022` for Jarvis sub-UI components, expressive deterministic tool instructions, voice-agent work, and JARVIS-style component isolation
- 2026-04-06 22:05 PT | Added `T-023` to `Backlog` and `In Progress` to land a reviewed semantic overlay layer on top of deterministic GLB manifests
- 2026-04-06 22:10 PT | Extended the footer chat tool loop with explicit semantic refresh support so overlay-aware intent planning can self-prime on the active asset
- 2026-04-06 22:14 PT | Switched semantic refresh to stale-while-revalidate so interactive tool calls use cache-first behavior and only explicit refresh requests block on overlay generation
- 2026-04-06 22:16 PT | Added `T-024` to `Backlog` for shared semantic refresh locks and persisted job state across multiple server instances
- 2026-04-06 22:35 PT | Added `T-025` through `T-030` to `Backlog` to stage the structural snapshot, semantic part-unit, planner, isolate, remove-part, and presentation-state rewrite as incremental vertical slices
- 2026-04-06 22:40 PT | Added `T-025` to `In Progress` to extract a dedicated structural snapshot connector and make preprocessing consume it as a compatibility layer
- 2026-04-06 22:43 PT | Marked `T-025` done after extracting a dedicated `gltf-structure` connector and refactoring preprocessing to derive capabilities from the structural snapshot
- 2026-04-06 22:48 PT | Added `T-026` to `In Progress` to extend semantic overlays with validated part-unit assemblies without changing planner behavior yet
- 2026-04-06 22:48 PT | Marked `T-026` done after extending semantic overlays, validation, prompt schema, and storage to include reviewed part-unit assemblies
- 2026-04-06 23:05 PT | Added `T-027` to `In Progress` to resolve semantic part units deterministically before isolate and remove-part execution paths are wired
- 2026-04-06 23:05 PT | Marked `T-027` done after adding semantic part query helpers, planner-level part intent resolution, and deterministic highlight fallback tests
- 2026-04-06 23:18 PT | Added `T-028` to `In Progress` to execute semantic isolate intents through validated node visibility patches and the existing viewer patch flow
- 2026-04-06 23:18 PT | Marked `T-028` done after wiring isolate planning to emit node visibility patches and teaching the viewport to restore and apply node visibility state deterministically
- 2026-04-06 23:32 PT | Added `T-029` to `In Progress` to execute one semantic remove-part intent through deterministic xray material edits and the existing patch application path
- 2026-04-06 23:32 PT | Marked `T-029` done after wiring remove-part planning to emit xray-style material patches and teaching the viewport to restore and apply that state deterministically
- 2026-04-06 23:44 PT | Added `T-030` to `In Progress` to replace batch-history patch storage with layered presentation state while preserving the existing footer and viewport integrations
- 2026-04-06 23:44 PT | Marked `T-030` done after splitting patch storage into highlight, material, visibility, transform, and viewer presentation layers with reversible history snapshots
- 2026-04-06 23:58 PT | Marked `T-031` done after adding a REST-backed headlight support/toggle path and deriving spotlight beams from identified headlight emitters in the viewport
- 2026-04-07 14:12 PT | Marked `T-032`, `T-033`, and `T-034` done after adding shared semantic group definitions, reviewed asset node assignments, and rebuilding planner-visible overlay groups from reviewed assignments instead of direct overlay mutation
- 2026-04-07 14:12 PT | Added `T-035` and `T-036` to `Backlog` to separate pending LLM semantic proposals from reviewed assignments and feed reviewed examples back into proposal generation
- 2026-04-07 14:18 PT | Marked `T-035` done after adding a file-backed pending semantic proposal store and persisting LLM node-to-group proposals without exposing them to planners
- 2026-04-07 14:20 PT | Marked `T-036` done after deriving compact reviewed semantic examples from assignment files and feeding them into semantic proposal prompt input without adding a new persisted example store
- 2026-04-08 18:12 PT | Added cleanup tasks `T-037` through `T-040` to track overlapping semantic write tools, hidden client semantic repair logic, semantic lookup side effects, and dead orchestration scaffolding after the deterministic snapshot rewrite
- 2026-04-08 18:29 PT | Marked `T-037` done after deleting the overlapping `annotate_vehicle_semantic_group` chat tool, removing its footer/tool-catalog surface, and converting semantic assignment tests to the canonical mutation path
- 2026-04-08 18:18 PT | Marked `T-038` done after removing client-side semantic runtime `setOverlay` and `setOverlayStatus` mutators and routing viewport semantic status polling through revision-safe snapshot application
- 2026-04-08 18:23 PT | Marked `T-039` done after making semantic group `get` a pure lookup, removing highlight side effects from semantic lookup execution, and updating tests to stop expecting presentation patch ops from semantic reads
- 2026-04-08 18:30 PT | Marked `T-040` done after deleting the dead orchestration module, inlining the remaining tool-catalog helper into routing, and removing unused orchestration contract types from the chat internal surface
- 2026-04-08 18:44 PT | Compressed `openai-chat/execution.ts` by moving tool schemas into `tool-definitions.ts` and tool argument parsing into `tool-args.ts`, then removed stale imports after the extraction
- 2026-04-08 18:49 PT | Compressed `openai-chat/execution.ts` again by moving semantic target resolution and semantic tool execution into `semantic-execution.ts`, leaving the top-level dispatcher and non-semantic tool flow in place
- 2026-04-08 19:02 PT | Collapsed the model-facing chat tool surface into domain tools for presentation, selection, semantics, and assistant UI, while translating those broader actions onto the existing deterministic executors underneath
- 2026-04-08 19:17 PT | Collapsed presentation-state synchronization onto `vehiclePatchState.apply(...)`, migrated production callers and tests off `queue`/`setHighlights`/`clearHighlights`/`clearHighlightTargets`/`restore`, and deleted the dead wrapper methods
- 2026-04-09 17:01 PT | Marked `T-041` done after adding a reusable request-gate approval UI, extracting its interaction state into a shared `requestGate` store, and making the overlay block underlying canvas interaction when visible
- 2026-04-09 17:01 PT | Removed the request-gate debug default by hiding it at store reset and leaving the mounted component dormant until app-layer intercept code calls `requestGate.open(...)`
- 2026-04-09 17:01 PT | Recorded that duplex chat handling remains in place and the new request-gate store is ready to serve as an ALI intercept surface for tool-usage approval flows
- 2026-04-09 PT | Marked T-042 done after having createRealtimeClientSecret return the built instructions string, returning it through the API route, storing it in the orb on session open, and pushing session.update via a store-reactive $effect whenever vehicleNodeSelection or vehiclePatchState changes during a live session
- 2026-04-09 PT | Marked T-043 done after adding label to HighlightScopeDescriptor and detecting in the sidebar $effect when all current highlight targets are a strict subset of the updated group targets, then re-applying set_highlights to include the new members
- 2026-04-09 PT | Marked T-044 done after fixing resolveScopedSemanticTargets highlighted scope to split candidateTargets by targetType rather than assigning all to materialIds, matching the behaviour already in resolveTypedSemanticMutationTargets
- 2026-04-10 16:22 PT | Marked `T-006` done after adding a route-level `POST /api/vehicle-assets/[assetId]/intent` integration test path that covers valid, missing-request, and unknown-asset cases under `npm test`
- 2026-04-10 16:29 PT | Marked `T-001` done for the current review bar, removed cancelled `T-024`, and deleted stale backlog duplicates for `T-037` through `T-040`
