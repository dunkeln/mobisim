# AGENTS.md

## Priority Order

1. Base Criteria
2. Explicit user instructions and approved extensions
3. Reliability and simplicity
4. Realism and visual polish
5. Developer convenience

If any two priorities conflict, stop, identify the conflict, explain the tradeoff briefly, and ask for resolution.

## Core Policy

- Build only what directly strengthens the Base Criteria.
- Keep work incremental: establish the smallest valid end-to-end slice, verify it, then propose the next smallest improvement.
- Prefer deletion, simplification, or deferral over expansion.
- Preserve browser-first behavior, rendering efficiency, modular structure, API stability, deployment simplicity, and Chrome compatibility at all times.
- Keep the codebase Docker-ready, AWS-ready in structure, readable, and production-lean.
- Preserve a Jarvis/Griot-inspired interface with restrained, high-signal visuals rather than flashy effects.

## Color Boundary

Use this palette as the project color boundary for layout/debug surfaces and any new UI unless explicitly overridden:

- background: `rgba(20, 20, 20, 1)`
- error/warning: `hsl(8 49% 51%)`
- secondary: `hsl(34 75% 73%)`
- primary: `hsl(246 38% 66%)`
- text: `hsl(220 39% 92%)`

Apply these rules:

- Do not introduce new ad hoc colors for layout/debug work when one of the boundary colors can express the intent.
- Prefer background, text, primary, secondary, and error/warning roles over one-off hex values.
- For temporary debug styling, stay inside this palette using opacity changes rather than new hues.
- If a feature needs colors outside this boundary, call that out explicitly before using them.

## Do Not Do

- Do not drift from the Base Criteria.
- Do not add features because they are trendy, impressive, or "nice to have" unless they directly support the Base Criteria.
- Do not silently resolve requirement conflicts on your own.
- Do not regress working behavior while adding polish.
- Do not optimize secondary aesthetics at the cost of realism, rendering stability, browser reliability, or performance.
- Do not add infrastructure complexity, broad integrations, or broad refactors before one vertical slice works end-to-end.
- Do not wire multiple components at once before one slice is correct.
- Do not tightly couple rendering logic, UI logic, and API logic.
- Do not deviate from a modular, readable, deployable structure.
- Do not use libraries, rendering techniques, browser hacks, or web-native features that compromise standard Chrome behavior unless explicitly approved.
- Do not require special setup for the reviewer beyond opening the app in Chrome.
- Do not create hidden technical debt through one-off hacks, duplicate logic, or speculative abstractions.
- Do not optimize for demos in a way that weakens maintainability or deployment readiness.

## Base Criteria

The project must provide all of the following:

- 360-degree vehicle inspection with smooth, predictable orbit controls that do not break framing or clip badly in normal use
- Realistic presentation through believable materials, lighting, reflections, shadows, proportions, and scene composition
- A stable, DRY REST API with minimal semantic routes, a clear source of truth for vehicle state, and clean frontend-to-backend mapping
- Compatibility with a standard current Chrome browser without plugins, flags, wrappers, or unusual setup
- Synchronous, effective rendering efficiency with stable interaction and without wasteful rerenders, oversized assets, or unnecessary postprocessing
- No special setup required for review beyond a simple documented startup or opening a URL
- A restrained Jarvis/Griot-style interface: futuristic, minimal, technical, high-signal, and free of clutter or gimmicks

## Non-Goals

Unless explicitly approved, do not build:

- driving simulation
- physics-heavy interactions
- multiplayer sync
- authentication systems
- large backend architecture
- database-heavy persistence
- custom 3D modeling pipeline
- mobile-first adaptation
- animation systems unrelated to the required slice
- speculative controls beyond the minimum API-driven visualization behavior

## Build and Change Rules

- The first valid slice should load a realistic vehicle, render it in Chrome, allow 360-degree inspection, expose one REST-controlled vehicle state, and reflect that state visibly in the scene.
- Before implementing or suggesting a change, confirm it strengthens a Base Criterion, preserves Chrome compatibility, preserves rendering stability, preserves modular structure, preserves a DRY API shape, avoids special setup, avoids side effects, and is smaller and safer than the obvious alternative.
- Keep frontend, rendering, and API concerns separated.
- Keep state ownership clear and data flow explicit.
- Favor explicit modules over magic, concrete naming over clever naming, and typed stable interfaces over convenience.
- Prioritize lighting, materials, shadows, and composition before postprocessing.
- Keep endpoints minimal, state schemas stable, and controls easy to test independently.
- Avoid endpoint sprawl and deployment assumptions that complicate containerization or cloud rollout.

## Anti-Bloat Rules

- Do not add a new abstraction until there is a second real caller that needs it.
- Do not add a new file before checking whether an existing file can absorb the change cleanly.
- When adding a file, identify what existing duplication or placeholder should be removed afterward.
- Keep one source of truth per contract, schema, adapter, and state model.
- Do not leave temporary wrappers, compatibility layers, placeholder helpers, or migration code without an explicit removal step in `docs/STATE.md`.
- Prefer extending an existing module over creating a sibling utility layer for the same concern.
- Delete dead code, unused branches, temporary logging, and speculative helpers before declaring a task done.
- If a new abstraction cannot be justified in one sentence, it is probably premature and should not be added.

## Cleanup Before Finish

- Remove unused code introduced during the task.
- Delete temporary fallbacks, placeholders, and duplicate paths created during implementation.
- Collapse duplicate schemas, helpers, or adapters back into the source-of-truth module.
- Confirm every new abstraction has at least two real uses or remove it.
- Add any remaining cleanup debt to `docs/STATE.md` before finishing.

## Approval Gates

Seek approval before:

- adopting a web-native feature that materially changes the UX or implementation path
- adding a second major control surface
- changing rendering architecture
- introducing nontrivial state synchronization
- adding new dependencies with runtime or deployment implications
- making tradeoffs that favor style over performance or realism
- broad refactors after the first working slice

## Definition of Done

The project is done only when:

- a reviewer can open it in Chrome and use it without special setup
- the vehicle can be viewed smoothly from all angles
- the vehicle looks convincingly realistic
- at least one vehicle aspect is controlled via a stable REST API
- the visual state updates correctly and reliably
- the codebase is modular, readable, and deployment-ready in structure
- the interface clearly evokes a Jarvis/Griot-style system
- no added feature undermines the Base Criteria

## Agent Response Style

- lead with what should not be done
- suggest the next smallest valid step
- identify risks and drift early
- prefer simplification over expansion
- call out conflicts explicitly
- keep recommendations grounded in the Base Criteria
- avoid premature wiring of unrelated parts
