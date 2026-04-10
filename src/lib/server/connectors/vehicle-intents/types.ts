import type { VehicleAssetId } from '$lib/vehicles/catalog';
import type { VehicleInspectionPatchOperation as SharedVehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';

export type PlannedVehicleIntentResult = {
	assetId: VehicleAssetId;
	operations: SharedVehicleInspectionPatchOperation[];
	rejected: string[];
	summary: string;
};

export type VehiclePartIntentMode = 'highlight' | 'focus' | 'isolate' | 'remove';

export type PlannedVehiclePartIntentResult = {
	assetId: VehicleAssetId;
	mode: VehiclePartIntentMode;
	partQuery: string;
	matchedPartIds: string[];
	matchedPartLabels: string[];
	matchedNodeIds: string[];
	matchedMaterialIds: string[];
	matchedPaths: string[];
	matchedMaterialNames: string[];
	operations: SharedVehicleInspectionPatchOperation[];
	summary: string;
};

export type VehiclePlannerTargetExpression =
	| {
			kind: 'semantic_query';
			query: string;
	  }
	| {
			kind: 'highlighted_materials';
	  }
	| {
			kind: 'union';
			items: VehiclePlannerTargetExpression[];
	  }
	| {
			kind: 'intersect';
			left: VehiclePlannerTargetExpression;
			right: VehiclePlannerTargetExpression;
	  }
	| {
			kind: 'subtract';
			left: VehiclePlannerTargetExpression;
			right: VehiclePlannerTargetExpression;
	  };

export type VehiclePlannerStep =
	| {
			kind: 'resolve_keep_targets';
			query: string;
	  }
	| {
			kind: 'read_highlighted_materials';
	  }
	| {
			kind: 'enumerate_all_materials';
	  }
	| {
			kind: 'subtract_keep_targets';
	  }
	| {
			kind: 'apply_remove_material_alpha';
			alpha: number;
	  };

export type VehiclePlannerConstraint =
	| {
			kind: 'preserve_current_paint';
	  };

export type VehiclePlannerJob = {
	intent: 'remove_all_except';
	assetId: VehicleAssetId;
	keep: VehiclePlannerTargetExpression[];
	steps: VehiclePlannerStep[];
	constraints?: VehiclePlannerConstraint[];
};

export type VehiclePlannerVerification = {
	preservedMaterialIds: string[];
	mutatedMaterialIds: string[];
	verificationPassed: boolean;
};

export type PlannedVehicleSetLogicIntentResult = PlannedVehicleIntentResult & {
	plannerJob: VehiclePlannerJob;
	verification: VehiclePlannerVerification;
};

export type VehicleIntentPresentationContext = {
	highlightedTargets?: Array<{
		targetId: string;
		targetType?: 'node' | 'material';
	}>;
	materialTargets?: Array<{
		targetId: string;
		targetType?: 'node' | 'material';
	}>;
};

export type NormalizedVehiclePaintIntent = {
	colorFamily: string;
	shade?: 'very_dark' | 'dark' | 'medium' | 'light' | 'very_light';
	saturation?: 'muted' | 'balanced' | 'vivid';
	finish?: 'solid' | 'metallic' | 'chrome' | 'matte' | 'pearl' | 'gloss';
	hex?: string;
};
