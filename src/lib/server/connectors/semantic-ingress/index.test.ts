import { beforeEach, describe, expect, it, vi } from 'vitest';

const deriveVehicleInspectionCapabilitiesMock = vi.fn();
const deriveStructuralAssetSnapshotMock = vi.fn();
const readVehicleSemanticOverlayMock = vi.fn();
const mkdirMock = vi.fn();
const readdirMock = vi.fn();
const readFileMock = vi.fn();
const statMock = vi.fn();
const writeFileMock = vi.fn();

vi.mock('node:fs/promises', () => ({
	mkdir: mkdirMock,
	readdir: readdirMock,
	readFile: readFileMock,
	stat: statMock,
	writeFile: writeFileMock
}));

vi.mock('$lib/server/connectors/gltf-preprocess', () => ({
	deriveVehicleInspectionCapabilities: deriveVehicleInspectionCapabilitiesMock
}));

vi.mock('$lib/server/connectors/gltf-structure', () => ({
	deriveStructuralAssetSnapshot: deriveStructuralAssetSnapshotMock
}));

vi.mock('$lib/server/connectors/vehicle-semantic-overlay', () => ({
	readVehicleSemanticOverlay: readVehicleSemanticOverlayMock
}));

describe('semantic ingress', () => {
	beforeEach(() => {
		deriveVehicleInspectionCapabilitiesMock.mockReset();
		deriveStructuralAssetSnapshotMock.mockReset();
		readVehicleSemanticOverlayMock.mockReset();
		mkdirMock.mockReset();
		readdirMock.mockReset();
		readFileMock.mockReset();
		statMock.mockReset();
		writeFileMock.mockReset();
		readFileMock.mockRejectedValue(new Error('missing'));
		readdirMock.mockRejectedValue(new Error('missing'));
		statMock.mockRejectedValue(new Error('missing'));
		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-1'
		});
	});

	it('assigns a rest+sse ingress to a semantic group', async () => {
		const { assignSemanticIngress } = await import('./index');

		readVehicleSemanticOverlayMock.mockResolvedValue({
			structuralGeneratedAt: 'structural-1',
			acceptedGroups: [{ id: 'body_shell', humanLabel: 'Body Shell' }]
		});

		const binding = await assignSemanticIngress({
			assetId: 'audi_r8',
			targetType: 'semantic_group',
			targetId: 'body_shell',
			targetLabel: 'Body Shell',
			transport: 'rest_sse',
			assignedBy: 'model'
		});

		expect(binding.scope).toBe('global');
		expect(binding.restPath).toBe(
			'/api/vehicle-assets/audi_r8/semantic-ingress/semantic_group-body-shell-rest_sse'
		);
		expect(binding.ssePath).toBe(
			'/api/vehicle-assets/audi_r8/semantic-ingress/semantic_group-body-shell-rest_sse/events'
		);
		expect(writeFileMock).toHaveBeenCalledTimes(1);
	});

	it('assigns a stream ingress to a semantic node', async () => {
		const { assignSemanticIngress } = await import('./index');

		deriveStructuralAssetSnapshotMock.mockResolvedValue({
			nodes: [{ id: 'node-1' }]
		});

		const binding = await assignSemanticIngress({
			assetId: 'audi_r8',
			targetType: 'semantic_node',
			targetId: 'node-1',
			targetLabel: 'Left Door',
			transport: 'stream',
			userId: 'email:test@example.com'
		});

		expect(binding.scope).toBe('user');
		expect(binding.streamPath).toBe(
			`/api/vehicle-assets/audi_r8/semantic-ingress/${binding.ingressId}/events`
		);
		expect(binding.restPath).toBeUndefined();
	});

	it('ingests numeric samples and returns a bounded snapshot window', async () => {
		const {
			assignSemanticIngress,
			getSemanticIngressSnapshot,
			ingestSemanticIngressSamples
		} = await import('./index');

		readVehicleSemanticOverlayMock.mockResolvedValue({
			structuralGeneratedAt: 'structural-1',
			acceptedGroups: [{ id: 'body_shell', humanLabel: 'Body Shell' }]
		});

		const binding = await assignSemanticIngress({
			assetId: 'audi_r8',
			targetType: 'semantic_group',
			targetId: 'body_shell',
			targetLabel: 'Body Shell',
			transport: 'rest_sse',
			assignedBy: 'model'
		});

		readFileMock.mockResolvedValue(
			JSON.stringify({
				assetId: 'audi_r8',
				structuralGeneratedAt: 'structural-1',
				bindings: [binding],
				samplesByIngress: {
					[binding.ingressId]: [
						{
							timestamp: '2026-04-08T12:00:00.000Z',
							value: 12,
							metric: 'speed',
							unit: 'kmh'
						}
					]
				}
			})
		);
		readdirMock.mockResolvedValue(['structural-1.json']);
		statMock.mockResolvedValue({ mtimeMs: 10 } as never);

		const snapshot = await ingestSemanticIngressSamples({
			assetId: 'audi_r8',
			ingressId: binding.ingressId,
			samples: [
				{
					timestamp: '2026-04-08T12:00:01.000Z',
					value: 14,
					metric: 'speed',
					unit: 'kmh'
				}
			]
		});

		expect(snapshot.samples).toHaveLength(2);
		expect(snapshot.samples[1]).toEqual({
			timestamp: '2026-04-08T12:00:01.000Z',
			value: 14,
			metric: 'speed',
			unit: 'kmh',
			source: undefined
		});

		const persistedStore = JSON.parse(writeFileMock.mock.calls.at(-1)?.[1] as string) as {
			samplesByIngress: Record<string, Array<{ value: number }>>;
		};
		expect(persistedStore.samplesByIngress[binding.ingressId]).toHaveLength(2);

		const latestSnapshot = await getSemanticIngressSnapshot('audi_r8', binding.ingressId);
		expect(latestSnapshot?.samples).toHaveLength(1);
		expect(latestSnapshot?.samples[0]?.value).toBe(12);
	});

	it('lists persisted bindings without deriving vehicle capabilities', async () => {
		const { listSemanticIngressBindings, removeSemanticIngressBinding } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockReset();
		readFileMock.mockResolvedValue(
			JSON.stringify({
				assetId: 'audi_r8',
				structuralGeneratedAt: 'structural-1',
				bindings: [
					{
						ingressId: 'semantic_group-body-shell-rest_sse',
						assetId: 'audi_r8',
						structuralGeneratedAt: 'structural-1',
						scope: 'global',
						targetType: 'semantic_group',
						targetId: 'body_shell',
						targetLabel: 'Body Shell',
						transport: 'rest_sse',
						assignedAt: '2026-04-08T12:00:00.000Z',
						assignedBy: 'model',
						restPath: '/api/vehicle-assets/audi_r8/semantic-ingress/semantic_group-body-shell-rest_sse',
						ssePath:
							'/api/vehicle-assets/audi_r8/semantic-ingress/semantic_group-body-shell-rest_sse/events'
					}
				],
				samplesByIngress: {}
			})
		);
		readdirMock.mockResolvedValue(['structural-1.json']);
		statMock.mockResolvedValue({ mtimeMs: 10 } as never);

		const store = await listSemanticIngressBindings('audi_r8');

		expect(deriveVehicleInspectionCapabilitiesMock).not.toHaveBeenCalled();
		expect(store.bindings).toHaveLength(1);
	});

	it('filters user-scoped bindings to the active user and requested semantic group', async () => {
		const { listSemanticIngressBindings, removeSemanticIngressBinding } = await import('./index');

		readFileMock.mockResolvedValue(
			JSON.stringify({
				assetId: 'audi_r8',
				structuralGeneratedAt: 'structural-1',
				bindings: [
					{
						ingressId: 'semantic_group-body-shell-rest_sse-user-aaaa1111aaaa',
						assetId: 'audi_r8',
						structuralGeneratedAt: 'structural-1',
						scope: 'user',
						scopeKey: 'aaaa1111aaaa',
						targetType: 'semantic_group',
						targetId: 'body_shell',
						targetLabel: 'Body Shell',
						transport: 'rest_sse',
						assignedAt: '2026-04-08T12:00:00.000Z',
						assignedBy: 'user',
						restPath:
							'/api/vehicle-assets/audi_r8/semantic-ingress/semantic_group-body-shell-rest_sse-user-aaaa1111aaaa',
						ssePath:
							'/api/vehicle-assets/audi_r8/semantic-ingress/semantic_group-body-shell-rest_sse-user-aaaa1111aaaa/events'
					},
					{
						ingressId: 'semantic_group-wheels-rest_sse',
						assetId: 'audi_r8',
						structuralGeneratedAt: 'structural-1',
						scope: 'global',
						targetType: 'semantic_group',
						targetId: 'wheels',
						targetLabel: 'Wheels',
						transport: 'rest_sse',
						assignedAt: '2026-04-08T12:00:00.000Z',
						assignedBy: 'model',
						restPath: '/api/vehicle-assets/audi_r8/semantic-ingress/semantic_group-wheels-rest_sse',
						ssePath:
							'/api/vehicle-assets/audi_r8/semantic-ingress/semantic_group-wheels-rest_sse/events'
					}
				],
				samplesByIngress: {}
			})
		);
		readdirMock.mockResolvedValue(['structural-1.json']);
		statMock.mockResolvedValue({ mtimeMs: 10 } as never);

		const store = await listSemanticIngressBindings('audi_r8', {
			userId: 'email:other@example.com',
			targetType: 'semantic_group',
			targetId: 'body_shell'
		});

		expect(store.bindings).toEqual([]);
		await expect(
			removeSemanticIngressBinding('audi_r8', 'semantic_group-body-shell-rest_sse-user-aaaa1111aaaa', 'email:other@example.com')
		).resolves.toBe(false);
	});

	it('removes a visible binding and drops its retained samples', async () => {
		const { removeSemanticIngressBinding } = await import('./index');

		readFileMock.mockResolvedValue(
			JSON.stringify({
				assetId: 'audi_r8',
				structuralGeneratedAt: 'structural-1',
				bindings: [
					{
						ingressId: 'semantic_group-body-shell-rest_sse',
						assetId: 'audi_r8',
						structuralGeneratedAt: 'structural-1',
						scope: 'global',
						targetType: 'semantic_group',
						targetId: 'body_shell',
						targetLabel: 'Body Shell',
						transport: 'rest_sse',
						assignedAt: '2026-04-08T12:00:00.000Z',
						assignedBy: 'model',
						restPath: '/api/vehicle-assets/audi_r8/semantic-ingress/semantic_group-body-shell-rest_sse',
						ssePath:
							'/api/vehicle-assets/audi_r8/semantic-ingress/semantic_group-body-shell-rest_sse/events'
					}
				],
				samplesByIngress: {
					'semantic_group-body-shell-rest_sse': [
						{
							timestamp: '2026-04-08T12:00:00.000Z',
							value: 12
						}
					]
				}
			})
		);

		await expect(
			removeSemanticIngressBinding('audi_r8', 'semantic_group-body-shell-rest_sse')
		).resolves.toBe(true);
		const persistedStore = JSON.parse(writeFileMock.mock.calls.at(-1)?.[1] as string) as {
			bindings: Array<{ ingressId: string }>;
			samplesByIngress: Record<string, unknown>;
		};
		expect(persistedStore.bindings).toEqual([]);
		expect(persistedStore.samplesByIngress).toEqual({});
	});
});
