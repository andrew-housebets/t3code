import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";
import { themeFontFamilies, type FontFamilies } from "./fontFamilies";

export function useClaudeLook(): boolean {
  return useAppearancePreferences().themeId === "claude";
}

export function useFontFamilies(): FontFamilies {
  return themeFontFamilies(useAppearancePreferences().themeId);
}
