import { VEHICLE_CATALOG, type VehicleAssetId } from '$lib/vehicles/catalog';
import {
	deriveStructuralAssetSnapshot,
	type StructuralMaterial,
	type StructuralMesh,
	type StructuralNode
} from '$lib/server/connectors/gltf-structure';
import {
	listSemanticMaterialsByQuery,
	listSemanticMaterialsByTags
} from '$lib/server/connectors/vehicle-semantic-overlay';
import type { VehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';
import type {
	VehicleBodyPaintPlan,
	VehicleInspectionCapabilities,
	VehicleInspectionControlCandidate,
	VehicleInspectionDebugMesh,
	VehicleInspectionMaterialSummary,
	VehicleInspectionPatchManifest,
	VehiclePartHighlightPlan,
	VehicleInspectionPatchValidationResult,
	VehicleWindowTintPlan
} from './types';

function deriveControlCandidates(nodes: StructuralNode[]): VehicleInspectionControlCandidate[] {
	return nodes
		.filter((node) => node.meshId !== null || node.childCount > 0)
		.map((node) => ({
			nodeId: node.id,
			name: node.name,
			path: node.path,
			meshId: node.meshId,
			availableControls: ['translation', 'rotation', 'scale', 'visibility']
		}));
}

function deriveDebugMeshes(meshes: StructuralMesh[]): {
	wireframeMeshes: VehicleInspectionDebugMesh[];
	uvDebugMeshes: VehicleInspectionDebugMesh[];
} {
	const toDebugMesh = (mesh: StructuralMesh): VehicleInspectionDebugMesh => ({
		meshId: mesh.id,
		name: mesh.name,
		attributeSemantics: mesh.attributeSemantics,
		materialNames: mesh.materialNames
	});

	return {
		wireframeMeshes: meshes.filter((mesh) => mesh.primitiveCount > 0).map(toDebugMesh),
		uvDebugMeshes: meshes.filter((mesh) => mesh.hasTexcoord0 || mesh.hasTexcoord1).map(toDebugMesh)
	};
}

function deriveMaterialSummaries(
	materials: StructuralMaterial[]
): VehicleInspectionMaterialSummary[] {
	return materials.map((material) => ({
		id: material.id,
		name: material.name,
		alphaMode: material.alphaMode,
		doubleSided: material.doubleSided,
		textureSlots: material.textureSlots,
		meshIds: material.meshIds,
		meshNames: material.meshNames,
		nodePaths: material.nodePaths
	}));
}

const PRIMARY_HIGHLIGHT_FACTOR: [number, number, number, number] = [0.5566, 0.5308, 0.7892, 0.48];
const HIGHLIGHT_TERM_SYNONYMS: Record<string, string[]> = {
	wheel: ['wheel', 'wheels', 'tire', 'tires', 'rim', 'rims'],
	wheels: ['wheel', 'wheels', 'tire', 'tires', 'rim', 'rims'],
	headlight: ['headlight', 'headlights', 'headlamp', 'headlamps', 'lamp', 'light'],
	headlights: ['headlight', 'headlights', 'headlamp', 'headlamps', 'lamp', 'light'],
	glass: ['glass', 'window', 'windows', 'windshield'],
	door: ['door', 'doors'],
	hood: ['hood', 'bonnet'],
	trunk: ['trunk', 'boot']
};

function normalizeHighlightTerms(partQuery: string): string[] {
	const baseTerms = partQuery
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.map((term) => term.trim())
		.filter((term) => term.length > 1);

	const expandedTerms = new Set(baseTerms);

	for (const term of baseTerms) {
		for (const synonym of HIGHLIGHT_TERM_SYNONYMS[term] ?? []) {
			expandedTerms.add(synonym);
		}

		if (term.endsWith('s') && term.length > 2) {
			expandedTerms.add(term.slice(0, -1));
		} else {
			expandedTerms.add(`${term}s`);
		}
	}

	return Array.from(expandedTerms);
}

function includesAnyTerm(value: string, terms: string[]): boolean {
	const normalizedValue = value.toLowerCase();
	return terms.some((term) => normalizedValue.includes(term));
}

function inferBodyPaintMaterialNames(capabilities: VehicleInspectionCapabilities): string[] {
	const configuredNames = VEHICLE_CATALOG[capabilities.assetId].bodyPaintMaterialNames;
	if (configuredNames && configuredNames.length > 0) {
		const configuredNameSet = new Set(configuredNames);
		const matchedConfiguredNames = capabilities.materials
			.filter((material) => configuredNameSet.has(material.name))
			.map((material) => material.name);

		if (matchedConfiguredNames.length > 0) {
			return matchedConfiguredNames;
		}
	}

	const materialNameMatches = capabilities.materials
		.filter((material) => {
			const name = material.name.toLowerCase();
			return (
				(name.includes('paint') || name.includes('body')) &&
				!name.includes('glass') &&
				!name.includes('tire') &&
				!name.includes('rim')
			);
		})
		.map((material) => material.name);

	if (materialNameMatches.length > 0) {
		return materialNameMatches;
	}

	const bodyLikeMeshIds = new Set(
		capabilities.controlCandidates
			.filter((candidate) => {
				const path = candidate.path.toLowerCase();
				return (
					path.includes('body') ||
					path.includes('door') ||
					path.includes('hood') ||
					path.includes('bonnet') ||
					path.includes('bumper') ||
					path.includes('fender') ||
					path.includes('quarter') ||
					path.includes('mirror') ||
					path.includes('panel')
				);
			})
			.map((candidate) => candidate.meshId)
			.filter((meshId): meshId is string => meshId !== null)
	);

	if (bodyLikeMeshIds.size === 0) {
		return [];
	}

	const bodyLikeMaterialNames = new Set<string>();
	for (const mesh of capabilities.wireframeMeshes) {
		if (!bodyLikeMeshIds.has(mesh.meshId)) {
			continue;
		}

		for (const materialName of mesh.materialNames) {
			if (
				!materialName.toLowerCase().includes('glass') &&
				!materialName.toLowerCase().includes('chrome') &&
				!materialName.toLowerCase().includes('mirror')
			) {
				bodyLikeMaterialNames.add(materialName);
			}
		}
	}

	return capabilities.materials
		.filter((material) => bodyLikeMaterialNames.has(material.name))
		.map((material) => material.name);
}

function inferWindowTintMaterialNames(capabilities: VehicleInspectionCapabilities): string[] {
	const configuredNames = VEHICLE_CATALOG[capabilities.assetId].windowTintMaterialNames;
	if (configuredNames && configuredNames.length > 0) {
		const configuredNameSet = new Set(configuredNames);
		const matchedConfiguredNames = capabilities.materials
			.filter((material) => configuredNameSet.has(material.name))
			.map((material) => material.name);

		if (matchedConfiguredNames.length > 0) {
			return matchedConfiguredNames;
		}
	}

	return capabilities.materials
		.filter((material) => {
			const name = material.name.toLowerCase();
			return (
				name.includes('glass') ||
				name.includes('window') ||
				name.includes('windshield') ||
				name.includes('screen')
			);
		})
		.map((material) => material.name);
}

function isVec3(value: unknown): value is [number, number, number] {
	return (
		Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === 'number')
	);
}

function isVec4(value: unknown): value is [number, number, number, number] {
	return (
		Array.isArray(value) && value.length === 4 && value.every((entry) => typeof entry === 'number')
	);
}

function isBoolean(value: unknown): value is boolean {
	return typeof value === 'boolean';
}

function isNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function validatePatchOperation(
	operation: VehicleInspectionPatchOperation,
	index: number,
	nodeIds: Set<string>,
	materialIds: Set<string>,
	debugMeshIds: Set<string>
): { accepted?: VehicleInspectionPatchOperation; reason?: string } {
	switch (operation.targetType) {
		case 'node':
			if (!nodeIds.has(operation.targetId)) {
				return { reason: `Unknown node target: ${operation.targetId}` };
			}

			switch (operation.op) {
				case 'set_visibility':
					return isBoolean(operation.value)
						? { accepted: operation }
						: { reason: 'Node visibility requires a boolean value' };
			}
			break;
		case 'material':
			if (!materialIds.has(operation.targetId)) {
				return { reason: `Unknown material target: ${operation.targetId}` };
			}

			switch (operation.op) {
				case 'set_base_color_factor':
				case 'set_overlay_highlight':
					return isVec4(operation.value)
						? { accepted: operation }
						: { reason: `${operation.op} requires a 4-number tuple` };
				case 'set_metalness_factor':
				case 'set_roughness_factor':
				case 'set_env_map_intensity':
					return isNumber(operation.value)
						? { accepted: operation }
						: { reason: `${operation.op} requires a numeric value` };
				case 'set_emissive_factor':
					return isVec3(operation.value)
						? { accepted: operation }
						: { reason: 'Emissive factor requires a 3-number tuple' };
				case 'set_alpha':
					return isNumber(operation.value)
						? { accepted: operation }
						: { reason: 'Alpha requires a numeric value' };
				case 'set_double_sided':
					return isBoolean(operation.value)
						? { accepted: operation }
						: { reason: 'Double-sided requires a boolean value' };
			}
			break;
		case 'viewer':
			switch (operation.targetId) {
				case 'postprocess':
					return operation.op === 'set_enabled' && isBoolean(operation.value)
						? { accepted: operation }
						: { reason: 'Postprocess viewer op requires set_enabled(boolean)' };
				case 'wireframe':
				case 'xray':
				case 'uv_debug':
					if (operation.op === 'set_enabled' && isBoolean(operation.value)) {
						return { accepted: operation };
					}

					if (
						operation.op === 'set_target' &&
						(operation.value === null ||
							(typeof operation.value === 'string' && debugMeshIds.has(operation.value)))
					) {
						return { accepted: operation };
					}

					return {
						reason: `${operation.targetId} viewer op requires set_enabled(boolean) or set_target(meshId|null)`
					};
			}
	}

	return { reason: `Unsupported patch operation at index ${index}` };
}

export async function deriveVehicleInspectionCapabilities(
	assetId: VehicleAssetId
): Promise<VehicleInspectionCapabilities> {
	const snapshot = await deriveStructuralAssetSnapshot(assetId);
	const { wireframeMeshes, uvDebugMeshes } = deriveDebugMeshes(snapshot.meshes);

	return {
		assetId: snapshot.assetId,
		generatedAt: snapshot.generatedAt,
		sceneCount: snapshot.scenes.length,
		nodeCount: snapshot.nodes.length,
		meshCount: snapshot.meshes.length,
		materialCount: snapshot.materials.length,
		scenes: snapshot.scenes,
		controlCandidates: deriveControlCandidates(snapshot.nodes),
		wireframeMeshes,
		uvDebugMeshes,
		materials: deriveMaterialSummaries(snapshot.materials)
	};
}

export async function planVehiclePartHighlight(
	assetId: VehicleAssetId,
	partQuery: string
): Promise<VehiclePartHighlightPlan> {
	const capabilities = await deriveVehicleInspectionCapabilities(assetId);
	const semanticMatches = await listSemanticMaterialsByQuery(
		assetId,
		capabilities.generatedAt,
		partQuery
	);
	const terms = normalizeHighlightTerms(partQuery);

	if (terms.length === 0 && semanticMatches.length === 0) {
		return {
			assetId,
			partQuery,
			matchedPaths: [],
			matchedMaterialNames: [],
			operations: []
		};
	}

	const matchedNodes = capabilities.controlCandidates.filter(
		(candidate) => includesAnyTerm(candidate.name, terms) || includesAnyTerm(candidate.path, terms)
	);
	const matchedMeshIds = new Set(
		matchedNodes
			.map((candidate) => candidate.meshId)
			.filter((meshId): meshId is string => meshId !== null)
	);
	const matchedPaths = matchedNodes.map((candidate) => candidate.path);

	const meshMaterialNames = new Set<string>();
	for (const mesh of capabilities.wireframeMeshes) {
		if (!matchedMeshIds.has(mesh.meshId)) {
			continue;
		}

		for (const materialName of mesh.materialNames) {
			meshMaterialNames.add(materialName);
		}
	}

	const semanticMaterialIds = new Set(semanticMatches.map((material) => material.targetId));
	const matchedMaterials = capabilities.materials.filter(
		(material) =>
			semanticMaterialIds.has(material.id) ||
			meshMaterialNames.has(material.name) ||
			includesAnyTerm(material.name, terms)
	);

	return {
		assetId,
		partQuery,
		matchedPaths: Array.from(
			new Set([...matchedPaths, ...matchedMaterials.flatMap((material) => material.nodePaths)])
		),
		matchedMaterialNames: matchedMaterials.map((material) => material.name),
		operations: matchedMaterials.map((material) => ({
			targetType: 'material',
			targetId: material.id,
			targetName: material.name,
			op: 'set_overlay_highlight',
			value: PRIMARY_HIGHLIGHT_FACTOR
		}))
	};
}

export async function planVehicleBodyPaint(
	assetId: VehicleAssetId,
	color: [number, number, number, number],
	finish?: {
		metalness?: number;
		roughness?: number;
		envMapIntensity?: number;
	}
): Promise<VehicleBodyPaintPlan> {
	const capabilities = await deriveVehicleInspectionCapabilities(assetId);
	const semanticMatches = await listSemanticMaterialsByTags(assetId, capabilities.generatedAt, [
		'body_paint_candidate'
	]);
	const matchedMaterialNames =
		semanticMatches.length > 0
			? capabilities.materials
					.filter((material) =>
						semanticMatches.some((candidate) => candidate.targetId === material.id)
					)
					.map((material) => material.name)
			: inferBodyPaintMaterialNames(capabilities);
	const matchedNameSet = new Set(matchedMaterialNames);

	return {
		assetId,
		color,
		matchedMaterialNames,
		operations: capabilities.materials
			.filter((material) => matchedNameSet.has(material.name))
			.flatMap((material) => {
				const operations: VehicleInspectionPatchOperation[] = [
					{
						targetType: 'material',
						targetId: material.id,
						targetName: material.name,
						op: 'set_base_color_factor',
						value: color
					}
				];

				if (typeof finish?.metalness === 'number') {
					operations.push({
						targetType: 'material',
						targetId: material.id,
						targetName: material.name,
						op: 'set_metalness_factor',
						value: finish.metalness
					});
				}

				if (typeof finish?.roughness === 'number') {
					operations.push({
						targetType: 'material',
						targetId: material.id,
						targetName: material.name,
						op: 'set_roughness_factor',
						value: finish.roughness
					});
				}

				if (typeof finish?.envMapIntensity === 'number') {
					operations.push({
						targetType: 'material',
						targetId: material.id,
						targetName: material.name,
						op: 'set_env_map_intensity',
						value: finish.envMapIntensity
					});
				}

				return operations;
			})
	};
}

export async function planVehicleWindowTint(
	assetId: VehicleAssetId,
	resolvedLabel: string,
	color: [number, number, number, number]
): Promise<VehicleWindowTintPlan> {
	const capabilities = await deriveVehicleInspectionCapabilities(assetId);
	const semanticMatches = await listSemanticMaterialsByTags(assetId, capabilities.generatedAt, [
		'glass_candidate'
	]);
	const matchedMaterialNames =
		semanticMatches.length > 0
			? capabilities.materials
					.filter((material) =>
						semanticMatches.some((candidate) => candidate.targetId === material.id)
					)
					.map((material) => material.name)
			: inferWindowTintMaterialNames(capabilities);
	const matchedNameSet = new Set(matchedMaterialNames);

	return {
		assetId,
		resolvedLabel,
		color,
		matchedMaterialNames,
		operations: capabilities.materials
			.filter((material) => matchedNameSet.has(material.name))
			.map((material) => ({
				targetType: 'material',
				targetId: material.id,
				targetName: material.name,
				op: 'set_base_color_factor',
				value: color
			}))
	};
}

export async function validateVehicleInspectionPatchManifest(
	patchManifest: VehicleInspectionPatchManifest
): Promise<VehicleInspectionPatchValidationResult> {
	const capabilities = await deriveVehicleInspectionCapabilities(patchManifest.assetId);
	const nodeIds = new Set(capabilities.controlCandidates.map((candidate) => candidate.nodeId));
	const materialIds = new Set(capabilities.materials.map((material) => material.id));
	const debugMeshIds = new Set(
		[...capabilities.wireframeMeshes, ...capabilities.uvDebugMeshes].map((mesh) => mesh.meshId)
	);

	const accepted: VehicleInspectionPatchOperation[] = [];
	const rejected: VehicleInspectionPatchValidationResult['rejected'] = [];

	patchManifest.operations.forEach((operation, index) => {
		const validation = validatePatchOperation(operation, index, nodeIds, materialIds, debugMeshIds);

		if (validation.accepted) {
			accepted.push(validation.accepted);
			return;
		}

		rejected.push({
			index,
			reason: validation.reason ?? 'Unknown patch validation error',
			operation
		});
	});

	return {
		assetId: patchManifest.assetId,
		presetId: patchManifest.presetId,
		userId: patchManifest.userId,
		accepted,
		rejected
	};
}
