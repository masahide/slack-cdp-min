
// this file is generated — do not edit it


declare module "svelte/elements" {
	export interface HTMLAttributes<T> {
		'data-sveltekit-keepfocus'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-noscroll'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-preload-code'?:
			| true
			| ''
			| 'eager'
			| 'viewport'
			| 'hover'
			| 'tap'
			| 'off'
			| undefined
			| null;
		'data-sveltekit-preload-data'?: true | '' | 'hover' | 'tap' | 'off' | undefined | null;
		'data-sveltekit-reload'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-replacestate'?: true | '' | 'off' | undefined | null;
	}
}

export {};


declare module "$app/types" {
	export interface AppTypes {
		RouteId(): "/" | "/__tests__" | "/day" | "/day/[date]" | "/day/[date]/__tests__" | "/day/[date]/raw" | "/day/[date]/raw/__tests__";
		RouteParams(): {
			"/day/[date]": { date: string };
			"/day/[date]/__tests__": { date: string };
			"/day/[date]/raw": { date: string };
			"/day/[date]/raw/__tests__": { date: string }
		};
		LayoutParams(): {
			"/": { date?: string };
			"/__tests__": Record<string, never>;
			"/day": { date?: string };
			"/day/[date]": { date: string };
			"/day/[date]/__tests__": { date: string };
			"/day/[date]/raw": { date: string };
			"/day/[date]/raw/__tests__": { date: string }
		};
		Pathname(): "/" | "/__tests__" | "/__tests__/" | "/day" | "/day/" | `/day/${string}` & {} | `/day/${string}/` & {} | `/day/${string}/__tests__` & {} | `/day/${string}/__tests__/` & {} | `/day/${string}/raw` & {} | `/day/${string}/raw/` & {} | `/day/${string}/raw/__tests__` & {} | `/day/${string}/raw/__tests__/` & {};
		ResolvedPathname(): `${"" | `/${string}`}${ReturnType<AppTypes['Pathname']>}`;
		Asset(): string & {};
	}
}