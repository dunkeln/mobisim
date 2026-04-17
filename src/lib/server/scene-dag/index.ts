import type { StructuralAssetSnapshot, StructuralNode } from '$lib/server/connectors/gltf-structure/types';
import { deriveStructuralAssetSnapshot } from '$lib/server/connectors/gltf-structure';
import { deriveVehicleInspectionCapabilities } from '$lib/server/connectors/gltf-preprocess';
import type {
	FooterChatPresentationContext,
	FooterChatViewerMode
} from '$lib/server/connectors/openai-chat/types';
import type { VehicleNodeSelection } from '$lib/stores/vehicle-node-selection';
import type { VehicleAssetId } from '$lib/vehicles/catalog';
import type {
	VehicleSemanticOverlayDiscard,
	VehicleSemanticGroup,
	VehicleSemanticMaterialSuggestion,
	VehicleSemanticOverlay,
	VehicleSemanticOverlayStatus,
	VehicleSemanticPartUnit
} from '$lib/server/connectors/vehicle-semantic-overlay/types';
import {
	getVehicleSemanticOverlayStatus,
	readVehicleSemanticOverlay
} from '$lib/server/connectors/vehicle-semantic-overlay';
import { getSelectionConstraintNodeIds } from '$lib/stores/vehicle-node-selection';
import type { SceneDag, SceneDagPresentation, SceneDagSelection } from './types';

function recordById<T extends { id: string }>(values: T[]): Record<string, T> {
	return Object.fromEntries(values.map((entry) => [entry.id, entry]));
}

function cloneList<T>(values: T[] | undefined): T[] {
	return values ? values.map((entry) => ({ ...entry })) : [];
}

function clonePresentation(
	presentation: FooterChatPresentationContext | undefined
): SceneDagPresentation | undefined {
	if (!presentation) {
		return undefined;
	}

	return {
		activeIntentLabel: presentation.activeIntentLabel,
		highlightedTargets: cloneList(presentation.highlightedTargets),
		materialTargets: cloneList(presentation.materialTargets),
		hiddenTargets: cloneList(presentation.hiddenTargets),
		viewerModes: presentation.viewerModes ? [...presentation.viewerModes] : undefined
	};
}

function buildSelection(input: {
	structure: StructuralAssetSnapshot;
	selectedNodes: VehicleNodeSelection[] | undefined;
	selectedGroupId: string | null | undefined;
}): SceneDagSelection {
	const nextSelectedNodes = input.selectedNodes
		? input.selectedNodes.map((selection) => ({ ...selection }))
		: [];
	const nodeById = recordById(input.structure.nodes ?? []);
	const meshById = recordById(input.structure.meshes ?? []);
	const selectedNodeIds = Array.from(
		new Set(nextSelectedNodes.flatMap((selection) => getSelectionConstraintNodeIds(selection)))
	).sort((left, right) => left.localeCompare(right));
	const selectedMaterialIds = Array.from(
		new Set(
			nextSelectedNodes.flatMap((selection) => {
				const materialIds: string[] = [];
				const node = getSelectionConstraintNodeIds(selection)
					.map((nodeId) => nodeById[nodeId])
					.find((candidate): candidate is StructuralNode => !!candidate?.meshId);
				if (!node?.meshId) {
					return materialIds;
				}
				const mesh = meshById[node.meshId];
				if (!mesh) {
					return materialIds;
				}
				if (
					typeof selection.materialIndex === 'number' &&
					selection.materialIndex >= 0 &&
					selection.materialIndex < (mesh.materialIds?.length ?? 0)
				) {
					materialIds.push(mesh.materialIds?.[selection.materialIndex]!);
					return materialIds;
				}
				if (selection.materialName) {
					(mesh.materialIds ?? []).forEach((materialId, index) => {
						if ((mesh.materialNames ?? [])[index] === selection.materialName) {
							materialIds.push(materialId);
						}
					});
				}
				return materialIds;
			})
		)
	).sort((left, right) => left.localeCompare(right));

	return {
		selectedGroupId: input.selectedGroupId ?? null,
		selectedNodes: nextSelectedNodes,
		selectedNodeIds,
		selectedMaterialIds
	};
}

export function buildSceneDag(input: {
	assetId: VehicleAssetId;
	structure: StructuralAssetSnapshot;
	semanticOverlay: VehicleSemanticOverlay | null;
	semanticOverlayStatus?: VehicleSemanticOverlayStatus;
	selectedNodes?: VehicleNodeSelection[];
	selectedGroupId?: string | null;
	presentation?: FooterChatPresentationContext;
}): SceneDag {
	const semanticOverlay = input.semanticOverlay
		? {
				...input.semanticOverlay,
				acceptedMaterials: (input.semanticOverlay.acceptedMaterials ?? []).map((material) => ({
					...material,
					aliases: [...(material.aliases ?? [])],
					semanticTags: [...(material.semanticTags ?? [])]
				})),
				acceptedParts: (input.semanticOverlay.acceptedParts ?? []).map((part) => ({
					...part,
					aliases: [...(part.aliases ?? [])],
					nodeIds: [...(part.nodeIds ?? [])],
					meshIds: [...(part.meshIds ?? [])],
					materialIds: [...(part.materialIds ?? [])]
				})),
				acceptedGroups: (input.semanticOverlay.acceptedGroups ?? []).map((group) => ({
					...group,
					aliases: [...(group.aliases ?? [])],
					nodeIds: [...(group.nodeIds ?? [])],
					meshIds: [...(group.meshIds ?? [])],
					materialIds: [...(group.materialIds ?? [])],
					supports: [...(group.supports ?? [])]
				})),
				discardedSuggestions: (input.semanticOverlay.discardedSuggestions ?? []).map((entry) => ({
					...entry,
					payload: { ...(entry.payload as Record<string, unknown>) } as VehicleSemanticOverlayDiscard['payload']
				}))
			}
		: null;

	return {
		assetId: input.assetId,
		structuralGeneratedAt: input.structure.generatedAt,
		semanticOverlayStatus: input.semanticOverlayStatus ?? (semanticOverlay ? 'fresh' : 'missing'),
		structure: {
			...input.structure,
			scenes: (input.structure.scenes ?? []).map((scene) => ({
				...scene,
				rootNodeNames: [...scene.rootNodeNames]
			})),
			nodes: (input.structure.nodes ?? []).map((node) => ({
				...node,
				childIds: [...(node.childIds ?? [])]
			})),
			meshes: (input.structure.meshes ?? []).map((mesh) => ({
				...mesh,
				attributeSemantics: [...(mesh.attributeSemantics ?? [])],
				materialIds: [...(mesh.materialIds ?? [])],
				materialNames: [...(mesh.materialNames ?? [])]
			})),
			materials: (input.structure.materials ?? []).map((material) => ({
				...material,
				textureSlots: [...(material.textureSlots ?? [])],
				meshIds: [...(material.meshIds ?? [])],
				meshNames: [...(material.meshNames ?? [])],
				meshMaterialSlots: [...(material.meshMaterialSlots ?? [])].map((slot) => ({
					meshId: slot.meshId,
					slotIndices: [...slot.slotIndices]
				})),
				nodeIds: [...(material.nodeIds ?? [])],
				nodePaths: [...(material.nodePaths ?? [])]
			}))
		},
		structureIndex: {
			nodesById: recordById(input.structure.nodes ?? []),
			meshesById: recordById(input.structure.meshes ?? []),
			materialsById: recordById(input.structure.materials ?? [])
		},
		semanticOverlay,
		semanticIndex: {
			groupsById: semanticOverlay ? recordById(semanticOverlay.acceptedGroups) : {},
			partsById: semanticOverlay ? recordById(semanticOverlay.acceptedParts) : {},
			materialsById: semanticOverlay ? recordById(semanticOverlay.acceptedMaterials) : {}
		},
		selection: buildSelection({
			structure: input.structure,
			selectedNodes: input.selectedNodes,
			selectedGroupId: input.selectedGroupId
		}),
		presentation: clonePresentation(input.presentation)
	};
}

export async function loadSceneDag(input: {
	assetId: VehicleAssetId;
	semanticOverlay: VehicleSemanticOverlay | null;
	selectedNodes?: VehicleNodeSelection[];
	selectedGroupId?: string | null;
	presentation?: FooterChatPresentationContext;
}): Promise<SceneDag> {
	const structure = await deriveStructuralAssetSnapshot(input.assetId);
	return buildSceneDag({
		assetId: input.assetId,
		structure,
		semanticOverlay: input.semanticOverlay,
		selectedNodes: input.selectedNodes,
		selectedGroupId: input.selectedGroupId,
		presentation: input.presentation
	});
}

export async function loadSceneDagWithSemanticOverlayState(input: {
	assetId: VehicleAssetId;
	selectedNodes?: VehicleNodeSelection[];
	selectedGroupId?: string | null;
	presentation?: FooterChatPresentationContext;
}): Promise<SceneDag> {
	const structure = await deriveStructuralAssetSnapshot(input.assetId);
	const capabilities = await deriveVehicleInspectionCapabilities(input.assetId);
	const semanticOverlayStatus = await getVehicleSemanticOverlayStatus(
		input.assetId,
		capabilities.generatedAt
	);
	const semanticOverlay =
		semanticOverlayStatus === 'fresh' || semanticOverlayStatus === 'stale'
			? await readVehicleSemanticOverlay(input.assetId)
			: null;

	return buildSceneDag({
		assetId: input.assetId,
		structure,
		semanticOverlay,
		semanticOverlayStatus,
		selectedNodes: input.selectedNodes,
		selectedGroupId: input.selectedGroupId,
		presentation: input.presentation
	});
}

export function summarizeSceneDag(sceneDag: SceneDag): string {
	return [
		`asset ${sceneDag.assetId}`,
		`structure ${sceneDag.structuralGeneratedAt}`,
		`nodes ${Object.keys(sceneDag.structureIndex.nodesById).length}`,
		`meshes ${Object.keys(sceneDag.structureIndex.meshesById).length}`,
		`materials ${Object.keys(sceneDag.structureIndex.materialsById).length}`,
		`groups ${Object.keys(sceneDag.semanticIndex.groupsById).length}`,
		`selected group ${sceneDag.selection.selectedGroupId ?? 'none'}`,
		`selected nodes ${sceneDag.selection.selectedNodeIds.length}`,
		`selected materials ${sceneDag.selection.selectedMaterialIds.length}`,
		`viewer modes ${sceneDag.presentation?.viewerModes?.join(', ') ?? 'none'}`
	].join('; ');
}

export function summarizeSceneDagInventory(sceneDag: SceneDag): string {
	const groups = Object.values(sceneDag.semanticIndex.groupsById)
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
			const parts = Object.values(sceneDag.semanticIndex.partsById)
				.filter((part) =>
					part.nodeIds.some((nodeId) => group.nodeIds.includes(nodeId)) ||
					part.materialIds.some((materialId) => group.materialIds.includes(materialId))
				)
				.slice()
				.sort((left, right) => right.confidence - left.confidence)
				.slice(0, 6)
				.map((part) => `${part.humanLabel} [${part.id}]`)
				.join(', ');

			return parts.length > 0
				? `${group.humanLabel} [${group.id}] {${membershipKinds || 'untyped'}} -> ${parts}`
				: `${group.humanLabel} [${group.id}] {${membershipKinds || 'untyped'}}`;
		});

	return groups.length > 0 ? groups.join(' | ') : 'none';
}
