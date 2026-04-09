import {
	CreateTableCommand,
	DescribeTableCommand,
	DynamoDBClient,
	ResourceNotFoundException,
	UpdateTimeToLiveCommand
} from '@aws-sdk/client-dynamodb';

const region = process.env.AWS_REGION || 'us-west-2';
const tableName = process.env.CONTEXT_HISTORY_TABLE || 'mobisim-context-history';
const endpoint = process.env.DYNAMODB_ENDPOINT || 'http://127.0.0.1:8000';

const client = new DynamoDBClient({
	region,
	endpoint,
	credentials: endpoint
		? {
				accessKeyId: 'local',
				secretAccessKey: 'local'
			}
		: undefined
});

async function ensureTable() {
	try {
		await client.send(
			new DescribeTableCommand({
				TableName: tableName
			})
		);
		console.log(`context history table already exists: ${tableName}`);
	} catch (error) {
		if (!(error instanceof ResourceNotFoundException)) {
			throw error;
		}

		await client.send(
			new CreateTableCommand({
				TableName: tableName,
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
		console.log(`created context history table: ${tableName}`);
	}

	try {
		await client.send(
			new UpdateTimeToLiveCommand({
				TableName: tableName,
				TimeToLiveSpecification: {
					AttributeName: 'expiresAt',
					Enabled: true
				}
			})
		);
		console.log(`enabled TTL on ${tableName} using expiresAt`);
	} catch (error) {
		console.warn('unable to enable TTL for context history table', error);
	}
}

ensureTable().catch((error) => {
	console.error('context history bootstrap failed', error);
	process.exitCode = 1;
});
