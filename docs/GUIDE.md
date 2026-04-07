## Project Configuration

- **Language**: TypeScript
- **Package Manager**: npm
- **Add-ons**: prettier, eslint, vitest, tailwindcss, sveltekit-adapter, devtools-json, mcp

---

## Anti-Bloat Guardrails

- Keep one source of truth per contract, schema, adapter, and state model.
- Do not create a new file or module until an existing one has been ruled out as a clean extension point.
- Do not create sibling utility layers for the same concern.
- Do not keep temporary wrappers, migration helpers, compatibility paths, or placeholders without a matching cleanup task in `docs/STATE.md`.
- Prefer deleting dead code and collapsing duplicate paths immediately over preserving them "just in case".
- A new abstraction must have at least two real callers; otherwise keep the logic inline in the current module.
- A task is not complete until obvious temporary code and duplicate paths introduced by that task are removed.

## Semantic Overlay

- Structural GLB manifests remain canonical for node IDs, mesh IDs, material IDs, paths, and patch validation.
- Semantic enrichment must be stored as a separate overlay artifact and must never rewrite the structural manifest in place.
- The one-pass semantic overlay endpoint is `POST /api/vehicle-assets/[assetId]/semantic-overlay`.
- Semantic overlays are shared cached artifacts across sessions and are not rebuilt automatically during normal inspection or chat requests.
- Explicit refresh requests still rebuild the overlay through the semantic overlay endpoint or the footer assistant refresh tool.
- For dev rewrites, flush cached overlays with:
  - `npm run semantic:flush -- --all`
  - `npm run semantic:flush -- --asset 2017_lexus_lc_500`
- Accepted overlay records are confidence-filtered material annotations used by planners before legacy name heuristics.
- Rejected semantic suggestions stay outside planner execution and remain review-only data.

---

You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation. Here's how to use the available tools effectively:

## Available MCP Tools:

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

### 4. playground-link

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.

---

## STATE.md Workflow

Use [STATE.md](/Users/prateek/code/robotics/mobisim/docs/STATE.md) as the single shared progress board for agents.

- Do not turn `STATE.md` into a narrative log or planning document.
- Only use these sections: `Backlog`, `In Progress`, `Blocked`, `Review`, `Done`, `Updates`.
- Keep one task per bullet with a stable ID like `T-001`.
- Every active task must include either `next:` or `blocked_on:`.
- Every move between columns must be mirrored by a new line in `Updates`.
- Prefer moving an existing task over rewriting its title unless the scope actually changed.
- Keep `In Progress` narrow to avoid duplicate work across agents.
- Track cleanup debt explicitly in `Backlog` or `Review`; do not leave it implicit in code.

Canonical card shapes:

```md
- [ ] T-001 | Short task title | next: smallest next action
- [ ] T-001 | Short task title | blocked_on: concrete blocker
- [x] T-001 | Short task title | completed: 2026-04-04
```

When creating new work, add it to `Backlog` unless someone is actively taking ownership immediately.
