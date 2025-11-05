import { derived, writable, type Readable, type Writable } from "svelte/store";

export type ThemeMode = "light" | "dark" | "system";
export type ThemeValue = "light" | "dark";

const STORAGE_KEY = "reaclog:theme";

export interface ThemeControllerOptions {
  initialTheme?: ThemeMode;
  storage?: Storage | null;
  matchMedia?: (query: string) => MediaQueryList;
  applyTheme?: (theme: ThemeValue, mode: ThemeMode) => void;
}

export interface ThemeController {
  mode: Writable<ThemeMode>;
  theme: Readable<ThemeValue>;
  connect: () => void;
  disconnect: () => void;
  setTheme: (mode: ThemeMode) => void;
  toggle: () => void;
}

export function createThemeController(options: ThemeControllerOptions = {}): ThemeController {
  const {
    initialTheme = "system",
    storage = typeof localStorage !== "undefined" ? localStorage : null,
    matchMedia = typeof window !== "undefined" ? window.matchMedia.bind(window) : undefined,
    applyTheme = defaultApplyTheme,
  } = options;

  const mode = writable<ThemeMode>(initialTheme);
  const systemPreference = writable<ThemeValue>("light");
  const theme = derived([mode, systemPreference], ([currentMode, system]) =>
    currentMode === "system" ? system : currentMode
  );

  let connected = false;
  let cleanup: Array<() => void> = [];
  let mediaCleanup: (() => void) | null = null;
  let currentMode: ThemeMode = initialTheme;
  let currentTheme: ThemeValue = initialTheme === "dark" ? "dark" : "light";

  function connect() {
    if (connected) {
      return;
    }
    connected = true;

    if (storage) {
      const stored = storage.getItem(STORAGE_KEY) as ThemeMode | null;
      if (stored === "light" || stored === "dark" || stored === "system") {
        mode.set(stored);
      }
    }

    if (matchMedia) {
      const media = matchMedia("(prefers-color-scheme: dark)");
      const updateSystem = (matches: boolean) => {
        systemPreference.set(matches ? "dark" : "light");
      };
      updateSystem(media.matches);
      const listener = (event: MediaQueryListEvent) => updateSystem(event.matches);
      if (typeof media.addEventListener === "function") {
        media.addEventListener("change", listener);
        mediaCleanup = () => media.removeEventListener("change", listener);
      } else if (typeof media.addListener === "function") {
        media.addListener(listener);
        mediaCleanup = () => media.removeListener(listener);
      }
    }

    cleanup.push(
      mode.subscribe((value) => {
        currentMode = value;
        if (!storage) {
          return;
        }
        if (value === "system") {
          storage.removeItem(STORAGE_KEY);
        } else {
          storage.setItem(STORAGE_KEY, value);
        }
      })
    );

    cleanup.push(
      theme.subscribe((value) => {
        currentTheme = value;
        applyTheme(value, currentMode);
      })
    );
  }

  function disconnect() {
    cleanup.forEach((fn) => fn());
    cleanup = [];
    if (mediaCleanup) {
      mediaCleanup();
      mediaCleanup = null;
    }
    connected = false;
  }

  function setTheme(next: ThemeMode) {
    mode.set(next);
  }

  function toggle() {
    const next = currentTheme === "dark" ? "light" : "dark";
    mode.set(next);
  }

  return {
    mode,
    theme,
    connect,
    disconnect,
    setTheme,
    toggle,
  };
}

function defaultApplyTheme(theme: ThemeValue, mode: ThemeMode) {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.themeMode = mode;
  root.style.setProperty("color-scheme", theme);
}

export const themeController = createThemeController();
