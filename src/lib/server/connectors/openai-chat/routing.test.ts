import { describe, expect, it } from 'vitest';
import {
	classifyExecutionRoute,
	getToolChoiceForRequest,
	isSemanticAnnotationRequest,
	isSemanticGroupCreationRequest,
	isSemanticGroupDeletionRequest,
	isSemanticGroupPatchRequest,
	shouldAttemptDirectVehicleEdit
} from './routing';
import { resolveIntentDraft } from './intent-resolver';

describe('isSemanticAnnotationRequest', () => {
	it('treats selected-target phrasing as semantic annotation intent', () => {
		expect(isSemanticAnnotationRequest('mark them as headlights')).toBe(true);
		expect(isSemanticAnnotationRequest('assign selected nodes to headlights')).toBe(true);
		expect(isSemanticAnnotationRequest('current selection should be headlights')).toBe(true);
	});
});

describe('isSemanticGroupDeletionRequest', () => {
	it('treats explicit semantic-group removal language as a direct group deletion request', () => {
		expect(isSemanticGroupDeletionRequest('remove the current semantic group completely')).toBe(
			true
		);
		expect(isSemanticGroupDeletionRequest('delete the body shell semantic group')).toBe(true);
		expect(isSemanticGroupDeletionRequest('remove this from the group')).toBe(false);
	});
});

describe('isSemanticGroupPatchRequest', () => {
	it('treats explicit semantic-group rename language as a direct group patch request', () => {
		expect(isSemanticGroupPatchRequest('rename front lighting -> lighting')).toBe(true);
		expect(isSemanticGroupPatchRequest('relabel the body shell semantic group to exterior shell')).toBe(
			true
		);
		expect(isSemanticGroupPatchRequest('rename this selection')).toBe(false);
	});
});

describe('isSemanticGroupCreationRequest', () => {
	it('treats explicit semantic-group creation language as a semantic creation request', () => {
		expect(isSemanticGroupCreationRequest('create a new semantic group from this selection')).toBe(
			true
		);
		expect(isSemanticGroupCreationRequest('group this selection')).toBe(true);
		expect(isSemanticGroupCreationRequest('add this to body shell')).toBe(false);
	});
});

describe('getToolChoiceForRequest', () => {
	it('forces the tool catalog for explicit capability requests', () => {
		expect(
			getToolChoiceForRequest({
				message: 'what tools are available here?',
				selectedNodes: []
			})
		).toEqual({
			type: 'function',
			function: {
				name: 'get_vehicle_tool_catalog'
			}
		});
	});

	it('forces the tool catalog for compound requests that need planning-first tool composition', () => {
		expect(
			getToolChoiceForRequest({
				message: 'highlight the wheels and then put the changed targets in the footer list',
				selectedNodes: []
			})
		).toEqual({
			type: 'function',
			function: {
				name: 'get_vehicle_tool_catalog'
			}
		});
	});

	it('forces the semantics tool for selected-target semantic removal even with pronoun phrasing', () => {
		expect(
			getToolChoiceForRequest({
				assetId: 'audi_r8',
				message: 'take this out of the wheels group',
				selectedNodes: [
					{
						assetId: 'audi_r8',
						nodeId: 'node-41',
						nodeName: 'Wheel Cover',
						nodePath: 'Scene/Wheel Cover'
					}
				]
			})
		).toEqual({
			type: 'function',
			function: {
				name: 'edit_vehicle_semantics'
			}
		});
	});

	it('forces the tool catalog for action requests that also ask for structured footer output', () => {
		expect(
			getToolChoiceForRequest({
				assetId: 'audi_r8',
				message: 'remove the body shell and put the changed targets in the footer list',
				selectedNodes: []
			})
		).toEqual({
			type: 'function',
			function: {
				name: 'get_vehicle_tool_catalog'
			}
		});
	});

	it('forces the semantics tool for explicit semantic group creation requests', () => {
		expect(
			getToolChoiceForRequest({
				assetId: 'audi_r8',
				message: 'create a new semantic group from this selection',
				selectedNodes: [
					{
						assetId: 'audi_r8',
						nodeId: 'node-1',
						nodeName: 'Wheel Cover',
						nodePath: 'Scene/Wheel Cover'
					}
				]
			})
		).toEqual({
			type: 'function',
			function: {
				name: 'edit_vehicle_semantics'
			}
		});
	});
});

describe('resolveIntentDraft', () => {
	it('derives a semantic unassign draft from selected-node removal language', () => {
		const draft = resolveIntentDraft({
			assetId: 'audi_r8',
			message: 'remove the selected node from the wheels group',
			selectedNodes: [
				{
					assetId: 'audi_r8',
					nodeId: 'node-41',
					nodeName: 'Wheel Cover',
					nodePath: 'Scene/Wheel Cover'
				}
			]
		});

		expect(draft.domain).toBe('semantics');
		expect(draft.operation).toBe('unassign');
		expect(draft.referent).toBe('selected');
		expect(draft.targetScope).toBe('node');
		expect(draft.confidence).toBeGreaterThan(0.5);
	});

	it('keeps selected-node remove-from-view language in presentation', () => {
		const draft = resolveIntentDraft({
			assetId: 'audi_r8',
			message: 'remove it from the view',
			selectedNodes: [
				{
					assetId: 'audi_r8',
					nodeId: 'node-41',
					nodeName: 'Wheel Cover',
					nodePath: 'Scene/Wheel Cover'
				}
			]
		});

		expect(draft.domain).toBe('presentation');
		expect(draft.operation).toBe('unassign');
		expect(draft.referent).toBe('selected');
		expect(draft.targetScope).toBe('node');
		expect(classifyExecutionRoute({
			assetId: 'audi_r8',
			message: 'remove it from the view',
			selectedNodes: [
				{
					assetId: 'audi_r8',
					nodeId: 'node-41',
					nodeName: 'Wheel Cover',
					nodePath: 'Scene/Wheel Cover'
				}
			]
		})).toBe('direct_edit');
	});

	it('derives a semantic assign draft from selection-backed put-in-category phrasing', () => {
		const draft = resolveIntentDraft({
			assetId: 'audi_r8',
			message: 'put two selections in front lighting category',
			selectedNodes: [
				{
					assetId: 'audi_r8',
					nodeId: 'node-101',
					nodeName: 'Headlight Left',
					nodePath: 'Scene/Front/HeadlightLeft'
				},
				{
					assetId: 'audi_r8',
					nodeId: 'node-102',
					nodeName: 'Headlight Right',
					nodePath: 'Scene/Front/HeadlightRight'
				}
			]
		});

		expect(draft.domain).toBe('semantics');
		expect(draft.operation).toBe('assign');
		expect(draft.referent).toBe('selected');
		expect(draft.targetScope).toBe('node');
		expect(draft.confidence).toBeGreaterThan(0.5);
	});

	it('treats pronoun-based semantic mutation as highlighted-target intent when highlights exist', () => {
		const draft = resolveIntentDraft({
			assetId: 'audi_r8',
			message: 'add that to the wheels group',
			selectedNodes: [],
			presentation: {
				highlightedTargets: [
					{
						targetId: 'material-wheel',
						targetType: 'material',
						targetName: 'Wheel'
					}
				]
			}
		});

		expect(draft.domain).toBe('semantics');
		expect(draft.operation).toBe('assign');
		expect(draft.referent).toBe('highlighted');
		expect(draft.targetScope).toBe('material');
	});

	it('treats selection expansion as a first-class selection-domain intent', () => {
		const draft = resolveIntentDraft({
			assetId: 'audi_r8',
			message: 'expand this selection to the semantic group',
			selectedNodes: [
				{
					assetId: 'audi_r8',
					nodeId: 'node-41',
					nodeName: 'Wheel Cover',
					nodePath: 'Scene/Wheel Cover'
				}
			]
		});

		expect(draft.domain).toBe('selection');
		expect(draft.operation).toBe('expand_selection');
	});

	it('derives a semantic create-group draft from explicit creation language', () => {
		const draft = resolveIntentDraft({
			assetId: 'audi_r8',
			message: 'create a new semantic group from this selection',
			selectedNodes: [
				{
					assetId: 'audi_r8',
					nodeId: 'node-41',
					nodeName: 'Wheel Cover',
					nodePath: 'Scene/Wheel Cover'
				}
			]
		});

		expect(draft.domain).toBe('semantics');
		expect(draft.operation).toBe('create_group');
		expect(draft.referent).toBe('selected');
		expect(draft.targetScope).toBe('node');
	});

	it('keeps freeform visual removal of a semantic family in presentation', () => {
		const input = {
			assetId: 'audi_r8' as const,
			message: 'remove the body shell',
			selectedNodes: []
		};

		const draft = resolveIntentDraft(input);

		expect(draft.domain).toBe('presentation');
		expect(shouldAttemptDirectVehicleEdit(input)).toBe(true);
	});

	it('classifies simple freeform visual edits as direct-edit routes', () => {
		expect(
			classifyExecutionRoute({
				assetId: 'audi_r8',
				message: 'remove the body shell',
				selectedNodes: []
			})
		).toBe('direct_edit');
	});

	it('classifies explicit semantic group deletion as a direct-edit route', () => {
		expect(
			classifyExecutionRoute({
				assetId: 'audi_r8',
				message: 'remove the current semantic group completely',
				selectedNodes: []
			})
		).toBe('direct_edit');
	});

	it('classifies explicit semantic group rename requests as direct-edit routes', () => {
		expect(
			classifyExecutionRoute({
				assetId: 'audi_r8',
				message: 'rename front lighting -> lighting',
				selectedNodes: []
			})
		).toBe('direct_edit');
	});

	it('classifies generic light on-off requests as direct vehicle edits', () => {
		const input = {
			assetId: 'audi_r8' as const,
			message: 'turn on the lights',
			selectedNodes: []
		};

		expect(shouldAttemptDirectVehicleEdit(input)).toBe(true);
		expect(classifyExecutionRoute(input)).toBe('direct_edit');
	});

	it('classifies explicit uv debug requests as direct vehicle edits', () => {
		const input = {
			assetId: 'audi_r8' as const,
			message: 'show uv debug',
			selectedNodes: []
		};

		expect(shouldAttemptDirectVehicleEdit(input)).toBe(true);
		expect(classifyExecutionRoute(input)).toBe('direct_edit');
	});

	it('classifies explicit wireframe requests as direct vehicle edits', () => {
		const input = {
			assetId: 'audi_r8' as const,
			message: 'turn on wireframe',
			selectedNodes: []
		};

		expect(shouldAttemptDirectVehicleEdit(input)).toBe(true);
		expect(classifyExecutionRoute(input)).toBe('direct_edit');
	});
});
