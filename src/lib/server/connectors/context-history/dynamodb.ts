import {
	CreateTableCommand,
	DescribeTableCommand,
	DynamoDBClient,
	ResourceNotFoundException
} from '@aws-sdk/client-dynamodb';
import {
	DynamoDBDocumentClient,
	GetCommand,
	PutCommand,
	QueryCommand
} from '@aws-sdk/lib-dynamodb';
import type { VehicleAssetId } from '$lib/vehicles/catalog';
import type {
	ContextHistoryConfig,
	ContextHistoryPort,
	UserAssetContextEvent,
	UserAssetContextSnapshot,
	UserGlobalContextSnapshot
} from './types';

let documentClient: DynamoDBDocumentClient | null = null;
let ensuredTablePromise: Promise<void> | null = null;

function createClient(config: ContextHistoryConfig): DynamoDBDocumentClient {
	if (documentClient) {
		return documentClient;
	}

	const baseClient = new DynamoDBClient({
		region: config.region,
		endpoint: config.endpoint,
		credentials: config.endpoint
			? {
					accessKeyId: 'local',
					secretAccessKey: 'local'
				}
			: undefined
	});

	documentClient = DynamoDBDocumentClient.from(baseClient, {
		marshallOptions: {
			removeUndefinedValues: true
		}
	});

	return documentClient;
}

async function ensureLocalTable(config: ContextHistoryConfig): Promise<void> {
	if (!config.endpoint) {
		return;
	}

	if (!ensuredTablePromise) {
		const client = createClient(config);
		ensuredTablePromise = (async () => {
			try {
				await client.send(
					new DescribeTableCommand({
						TableName: config.tableName
					})
				);
				return;
			} catch (error) {
				if (!(error instanceof ResourceNotFoundException)) {
					throw error;
				}
			}

			await client.send(
				new CreateTableCommand({
					TableName: config.tableName,
					AttributeDefinitions: [
						{ AttributeName: 'pk', AttributeType: 'S' },
						{ AttributeName: 'sk', AttributeType: 'S' }
					],
					KeySchema: [
						{ AttributeName: 'pk', KeyType: 'HASH' },
						{ AttributeName: 'sk', KeyType: 'RANGE' }
					],
					BillingMode: 'PAY_PER_REQUEST'
				})
			);
		})();
	}

	await ensuredTablePromise;
}

function buildUserPk(userId: string): string {
	return `USER#${userId}`;
}

function buildAssetSnapshotSk(assetId: VehicleAssetId): string {
	return `ASSET#${assetId}#SNAPSHOT`;
}

function buildAssetEventPrefix(assetId: VehicleAssetId): string {
	return `ASSET#${assetId}#EVENT#`;
}

function buildAssetEventSk(assetId: VehicleAssetId, eventAt: string): string {
	return `${buildAssetEventPrefix(assetId)}${eventAt}`;
}

function buildUserGlobalSk(): string {
	return 'GLOBAL#SNAPSHOT';
}

export function createDynamoDbContextHistoryPort(config: ContextHistoryConfig): ContextHistoryPort {
	const client = createClient(config);

	async function ready(): Promise<void> {
		await ensureLocalTable(config);
	}

	return {
		async getAssetSnapshot(userId, assetId) {
			await ready();
			const result = await client.send(
				new GetCommand({
					TableName: config.tableName,
					Key: {
						pk: buildUserPk(userId),
						sk: buildAssetSnapshotSk(assetId)
					}
				})
			);

			return (result.Item?.payload as UserAssetContextSnapshot | undefined) ?? null;
		},

		async listAssetEvents(userId, assetId, limit) {
			await ready();
			const result = await client.send(
				new QueryCommand({
					TableName: config.tableName,
					KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
					ExpressionAttributeValues: {
						':pk': buildUserPk(userId),
						':sk': buildAssetEventPrefix(assetId)
					},
					ScanIndexForward: false,
					Limit: limit
				})
			);

			return (result.Items ?? [])
				.map((item) => item.payload as UserAssetContextEvent | undefined)
				.filter((item): item is UserAssetContextEvent => !!item);
		},

		async getUserGlobalSnapshot(userId) {
			await ready();
			const result = await client.send(
				new GetCommand({
					TableName: config.tableName,
					Key: {
						pk: buildUserPk(userId),
						sk: buildUserGlobalSk()
					}
				})
			);

			return (result.Item?.payload as UserGlobalContextSnapshot | undefined) ?? null;
		},

		async putAssetSnapshot(snapshot) {
			await ready();
			await client.send(
				new PutCommand({
					TableName: config.tableName,
					Item: {
						pk: buildUserPk(snapshot.userId),
						sk: buildAssetSnapshotSk(snapshot.assetId),
						entityType: 'asset_snapshot',
						payload: snapshot
					}
				})
			);
		},

		async putAssetEvent(event) {
			await ready();
			const expiresAt =
				Math.floor(Date.parse(event.eventAt) / 1000) + config.eventTtlDays * 24 * 60 * 60;
			await client.send(
				new PutCommand({
					TableName: config.tableName,
					Item: {
						pk: buildUserPk(event.userId),
						sk: buildAssetEventSk(event.assetId, event.eventAt),
						entityType: 'asset_event',
						expiresAt,
						payload: event
					}
				})
			);
		},

		async putUserGlobalSnapshot(snapshot) {
			await ready();
			await client.send(
				new PutCommand({
					TableName: config.tableName,
					Item: {
						pk: buildUserPk(snapshot.userId),
						sk: buildUserGlobalSk(),
						entityType: 'user_global_snapshot',
						payload: snapshot
					}
				})
			);
		}
	};
}
