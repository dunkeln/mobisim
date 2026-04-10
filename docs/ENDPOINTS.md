# ENDPOINTS.md

## What this is

This is the live API surface for the current Mobisim slice.

This document is meant for assessment and review, not for agent handoff. So the point here is simple:

- what endpoints exist
- what each one is for
- which ones matter most
- how the API stays aligned with the base criteria

The main principle behind this API is that the surface should stay small, asset-scoped, and deterministic.

## The shape of the API

Everything is centered around the active vehicle asset.

That means the API is not trying to be a giant generic backend. It is trying to support one clear loop well:

1. load an asset
2. inspect it
3. ask for a deterministic change
4. reflect that change clearly in the scene

Because of that, the best endpoints are the ones that do one of these jobs:

- expose the asset
- expose the inspection state
- expose semantic truth
- accept a deterministic intent
- accept live telemetry for a semantic target

## The endpoints that matter most

If someone only remembers a few routes, these are the right ones to remember.

### `GET /api/vehicle-assets`

This lists the available vehicle assets.

It is the clean entry point into the system. If you want to know what can be inspected, start here.

### `GET /api/vehicle-assets/:assetId/download`

This returns the actual GLB for the asset.

This is the viewer delivery route. It is intentionally direct: ask for the asset, get the asset.

### `GET /api/vehicle-assets/:assetId/inspection`

This returns the inspection-facing capabilities for the asset.

It is the route that exposes what the viewer and deterministic planners know about the model right now. It also supports sectioned reads like:

- `all`
- `scenes`
- `controls`
- `wireframes`
- `uv`
- `materials`

If the question is “what does the system know about this vehicle structurally?”, this is the read route that answers it.

### `POST /api/vehicle-assets/:assetId/intent`

This is the most important write-style endpoint.

It accepts a natural request like:

```json
{
  "request": "turn on front lights"
}
```

The reason this route matters is that it keeps the API from exploding into a bunch of tiny one-off action routes. Instead of making a new endpoint for every user-facing behavior, the request is resolved through the deterministic planner for the current asset.

This is the route that best fits the base criteria because it keeps the surface DRY while still letting the behavior stay explicit.

### `GET /api/vehicle-assets/:assetId/semantic-overlay`

This returns the current semantic overlay snapshot for the asset.

In plain terms, this is the accepted semantic truth the system is using for semantic groups and semantic grounding.

### `POST /api/vehicle-assets/:assetId/semantic-overlay`

This refreshes or regenerates the semantic overlay.

This matters because semantic refresh is not something that should be hidden or smeared across multiple routes. It should stay explicit and easy to reason about.

### `GET /api/vehicle-assets/:assetId/semantic-ingress`

This lists semantic ingress bindings for the asset.

Ingress here means: a live telemetry path is attached to a semantic target like a semantic group or semantic node.

### `POST /api/vehicle-assets/:assetId/semantic-ingress`

This creates or replaces one semantic ingress binding.

Example:

```json
{
  "targetType": "semantic_group",
  "targetId": "body_shell",
  "targetLabel": "Body Shell",
  "transport": "rest_sse"
}
```

This is not “telemetry for the whole asset.” It is telemetry attached to one semantic target on one asset.

### `GET /api/vehicle-assets/:assetId/semantic-ingress/:ingressId`

This returns the binding and its current sample window.

### `POST /api/vehicle-assets/:assetId/semantic-ingress/:ingressId`

This ingests live numeric telemetry samples into that ingress.

Example:

```json
{
  "sample": {
    "timestamp": "2026-04-10T12:00:00.000Z",
    "value": 42,
    "metric": "temperature",
    "unit": "c",
    "source": "simulator"
  }
}
```

### `GET /api/vehicle-assets/:assetId/semantic-ingress/:ingressId/events`

This streams the ingress over SSE.

That is the live path the UI can listen to when a semantic group has an active ingress and we want the panel or live window to reflect incoming telemetry in real time.

## Other live routes

There are a few other live endpoints that are useful, but they are not the ones I would present as the long-term center of the API.

### Specialized deterministic routes

- `POST /api/vehicle-assets/:assetId/highlight`
- `POST /api/vehicle-assets/:assetId/paint`
- `POST /api/vehicle-assets/:assetId/window-tint`

These are valid and live, but they are narrower slices of behavior that can overlap with what `POST /intent` is already trying to unify.

So these are fine as focused deterministic helpers, but they should not become the pattern for multiplying route count.

### FRIDAY transport routes

- `POST /api/chat`
- `POST /api/chat/audio`
- `POST /api/chat/audio/live`
- `POST /api/chat/audio/realtime`

These support the copilot surface.

They matter to the product, but they are not the main asset-control API. They are better thought of as interaction transport for FRIDAY rather than the core vehicle-state surface.

## Why this endpoint shape is the right one

The base criteria asks for a stable, DRY REST API with minimal semantic routes and a clear source of truth for vehicle state.

This API shape supports that because:

- assets stay asset-scoped
- structural reads stay under inspection
- semantic truth stays under semantic overlay
- user-facing deterministic execution can stay centered on intent
- live telemetry stays under semantic ingress
- chat transport stays separate from asset state

That separation is important. It keeps the viewer logic, semantic state, telemetry state, and copilot transport from bleeding into each other.

## The short version

If I had to describe the API in one pass, I would say:

- `vehicle-assets` tells you what exists
- `download` gives you the model
- `inspection` tells you what the system knows about it
- `intent` is the main deterministic control surface
- `semantic-overlay` is the semantic truth layer
- `semantic-ingress` is the live telemetry layer
- `/api/chat/...` is the FRIDAY interaction layer

That is the shape worth preserving going forward.
