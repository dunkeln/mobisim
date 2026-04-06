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

- [ ] T-002 | Expose one REST-controlled vehicle state | next: define minimal request and response schema
- [ ] T-003 | Reflect controlled vehicle state in the scene | next: map one API field to one visible scene change
- [ ] T-006 | Add integration test for vehicle state endpoint | next: add a passing test path that does not depend on Playwright browser install
- [ ] T-008 | Delete placeholder scene helpers after the first vertical slice lands | next: remove procedural stand-in scene code after asset-driven scene is live
- [ ] T-013 | Reduce oversized client chunk from viewer route | next: re-measure after the first real asset and split any viewer-only code if still needed
- [x] T-017 | Wire frontend viewer to registry-backed asset selection | completed: 2026-04-05

## In Progress

- [ ] T-004 | Define shared API contract for vehicle state | next: add the contract to the reduced app shell without reintroducing scaffolding

## Blocked

- [ ] T-001 | Load realistic vehicle asset into scene | blocked_on: approved production-ready source asset

## Review

- [ ] T-014 | Verify root shell remains no-scroll with viewport content only in routes | next: run browser check after next layout-affecting change

## Done

- [x] T-000 | Initialize project documentation scaffold | completed: 2026-04-04
- [x] T-005 | Establish root-only app shell and route-owned page content | completed: 2026-04-04
- [x] T-007 | Prune duplicate vehicle-state types after API wiring | completed: 2026-04-05
- [x] T-009 | Remove temporary wrappers introduced during current slice work | completed: 2026-04-05
- [x] T-010 | Lock document and app shell to no-scroll viewport behavior | completed: 2026-04-04
- [x] T-011 | Define dark-first Tailwind 4 surface tokens and color boundary | completed: 2026-04-04
- [x] T-012 | Add reusable Threlte inspection viewport placeholder | completed: 2026-04-04
- [x] T-015 | Load Audi R8 asset into the inspection viewport | completed: 2026-04-05
- [x] T-018 | Build server-side vehicle asset registry scaffold | completed: 2026-04-05
- [x] T-017 | Wire frontend viewer to registry-backed asset selection | completed: 2026-04-05

## Updates

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
