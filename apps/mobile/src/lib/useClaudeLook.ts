import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";
import { themeFontFamilies, type FontFamilies } from "./fontFamilies";

export function useFontFamilies(): FontFamilies {
  return themeFontFamilies(useAppearancePreferences().themeId);
}
