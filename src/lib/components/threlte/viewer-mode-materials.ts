import type * as THREE from 'three';
import { isLowAlphaMaterial } from '$lib/components/threlte/persistent-alpha';

export function mapMaterialsPreservingLowAlpha(
	source: THREE.Material | THREE.Material[],
	mapper: (material: THREE.Material, index: number) => THREE.Material
): THREE.Material | THREE.Material[] {
	if (Array.isArray(source)) {
		return source.map((material, index) =>
			isLowAlphaMaterial(material) ? material : mapper(material, index)
		);
	}

	return isLowAlphaMaterial(source) ? source : mapper(source, 0);
}
