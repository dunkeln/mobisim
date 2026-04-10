import { toast as sonnerToast } from 'svelte-sonner';

import type { ExternalToast, ToastOptions } from 'svelte-sonner';

function resolveToastDescription(data?: ExternalToast): string | null {
	if (typeof data?.description === 'string') {
		return data.description;
	}

	return null;
}

export const toast = {
	...sonnerToast,
	error(message: string, data?: ExternalToast) {
		console.error('sonner error', {
			message,
			description: resolveToastDescription(data),
			toast: data
		});

		return sonnerToast.error(message, data);
	}
};

export type { ExternalToast, ToastOptions };
