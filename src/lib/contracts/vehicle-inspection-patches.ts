export type VehicleInspectionNodePatchOperation = {
	targetType: 'node';
	targetId: string;
	targetName?: string;
	op: 'set_translation' | 'set_rotation' | 'set_scale' | 'set_visibility';
	value: [number, number, number] | boolean;
};

export type VehicleInspectionMaterialPatchOperation = {
	targetType: 'material';
	targetId: string;
	targetName?: string;
	op:
		| 'set_base_color_factor'
		| 'set_emissive_factor'
		| 'set_alpha'
		| 'set_double_sided'
		| 'set_overlay_highlight';
	value: [number, number, number, number] | [number, number, number] | number | boolean;
};

export type VehicleInspectionViewerPatchOperation = {
	targetType: 'viewer';
	targetId: 'postprocess' | 'wireframe' | 'uv_debug';
	targetName?: string;
	op: 'set_enabled' | 'set_target';
	value: boolean | string | null;
};

export type VehicleInspectionPatchOperation =
	| VehicleInspectionNodePatchOperation
	| VehicleInspectionMaterialPatchOperation
	| VehicleInspectionViewerPatchOperation;
