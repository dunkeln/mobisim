import type { Material } from 'three';

export const LOW_ALPHA_OPACITY_THRESHOLD = 0.2;

export function resolvePersistentAlpha(currentOpacity: number, requestedOpacity: number): number {
	return Math.min(currentOpacity, requestedOpacity);
}

export function isLowAlphaOpacity(opacity: number): boolean {
	return opacity <= LOW_ALPHA_OPACITY_THRESHOLD;
}

export function isLowAlphaMaterial(material: Material): boolean {
	if (!('opacity' in material) || typeof material.opacity !== 'number') {
		return false;
	}

	return isLowAlphaOpacity(material.opacity);
}
