import { OpenAIChatInputError } from './errors';
import {
	type AssignSemanticIngressToolArgs,
	type ApplyVehicleAppearanceIntentToolArgs,
	type ApplyVehicleFocusIntentToolArgs,
	type EditVehiclePresentationToolArgs,
	type EditVehicleSelectionToolArgs,
	type EditVehicleSemanticsToolArgs,
	type SetAssistantUiToolArgs,
	type ExpandVehicleSelectionToolArgs,
	type GetVehicleToolCatalogToolArgs,
	type ManageVehicleSemanticGroupToolArgs,
	type MutateVehicleSemanticAssignmentToolArgs,
	type RefreshVehicleSemanticsToolArgs,
	type RestoreVehiclePresentationToolArgs,
	type SetIntentSidebarToolArgs,
	type SetSupplementaryReferenceListToolArgs,
	type SetVehicleViewModeToolArgs,
	type SetOperationMode
} from './internal';
import { normalizeSidebarCard, normalizeSupplementaryListState } from './normalize';
import type { FooterChatSidebarCard } from './types';

const VALID_SET_OPERATIONS: SetOperationMode[] = ['replace', 'add', 'subtract', 'intersect', 'union'];

function parseSetOperation(value: unknown): SetOperationMode | undefined {
	if (typeof value === 'string' && VALID_SET_OPERATIONS.includes(value as SetOperationMode)) {
		return value as SetOperationMode;
	}
	return undefined;
}

export function parseApplyVehicleAppearanceIntentToolArgs(
	input: string
): ApplyVehicleAppearanceIntentToolArgs {
	const parsed = JSON.parse(input) as ApplyVehicleAppearanceIntentToolArgs;
	return {
		request: typeof parsed.request === 'string' ? parsed.request.trim() || undefined : undefined,
		colorFamily:
			typeof parsed.colorFamily === 'string' ? parsed.colorFamily.trim() || undefined : undefined,
		shade: parsed.shade,
		saturation: parsed.saturation,
		finish: parsed.finish,
		hex: parsed.hex,
		scope: parsed.scope === 'selection' ? 'selection' : 'asset'
	};
}

export function parseApplyVehicleFocusIntentToolArgs(input: string): ApplyVehicleFocusIntentToolArgs {
	const parsed = JSON.parse(input) as ApplyVehicleFocusIntentToolArgs;
	return {
		request: parsed.request,
		scope: parsed.scope === 'selection' ? 'selection' : 'asset'
	};
}

export function parseSetVehicleViewModeToolArgs(input: string): SetVehicleViewModeToolArgs {
	const parsed = JSON.parse(input) as SetVehicleViewModeToolArgs;
	if (!['wireframe', 'xray', 'uv_debug', 'postprocess'].includes(parsed.mode)) {
		throw new OpenAIChatInputError('A valid vehicle view mode is required.');
	}

	return {
		mode: parsed.mode,
		enabled: parsed.enabled !== false
	};
}

export function parseGetVehicleToolCatalogToolArgs(input: string): GetVehicleToolCatalogToolArgs {
	if (!input.trim()) {
		return {};
	}

	const parsed = JSON.parse(input) as {
		goal?: unknown;
		includeExamples?: unknown;
	};

	return {
		goal: typeof parsed.goal === 'string' ? parsed.goal.trim() || undefined : undefined,
		includeExamples: parsed.includeExamples === true
	};
}

export function parseRestoreVehiclePresentationToolArgs(
	input: string
): RestoreVehiclePresentationToolArgs {
	const parsed = JSON.parse(input) as RestoreVehiclePresentationToolArgs;
	if (!['highlights', 'hidden', 'viewer_modes', 'materials', 'all'].includes(parsed.kind)) {
		throw new OpenAIChatInputError('A valid presentation restore kind is required.');
	}

	return {
		kind: parsed.kind,
		scope: parsed.scope === 'matching' ? 'matching' : 'all',
		query: typeof parsed.query === 'string' ? parsed.query.trim() || undefined : undefined
	};
}

export function parseExpandVehicleSelectionToolArgs(input: string): ExpandVehicleSelectionToolArgs {
	const parsed = JSON.parse(input) as ExpandVehicleSelectionToolArgs;
	if (!['node', 'part', 'semantic_group'].includes(parsed.target)) {
		throw new OpenAIChatInputError('A valid selection expansion target is required.');
	}

	return {
		target: parsed.target,
		query: typeof parsed.query === 'string' ? parsed.query.trim() || undefined : undefined
	};
}

export function parseRefreshVehicleSemanticsToolArgs(input: string): RefreshVehicleSemanticsToolArgs {
	if (!input.trim()) {
		return {};
	}

	const parsed = JSON.parse(input) as RefreshVehicleSemanticsToolArgs;
	return {
		force: parsed.force === true
	};
}

export function parseSetIntentSidebarToolArgs(input: string): SetIntentSidebarToolArgs {
	const parsed = JSON.parse(input) as SetIntentSidebarToolArgs;
	return {
		active: parsed.active === true,
		cards: Array.isArray(parsed.cards)
			? parsed.cards
					.map((card) => normalizeSidebarCard(card))
					.filter((card): card is FooterChatSidebarCard => card !== null)
			: []
	};
}

export function parseSetSupplementaryReferenceListToolArgs(
	input: string
): SetSupplementaryReferenceListToolArgs {
	const parsed = JSON.parse(input) as SetSupplementaryReferenceListToolArgs;
	const normalized = normalizeSupplementaryListState({
		active: parsed.active === true,
		entries:
			parsed.entries && typeof parsed.entries === 'object' && !Array.isArray(parsed.entries)
				? Object.fromEntries(
						Object.entries(parsed.entries).map(([key, value]) => [key, typeof value === 'string' ? value : ''])
					)
				: {}
	});

	return normalized ?? { active: false, entries: {} };
}

export function parseMutateVehicleSemanticAssignmentToolArgs(
	input: string
): MutateVehicleSemanticAssignmentToolArgs {
	const parsed = JSON.parse(input) as MutateVehicleSemanticAssignmentToolArgs;
	if (!['assign', 'reassign', 'unassign'].includes(parsed.action)) {
		throw new OpenAIChatInputError('A valid semantic assignment action is required.');
	}

	return {
		action: parsed.action,
		scope:
			parsed.scope === 'highlighted' ||
			parsed.scope === 'material_targets' ||
			parsed.scope === 'hidden'
				? parsed.scope
				: parsed.scope === 'selected'
					? 'selected'
					: undefined,
		targetScope:
			parsed.targetScope === 'node' ||
			parsed.targetScope === 'material' ||
			parsed.targetScope === 'mixed'
				? parsed.targetScope
				: undefined,
		nodeIds: Array.isArray(parsed.nodeIds)
			? parsed.nodeIds.filter(
					(value): value is string => typeof value === 'string' && value.trim().length > 0
			  )
			: undefined,
		materialIds: Array.isArray(parsed.materialIds)
			? parsed.materialIds.filter(
					(value): value is string => typeof value === 'string' && value.trim().length > 0
			  )
			: undefined,
		query: typeof parsed.query === 'string' ? parsed.query.trim() || undefined : undefined,
		semanticGroup:
			typeof parsed.semanticGroup === 'string' ? parsed.semanticGroup.trim() || undefined : undefined,
		category: parsed.category,
		humanLabel:
			typeof parsed.humanLabel === 'string' ? parsed.humanLabel.trim() || undefined : undefined,
		aliases: Array.isArray(parsed.aliases)
			? parsed.aliases.filter(
					(value): value is string => typeof value === 'string' && value.trim().length > 0
			  )
			: undefined
	};
}

export function parseManageVehicleSemanticGroupToolArgs(
	input: string
): ManageVehicleSemanticGroupToolArgs {
	const parsed = JSON.parse(input) as ManageVehicleSemanticGroupToolArgs;
	if (!['create', 'patch', 'delete', 'get'].includes(parsed.action)) {
		throw new OpenAIChatInputError('A valid semantic group management action is required.');
	}

	return {
		action: parsed.action,
		targetType: parsed.targetType === 'semantic_node' ? 'semantic_node' : 'semantic_group',
		scope:
			parsed.scope === 'highlighted' || parsed.scope === 'hidden'
				? parsed.scope
				: parsed.scope === 'selected'
					? 'selected'
					: undefined,
		query: typeof parsed.query === 'string' ? parsed.query.trim() || undefined : undefined,
		groupId: typeof parsed.groupId === 'string' ? parsed.groupId.trim() || undefined : undefined,
		nodeId: typeof parsed.nodeId === 'string' ? parsed.nodeId.trim() || undefined : undefined,
		nodeIds: Array.isArray(parsed.nodeIds)
			? parsed.nodeIds.filter(
					(value): value is string => typeof value === 'string' && value.trim().length > 0
			  )
			: undefined,
		humanLabel:
			typeof parsed.humanLabel === 'string' ? parsed.humanLabel.trim() || undefined : undefined,
		aliases: Array.isArray(parsed.aliases)
			? parsed.aliases.filter(
					(value): value is string => typeof value === 'string' && value.trim().length > 0
			  )
			: undefined,
		category: parsed.category,
		supports: Array.isArray(parsed.supports)
			? parsed.supports.filter(
					(
						value
					): value is NonNullable<ManageVehicleSemanticGroupToolArgs['supports']>[number] =>
						['highlight', 'focus', 'isolate', 'paint', 'tint'].includes(value)
			  )
			: undefined,
		assignmentMode:
			parsed.assignmentMode === 'exclusive' || parsed.assignmentMode === 'overlay'
				? parsed.assignmentMode
				: undefined,
		exclusiveFamily:
			parsed.exclusiveFamily === null
				? null
				: typeof parsed.exclusiveFamily === 'string'
					? parsed.exclusiveFamily.trim() || undefined
					: undefined
	};
}

export function parseAssignSemanticIngressToolArgs(input: string): AssignSemanticIngressToolArgs {
	const parsed = JSON.parse(input) as AssignSemanticIngressToolArgs;
	if (
		(parsed.targetType !== 'semantic_group' && parsed.targetType !== 'semantic_node') ||
		typeof parsed.targetId !== 'string' ||
		(parsed.transport !== 'rest_sse' && parsed.transport !== 'stream')
	) {
		throw new OpenAIChatInputError('A valid semantic ingress target and transport are required.');
	}

	return {
		targetType: parsed.targetType,
		targetId: parsed.targetId.trim(),
		targetLabel:
			typeof parsed.targetLabel === 'string' ? parsed.targetLabel.trim() || undefined : undefined,
		transport: parsed.transport
	};
}

export function parseEditVehiclePresentationToolArgs(input: string): EditVehiclePresentationToolArgs {
	const parsed = JSON.parse(input) as { action?: unknown };
	if (parsed.action === 'appearance') {
		return {
			action: 'appearance',
			...parseApplyVehicleAppearanceIntentToolArgs(input)
		};
	}

	if (parsed.action === 'focus') {
		return {
			action: 'focus',
			...parseApplyVehicleFocusIntentToolArgs(input)
		};
	}

	if (parsed.action === 'restore') {
		return {
			action: 'restore',
			...parseRestoreVehiclePresentationToolArgs(input)
		};
	}

	if (parsed.action === 'view_mode') {
		return {
			action: 'view_mode',
			...parseSetVehicleViewModeToolArgs(input)
		};
	}

	throw new OpenAIChatInputError('A valid presentation action is required.');
}

export function parseEditVehicleSelectionToolArgs(input: string): EditVehicleSelectionToolArgs {
	const parsed = JSON.parse(input) as EditVehicleSelectionToolArgs;
	if (parsed.action !== 'expand') {
		throw new OpenAIChatInputError('A valid selection action is required.');
	}

	return {
		action: 'expand',
		...parseExpandVehicleSelectionToolArgs(input)
	};
}

export function parseEditVehicleSemanticsToolArgs(input: string): EditVehicleSemanticsToolArgs {
	const parsed = JSON.parse(input) as { action?: unknown };

	if (parsed.action === 'assign' || parsed.action === 'reassign' || parsed.action === 'unassign') {
		const args = parseMutateVehicleSemanticAssignmentToolArgs(input);
		return {
			...args,
			action: parsed.action
		};
	}

	if (
		parsed.action === 'create_group' ||
		parsed.action === 'patch_group' ||
		parsed.action === 'delete_group' ||
		parsed.action === 'get_group' ||
		parsed.action === 'get_node'
	) {
		const args = parseManageVehicleSemanticGroupToolArgs(
			JSON.stringify({
				...(JSON.parse(input) as Record<string, unknown>),
				action:
					parsed.action === 'create_group'
						? 'create'
						: parsed.action === 'patch_group'
							? 'patch'
							: parsed.action === 'delete_group'
								? 'delete'
								: 'get',
				targetType: parsed.action === 'get_node' ? 'semantic_node' : 'semantic_group'
			})
		);
		return {
			scope: args.scope,
			query: args.query,
			groupId: args.groupId,
			nodeId: args.nodeId,
			nodeIds: args.nodeIds,
			humanLabel: args.humanLabel,
			aliases: args.aliases,
			category: args.category,
			supports: args.supports,
			assignmentMode: args.assignmentMode,
			exclusiveFamily: args.exclusiveFamily,
			action: parsed.action
		};
	}

	if (parsed.action === 'refresh') {
		return {
			action: 'refresh',
			...parseRefreshVehicleSemanticsToolArgs(input)
		};
	}

	if (parsed.action === 'assign_ingress') {
		return {
			action: 'assign_ingress',
			...parseAssignSemanticIngressToolArgs(input)
		};
	}

	throw new OpenAIChatInputError('A valid semantic action is required.');
}

export function parseSetAssistantUiToolArgs(input: string): SetAssistantUiToolArgs {
	const parsed = JSON.parse(input) as { action?: unknown };
	if (parsed.action === 'sidebar') {
		return {
			action: 'sidebar',
			...parseSetIntentSidebarToolArgs(input)
		};
	}

	if (parsed.action === 'supplementary_list') {
		return {
			action: 'supplementary_list',
			...parseSetSupplementaryReferenceListToolArgs(input)
		};
	}

	throw new OpenAIChatInputError('A valid assistant UI action is required.');
}
