<script lang="ts">
	/**
	 * FooterOrb — geodesic hypersphere with per-edge dimming + vertex heartbeat.
	 *
	 * Outer geodesic sphere (r=0.90) + inner sphere (r=0.76) with connector spokes.
	 * ~1/3 of edges on each net are rendered at reduced brightness via vertexColors.
	 * Per-vertex radial displacement drives the heartbeat surface deformation.
	 *
	 * amplitude: 0–1 — controls deformation depth + speed in 'responding' mode.
	 */

	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolveInspectionAssetId } from '$lib/routes/inspection';
	import { toast } from '$lib/components/ui/sonner';
	import {
		approveBulkApplication,
		approveSemanticIngressApplication,
		applyChatResponse,
		beginFooterResponseCycle,
		getPresentationContext,
		prepareSemanticBootstrapForRequest,
		getSidebarContext,
		getSupplementaryListContext,
		getSelectedNodeContext
	} from '$lib/components/chat/footer-chat-client';
	import type {
		FooterChatAudioResponse,
		FooterChatAudioStreamEvent,
		FooterChatResponse
	} from '$lib/server/connectors/openai-chat/types';
	import type { VehicleAssetId } from '$lib/vehicles/catalog';
	import * as THREE from 'three';

	type OrbMode = 'idle' | 'listening' | 'processing' | 'responding';

	type Props = {
		mode?: OrbMode;
		amplitude?: number;
		class?: string;
		size?: number;
		interactive?: boolean;
	};

	let {
		mode = 'idle',
		amplitude = 0,
		class: className = '',
		size = 96,
		interactive = true
	}: Props = $props();

	let canvas: HTMLCanvasElement | undefined = $state();
	let audioElement: HTMLAudioElement | null = null;
	let realtimeAudioElement: HTMLAudioElement | null = null;
	let mediaRecorder: MediaRecorder | null = $state(null);
	let mediaStream: MediaStream | null = $state(null);
	let realtimePeerConnection: RTCPeerConnection | null = $state(null);
	let realtimeDataChannel: RTCDataChannel | null = $state(null);
	let realtimeToolAbortController: AbortController | null = null;
	let realtimeResponseActive = $state(false);
	let realtimeSessionActive = $state(false);
	let realtimeSessionAssetId = $state<VehicleAssetId | undefined>();
	let realtimeSemanticOverlayStatus = $state<'missing' | 'stale' | 'fresh' | 'unknown'>('unknown');
	let realtimeConnecting = $state(false);
	let recorderChunks: BlobPart[] = [];
	let activeMode = $state<OrbMode>('idle');
	let activeAmplitude = $state(0);
	let busy = $state(false);
	const assetId = $derived(resolveInspectionAssetId(page.url));

	const RECORDER_MIME_CANDIDATES = [
		'audio/webm;codecs=opus',
		'audio/webm',
		'audio/mp4;codecs=mp4a.40.2',
		'audio/mp4'
	] as const;

	$effect(() => {
		if (
			!busy &&
			!realtimeSessionActive &&
			mediaRecorder?.state !== 'recording' &&
			!audioElement &&
			!realtimeAudioElement
		) {
			activeMode = mode;
			activeAmplitude = amplitude;
		}
	});

	$effect(() => {
		if (realtimeSessionActive && realtimeSessionAssetId && realtimeSessionAssetId !== assetId) {
			closeRealtimeSession();
		}
	});

	function syncVisuals(nextMode: OrbMode, nextAmplitude: number): void {
		activeMode = nextMode;
		activeAmplitude = nextAmplitude;
	}

	function stopRecorderStream(): void {
		mediaStream?.getTracks().forEach((track) => track.stop());
		mediaStream = null;
	}

	function resetOrbState(): void {
		if (!realtimeSessionActive && !realtimeConnecting) {
			busy = false;
		}
		syncVisuals(mode, amplitude);
	}

	function supportsRealtimeDuplex(): boolean {
		return typeof RTCPeerConnection !== 'undefined';
	}

	function isTrustedLocalOrigin(hostname: string): boolean {
		return (
			hostname === 'localhost' ||
			hostname === '127.0.0.1' ||
			hostname === '[::1]' ||
			hostname.endsWith('.localhost')
		);
	}

	function getVoiceInputUnavailableReason(): string | null {
		if (typeof window === 'undefined') {
			return 'Voice input is only available in the browser.';
		}

		if (!window.isSecureContext && !isTrustedLocalOrigin(window.location.hostname)) {
			return 'Microphone capture requires HTTPS or localhost. Local-network HTTP on iPad will be blocked.';
		}

		if (!navigator.mediaDevices?.getUserMedia) {
			return 'This browser context does not expose microphone capture.';
		}

		if (!supportsRealtimeDuplex() && typeof MediaRecorder === 'undefined') {
			return 'This browser does not support either realtime voice sessions or recorded fallback audio.';
		}

		return null;
	}

	function selectRecorderMimeType(): string | undefined {
		if (typeof MediaRecorder === 'undefined') {
			return undefined;
		}

		for (const mimeType of RECORDER_MIME_CANDIDATES) {
			if (MediaRecorder.isTypeSupported(mimeType)) {
				return mimeType;
			}
		}

		return undefined;
	}

	function estimateResponseIntensity(content: string): number {
		const normalized = content.trim();
		if (!normalized) {
			return 0.58;
		}

		const exclamationCount = (normalized.match(/!/g) ?? []).length;
		const emphaticWordCount = (
			normalized.match(
				/\b(certainly|clearly|definitely|precisely|exactly|fully|complete|done|applied|updated|resolved|confirmed|ready)\b/gi
			) ?? []
		).length;
		const hedgeWordCount = (
			normalized.match(/\b(maybe|might|perhaps|possibly|should|could|likely|seems?)\b/gi) ?? []
		).length;
		const sentenceCount = Math.max(1, normalized.split(/[.!?]+/).filter(Boolean).length);
		const averageSentenceLength = normalized.length / sentenceCount;

		const intensity =
			0.58 +
			Math.min(exclamationCount, 2) * 0.08 +
			Math.min(emphaticWordCount, 3) * 0.07 +
			Math.min(averageSentenceLength / 120, 0.12) -
			Math.min(hedgeWordCount, 3) * 0.08;

		return THREE.MathUtils.clamp(intensity, 0.42, 0.96);
	}

	function summarizeHttpFailure(status: number, body: string): string {
		const trimmed = body.trim();
		if (!trimmed) {
			return `Request failed with HTTP ${status}.`;
		}

		const stripped = trimmed
			.replace(/<style[\s\S]*?<\/style>/gi, ' ')
			.replace(/<script[\s\S]*?<\/script>/gi, ' ')
			.replace(/<[^>]+>/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();

		if (!stripped) {
			return `Request failed with HTTP ${status}.`;
		}

		return `HTTP ${status}: ${stripped.slice(0, 240)}`;
	}

	async function blobToFile(blob: Blob): Promise<File> {
		const mimeType = blob.type || 'application/octet-stream';
		const extension = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('wav') ? 'wav' : 'webm';
		return new File([blob], `footer-orb.${extension}`, {
			type: mimeType
		});
	}

	function describeReplyAudioError(error: unknown): string {
		if (error instanceof DOMException && error.name === 'NotAllowedError') {
			return 'Reply audio playback was blocked by this browser session. The message still went through.';
		}

		if (error instanceof DOMException && error.name === 'NotSupportedError') {
			return 'Reply audio was returned, but this browser could not play the format.';
		}

		if (error instanceof Error && error.message.trim().length > 0) {
			return error.message;
		}

		return 'Reply audio could not be played on this device. The message still went through.';
	}

	async function playReplyAudio(payload: FooterChatAudioResponse): Promise<void> {
		if (!payload.audioBase64 || !payload.audioMimeType) {
			resetOrbState();
			return;
		}

		const binary = atob(payload.audioBase64);
		const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
		const audioBlob = new Blob([bytes], { type: payload.audioMimeType });
		const audioUrl = URL.createObjectURL(audioBlob);

		audioElement?.pause();
		if (audioElement?.src) {
			URL.revokeObjectURL(audioElement.src);
		}

		audioElement = new Audio(audioUrl);
		audioElement.onended = () => {
			URL.revokeObjectURL(audioUrl);
			audioElement = null;
			resetOrbState();
		};
		audioElement.onerror = () => {
			URL.revokeObjectURL(audioUrl);
			audioElement = null;
			resetOrbState();
			toast.error('Reply audio unavailable', {
				description:
					'The message was sent, but this browser could not play the reply audio on this device.'
			});
		};

		syncVisuals('responding', estimateResponseIntensity(payload.chat.message.content));
		try {
			await audioElement.play();
		} catch (error) {
			audioElement.pause();
			URL.revokeObjectURL(audioUrl);
			audioElement = null;
			resetOrbState();
			toast.error('Reply audio blocked', {
				description: describeReplyAudioError(error)
			});
		}
	}

	function buildRealtimeContextPayload() {
		const selectedNodeContext = getSelectedNodeContext(assetId);
		return {
			assetId,
			selectedNodeId: selectedNodeContext.selectedNodeId,
			selectedNodeName: selectedNodeContext.selectedNodeName,
			selectedNodePath: selectedNodeContext.selectedNodePath,
			selectedNodes: selectedNodeContext.selectedNodes,
			presentation: getPresentationContext(assetId),
			sidebar: getSidebarContext(assetId),
			supplementaryList: getSupplementaryListContext(assetId)
		};
	}

	function sendRealtimeEvent(event: Record<string, unknown>): void {
		realtimeDataChannel?.send(JSON.stringify(event));
	}

	function closeRealtimeSession(): void {
		realtimeToolAbortController?.abort();
		realtimeToolAbortController = null;
		realtimeDataChannel?.close();
		realtimeDataChannel = null;
		realtimePeerConnection?.close();
		realtimePeerConnection = null;
		realtimeAudioElement?.pause();
		realtimeAudioElement = null;
		stopRecorderStream();
		realtimeResponseActive = false;
		realtimeSessionActive = false;
		realtimeConnecting = false;
		realtimeSessionAssetId = undefined;
		realtimeSemanticOverlayStatus = 'unknown';
		busy = false;
		resetOrbState();
	}

	async function parseChatResponse(response: Response): Promise<FooterChatResponse> {
		const rawBody = await response.text();
		let payload: FooterChatResponse | { error?: string } | null = null;

		try {
			payload = JSON.parse(rawBody) as FooterChatResponse | { error?: string };
		} catch {
			payload = null;
		}

		if (!response.ok || !payload || !('message' in payload)) {
			throw new Error(
				payload && 'error' in payload && typeof payload.error === 'string'
					? payload.error || summarizeHttpFailure(response.status, rawBody)
					: summarizeHttpFailure(response.status, rawBody)
			);
		}

		return payload;
	}

	async function executeRealtimeVehicleRequest(requestText: string, callId: string): Promise<void> {
		const controller = new AbortController();
		realtimeToolAbortController?.abort();
		realtimeToolAbortController = controller;

		try {
			await prepareSemanticBootstrapForRequest(requestText, assetId);
			const payload = buildRealtimeContextPayload();
			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					...payload,
					message: requestText
				}),
				signal: controller.signal
			});
			const chatResponse = await parseChatResponse(response);
			const approval = await approveBulkApplication(chatResponse);
			if (!approval.approved) {
				sendRealtimeEvent({
					type: 'conversation.item.create',
					item: {
						type: 'function_call_output',
						call_id: callId,
						output: JSON.stringify({
							...chatResponse,
							message: {
								role: 'assistant',
								content: approval.blockedMessage
							},
							vehiclePatchAssetId: undefined,
							vehiclePatchLabel: undefined,
							vehiclePatchOperations: undefined,
							presentationRestore: undefined,
							selectionUpdate: undefined,
							sidebar: undefined,
							supplementaryList: undefined
						})
					}
				});
				sendRealtimeEvent({
					type: 'response.create'
				});
				return;
			}
			const ingressApproval = await approveSemanticIngressApplication(chatResponse, assetId);
			if (!ingressApproval.approved) {
				sendRealtimeEvent({
					type: 'conversation.item.create',
					item: {
						type: 'function_call_output',
						call_id: callId,
						output: JSON.stringify({
							...chatResponse,
							message: {
								role: 'assistant',
								content: ingressApproval.blockedMessage
							},
							semanticIngressBindings: undefined
						})
					}
				});
				sendRealtimeEvent({
					type: 'response.create'
				});
				return;
			}

			applyChatResponse(chatResponse, assetId);

			sendRealtimeEvent({
				type: 'conversation.item.create',
				item: {
					type: 'function_call_output',
					call_id: callId,
					output: JSON.stringify(chatResponse)
				}
			});
			sendRealtimeEvent({
				type: 'response.create'
			});
		} catch (error) {
			if (controller.signal.aborted) {
				sendRealtimeEvent({
					type: 'response.cancel'
				});
				return;
			}

			sendRealtimeEvent({
				type: 'conversation.item.create',
				item: {
					type: 'function_call_output',
					call_id: callId,
					output: JSON.stringify({
						error: error instanceof Error ? error.message : 'Realtime tool execution failed.'
					})
				}
			});
			sendRealtimeEvent({
				type: 'response.create'
			});
		} finally {
			if (realtimeToolAbortController === controller) {
				realtimeToolAbortController = null;
			}
		}
	}

	async function handleRealtimeEvent(event: Record<string, unknown>): Promise<void> {
		const type = typeof event.type === 'string' ? event.type : '';

		if (type === 'input_audio_buffer.speech_started') {
			realtimeToolAbortController?.abort();
			realtimeResponseActive = false;
			syncVisuals('listening', 0.62);
			return;
		}

		if (type === 'input_audio_buffer.speech_stopped') {
			syncVisuals('processing', 0.3);
			return;
		}

		if (type === 'output_audio_buffer.cleared') {
			realtimeResponseActive = false;
			syncVisuals('listening', 0.55);
			return;
		}

		if (type === 'response.created') {
			realtimeResponseActive = true;
			syncVisuals('processing', 0.38);
			return;
		}

		if (type === 'response.done') {
			realtimeResponseActive = false;
			syncVisuals('listening', 0.52);
			return;
		}

		if (type === 'response.function_call_arguments.done') {
			const name = typeof event.name === 'string' ? event.name : '';
			const callId = typeof event.call_id === 'string' ? event.call_id : '';
			const argumentsJson = typeof event.arguments === 'string' ? event.arguments : '{}';
			if (name !== 'execute_vehicle_request' || !callId) {
				return;
			}

			let parsedArgs: { request?: string } = {};
			try {
				parsedArgs = JSON.parse(argumentsJson) as { request?: string };
			} catch {}

			if (!parsedArgs.request?.trim()) {
				sendRealtimeEvent({
					type: 'conversation.item.create',
					item: {
						type: 'function_call_output',
						call_id: callId,
						output: JSON.stringify({
							error: 'Realtime tool request was empty.'
						})
					}
				});
				sendRealtimeEvent({
					type: 'response.create'
				});
				return;
			}

			await executeRealtimeVehicleRequest(parsedArgs.request, callId);
		}
	}

	async function startRealtimeConversation(): Promise<void> {
		if (busy || realtimeSessionActive || realtimeConnecting) {
			return;
		}

		const unavailableReason = getVoiceInputUnavailableReason();
		if (unavailableReason) {
			toast.error('Voice input unavailable', {
				description: unavailableReason
			});
			return;
		}

		realtimeConnecting = true;
		busy = true;
		realtimeSessionAssetId = assetId;

		try {
			mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const peerConnection = new RTCPeerConnection();
			realtimePeerConnection = peerConnection;

			for (const track of mediaStream.getTracks()) {
				peerConnection.addTrack(track, mediaStream);
			}

			realtimeAudioElement = new Audio();
			realtimeAudioElement.autoplay = true;
			realtimeAudioElement.setAttribute('playsinline', 'true');
			peerConnection.ontrack = (event) => {
				if (realtimeAudioElement) {
					realtimeAudioElement.srcObject = event.streams[0] ?? new MediaStream([event.track]);
					void realtimeAudioElement.play().catch(() => {});
				}
			};

			const dataChannel = peerConnection.createDataChannel('oai-events');
			realtimeDataChannel = dataChannel;
			dataChannel.onmessage = (messageEvent) => {
				try {
					const event = JSON.parse(messageEvent.data as string) as Record<string, unknown>;
					void handleRealtimeEvent(event);
				} catch {}
			};
			dataChannel.onerror = () => {
				toast.error('Voice session failed', {
					description: 'The realtime voice control channel failed.'
				});
				closeRealtimeSession();
			};
			dataChannel.onopen = () => {
				realtimeSessionActive = true;
				realtimeConnecting = false;
				busy = false;
				syncVisuals('listening', 0.58);
				toast.success('Duplex voice active', {
					description: 'Speak naturally. Speak again to interrupt the assistant, or click to end the session.'
				});
			};
			dataChannel.onclose = () => {
				closeRealtimeSession();
			};

			const sessionResponse = await fetch('/api/chat/audio/realtime', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					...buildRealtimeContextPayload()
				})
			});

			if (!sessionResponse.ok) {
				throw new Error(await sessionResponse.text());
			}

			const sessionPayload = (await sessionResponse.json()) as {
				clientSecret?: string;
				semanticOverlayStatus?: 'missing' | 'stale' | 'fresh' | 'unknown';
				error?: string;
			};
			if (!sessionPayload.clientSecret) {
				throw new Error(sessionPayload.error ?? 'Realtime session secret was missing.');
			}
			realtimeSemanticOverlayStatus = sessionPayload.semanticOverlayStatus ?? 'unknown';

			const offer = await peerConnection.createOffer();
			await peerConnection.setLocalDescription(offer);

			const sdpResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
				method: 'POST',
				body: offer.sdp ?? '',
				headers: {
					Authorization: `Bearer ${sessionPayload.clientSecret}`,
					'Content-Type': 'application/sdp'
				}
			});

			if (!sdpResponse.ok) {
				throw new Error(await sdpResponse.text());
			}

			const answerSdp = await sdpResponse.text();
			await peerConnection.setRemoteDescription({
				type: 'answer',
				sdp: answerSdp
			});
		} catch (error) {
			const resolvedError =
				error instanceof Error ? error.message : 'Realtime voice session could not be started.';
			closeRealtimeSession();
			toast.error('Voice session unavailable', {
				description: resolvedError
			});
		}
	}

	async function sendAudioMessage(audioBlob: Blob): Promise<void> {
		const file = await blobToFile(audioBlob);
		const selectedNodeContext = getSelectedNodeContext(assetId);
		const presentation = getPresentationContext(assetId);
		const sidebarContext = getSidebarContext(assetId);
		const supplementaryListContext = getSupplementaryListContext(assetId);
		beginFooterResponseCycle(assetId);
		const formData = new FormData();
		formData.set('audio', file);
		if (assetId) {
			formData.set('assetId', assetId);
		}
		if (selectedNodeContext.selectedNodeId) {
			formData.set('selectedNodeId', selectedNodeContext.selectedNodeId);
		}
		if (selectedNodeContext.selectedNodeName) {
			formData.set('selectedNodeName', selectedNodeContext.selectedNodeName);
		}
		if (selectedNodeContext.selectedNodePath) {
			formData.set('selectedNodePath', selectedNodeContext.selectedNodePath);
		}
		formData.set('selectedNodes', JSON.stringify(selectedNodeContext.selectedNodes));
		if (presentation) {
			formData.set('presentation', JSON.stringify(presentation));
		}
		formData.set('sidebar', JSON.stringify(sidebarContext));
		formData.set('supplementaryList', JSON.stringify(supplementaryListContext));

		syncVisuals('processing', 0.35);

		try {
			await sendLiveAudioMessage(formData);
			return;
		} catch {}

		await sendBufferedAudioMessage(formData);
	}

	async function sendBufferedAudioMessage(formData: FormData): Promise<void> {
		const response = await fetch('/api/chat/audio', {
			method: 'POST',
			body: formData
		});
		const rawBody = await response.text();
		let payload: FooterChatAudioResponse | { error?: string } | null = null;

		try {
			payload = JSON.parse(rawBody) as FooterChatAudioResponse | { error?: string };
		} catch {
			payload = null;
		}

		if (!response.ok || !payload || !('chat' in payload)) {
			throw new Error(
				payload && 'error' in payload && typeof payload.error === 'string'
					? payload.error || summarizeHttpFailure(response.status, rawBody)
					: summarizeHttpFailure(response.status, rawBody)
			);
		}

		const approval = await approveBulkApplication(payload.chat);
		if (!approval.approved) {
			resetOrbState();
			toast.error('Request not applied', {
				description: approval.blockedMessage
			});
			return;
		}
		const ingressApproval = await approveSemanticIngressApplication(payload.chat, assetId);
		if (!ingressApproval.approved) {
			resetOrbState();
			toast.error('Request not applied', {
				description: ingressApproval.blockedMessage
			});
			return;
		}

		applyChatResponse(payload.chat, assetId);
		toast.success('Voice request sent', {
			description: `${payload.transcript} -> ${payload.chat.message.content}`
		});
		await playReplyAudio(payload);
	}

	async function sendLiveAudioMessage(formData: FormData): Promise<void> {
		const response = await fetch('/api/chat/audio/live', {
			method: 'POST',
			body: formData,
			headers: {
				accept: 'application/x-ndjson'
			}
		});

		if (!response.ok) {
			throw new Error(await response.text());
		}

		if (!response.body) {
			throw new Error('Live audio response did not include a readable stream.');
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		let transcript = '';
		let chatPayload: FooterChatAudioResponse['chat'] | null = null;
		let chatApproved = true;

		while (true) {
			const { done, value } = await reader.read();
			buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

			let newlineIndex = buffer.indexOf('\n');
			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				if (line.length > 0) {
					const event = JSON.parse(line) as FooterChatAudioStreamEvent;

					if (event.type === 'transcribed') {
						transcript = event.transcript;
					}

					if (event.type === 'chat') {
						const approval = await approveBulkApplication(event.chat);
						if (!approval.approved) {
							chatApproved = false;
							chatPayload = {
								...event.chat,
								message: {
									role: 'assistant',
									content: approval.blockedMessage ?? 'Approval declined. No changes were applied.'
								}
							};
							toast.error('Request not applied', {
								description: chatPayload.message.content
							});
						} else {
							const ingressApproval = await approveSemanticIngressApplication(event.chat, assetId);
							if (!ingressApproval.approved) {
								chatApproved = false;
								chatPayload = {
									...event.chat,
									message: {
										role: 'assistant',
										content:
											ingressApproval.blockedMessage ??
											'Ingress approval declined. No semantic ingress changes were applied.'
									}
								};
								toast.error('Request not applied', {
									description: chatPayload.message.content
								});
								newlineIndex = buffer.indexOf('\n');
								continue;
							}
							chatPayload = event.chat;
							applyChatResponse(event.chat, assetId);
							toast.success('Voice request sent', {
								description: transcript
									? `${transcript} -> ${event.chat.message.content}`
									: event.chat.message.content
							});
						}
					}

					if (event.type === 'audio') {
						if (!chatPayload) {
							throw new Error('Live audio reply arrived before the assistant response.');
						}

						if (!chatApproved) {
							continue;
						}

						await playReplyAudio({
							transcript,
							audioBase64: event.audioBase64,
							audioMimeType: event.audioMimeType,
							audioVoice: event.audioVoice,
							chat: chatPayload
						});
					}

					if (event.type === 'error') {
						throw new Error(event.message);
					}
				}

				newlineIndex = buffer.indexOf('\n');
			}

			if (done) {
				break;
			}
		}

		if (!chatPayload) {
			throw new Error('Live audio stream ended before the assistant replied.');
		}

		if (!chatApproved) {
			resetOrbState();
		}
	}

	async function stopListening(): Promise<void> {
		if (realtimeSessionActive || realtimeConnecting) {
			closeRealtimeSession();
			return;
		}

		if (!mediaRecorder || mediaRecorder.state !== 'recording') {
			return;
		}

		syncVisuals('processing', 0.3);
		mediaRecorder.stop();
	}

	async function startListening(): Promise<void> {
		if (supportsRealtimeDuplex()) {
			await startRealtimeConversation();
			return;
		}

		if (busy) {
			return;
		}

		const unavailableReason = getVoiceInputUnavailableReason();
		if (unavailableReason) {
			toast.error('Voice input unavailable', {
				description: unavailableReason
			});
			return;
		}

		busy = true;

		try {
			mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
			recorderChunks = [];
			const recorderMimeType = selectRecorderMimeType();
			mediaRecorder = recorderMimeType
				? new MediaRecorder(mediaStream, { mimeType: recorderMimeType })
				: new MediaRecorder(mediaStream);
			mediaRecorder.ondataavailable = (event) => {
				if (event.data.size > 0) {
					recorderChunks = [...recorderChunks, event.data];
				}
			};
			mediaRecorder.onerror = () => {
				stopRecorderStream();
				resetOrbState();
				toast.error('Voice capture failed', {
					description: 'Microphone capture stopped unexpectedly.'
				});
			};
			mediaRecorder.onstop = async () => {
				const recordedBlob = new Blob(recorderChunks, {
					type: mediaRecorder?.mimeType || 'audio/webm'
				});
				stopRecorderStream();
				mediaRecorder = null;
				recorderChunks = [];

				try {
					await sendAudioMessage(recordedBlob);
				} catch (error) {
					resetOrbState();
					const resolvedError =
						error instanceof Error ? error.message : 'Unable to process the voice request.';
					toast.error('Voice request failed', {
						description: resolvedError
					});
				}
			};
			mediaRecorder.start();
			syncVisuals('listening', 0.6);
		} catch (error) {
			stopRecorderStream();
			resetOrbState();
			const resolvedError =
				error instanceof DOMException && error.name === 'NotAllowedError'
					? 'Microphone permission was denied for this site.'
					: error instanceof DOMException && error.name === 'NotSupportedError'
						? 'This browser granted the microphone but could not start a supported recording format.'
						: error instanceof Error
							? error.message
							: 'Microphone capture could not be started.';
			toast.error('Voice input unavailable', {
				description: resolvedError
			});
		}
	}

	async function toggleListening(): Promise<void> {
		if (realtimeSessionActive || realtimeConnecting || mediaRecorder?.state === 'recording') {
			await stopListening();
			return;
		}

		if (busy) {
			return;
		}

		await startListening();
	}

	// Secondary: hsl(34 75% 73%) ≈ #EBBE7A
	const SEC = new THREE.Color(0xebbe7a);
	const SEC_BRIGHT = new THREE.Color(0xffd898);
	const SEC_DIM = new THREE.Color(0xc8923a);
	const SEC_FAINT = new THREE.Color(0x8a5c18); // dim edge tone

	// Deterministic pseudo-random from an integer seed (no stdlib dependency)
	function pseudoRand(seed: number): number {
		let s = seed ^ 0x9e3779b9;
		s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
		s = Math.imul(s ^ (s >>> 13), 0xc2b2ae35);
		return ((s ^ (s >>> 16)) >>> 0) / 0xffffffff;
	}

	// Build a LineSegments geometry with per-edge vertex colors from a source
	// IcosahedronGeometry. Returns the LineSegments, the render position buffer,
	// and a lookup table: renderVertex[i] → source vertex index (for deformation).
	function buildNetGeometry(
		topoGeo: THREE.IcosahedronGeometry,
		dimFraction: number,
		dimSeed: number
	): {
		lines: THREE.LineSegments;
		renderPosBuf: THREE.BufferAttribute;
		vertToSrc: Uint16Array;
		origSrcPos: Float32Array;
	} {
		const srcPos = topoGeo.getAttribute('position') as THREE.BufferAttribute;

		// Map position string → source vertex index (icosahedron is indexed, so unique)
		const posToSrc = new Map<string, number>();
		for (let i = 0; i < srcPos.count; i++) {
			const k = `${srcPos.getX(i).toFixed(5)},${srcPos.getY(i).toFixed(5)},${srcPos.getZ(i).toFixed(5)}`;
			posToSrc.set(k, i);
		}

		const edgesGeo = new THREE.EdgesGeometry(topoGeo);
		const edgePos = edgesGeo.getAttribute('position') as THREE.BufferAttribute;
		const edgeVertCount = edgePos.count; // always even: pairs of vertices
		const edgeCount = edgeVertCount / 2;

		// For each edge-vertex, find its source icosahedron vertex index
		const vertToSrc = new Uint16Array(edgeVertCount);
		for (let i = 0; i < edgeVertCount; i++) {
			const k = `${edgePos.getX(i).toFixed(5)},${edgePos.getY(i).toFixed(5)},${edgePos.getZ(i).toFixed(5)}`;
			vertToSrc[i] = posToSrc.get(k) ?? 0;
		}

		// Snapshot original source positions
		const origSrcPos = new Float32Array(srcPos.count * 3);
		for (let i = 0; i < srcPos.count; i++) {
			origSrcPos[i * 3] = srcPos.getX(i);
			origSrcPos[i * 3 + 1] = srcPos.getY(i);
			origSrcPos[i * 3 + 2] = srcPos.getZ(i);
		}

		// Classify edges: ~dimFraction are dim (pseudo-random by edge index + seed)
		const edgeIsDim = new Uint8Array(edgeCount);
		for (let e = 0; e < edgeCount; e++) {
			if (pseudoRand(e + dimSeed * 997) < dimFraction) edgeIsDim[e] = 1;
		}

		// Build render geometry: positions + vertex colors
		const renderPosArr = new Float32Array(edgeVertCount * 3);
		const colorArr = new Float32Array(edgeVertCount * 3);

		for (let e = 0; e < edgeCount; e++) {
			const isDim = edgeIsDim[e] === 1;
			const col = isDim ? SEC_FAINT : SEC;
			for (let v = 0; v < 2; v++) {
				const vi = e * 2 + v;
				const si = vertToSrc[vi];
				renderPosArr[vi * 3] = origSrcPos[si * 3];
				renderPosArr[vi * 3 + 1] = origSrcPos[si * 3 + 1];
				renderPosArr[vi * 3 + 2] = origSrcPos[si * 3 + 2];
				colorArr[vi * 3] = col.r;
				colorArr[vi * 3 + 1] = col.g;
				colorArr[vi * 3 + 2] = col.b;
			}
		}

		const renderGeo = new THREE.BufferGeometry();
		const renderPosBuf = new THREE.BufferAttribute(renderPosArr, 3);
		renderGeo.setAttribute('position', renderPosBuf);
		renderGeo.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));

		const mat = new THREE.LineBasicMaterial({
			vertexColors: true,
			transparent: true,
			opacity: 0.5,
			linewidth: 1.35
		});

		edgesGeo.dispose();
		return { lines: new THREE.LineSegments(renderGeo, mat), renderPosBuf, vertToSrc, origSrcPos };
	}

	// Deform a net's render position buffer using radial sine displacement.
	// origSrc: base vertex positions (indexed), vertToSrc: edge-vert → src-vert.
	function deformNet(
		renderPosBuf: THREE.BufferAttribute,
		vertToSrc: Uint16Array,
		origSrc: Float32Array,
		t: number,
		freq: number,
		depth: number
	): void {
		const edgeVertCount = vertToSrc.length;
		for (let i = 0; i < edgeVertCount; i++) {
			const si = vertToSrc[i];
			const ox = origSrc[si * 3];
			const oy = origSrc[si * 3 + 1];
			const oz = origSrc[si * 3 + 2];
			const phase = ox * 3.1 + oy * 2.3 + oz * 1.7;
			const r = 1 + Math.sin(t * freq + phase) * depth;
			renderPosBuf.setXYZ(i, ox * r, oy * r, oz * r);
		}
		renderPosBuf.needsUpdate = true;
	}

	onMount(() => {
		if (!canvas) return;

		const renderSize = Math.max(96, Math.round(size));

		// ── Scene ───────────────────────────────────────────────
		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
		camera.position.z = 3.6;

		const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
		renderer.setSize(renderSize, renderSize, false);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.5));
		renderer.setClearColor(0x000000, 0);

		// ── Lighting ────────────────────────────────────────────
		scene.add(new THREE.AmbientLight(0xffeedd, 0.4));

		const keyLight = new THREE.PointLight(0xffd090, 7, 12);
		keyLight.position.set(-2.2, 2.8, 3.0);
		scene.add(keyLight);

		const rimLight = new THREE.PointLight(0xc87030, 2.5, 10);
		rimLight.position.set(2.2, -1.8, -1.5);
		scene.add(rimLight);

		// ── Depth volume sphere ──────────────────────────────────
		const volGeo = new THREE.SphereGeometry(0.88, 64, 64);
		const volMat = new THREE.MeshPhongMaterial({
			color: SEC_DIM,
			emissive: SEC_DIM,
			emissiveIntensity: 0.08,
			transparent: true,
			opacity: 0.05,
			depthWrite: false
		});
		scene.add(new THREE.Mesh(volGeo, volMat));

		// ── Outer net: r=0.90, detail=2, ~1/3 dim edges ─────────
		const outerTopoGeo = new THREE.IcosahedronGeometry(0.9, 2);
		const {
			lines: outerLines,
			renderPosBuf: outerPosBuf,
			vertToSrc: outerVertToSrc,
			origSrcPos: outerOrigSrc
		} = buildNetGeometry(outerTopoGeo, 0.33, 1);

		const outerMat = outerLines.material as THREE.LineBasicMaterial;
		outerMat.opacity = 0.5;
		scene.add(outerLines);
		outerTopoGeo.dispose();

		// ── Inner net: r=0.87, detail=1, ~1/3 dim edges ─────────
		const innerTopoGeo = new THREE.IcosahedronGeometry(0.87, 1);
		const {
			lines: innerLines,
			renderPosBuf: innerPosBuf,
			vertToSrc: innerVertToSrc,
			origSrcPos: innerOrigSrc
		} = buildNetGeometry(innerTopoGeo, 0.33, 42);

		const innerMat = innerLines.material as THREE.LineBasicMaterial;
		innerMat.opacity = 0.28;
		scene.add(innerLines);
		innerTopoGeo.dispose();

		// ── Connector spokes: 12 icosahedron vertices ────────────
		// Outer endpoints at r=0.90, inner endpoints at r=0.87
		const baseGeo = new THREE.IcosahedronGeometry(1, 0);
		const baseAttr = baseGeo.getAttribute('position');
		const seenKeys = new Set<string>();
		const spokeVerts: THREE.Vector3[] = [];

		for (let i = 0; i < baseAttr.count; i++) {
			const v = new THREE.Vector3().fromBufferAttribute(baseAttr, i).normalize();
			const key = [v.x, v.y, v.z].map((n) => n.toFixed(3)).join(',');
			if (!seenKeys.has(key)) {
				seenKeys.add(key);
				spokeVerts.push(v.clone());
			}
		}
		baseGeo.dispose();

		const OUTER_R = 0.9;
		const INNER_R = 0.87;

		const spokePts: number[] = [];
		for (const v of spokeVerts) {
			spokePts.push(v.x * OUTER_R, v.y * OUTER_R, v.z * OUTER_R);
			spokePts.push(v.x * INNER_R, v.y * INNER_R, v.z * INNER_R);
		}
		const spokeGeo = new THREE.BufferGeometry();
		const spokePosAttr = new THREE.Float32BufferAttribute(spokePts, 3);
		spokeGeo.setAttribute('position', spokePosAttr);
		const origSpoke = new Float32Array(spokePts);

		const spokeMat = new THREE.LineBasicMaterial({
			color: SEC_BRIGHT,
			transparent: true,
			opacity: 0.25
		});
		const spokeLines = new THREE.LineSegments(spokeGeo, spokeMat);
		// Spokes co-rotate with the outer net
		outerLines.add(spokeLines);

		// ── Core ─────────────────────────────────────────────────
		const coreGeo = new THREE.SphereGeometry(0.54, 16, 16);
		const coreMat = new THREE.MeshPhongMaterial({
			color: 0xffffff,
			emissive: 0xffeecc,
			emissiveIntensity: 2.8,
			transparent: true,
			opacity: 0.88
		});
		const coreMesh = new THREE.Mesh(coreGeo, coreMat);
		scene.add(coreMesh);

		// ── Animation loop ───────────────────────────────────────
		const clock = new THREE.Clock();
		let raf: number;
		let smoothedAmplitude = 0;
		let idleWeight = 1;
		let listeningWeight = 0;
		let processingWeight = 0;
		let respondingWeight = 0;

		function animate() {
			raf = requestAnimationFrame(animate);
			const delta = Math.min(clock.getDelta(), 0.05);
			const t = clock.elapsedTime;
			const m = activeMode;
			const targetAmplitude = Math.min(1, Math.max(0, activeAmplitude));
			smoothedAmplitude = THREE.MathUtils.damp(smoothedAmplitude, targetAmplitude, 5.4, delta);
			const a = smoothedAmplitude;

			idleWeight = THREE.MathUtils.damp(idleWeight, m === 'idle' ? 1 : 0, 7.5, delta);
			listeningWeight = THREE.MathUtils.damp(
				listeningWeight,
				m === 'listening' ? 1 : 0,
				7.5,
				delta
			);
			processingWeight = THREE.MathUtils.damp(
				processingWeight,
				m === 'processing' ? 1 : 0,
				7.5,
				delta
			);
			respondingWeight = THREE.MathUtils.damp(
				respondingWeight,
				m === 'responding' ? 1 : 0,
				6.25,
				delta
			);

			// Rotation
			const outerSpeed =
				idleWeight * 0.07 +
				listeningWeight * 0.22 +
				processingWeight * 0.3 +
				respondingWeight * (0.16 + a * 0.035);
			const innerSpeed =
				idleWeight * 0.1 +
				listeningWeight * 0.28 +
				processingWeight * 0.28 +
				respondingWeight * (0.2 + a * 0.04);

			outerLines.rotation.y = t * outerSpeed;
			outerLines.rotation.x = t * outerSpeed * 0.38;
			innerLines.rotation.y = -t * innerSpeed;
			innerLines.rotation.z = t * innerSpeed * 0.52;

			// Heartbeat parameters
			const heartFreq =
				idleWeight * 0.65 +
				listeningWeight * 1.9 +
				processingWeight * 3.5 +
				respondingWeight * (1.4 + a * 3.2);

			const heartDepth =
				idleWeight * 0.016 +
				listeningWeight * 0.04 +
				processingWeight * 0.03 +
				respondingWeight * (0.024 + a * 0.095);

			// Deform outer net vertices
			deformNet(outerPosBuf, outerVertToSrc, outerOrigSrc, t, heartFreq, heartDepth);

			// Sync spoke outer endpoints with deformed outer surface
			for (let i = 0; i < spokeVerts.length; i++) {
				const si = i * 6;
				const ox = origSpoke[si] / OUTER_R; // unit direction
				const oy = origSpoke[si + 1] / OUTER_R;
				const oz = origSpoke[si + 2] / OUTER_R;
				const phase = ox * 3.1 + oy * 2.3 + oz * 1.7;
				const r = 1 + Math.sin(t * heartFreq + phase) * heartDepth;
				spokePosAttr.setXYZ(i * 2, ox * r * OUTER_R, oy * r * OUTER_R, oz * r * OUTER_R);
			}
			spokePosAttr.needsUpdate = true;

			// Inner net: lighter deformation, slightly offset phase
			deformNet(
				innerPosBuf,
				innerVertToSrc,
				innerOrigSrc,
				t + 0.4,
				heartFreq * 0.8,
				heartDepth * 0.6
			);

			// Material opacity by mode
			outerMat.opacity =
				idleWeight * 0.38 +
				listeningWeight * 0.72 +
				processingWeight * 0.55 +
				respondingWeight * (0.45 + a * 0.35);

			innerMat.opacity =
				idleWeight * 0.2 +
				listeningWeight * 0.382 +
				processingWeight * 0.316 +
				respondingWeight * (0.25 + a * 0.22);

			spokeMat.opacity =
				idleWeight * 0.11 +
				listeningWeight * 0.352 +
				processingWeight * 0.256 +
				respondingWeight * (0.16 + a * 0.32);

			volMat.opacity =
				idleWeight * 0.03 +
				listeningWeight * 0.098 +
				processingWeight * 0.074 +
				respondingWeight * (0.05 + a * 0.08);

			// Keep the inner core stable; only the surrounding nets should feel active.
			coreMesh.scale.setScalar(1);
			coreMat.emissiveIntensity =
				idleWeight * 1.95 +
				listeningWeight * 3.1 +
				processingWeight * 2.8 +
				respondingWeight * (2.7 + a * 3.9);

			// Key light breathes with heartbeat
			keyLight.intensity =
				idleWeight * (5 + Math.sin(t * 0.7) * 2) +
				(listeningWeight + processingWeight + respondingWeight) *
					(6 + a * 5 + Math.sin(t * heartFreq * 0.5) * 2);

			renderer.render(scene, camera);
		}

		animate();

		return () => {
			cancelAnimationFrame(raf);
			closeRealtimeSession();
			audioElement?.pause();
			if (audioElement?.src) {
				URL.revokeObjectURL(audioElement.src);
			}
			audioElement = null;
			renderer.dispose();
			[volGeo, spokeGeo, coreGeo].forEach((g) => g.dispose());
			[outerLines, innerLines].forEach((ls) => {
				ls.geometry.dispose();
				(ls.material as THREE.Material).dispose();
			});
		};
	});
</script>

{#if interactive}
	<button
		type="button"
		class="glass-motion-color glass-motion-transform orb-shell {className}"
		class:is-active={activeMode !== 'idle'}
		class:is-busy={busy}
		class:is-processing={activeMode === 'processing'}
		style={`--orb-size: ${size};`}
		onclick={toggleListening}
		aria-label={
			realtimeSessionActive || realtimeConnecting || mediaRecorder?.state === 'recording'
				? 'Stop duplex voice session'
				: 'Start duplex voice session'
		}
		aria-pressed={realtimeSessionActive || realtimeConnecting || mediaRecorder?.state === 'recording'}
	>
		<div class="orb-processing-ring" aria-hidden="true"></div>
		<div class="orb">
			<canvas bind:this={canvas} class="orb-canvas"></canvas>
		</div>
	</button>
{:else}
	<div
		class="glass-motion-color glass-motion-transform orb-shell {className}"
		class:is-active={activeMode !== 'idle'}
		class:is-busy={busy}
		class:is-processing={activeMode === 'processing'}
		style={`--orb-size: ${size};`}
		aria-hidden="true"
	>
		<div class="orb-processing-ring" aria-hidden="true"></div>
		<div class="orb">
			<canvas bind:this={canvas} class="orb-canvas"></canvas>
		</div>
	</div>
{/if}

<style>
	.orb-shell {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.6rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--color-boundary-text) 12%, transparent);
		background:
			radial-gradient(circle at 20% 8%, color-mix(in srgb, white 4%, transparent), transparent 28%),
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--color-boundary-text) 2.5%, transparent),
				color-mix(in srgb, var(--color-boundary-text) 0.75%, transparent)
			);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, white 6%, transparent),
			0 10px 24px color-mix(in srgb, var(--color-boundary-background) 12%, transparent);
		backdrop-filter: blur(16px) saturate(106%);
		-webkit-backdrop-filter: blur(16px) saturate(106%);
		transition:
			border-color 160ms ease,
			background 160ms ease,
			box-shadow 160ms ease,
			transform 160ms ease;
		isolation: isolate;
	}

	.orb-shell::before {
		content: '';
		position: absolute;
		inset: 1px;
		border-radius: inherit;
		border: 1px solid color-mix(in srgb, var(--color-boundary-text) 6%, transparent);
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, white 4%, transparent),
				transparent 18%,
				transparent 100%
			),
			radial-gradient(
				110% 70% at 18% 0%,
				color-mix(in srgb, white 3%, transparent),
				transparent 24%
			);
		pointer-events: none;
		z-index: 0;
	}

	.orb-shell:hover,
	.orb-shell:focus-visible,
	.orb-shell.is-busy,
	.orb-shell.is-active {
		background:
			radial-gradient(
				44% 38% at 24% 18%,
				color-mix(in srgb, var(--color-boundary-secondary) 10%, transparent),
				transparent 72%
			),
			radial-gradient(
				34% 32% at 76% 30%,
				color-mix(in srgb, var(--color-boundary-secondary) 7%, transparent),
				transparent 78%
			),
			radial-gradient(circle at 20% 8%, color-mix(in srgb, white 5%, transparent), transparent 26%),
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--color-boundary-secondary) 6%, transparent),
				color-mix(in srgb, var(--color-boundary-secondary) 2%, transparent) 55%,
				color-mix(in srgb, var(--color-boundary-text) 1.25%, transparent)
			);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, white 7%, transparent),
			inset 0 0 20px color-mix(in srgb, var(--color-boundary-secondary) 5%, transparent),
			0 12px 28px color-mix(in srgb, var(--color-boundary-background) 14%, transparent);
		transform: translateY(-1px);
	}

	.orb {
		position: relative;
		z-index: 1;
		width: calc(var(--orb-size, 96) * 1px);
		height: calc(var(--orb-size, 96) * 1px);
		flex-shrink: 0;
		border-radius: 999px;
		background:
			radial-gradient(
				circle at 50% 30%,
				color-mix(in srgb, white 5%, transparent),
				transparent 52%
			),
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--color-boundary-text) 2%, transparent),
				color-mix(in srgb, var(--color-boundary-text) 0.35%, transparent)
			);
		box-shadow: none;
	}

	.orb-processing-ring {
		position: absolute;
		left: 50%;
		top: 50%;
		width: calc(var(--orb-size, 96) * 1px + 2.9rem);
		height: calc((var(--orb-size, 96) * 1px + 1.3rem) * 0.34);
		transform: translate(-50%, -50%) rotate(-16deg) scaleX(1.06);
		border-radius: 999px;
		opacity: 0;
		pointer-events: none;
		z-index: -1;
		background:
			linear-gradient(
				90deg,
				color-mix(in srgb, var(--color-boundary-secondary) 8%, transparent) 0%,
				color-mix(in srgb, var(--color-boundary-text) 24%, transparent) 18%,
				color-mix(in srgb, white 20%, transparent) 30%,
				color-mix(in srgb, var(--color-boundary-tertiary) 26%, transparent) 52%,
				color-mix(in srgb, var(--color-boundary-secondary) 34%, transparent) 74%,
				color-mix(in srgb, var(--color-boundary-text) 12%, transparent) 100%
			);
		border: 1px solid color-mix(in srgb, var(--color-boundary-text) 8%, transparent);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, white 16%, transparent),
			0 0 0 1px color-mix(in srgb, var(--color-boundary-secondary) 6%, transparent),
			0 10px 28px color-mix(in srgb, var(--color-boundary-background) 14%, transparent);
		backdrop-filter: blur(10px) saturate(112%);
		-webkit-backdrop-filter: blur(10px) saturate(112%);
		mask:
			radial-gradient(
				ellipse at center,
				transparent 0 53%,
				black 60% 72%,
				transparent 79%
			);
		-webkit-mask:
			radial-gradient(
				ellipse at center,
				transparent 0 53%,
				black 60% 72%,
				transparent 79%
			);
		transition:
			opacity 180ms ease,
			filter 180ms ease,
			transform 180ms ease;
		filter: blur(0.35px);
	}

	.orb-shell.is-processing .orb-processing-ring {
		opacity: 0.92;
		animation: orb-processing-ring-spin 4.8s linear infinite;
	}

	.orb-canvas {
		width: 100%;
		height: 100%;
		display: block;
	}

	@keyframes orb-processing-ring-spin {
		from {
			transform: translate(-50%, -50%) rotate(-16deg) scaleX(1.06);
		}

		to {
			transform: translate(-50%, -50%) rotate(344deg) scaleX(1.06);
		}
	}
</style>
