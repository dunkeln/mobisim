import type { FooterChatRequest } from './types';
import { OpenAIChatInputError } from './errors';
import { isVehicleAssetId } from '$lib/vehicles/catalog';

function readStringField(value: FormDataEntryValue | null): string | undefined {
	return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function readJsonField<T>(value: FormDataEntryValue | null, fallback: T): T {
	if (typeof value !== 'string' || value.trim().length === 0) {
		return fallback;
	}

	if (value.trim() === 'undefined' || value.trim() === 'null') {
		return fallback;
	}

	return JSON.parse(value) as T;
}

export function parseFooterAudioChatFormData(formData: FormData): {
	audio: File;
	payload: Omit<FooterChatRequest, 'message'>;
} {
	const audio = formData.get('audio');
	if (!(audio instanceof File)) {
		throw new OpenAIChatInputError('Audio file is required.');
	}

	try {
		return {
			audio,
			payload: {
				assetId: (() => {
					const assetId = readStringField(formData.get('assetId'));
					return assetId && isVehicleAssetId(assetId) ? assetId : undefined;
				})(),
				selectedGroupId: readStringField(formData.get('selectedGroupId')),
				selectedNodeId: readStringField(formData.get('selectedNodeId')),
				selectedNodeName: readStringField(formData.get('selectedNodeName')),
				selectedNodePath: readStringField(formData.get('selectedNodePath')),
				selectedNodes: readJsonField(formData.get('selectedNodes'), []),
				presentation: readJsonField(formData.get('presentation'), undefined),
				sidebar: readJsonField(formData.get('sidebar'), undefined),
				supplementaryList: readJsonField(formData.get('supplementaryList'), undefined)
			}
		};
	} catch {
		throw new OpenAIChatInputError('Invalid audio chat metadata.');
	}
}
