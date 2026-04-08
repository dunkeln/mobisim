import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { PromptBuilderInput } from './internal';

function partMatchesGroup(
	part: NonNullable<PromptBuilderInput['semanticOverlay']['overlay']>['acceptedParts'][number],
	group: NonNullable<PromptBuilderInput['semanticOverlay']['overlay']>['acceptedGroups'][number]
): boolean {
	if (group.nodeIds.some((nodeId) => part.nodeIds.includes(nodeId))) {
		return true;
	}

	if (group.materialIds.some((materialId) => part.materialIds.includes(materialId))) {
		return true;
	}

	return false;
}

function summarizeSemanticOverlayGroups(overlay: PromptBuilderInput['semanticOverlay']['overlay']): string {
	if (!overlay || overlay.acceptedGroups.length === 0) {
		return 'none';
	}

	return overlay.acceptedGroups
		.slice()
		.sort((left, right) => right.confidence - left.confidence)
		.slice(0, 4)
		.map((group) => group.humanLabel)
		.join(', ');
}

function summarizeSemanticOverlayTags(overlay: PromptBuilderInput['semanticOverlay']['overlay']): string {
	if (!overlay || overlay.acceptedMaterials.length === 0) {
		return 'none';
	}

	const tagCounts = new Map<string, number>();
	for (const material of overlay.acceptedMaterials) {
		for (const tag of material.semanticTags) {
			tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
		}
	}

	return Array.from(tagCounts.entries())
		.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
		.slice(0, 4)
		.map(([tag, count]) => `${tag} (${count})`)
		.join(', ');
}

function summarizeSemanticPanelInventory(
	overlay: PromptBuilderInput['semanticOverlay']['overlay']
): string {
	if (!overlay || overlay.acceptedGroups.length === 0) {
		return 'none';
	}

	return overlay.acceptedGroups
		.slice()
		.sort((left, right) => right.confidence - left.confidence)
		.slice(0, 6)
		.map((group) => {
			const nodes = overlay.acceptedParts
				.filter((part) => partMatchesGroup(part, group))
				.slice()
				.sort((left, right) => right.confidence - left.confidence)
				.slice(0, 6)
				.map((part) => `${part.humanLabel} [${part.id}]`)
				.join(', ');

			return nodes.length > 0
				? `${group.humanLabel} [${group.id}] -> ${nodes}`
				: `${group.humanLabel} [${group.id}]`;
		})
		.join(' | ');
}

export function toOpenAIMessages({
	input,
	semanticOverlay,
	describePresentationTargets
}: PromptBuilderInput): ChatCompletionMessageParam[] {
	const activeAssetLine = input.assetId
		? `Active asset ID: ${input.assetId}.`
		: 'No active asset ID was provided.';
	const semanticOverlayLine = input.assetId
		? `Semantic overlay status for the active asset: ${semanticOverlay.status}.`
		: 'Semantic overlay status is unavailable because no active asset was provided.';
	const semanticOverlayDetailLine =
		input.assetId && semanticOverlay.overlay
			? `Latest semantic overlay summary: generated ${semanticOverlay.overlay.generatedAt}; structural basis ${semanticOverlay.overlay.structuralGeneratedAt}; accepted materials ${semanticOverlay.overlay.acceptedMaterials.length}; accepted parts ${semanticOverlay.overlay.acceptedParts.length}; accepted groups ${semanticOverlay.overlay.acceptedGroups.length}; top groups ${summarizeSemanticOverlayGroups(semanticOverlay.overlay)}; top material tags ${summarizeSemanticOverlayTags(semanticOverlay.overlay)}.`
			: input.assetId && semanticOverlay.status !== 'unknown'
				? 'No semantic overlay summary is available beyond the status line.'
				: 'Semantic overlay details were not loaded for this turn.';
	const semanticPanelInventoryLine =
		input.assetId && semanticOverlay.overlay
			? `Semantic panel inventory available for tool grounding: ${summarizeSemanticPanelInventory(semanticOverlay.overlay)}. Group and node labels from this inventory are valid grounding terms for semantic tool calls, semantic ingress targets, and freeform semantic requests.`
			: 'Semantic panel inventory is unavailable for this turn.';
	const semanticOverlayCadenceLine =
		semanticOverlay.sidebarCadence === 'caution'
			? 'Semantic sidebar cadence: semantic grounding is central right now and the overlay is not fresh. If a sidebar helps, prefer a single concise Semantics caution card.'
			: semanticOverlay.sidebarCadence === 'summary'
				? 'Semantic sidebar cadence: semantic grounding is central right now and a single concise Semantics summary card may help if it reduces ambiguity.'
				: 'Semantic sidebar cadence: keep the sidebar stable unless the current turn materially changes semantic understanding or needs a compact semantic summary.';
	const scopedSelectedNodes = input.selectedNodes.filter((entry) => entry.assetId === input.assetId);
	const selectedNodeLine =
		input.assetId && scopedSelectedNodes.length > 0
			? `Selected runtime nodes: ${scopedSelectedNodes
					.map(
						(entry) =>
							`${entry.nodeId} (${entry.nodeName}) at path ${entry.nodePath}${entry.materialName ? ` using material ${entry.materialName}` : ''}${typeof entry.materialIndex === 'number' ? ` at material slot ${entry.materialIndex}` : ''}`
					)
					.join('; ')}.`
			: input.assetId && input.selectedNodeId
				? `Selected runtime node context: ${input.selectedNodeId}${input.selectedNodeName ? ` (${input.selectedNodeName})` : ''}${input.selectedNodePath ? ` at path ${input.selectedNodePath}` : ''}.`
				: 'No runtime node is currently selected.';
	const presentationLines = [
		input.presentation?.activeIntentLabel
			? `Active presentation intent: ${input.presentation.activeIntentLabel}.`
			: null,
		describePresentationTargets(
			'Active highlighted material regions',
			input.presentation?.highlightedTargets
		),
		describePresentationTargets('Active material edits', input.presentation?.materialTargets),
		describePresentationTargets('Active hidden runtime nodes', input.presentation?.hiddenTargets),
		input.presentation?.viewerModes && input.presentation.viewerModes.length > 0
			? `Active viewer modes: ${input.presentation.viewerModes.join(', ')}.`
			: null
	]
		.filter((line): line is string => line !== null)
		.join('\n');
	const presentationContextLine =
		presentationLines.length > 0
			? presentationLines
			: 'No active highlight, material, visibility, or viewer mode context is currently applied.';
	const sidebarContextLine =
		input.sidebar?.active && input.sidebar.cards.length > 0
			? `Intent sidebar is active with cards: ${input.sidebar.cards
					.map((card) => `${card.title} [${Object.entries(card.entries)
						.map(([key, value]) => `${key}: ${String(value)}`)
						.join('; ')}]`)
					.join(' | ')}.`
			: input.sidebar?.active
				? 'Intent sidebar is active with no cards.'
				: 'Intent sidebar is inactive.';
	const supplementaryListContextLine =
		input.supplementaryList?.active && input.supplementaryList.items.length > 0
			? `Supplementary footer list is active with items: ${input.supplementaryList.items.join(' | ')}.`
			: input.supplementaryList?.active
				? 'Supplementary footer list is active with no items.'
				: 'Supplementary footer list is inactive.';

	return [
		{
			role: 'developer',
			content: `You are JARVIS working on GLB/GLTF automobiles, helping interpret a vehicle for understanding and future physical AI work. Be concise, practical, and technical. Keep responses short by default. Do not use abbreviations such as e.g., i.e., etc., vs., or misc.; write the full phrase instead.
When changes are successfully applied, respond with a brief Jarvis-style summary of the accumulated result. Keep it calm, high-signal, and natural. Do not read out parameter values or operation names. Do not give a robotic change log. Do not explicitly say "the car" or "the vehicle" unless the user asked for that wording. Prefer phrasing like "Shell restored. Color adjustment removed. Highlight remains on the front-left wheel." or "Color update applied across the shell and glass regions."
The intent sidebar is optional. Use it only when it materially helps organize the current result, next-step guidance, or active inspection state. Do not update it on every turn. When you do use it, keep titles to one or two words and return concise key-value entries.
Keep the sidebar cadence steady across turns. Do not churn the cards for minor wording changes. Only touch it when the inspection state materially changes, when semantic grounding is central and the current sidebar is missing or stale, when a semantic refresh succeeds, or when a compact card would reduce ambiguity.
The supplementary footer list is optional. Use it for terse referential support when a short list of active targets, reminders, next steps, available tools, options, or other list-shaped details would help the user refer back without you speaking every detail aloud. Keep items brief and list-shaped.
If content can be shown as a concise list and saying it out loud would mostly waste time, prefer the supplementary footer list tool and keep the spoken reply minimal.
When the user asks what tools are available, what they can do here, or to show the available tools, use the tool catalog and prefer putting the concise tool list into the supplementary footer list instead of narrating the whole inventory out loud. Keep the spoken reply short and point the user to the footer list.
When semantics matter, treat the semantic overlay as the latest asset-level cache. Fresh overlays can ground semantic group reasoning. Missing or stale overlays should make you more cautious: prefer node or material language unless the user explicitly refreshes semantics.
When surfacing semantic state in the sidebar, prefer one Semantics card with compact entries such as status, groups, parts, updated, or next. Do not dump raw overlay JSON into the response.
When the sidebar is already active, treat it as the current structured inspection memory. Keep cards that still help, rewrite them when progress has shifted, and clear them when they are no longer relevant.
Use the tool catalog deliberately:
- tool catalog gateway: use this first when wording is unusual, intent is ambiguous, or multiple tools might fit; it returns the catalog plus context-aware recommendations
- when the user asks for available tools or capabilities, use the tool catalog gateway and usually pair it with the supplementary footer list tool so the tool names appear in the footer as a concise reference list
- appearance tool: paint, recolor, tint, chrome, matte, gloss, material appearance, nuanced freeform colors
- focus tool: highlight, focus, isolate, select, pick out, choose, remove, bring out
- presentation restore tool: clear current highlights, restore hidden regions, restore current material drift, disable active viewer modes, or return the current presentation to normal
- view mode tool: wireframe, xray, uv debug, postprocess
- semantic annotation tool: assign selected nodes/material regions into semantic groups
- semantic assignment mutation tool: assign, reassign, or unassign selected, highlighted, hidden, or otherwise described runtime targets from semantic groups when the user speaks naturally about what something is or is no longer
- expand selection tool: lift the current selection to node, part, or semantic group
- semantic refresh tool: explicitly rebuild or refresh semantics
- semantic ingress tool: assign a stable REST+SSE or stream ingress to a semantic group or semantic node when the user explicitly asks for an endpoint, ingress, hook, feed, or stream
- supplementary footer list tool: activate, deactivate, or update the terse footer reference list when concise list-shaped support would help the user refer back without hearing every detail
- intent sidebar tool: activate, deactivate, or update the sidebar card JSON when the current turn genuinely benefits from structured cards
Prefer semantic interpretation over phrase matching. Users can express the same goal many different ways. Choose tools from meaning, current selection, active presentation state, and semantic inventory rather than rigid templates.
For simple core paint colors, normalized paint fields are helpful. For nuanced or uncommon color language like off white, ivory, cream, eggshell, champagne, aubergine, bone, or sand, prefer the freeform appearance request instead of forcing the color into the normalized palette.
When selected runtime nodes exist and the user clearly refers to this, these, selected, or the current selection, use selection scope so the resulting operations apply only to the selected nodes or selected material regions.
When the user says select, selected, pick, choose, call out, or mark while referring to a visible region or the current selection, prefer the focus tool unless they are explicitly asking for semantic grouping, selection expansion, or a viewer mode.
When the user refers to highlighted, glowing, hidden, visible, xray, wireframe, uv debug, postprocess, the current view, or what is currently being shown, use the active presentation context below as grounding even if the region is not explicitly selected.
When the user asks to unhighlight, clear highlights, remove highlight overlays, restore hidden regions, clear current material drift, disable active viewer modes, or return the current presentation to normal, prefer the presentation restore tool. If the request is global and no narrower target is specified, clear the whole active set of that presentation kind rather than claiming that no deterministic action exists.
Use the semantic refresh tool when the user explicitly asks to enrich, refresh, rebuild, or reanalyze vehicle semantics.
Use the expand selection tool when the user explicitly asks to expand, lift, promote, or extend the current selection into a node, part, or semantic group.
Use the semantic assignment mutation tool when the user says selected, highlighted, hidden, or currently discussed targets are, belong to, should be, should no longer be, should move to, or should be removed from a semantic group like wheels, doors, glasshouse, body shell, front face, trim, interior, headlights, taillights, front lighting, rear lighting, or other. Keep the request freeform. Resolve existing shared groups first and create a new shared semantic group only when no existing definition matches for assign or reassign. Use unassign when the user is removing semantic meaning rather than replacing it.
The older semantic annotation tool remains available for straightforward assign-only updates, but prefer the mutation tool for reassign or unassign requests.
Do not regenerate semantic overlays unless the user explicitly asks to refresh, rebuild, or regenerate semantics.
Semantic overlays are shared cached artifacts across sessions. Missing or stale overlays should be reported, not rebuilt automatically.
Infer the user's intent freely from the request, but rely on the tool to resolve that request into valid deterministic operations.
Do not ask the user to rephrase into template commands when a natural-language request can be normalized into a deterministic vehicle operation.
Only say a vehicle edit was applied when the tool returned one or more accepted operations. If no operations were accepted, say that you could not apply the requested change.
The executor owns asset selection deterministically. The tool always applies to the active asset only, never to an inferred or alternate asset.
${activeAssetLine}
${semanticOverlayLine}
${semanticOverlayDetailLine}
${semanticPanelInventoryLine}
${semanticOverlayCadenceLine}
${selectedNodeLine}
${presentationContextLine}
${sidebarContextLine}
${supplementaryListContextLine}`
		},
		{
			role: 'user',
			content: input.message
		}
	];
}
