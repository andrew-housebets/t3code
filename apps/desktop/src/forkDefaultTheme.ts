interface SeedStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const THEME_KEY = "t3code:theme";
const CUSTOM_THEMES_KEY = "t3code:themes:v1";
const APPEARANCE_MODE_KEY = "t3code:theme-appearance-mode";
const SEEDED_KEY = "t3code:fork-default-theme-seeded";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function seedForkDefaultTheme(storage: SeedStorage, theme: unknown): boolean {
  if (!isObject(theme) || typeof theme.id !== "string") return false;
  if (storage.getItem(SEEDED_KEY) !== null || storage.getItem(THEME_KEY) !== null) return false;
  const raw = storage.getItem(CUSTOM_THEMES_KEY);
  let stored: unknown[] = [];
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return false;
      stored = parsed;
    } catch {
      return false;
    }
  }
  const id = theme.id;
  if (!stored.some((entry) => isObject(entry) && entry.id === id)) {
    storage.setItem(CUSTOM_THEMES_KEY, JSON.stringify([...stored, theme]));
  }
  storage.setItem(THEME_KEY, id);
  if (storage.getItem(APPEARANCE_MODE_KEY) === null) storage.setItem(APPEARANCE_MODE_KEY, "system");
  storage.setItem(SEEDED_KEY, "1");
  return true;
}
