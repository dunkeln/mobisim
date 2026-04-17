import * as THREE from 'three';
import { LOW_ALPHA_OPACITY_THRESHOLD } from './persistent-alpha';

export type RuntimeNodeLookup = {
	nodeById: Map<string, THREE.Object3D>;
	nodeIdByObject: Map<THREE.Object3D, string>;
};

export type ResolvedRuntimeSelection = {
	nodeId: string;
	runtimeNode: THREE.Object3D;
	materialIndex?: number;
	materialName?: string;
};

export type RuntimeSelectionTraceEntry = {
	depthRank: number;
	objectName: string;
	nodeId: string | null;
	nodePath: string | null;
	materialIndex: number | null;
	materialName: string | null;
	opacity: number | null;
	transparent: boolean | null;
	visible: boolean;
	depthTest: boolean | null;
	colorWrite: boolean | null;
	skipped: boolean;
	reason: string | null;
	selected: boolean;
	distance: number;
};

type ResolveRuntimeSelectionParams = {
	scene: THREE.Object3D;
	camera: THREE.Camera;
	canvasRect: DOMRect;
	clientX: number;
	clientY: number;
	granularity?: 'node' | 'material';
};

const SELECTION_PASSTHROUGH_ALPHA_THRESHOLD = LOW_ALPHA_OPACITY_THRESHOLD;
export const SELECTABLE_PICK_LAYER = 1;
const SELECTION_OVERLAY_NAMES = new Set([
	'__mobisim-highlight-overlay__',
	'__mobisim-selection-overlay__',
	'__mobisim-emissive-glow-overlay__'
]);

function createNodeId(index: number): string {
	return `node-${index}`;
}

function hasOpacityProperty(material: THREE.Material): material is THREE.Material & {
	opacity: number;
	transparent: boolean;
	side: THREE.Side;
} {
	return 'opacity' in material && 'transparent' in material && 'side' in material;
}

function hasRaycastSuppressionFlags(material: THREE.Material): material is THREE.Material & {
	depthTest: boolean;
	colorWrite: boolean;
	visible: boolean;
} {
	return 'depthTest' in material && 'colorWrite' in material && 'visible' in material;
}

function resolveIntersectionMaterial(
	object: THREE.Object3D,
	materialIndex: number | undefined
): THREE.Material | null {
	if (!(object instanceof THREE.Mesh)) {
		return null;
	}

	if (Array.isArray(object.material)) {
		if (typeof materialIndex !== 'number') {
			return object.material[0] ?? null;
		}

		return object.material[materialIndex] ?? null;
	}

	return object.material ?? null;
}

function resolveSelectionMaterialName(
	object: THREE.Object3D,
	materialIndex: number | undefined
): string | undefined {
	const material = resolveIntersectionMaterial(object, materialIndex);
	return material?.name || undefined;
}

function shouldPassThroughSelectionHit(
	object: THREE.Object3D,
	materialIndex: number | undefined
): boolean {
	if (!object.visible) {
		return true;
	}

	const material = resolveIntersectionMaterial(object, materialIndex);
	if (!material || !hasOpacityProperty(material)) {
		return false;
	}

	if (material.opacity <= SELECTION_PASSTHROUGH_ALPHA_THRESHOLD) {
		return true;
	}

	if (hasRaycastSuppressionFlags(material)) {
		if (!material.visible || !material.depthTest || !material.colorWrite) {
			return true;
		}
	}

	return false;
}

export function buildRuntimeNodeLookup(scene: THREE.Object3D): RuntimeNodeLookup {
	const nodeById = new Map<string, THREE.Object3D>();
	const nodeIdByObject = new Map<THREE.Object3D, string>();
	let nextNodeIndex = 0;

	scene.traverse((node) => {
		if (node === scene) {
			return;
		}

		const nodeId = createNodeId(nextNodeIndex);
		nextNodeIndex += 1;
		nodeById.set(nodeId, node);
		nodeIdByObject.set(node, nodeId);
	});

	return {
		nodeById,
		nodeIdByObject
	};
}

export function enableSelectablePickLayer(scene: THREE.Object3D): void {
	scene.layers.enable(SELECTABLE_PICK_LAYER);
	scene.traverse((node) => {
		node.layers.enable(SELECTABLE_PICK_LAYER);
	});
}

export function buildRuntimeNodePath(node: THREE.Object3D, root: THREE.Object3D): string {
	const parts: string[] = [];
	let current: THREE.Object3D | null = node;

	while (current && current !== root) {
		parts.unshift(current.name.trim() || current.type);
		current = current.parent;
	}

	if (current === root) {
		parts.unshift(root.name.trim() || 'Scene');
	}

	return parts.join('/');
}

function resolveSelectableRuntimeNodeId(
	lookup: RuntimeNodeLookup,
	object: THREE.Object3D
): string | null {
	return lookup.nodeIdByObject.get(object) ?? null;
}

function describeMaterialSelectionState(
	object: THREE.Object3D,
	materialIndex: number | undefined
): {
	opacity: number | null;
	transparent: boolean | null;
	depthTest: boolean | null;
	colorWrite: boolean | null;
} {
	const material = resolveIntersectionMaterial(object, materialIndex);
	if (!material || !hasOpacityProperty(material)) {
		return {
			opacity: null,
			transparent: null,
			depthTest: material && 'depthTest' in material ? material.depthTest : null,
			colorWrite: material && 'colorWrite' in material ? material.colorWrite : null
		};
	}

	return {
		opacity: material.opacity,
		transparent: material.transparent,
		depthTest: material.depthTest,
		colorWrite: material.colorWrite
	};
}

export function resolveRuntimeSelection(
	params: ResolveRuntimeSelectionParams
): ResolvedRuntimeSelection | null {
	const { scene, camera, canvasRect, clientX, clientY } = params;
	const granularity = params.granularity ?? 'node';
	if (canvasRect.width <= 0 || canvasRect.height <= 0) {
		return null;
	}

	const pointer = new THREE.Vector2();
	const raycaster = new THREE.Raycaster();
	pointer.x = ((clientX - canvasRect.left) / canvasRect.width) * 2 - 1;
	pointer.y = -((clientY - canvasRect.top) / canvasRect.height) * 2 + 1;
	raycaster.setFromCamera(pointer, camera);
	raycaster.layers.set(SELECTABLE_PICK_LAYER);

	const lookup = buildRuntimeNodeLookup(scene);
	const intersections = raycaster.intersectObject(scene, true);

	for (const intersection of intersections) {
		if (SELECTION_OVERLAY_NAMES.has(intersection.object.name)) {
			continue;
		}

		const object = intersection.object;
		const materialIndex =
			granularity === 'material' && typeof intersection.face?.materialIndex === 'number'
				? intersection.face.materialIndex
				: undefined;

		if (shouldPassThroughSelectionHit(object, materialIndex)) {
			continue;
		}

		const nodeId = resolveSelectableRuntimeNodeId(lookup, object);
		if (!nodeId) {
			continue;
		}

		const runtimeNode = lookup.nodeById.get(nodeId);
		if (!runtimeNode) {
			continue;
		}

		return {
			nodeId,
			runtimeNode,
			materialIndex,
			materialName: granularity === 'material' ? resolveSelectionMaterialName(object, materialIndex) : undefined
		};
	}

	return null;
}

export function traceRuntimeSelection(
	params: ResolveRuntimeSelectionParams
): {
	entries: RuntimeSelectionTraceEntry[];
	selected: RuntimeSelectionTraceEntry | null;
} {
	const { scene, camera, canvasRect, clientX, clientY } = params;
	if (canvasRect.width <= 0 || canvasRect.height <= 0) {
		return { entries: [], selected: null };
	}

	const pointer = new THREE.Vector2();
	const raycaster = new THREE.Raycaster();
	pointer.x = ((clientX - canvasRect.left) / canvasRect.width) * 2 - 1;
	pointer.y = -((clientY - canvasRect.top) / canvasRect.height) * 2 + 1;
	raycaster.setFromCamera(pointer, camera);
	raycaster.layers.set(SELECTABLE_PICK_LAYER);

	const lookup = buildRuntimeNodeLookup(scene);
	const intersections = raycaster.intersectObject(scene, true);
	const entries: RuntimeSelectionTraceEntry[] = [];
	let selected: RuntimeSelectionTraceEntry | null = null;

	for (const [depthRank, intersection] of intersections.entries()) {
		const object = intersection.object;
		const materialIndex =
			typeof intersection.face?.materialIndex === 'number' ? intersection.face.materialIndex : null;
		const materialState = describeMaterialSelectionState(object, materialIndex ?? undefined);
		const isOverlay = SELECTION_OVERLAY_NAMES.has(object.name);
		let skipped = isOverlay || !object.visible;
		let reason: string | null = isOverlay ? 'selection overlay' : !object.visible ? 'not visible' : null;

		if (!skipped && materialIndex !== null && shouldPassThroughSelectionHit(object, materialIndex)) {
			skipped = true;
			reason = 'pass-through surface';
		}

		const nodeId = skipped ? null : resolveSelectableRuntimeNodeId(lookup, object);
		if (!skipped && !nodeId) {
			skipped = true;
			reason = 'no selectable node';
		}

		const runtimeNode = nodeId ? lookup.nodeById.get(nodeId) : null;
		const nodePath = runtimeNode ? buildRuntimeNodePath(runtimeNode, scene) : null;
		const materialName =
			!skipped && params.granularity === 'material'
				? resolveSelectionMaterialName(object, materialIndex ?? undefined)
				: null;
		const entry: RuntimeSelectionTraceEntry = {
			depthRank,
			objectName: object.name || object.type,
			nodeId,
			nodePath,
			materialIndex,
			materialName,
			opacity: materialState.opacity,
			transparent: materialState.transparent,
			visible: object.visible,
			depthTest: materialState.depthTest,
			colorWrite: materialState.colorWrite,
			skipped,
			reason,
			selected: false,
			distance: intersection.distance
		};

		entries.push(entry);

		if (!skipped) {
			entry.selected = true;
			selected = entry;
			break;
		}
	}

	return { entries, selected };
}
