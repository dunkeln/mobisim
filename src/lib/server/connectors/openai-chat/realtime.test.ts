import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAIChatInputError } from './errors';
import { buildSessionLedger } from '$lib/contracts/session-ledger';

const envMock = {
	OPENAI_API_KEY: 'test-key',
	OPENAI_REALTIME_MODEL: 'gpt-realtime-mini',
	OPENAI_REALTIME_VOICE: 'alloy',
	OPENAI_AUDIO_TTS_VOICE: 'alloy'
};

const resolveContextHistoryMock = vi.fn();
const deriveVehicleInspectionCapabilitiesMock = vi.fn();
const getVehicleSemanticOverlayStatusMock = vi.fn();
const readVehicleSemanticOverlayMock = vi.fn();

vi.mock('$env/dynamic/private', () => ({
	env: envMock
}));

vi.mock('$lib/server/connectors/context-history', () => ({
	resolveContextHistory: resolveContextHistoryMock
}));

vi.mock('$lib/server/connectors/gltf-preprocess', () => ({
	deriveVehicleInspectionCapabilities: deriveVehicleInspectionCapabilitiesMock
}));

vi.mock('$lib/server/connectors/vehicle-semantic-overlay', () => ({
	getVehicleSemanticOverlayStatus: getVehicleSemanticOverlayStatusMock,
	readVehicleSemanticOverlay: readVehicleSemanticOverlayMock
}));

describe('realtime session payload', () => {
	beforeEach(() => {
		resolveContextHistoryMock.mockReset();
		deriveVehicleInspectionCapabilitiesMock.mockReset();
		getVehicleSemanticOverlayStatusMock.mockReset();
		readVehicleSemanticOverlayMock.mockReset();
		resolveContextHistoryMock.mockResolvedValue({
			historySourceOrder: ['current_request', 'current_asset_snapshot', 'current_asset_recent', 'user_global'],
			compactionApplied: false,
			sourceUsed: 'current_asset',
			currentAssetSummary: 'Stored active-asset context: highlights 2; viewer xray.',
			userGlobalSummary: 'Stored user-global context: recent assets audi_r8.'
		});
		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-1'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('missing');
		readVehicleSemanticOverlayMock.mockResolvedValue(null);
	});

	it('enables server vad interruption and exposes the vehicle tool bridge', async () => {
		const { buildRealtimeSessionPayload } = await import('./realtime');
		const sessionLedger = buildSessionLedger({
			assetId: 'audi_r8',
			structuralGeneratedAt: 'structural-1',
			semanticOverlayStatus: 'missing',
			semanticOverlayRevision: null,
			selectedNodeId: 'node-1',
			selectedNodeName: 'Front Fascia',
			selectedNodePath: 'Scene/Body/Front',
			presentation: {
				highlightedTargets: [
					{ targetId: 'material-body-shell', targetName: 'Body Shell', targetType: 'material' }
				]
			}
		});

		const payload = await buildRealtimeSessionPayload({
			userId: 'email:test@example.com',
			assetId: 'audi_r8',
			selectedNodeId: 'node-1',
			selectedNodeName: 'Front Fascia',
			selectedNodePath: 'Scene/Body/Front',
			presentation: {
				highlightedTargets: [
					{ targetId: 'material-body-shell', targetName: 'Body Shell', targetType: 'material' }
				]
			}
		}, sessionLedger);

		expect(payload.model).toBe('gpt-realtime-mini');
		expect(payload.output_modalities).toEqual(['audio']);
		expect(payload.audio.input.turn_detection).toEqual({
			type: 'server_vad',
			create_response: true,
			interrupt_response: true,
			prefix_padding_ms: 250,
			silence_duration_ms: 450
		});
		expect(payload.tools).toHaveLength(1);
		expect(payload.tools[0]?.name).toBe('execute_vehicle_request');
		expect(payload.instructions).toContain('Current runtime selection is first-class grounding.');
		expect(payload.instructions).toContain(
			'If the Selected runtime nodes line below is not none, there is an active selection. Do not say there is no active selection, and do not ask the user to select something first.'
		);
		expect(payload.instructions).toContain(
			'Named highlighted targets are secondary presentation context.'
		);
		expect(payload.instructions).toContain('Do not produce acknowledgment-only replies.');
		expect(payload.instructions).toContain('Acknowledge by giving the result or the next needed step.');
		expect(payload.instructions).toContain('fail closed with a hard no');
		expect(payload.instructions).toContain('No, I cannot do that here.');
		expect(payload.instructions).toContain(
			'When a live selection or highlight exists, treat deictic wording as a direct reference to it'
		);
		expect(payload.instructions).toContain('Active asset: audi_r8.');
		expect(payload.instructions).toContain('Selected runtime nodes: Front Fascia at Scene/Body/Front.');
		expect(payload.instructions).toContain('Highlighted targets: Body Shell.');
		expect(payload.instructions).toContain('Semantic overlay status: missing.');
		expect(payload.instructions).toContain('semantic grouping approval is handled by the app layer');
		expect(payload.instructions).toContain('Stored active-asset context: highlights 2; viewer xray.');
	});

	it('treats stale semantic overlays as cautionary in realtime instructions', async () => {
		const { buildRealtimeSessionPayload } = await import('./realtime');
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('stale');
		const sessionLedger = buildSessionLedger({
			assetId: 'audi_r8',
			structuralGeneratedAt: 'structural-1',
			semanticOverlayStatus: 'stale',
			semanticOverlayRevision: null
		});

		const payload = await buildRealtimeSessionPayload({
			userId: 'email:test@example.com',
			assetId: 'audi_r8'
		}, sessionLedger);

		expect(payload.instructions).toContain('Semantic overlay status: stale.');
		expect(payload.instructions).toContain('Treat semantic grouping as provisional');
	});

	it('rejects invalid asset ids before building a realtime scene dag', async () => {
		const { createRealtimeClientSecret } = await import('./realtime');

		await expect(
			createRealtimeClientSecret({
				userId: 'email:test@example.com',
				assetId: 'not_a_vehicle' as never
			})
		).rejects.toBeInstanceOf(OpenAIChatInputError);
	});
});
