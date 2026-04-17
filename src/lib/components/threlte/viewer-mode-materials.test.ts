import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mapMaterialsPreservingLowAlpha } from './viewer-mode-materials';

describe('viewer mode materials', () => {
	it('preserves low-alpha materials while remapping eligible materials', () => {
		const removed = new THREE.MeshStandardMaterial({ opacity: 0.08, transparent: true });
		const visible = new THREE.MeshStandardMaterial({ opacity: 1, transparent: false });

		const mapped = mapMaterialsPreservingLowAlpha([removed, visible], () => {
			return new THREE.MeshBasicMaterial({ wireframe: true });
		});

		expect(Array.isArray(mapped)).toBe(true);
		expect(mapped[0]).toBe(removed);
		expect(mapped[1]).toBeInstanceOf(THREE.MeshBasicMaterial);
	});

	it('remaps single materials when they are not low alpha', () => {
		const visible = new THREE.MeshStandardMaterial({ opacity: 1, transparent: false });

		const mapped = mapMaterialsPreservingLowAlpha(visible, () => {
			return new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0, 0) });
		});

		expect(mapped).toBeInstanceOf(THREE.MeshBasicMaterial);
		expect(mapped).not.toBe(visible);
	});
});
