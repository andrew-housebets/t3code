const FONT_FAMILIES = {
  regular: "DMSans-Regular",
  medium: "DMSans-Medium",
  bold: "DMSans-Bold",
} as const;

export const SYSTEM_FONT_FAMILY = "System";

const SYSTEM_FONT_FAMILIES = {
  regular: SYSTEM_FONT_FAMILY,
  medium: SYSTEM_FONT_FAMILY,
  bold: SYSTEM_FONT_FAMILY,
} as const;

export type FontFamilies = {
  readonly regular: string;
  readonly medium: string;
  readonly bold: string;
};

export function themeFontFamilies(themeId: string): FontFamilies {
  return themeId === "claude" ? SYSTEM_FONT_FAMILIES : FONT_FAMILIES;
}
