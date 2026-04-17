import { env } from '$env/dynamic/private';
import {
	DeleteObjectCommand,
	GetObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
	type _Object
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { resolveStorageBucketName } from './storage';

type ListedObject = {
	key: string;
	lastModified: Date | null;
};

type MemoryObject = {
	body: string;
	lastModified: Date;
};

let client: S3Client | null = null;
const memoryObjects = new Map<string, MemoryObject>();

function isTestMode(): boolean {
	return env.NODE_ENV === 'test' || process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
}

function getClientOptions(): {
	region?: string;
	accessKeyId?: string;
	secretAccessKey?: string;
	sessionToken?: string;
} {
	return {
		region: env.AWS_REGION?.trim() ?? env.AWS_DEFAULT_REGION?.trim(),
		accessKeyId: env.AWS_ACCESS_KEY_ID?.trim() || undefined,
		secretAccessKey: env.AWS_SECRET_ACCESS_KEY?.trim() || undefined,
		sessionToken: env.AWS_SESSION_TOKEN?.trim() || undefined
	};
}

function resolveClient(): S3Client {
	if (client) {
		return client;
	}

	const options = getClientOptions();
	if (!options.region) {
		throw new Error('AWS_REGION is required.');
	}

	client = new S3Client({
		region: options.region,
		credentials:
			options.accessKeyId && options.secretAccessKey
				? {
						accessKeyId: options.accessKeyId,
						secretAccessKey: options.secretAccessKey,
						sessionToken: options.sessionToken
					}
				: undefined
	});

	return client;
}

function normalizeKey(key: string): string {
	return key.replace(/^\/+/, '');
}

async function bodyToText(body: unknown): Promise<string> {
	if (!body) {
		throw new Error('S3 object body is empty.');
	}

	const candidate = body as
		| { transformToString: (encoding?: string) => Promise<string> }
		| Readable
		| Blob
		| unknown;

	if (typeof (candidate as { transformToString?: unknown }).transformToString === 'function') {
		return (candidate as { transformToString: (encoding?: string) => Promise<string> }).transformToString(
			'utf8'
		);
	}

	if (candidate instanceof Readable) {
		const chunks: Buffer[] = [];
		for await (const chunk of candidate) {
			chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
		}
		return Buffer.concat(chunks).toString('utf8');
	}

	if (typeof Blob !== 'undefined' && candidate instanceof Blob) {
		return candidate.text();
	}

	throw new Error('Unsupported S3 body response.');
}

function readMemoryObject(key: string): string | null {
	return memoryObjects.get(normalizeKey(key))?.body ?? null;
}

function writeMemoryObject(key: string, body: string): void {
	memoryObjects.set(normalizeKey(key), {
		body,
		lastModified: new Date()
	});
}

function deleteMemoryObject(key: string): void {
	memoryObjects.delete(normalizeKey(key));
}

function listMemoryObjects(prefix: string): ListedObject[] {
	const normalizedPrefix = normalizeKey(prefix);
	return Array.from(memoryObjects.entries())
		.filter(([key]) => key.startsWith(normalizedPrefix))
		.map(([key, value]) => ({
			key,
			lastModified: value.lastModified
		}));
}

function listMemoryCommonPrefixes(prefix: string): string[] {
	const normalizedPrefix = normalizeKey(prefix);
	const prefixes = new Set<string>();

	for (const key of memoryObjects.keys()) {
		if (!key.startsWith(normalizedPrefix)) {
			continue;
		}

		const suffix = key.slice(normalizedPrefix.length);
		const nextSegment = suffix.split('/')[0]?.trim();
		if (!nextSegment) {
			continue;
		}

		prefixes.add(`${normalizedPrefix}${nextSegment}/`);
	}

	return Array.from(prefixes).sort((left, right) => left.localeCompare(right));
}

export async function readJsonObject<T>(key: string): Promise<T | null> {
	if (isTestMode()) {
		const raw = readMemoryObject(key);
		return raw ? (JSON.parse(raw) as T) : null;
	}

	const bucket = resolveStorageBucketName();
	try {
		const response = await resolveClient().send(
			new GetObjectCommand({
				Bucket: bucket,
				Key: key
			})
		);

		return JSON.parse(await bodyToText(response.Body)) as T;
	} catch (error) {
		if ((error as { name?: string }).name === 'NoSuchKey') {
			return null;
		}
		if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
			return null;
		}
		throw error;
	}
}

export async function writeJsonObject(key: string, value: unknown): Promise<void> {
	const body = JSON.stringify(value, null, 2);
	if (isTestMode()) {
		writeMemoryObject(key, body);
		return;
	}

	await resolveClient().send(
		new PutObjectCommand({
			Bucket: resolveStorageBucketName(),
			Key: key,
			Body: body,
			ContentType: 'application/json'
		})
	);
}

export async function deleteJsonObject(key: string): Promise<void> {
	if (isTestMode()) {
		deleteMemoryObject(key);
		return;
	}

	await resolveClient().send(
		new DeleteObjectCommand({
			Bucket: resolveStorageBucketName(),
			Key: key
		})
	);
}

export async function listJsonObjects(prefix: string): Promise<ListedObject[]> {
	if (isTestMode()) {
		return listMemoryObjects(prefix);
	}

	const response = await resolveClient().send(
		new ListObjectsV2Command({
			Bucket: resolveStorageBucketName(),
			Prefix: prefix
		})
	);

	return (response.Contents ?? [])
		.map((entry: _Object) => {
			if (!entry.Key) {
				return null;
			}

			return {
				key: entry.Key,
				lastModified: entry.LastModified ?? null
			};
		})
		.filter((entry): entry is ListedObject => entry !== null);
}

export async function listCommonPrefixes(prefix: string): Promise<string[]> {
	if (isTestMode()) {
		return listMemoryCommonPrefixes(prefix);
	}

	const response = await resolveClient().send(
		new ListObjectsV2Command({
			Bucket: resolveStorageBucketName(),
			Prefix: prefix,
			Delimiter: '/'
		})
	);

	return (response.CommonPrefixes ?? [])
		.map((entry) => entry.Prefix?.trim() ?? '')
		.filter((value) => value.length > 0);
}

export function resetS3ClientForTests(): void {
	client = null;
	memoryObjects.clear();
}
