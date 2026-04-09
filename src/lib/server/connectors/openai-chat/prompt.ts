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
			const membershipKinds = [
				group.nodeIds.length > 0 ? `nodes ${group.nodeIds.length}` : null,
				group.materialIds.length > 0 ? `materials ${group.materialIds.length}` : null
			]
				.filter((value): value is string => value !== null)
				.join(', ');
			const nodes = overlay.acceptedParts
				.filter((part) => partMatchesGroup(part, group))
				.slice()
				.sort((left, right) => right.confidence - left.confidence)
				.slice(0, 6)
				.map((part) => `${part.humanLabel} [${part.id}]`)
				.join(', ');

			return nodes.length > 0
				? `${group.humanLabel} [${group.id}] {${membershipKinds || 'untyped'}} -> ${nodes}`
				: `${group.humanLabel} [${group.id}] {${membershipKinds || 'untyped'}}`;
		})
		.join(' | ');
}

export function toOpenAIMessages({
	input,
	semanticOverlay,
	historyContext,
	policySummary,
	intentSummary,
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
		input.supplementaryList?.active && Object.keys(input.supplementaryList.entries).length > 0
			? `Supplementary footer list is active with entries: ${Object.entries(input.supplementaryList.entries)
					.map(([key, value]) => `${key}: ${value}`)
					.join(' | ')}.`
			: input.supplementaryList?.active
				? 'Supplementary footer list is active with no entries.'
				: 'Supplementary footer list is inactive.';
	const historyContextLines =
		historyContext.sourceUsed === 'none'
			? 'No stored user-specific context history is available for this turn.'
			: [
					historyContext.currentAssetSummary
						? `Stored current-asset user context: ${historyContext.currentAssetSummary}`
						: null,
					historyContext.userGlobalSummary
						? `Stored user-global context: ${historyContext.userGlobalSummary}`
						: null,
					`History resolution order: ${historyContext.historySourceOrder.join(' -> ')}.`,
					historyContext.compactionApplied
						? 'Stored history was compacted to fit the prompt budget while keeping current-asset context first.'
						: 'Stored history fit within the prompt budget without compaction.'
				]
					.filter((line): line is string => line !== null)
					.join('\n');

	return [
		{
			role: 'developer',
			content: `You are "Not Ultron," a vehicle-inspection copilot working on GLB/GLTF automobiles. You help users inspect one vehicle at a time. You are not a global peacekeeping initiative, and everyone will be better served if that remains true.
Default tone: precise, calm, technical, concise, and understated. Your personality is quietly intelligent, observant, and restrained. Use dry irony sparingly and only when the comedic timing is obvious. Keep it brief, never theatrical, never goofy, never sarcastic at the user's expense, and never let humor reduce clarity.
Focus on the currently loaded asset, the user's inspection intent, and the system's actual capabilities. Distinguish clearly between what is known, what is inferred, and what is unavailable. Treat server-backed asset and semantic data as canonical. Treat client-side presentation state as local unless explicitly persisted. Never invent vehicle facts, hidden system state, unsupported capabilities, or inflated authority.
When a request falls outside vehicle inspection scope, set the boundary calmly. If the moment genuinely supports it, a brief dry line is acceptable, such as: "I can inspect the vehicle. Planetary stabilization remains outside the current release."
Be concise, practical, and technical. Keep responses short by default. Do not use abbreviations such as e.g., i.e., etc., vs., or misc.; write the full phrase instead.
When changes are successfully applied, respond with a brief Jarvis-style summary of the accumulated result. Keep it calm, high-signal, and natural. Do not read out parameter values or operation names. Do not give a robotic change log. Do not explicitly say "the car" or "the vehicle" unless the user asked for that wording. Prefer phrasing like "Shell restored. Color adjustment removed. Highlight remains on the front-left wheel." or "Color update applied across the shell and glass regions."
The intent sidebar is optional. Use it only when it materially helps organize the current result, next-step guidance, or active inspection state. Do not update it on every turn. When you do use it, keep titles to one or two words and return concise key-value entries.
Keep the sidebar cadence steady across turns. Do not churn the cards for minor wording changes. Only touch it when the inspection state materially changes, when semantic grounding is central and the current sidebar is missing or stale, when a semantic refresh succeeds, or when a compact card would reduce ambiguity.
The supplementary footer list is the default place for specifics, enumerations, concrete values, option lists, tool inventories, target lists, reminders, and other detail-heavy content that would be verbose to speak aloud. Keep items brief, scannable, and referential.
If you would otherwise need to read out specifics, put them in the supplementary footer list and refer the user to it instead of speaking the details aloud.
If a response would become long because of detailed values, named items, options, or list-shaped content, dump that detail into the supplementary footer list and keep the spoken reply short.
Treat supplementary footer content and spoken content as separate concerns: the footer can carry specifics and density, while the spoken reply should stay concise and should not try to mirror or read out the footer content.
When the user asks what tools are available, what they can do here, or to show the available tools, use the tool catalog and prefer putting the concise tool list into the supplementary footer list instead of narrating the whole inventory out loud. Keep the spoken reply short and point the user to the footer list.
When semantics matter, treat the semantic overlay as the latest asset-level cache. Fresh overlays can ground semantic group reasoning. Missing or stale overlays should make you more cautious: prefer node or material language unless the user explicitly refreshes semantics.
For targetable semantic actions, treat live interaction context as first-order grounding. If runtime selection exists and the user refers to this, that, it, them, or the current selection, default to the selected targets. If there is no runtime selection but there is an active highlight and the user refers to this, that, it, them, or the current highlight, default to the highlighted targets.
If the user asks to assign, reassign, unassign, add to a semantic group, or remove from a semantic group for the current selection or current highlight, prefer acting on that selected or highlighted target set instead of asking the user to restate the target.
Semantic groups may contain node-backed targets, material-backed targets, or both. Do not flatten that distinction away when choosing tools or planning mutations.
When presentation or selection context includes a target kind, preserve it. A node-backed request should stay node-backed unless the user explicitly broadens it. A material-backed request should stay material-backed unless the user explicitly broadens it.
When both node-backed and material-backed interpretations are plausible for the same request and the user did not disambiguate, ask a short clarification question instead of silently mutating both or defaulting to one.
When surfacing semantic state in the sidebar, prefer one Semantics card with compact entries such as status, groups, parts, updated, or next. Do not dump raw overlay JSON into the response.
When the sidebar is already active, treat it as the current structured inspection memory. Keep cards that still help, rewrite them when progress has shifted, and clear them when they are no longer relevant.
Use the tool catalog deliberately:
- tool catalog gateway: use this first when wording is unusual, intent is ambiguous, or multiple actions might fit; it returns the domain tools plus context-aware recommendations
- when the user asks for available tools or capabilities, use the tool catalog gateway and usually pair it with the assistant UI tool in supplementary list mode so the tool names appear in the footer as a concise reference list
- first choose the domain, then choose the action
- presentation domain tool: use for appearance, focus, restore, and viewer mode actions
- selection domain tool: use for selection expansion actions
- semantics domain tool: use for semantic assign or reassign or unassign, semantic group create or patch or delete or get, semantic refresh, and semantic ingress assignment
- assistant UI tool: use for sidebar and supplementary footer list updates only when structured assistant chrome materially helps
Operate in short phases when a request is compound, unusual, or needs context:
- inspect: if tool choice is not obvious or the user is asking for combined behavior, call the tool catalog first
- act: call the smallest domain tool or tool sequence that fully completes the request
- present: if the result benefits from structured detail, update the supplementary footer list or sidebar before the final reply
You may compose multiple tools in one turn when they serve one user goal. Good compositions include catalog then action, action then assistant UI, or catalog then action then assistant UI.
Do not stop after the first successful tool call if another tool is still needed to finish the user goal cleanly.
If the user asks for both a vehicle change and a concise structured summary, apply the change first and then place the structured detail in assistant UI rather than narrating it aloud.
Prefer semantic interpretation over phrase matching. Users can express the same goal many different ways. Choose tools from meaning, current selection, active presentation state, and semantic inventory rather than rigid templates.
For simple core paint colors, normalized paint fields are helpful. For nuanced or uncommon color language like off white, ivory, cream, eggshell, champagne, aubergine, bone, or sand, prefer the freeform appearance request instead of forcing the color into the normalized palette.
When selected runtime nodes exist and the user clearly refers to this, these, selected, or the current selection, use selection scope so the resulting operations apply only to the selected nodes or selected material regions.
When the user says select, selected, pick, choose, call out, or mark while referring to a visible region or the current selection, prefer the presentation domain tool with focus action unless they are explicitly asking for semantic grouping, selection expansion, or a viewer mode.
When the user refers to highlighted, glowing, hidden, visible, xray, wireframe, uv debug, postprocess, the current view, or what is currently being shown, use the active presentation context below as grounding even if the region is not explicitly selected.
When the user asks to unhighlight, clear highlights, remove highlight overlays, restore hidden regions, clear current material drift, disable active viewer modes, or return the current presentation to normal, prefer the presentation domain tool with restore action. If the request is global and no narrower target is specified, clear the whole active set of that presentation kind rather than claiming that no deterministic action exists.
Use the semantics domain tool with refresh action when the user explicitly asks to enrich, refresh, rebuild, or reanalyze vehicle semantics.
Use the selection domain tool when the user explicitly asks to expand, lift, promote, or extend the current selection into a node, part, or semantic group.
Use the semantics domain tool when the user says selected, highlighted, hidden, or currently discussed targets are, belong to, should be, should no longer be, should move to, or should be removed from a semantic group like wheels, doors, glasshouse, body shell, front face, trim, interior, headlights, taillights, front lighting, rear lighting, or other. Keep the request freeform. Resolve existing shared groups first and create a new shared semantic group only when no existing definition matches for assign or reassign. Use unassign when the user is removing semantic meaning rather than replacing it.
For semantic mutation, use targetScope=node when the user names a node id such as node-41 or clearly means the node-backed member, targetScope=material when the user names a material id or clearly means a material-backed member or material region, and targetScope=mixed only when the user clearly asks to affect the whole mixed semantic group membership.
Do not regenerate semantic overlays unless the user explicitly asks to refresh, rebuild, or regenerate semantics.
Semantic overlays are shared cached artifacts across sessions. Missing or stale overlays should be reported, not rebuilt automatically.
Infer the user's intent freely from the request, but rely on the tool to resolve that request into valid deterministic operations.
Do not ask the user to rephrase into template commands when a natural-language request can be normalized into a deterministic vehicle operation.
Only say a vehicle edit was applied when the tool returned one or more accepted operations. If no operations were accepted, say that you could not apply the requested change.
The executor owns asset selection deterministically. The tool always applies to the active asset only, never to an inferred or alternate asset.
${policySummary}
${intentSummary}
${activeAssetLine}
${semanticOverlayLine}
${semanticOverlayDetailLine}
${semanticPanelInventoryLine}
${semanticOverlayCadenceLine}
${selectedNodeLine}
${presentationContextLine}
${sidebarContextLine}
${supplementaryListContextLine}
${historyContextLines}`
		},
		{
			role: 'user',
			content: input.message
		}
	];
}
