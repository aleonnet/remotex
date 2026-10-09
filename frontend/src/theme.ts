// Light or dark: the system's, until the person chooses one here.
//
// The tokens are written under `[data-al-theme="light"]` and
// `[data-al-theme="dark"]` (design/tokens.css), so the theme is that attribute on
// the document's root, always one of the two: "system" is a choice, and what it
// resolves to is what the attribute says.

/** What the preferences offer. */
export type ThemeChoice = "system" | "light" | "dark";

/** What the page is painted in. */
export type Theme = "light" | "dark";

/** The choices, in the order the preferences show them. */
export const THEME_CHOICES: readonly ThemeChoice[] = [
  "system",
  "light",
  "dark",
];

/** The choice kept in this browser, or the system's where there is none. */
export function chooseTheme(stored: string | null): ThemeChoice {
  return THEME_CHOICES.find((choice) => choice === stored) ?? "system";
}

/** The theme a choice comes to, on a system that is dark or not. */
export function resolveTheme(choice: ThemeChoice, systemDark: boolean): Theme {
  if (choice === "system") {
    return systemDark ? "dark" : "light";
  }
  return choice;
}
