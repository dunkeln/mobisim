import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { VehicleInspectionMaterialSummary } from '$lib/server/connectors/gltf-preprocess/types';
import type { VehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';
import { resolveRuntimeMaterialTargets } from './runtime-material-targets';

function createMaterialOperation(targetId: string, targetName: string): VehicleInspectionPatchOperation {
	return {
		targetType: 'material',
		targetId,
		targetName,
		op: 'set_overlay_highlight',
		value: [0.58, 0.54, 0.86, 1]
	};
}

function createPaintOperation(targetId: string, targetName: string): VehicleInspectionPatchOperation {
	return {
		targetType: 'material',
		targetId,
		targetName,
		op: 'set_base_color_factor',
		value: [0.8, 0.1, 0.1, 1]
	};
}

function createEmissiveOperation(targetId: string, targetName: string): VehicleInspectionPatchOperation {
	return {
		targetType: 'material',
		targetId,
		targetName,
		op: 'set_emissive_factor',
		value: [1, 1, 1]
	};
}

describe('runtime material targets', () => {
	it('keeps material resolution scoped to the structural node paths for the chosen material id', () => {
		const scene = new THREE.Scene();
		scene.name = 'Scene';

		const sharedMaterialName = 'Material';
		const body = new THREE.Mesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshStandardMaterial({ name: sharedMaterialName })
		);
		body.name = 'Body';

		const wheel = new THREE.Mesh(
			new THREE.BoxGeometry(0.4, 0.4, 0.4),
			new THREE.MeshStandardMaterial({ name: sharedMaterialName })
		);
		wheel.name = 'Wheel';

		scene.add(body);
		scene.add(wheel);

		const summaries = new Map<string, VehicleInspectionMaterialSummary>([
			[
				'material-wheel',
				{
					id: 'material-wheel',
					name: sharedMaterialName,
					alphaMode: 'OPAQUE',
					doubleSided: false,
					textureSlots: [],
					meshIds: ['mesh-wheel'],
					meshNames: ['Wheel Mesh'],
					meshMaterialSlots: [{ meshId: 'mesh-wheel', slotIndices: [0] }],
					nodePaths: ['Scene/Wheel']
				}
			]
		]);

		const targets = resolveRuntimeMaterialTargets(
			scene,
			createMaterialOperation('material-wheel', sharedMaterialName),
			summaries
		);

		expect(targets).toHaveLength(1);
		expect(targets[0]?.node.name).toBe('Wheel');
	});

	it('falls back to scene-wide name matching when scoped structural resolution misses', () => {
		const scene = new THREE.Scene();
		scene.name = 'Scene';

		const body = new THREE.Mesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshStandardMaterial({ name: 'WheelSurface' })
		);
		body.name = 'Body';
		scene.add(body);

		const summaries = new Map<string, VehicleInspectionMaterialSummary>([
			[
				'material-wheel',
				{
					id: 'material-wheel',
					name: 'WheelSurface',
					alphaMode: 'OPAQUE',
					doubleSided: false,
					textureSlots: [],
					meshIds: ['mesh-wheel'],
					meshNames: ['Wheel Mesh'],
					meshMaterialSlots: [{ meshId: 'mesh-wheel', slotIndices: [0] }],
					nodePaths: ['Scene/Wheel']
				}
			]
		]);

		const targets = resolveRuntimeMaterialTargets(
			scene,
			createMaterialOperation('material-wheel', 'WheelSurface'),
			summaries
		);

		expect(targets).toHaveLength(1);
		expect(targets[0]?.node.name).toBe('Body');
	});

	it('uses structural slot indices to resolve multi-material targets even when runtime names drift', () => {
		const scene = new THREE.Scene();
		scene.name = 'Scene';

		const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [
			new THREE.MeshStandardMaterial({ name: 'RuntimeBody' }),
			new THREE.MeshStandardMaterial({ name: 'RuntimeTrim' })
		]);
		mesh.name = 'BodyMesh';
		mesh.userData.meshId = 'mesh-body';
		scene.add(mesh);

		const summaries = new Map<string, VehicleInspectionMaterialSummary>([
			[
				'material-body',
				{
					id: 'material-body',
					name: 'BodyPaint',
					alphaMode: 'OPAQUE',
					doubleSided: false,
					textureSlots: [],
					meshIds: ['mesh-body'],
					meshNames: ['BodyMesh'],
					meshMaterialSlots: [{ meshId: 'mesh-body', slotIndices: [0] }],
					nodePaths: ['Scene/BodyMesh']
				}
			]
		]);

		const targets = resolveRuntimeMaterialTargets(
			scene,
			createMaterialOperation('material-body', 'BodyPaint'),
			summaries
		);

		expect(targets).toHaveLength(1);
		expect(targets[0]?.materialIndex).toBe(0);
		expect(targets[0]?.material.name).toBe('RuntimeBody');
	});

	it('falls back to scene-wide name matching for body paint when scoped targets cannot bind', () => {
		const scene = new THREE.Scene();
		scene.name = 'Scene';

		const body = new THREE.Mesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshStandardMaterial({ name: 'BodyPaint' })
		);
		body.name = 'Body';
		scene.add(body);

		const summaries = new Map<string, VehicleInspectionMaterialSummary>([
			[
				'material-body',
				{
					id: 'material-body',
					name: 'BodyPaint',
					alphaMode: 'OPAQUE',
					doubleSided: false,
					textureSlots: [],
					meshIds: ['mesh-body'],
					meshNames: ['Body Mesh'],
					meshMaterialSlots: [{ meshId: 'mesh-body', slotIndices: [0] }],
					nodePaths: ['Scene/MissingScopedNode']
				}
			]
		]);

		const targets = resolveRuntimeMaterialTargets(
			scene,
			createPaintOperation('material-body', 'BodyPaint'),
			summaries
		);

		expect(targets).toHaveLength(1);
		expect(targets[0]?.node.name).toBe('Body');
	});

	it('falls back to scene-wide name matching for emissive headlight updates when scoped targets cannot bind', () => {
		const scene = new THREE.Scene();
		scene.name = 'Scene';

		const headlight = new THREE.Mesh(
			new THREE.BoxGeometry(0.3, 0.3, 0.3),
			new THREE.MeshStandardMaterial({ name: 'HeadlightLens' })
		);
		headlight.name = 'Headlight';
		scene.add(headlight);

		const summaries = new Map<string, VehicleInspectionMaterialSummary>([
			[
				'material-headlight',
				{
					id: 'material-headlight',
					name: 'HeadlightLens',
					alphaMode: 'OPAQUE',
					doubleSided: false,
					textureSlots: [],
					meshIds: ['mesh-headlight'],
					meshNames: ['Headlight Mesh'],
					meshMaterialSlots: [{ meshId: 'mesh-headlight', slotIndices: [0] }],
					nodePaths: ['Scene/MissingScopedNode']
				}
			]
		]);

		const targets = resolveRuntimeMaterialTargets(
			scene,
			createEmissiveOperation('material-headlight', 'HeadlightLens'),
			summaries
		);

		expect(targets).toHaveLength(1);
		expect(targets[0]?.node.name).toBe('Headlight');
	});
});
