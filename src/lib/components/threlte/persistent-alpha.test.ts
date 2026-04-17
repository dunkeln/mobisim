import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { isLowAlphaMaterial, isLowAlphaOpacity, resolvePersistentAlpha } from './persistent-alpha';

describe('persistent alpha', () => {
	it('keeps removals monotonic so later edits cannot make a hidden surface less transparent', () => {
		expect(resolvePersistentAlpha(1, 0.18)).toBe(0.18);
		expect(resolvePersistentAlpha(0.18, 0.08)).toBe(0.08);
		expect(resolvePersistentAlpha(0.08, 0.4)).toBe(0.08);
		expect(resolvePersistentAlpha(0.08, 1)).toBe(0.08);
	});

	it('treats low-opacity materials as pass-through for shared picker and viewer guards', () => {
		expect(isLowAlphaOpacity(0.2)).toBe(true);
		expect(isLowAlphaOpacity(0.21)).toBe(false);
		expect(isLowAlphaMaterial(new THREE.MeshBasicMaterial({ opacity: 0.18, transparent: true }))).toBe(
			true
		);
		expect(isLowAlphaMaterial(new THREE.MeshBasicMaterial({ opacity: 0.5, transparent: true }))).toBe(
			false
		);
	});
});
