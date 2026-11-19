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

function fingerprint(theme: unknown): string {
  let hash = 0;
  for (const char of JSON.stringify(theme)) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  return String(hash);
}

/** Selects the fork theme on a fresh profile, then refreshes the stored copy whenever a build ships a changed one. */
export function seedForkDefaultTheme(storage: SeedStorage, theme: unknown): boolean {
  if (!isObject(theme) || typeof theme.id !== "string") return false;
  const mark = fingerprint(theme);
  const seeded = storage.getItem(SEEDED_KEY);
  if (seeded === mark) return false;
  if (seeded === null && storage.getItem(THEME_KEY) !== null) return false;
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
  const isForkTheme = (entry: unknown) => isObject(entry) && entry.id === id;
  if (seeded === null) {
    if (!stored.some(isForkTheme)) {
      storage.setItem(CUSTOM_THEMES_KEY, JSON.stringify([...stored, theme]));
    }
    storage.setItem(THEME_KEY, id);
    if (storage.getItem(APPEARANCE_MODE_KEY) === null) {
      storage.setItem(APPEARANCE_MODE_KEY, "system");
    }
  } else if (stored.some(isForkTheme)) {
    storage.setItem(
      CUSTOM_THEMES_KEY,
      JSON.stringify(stored.map((entry) => (isForkTheme(entry) ? theme : entry))),
    );
  }
  storage.setItem(SEEDED_KEY, mark);
  return true;
}
