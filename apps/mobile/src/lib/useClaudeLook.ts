import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";

export function useClaudeLook(): boolean {
  return useAppearancePreferences().themeId === "claude";
}
