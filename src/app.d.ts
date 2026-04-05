declare module 'drizzle-orm/pg-core' {
	export const integer: (...args: unknown[]) => any;
	export const pgTable: (...args: unknown[]) => any;
	export const serial: (...args: unknown[]) => any;
	export const text: (...args: unknown[]) => any;
}

declare module 'drizzle-orm/postgres-js' {
	export const drizzle: (...args: unknown[]) => any;
}

declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
