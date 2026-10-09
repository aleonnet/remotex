import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import {
  chooseTheme,
  resolveTheme,
  type Theme,
  type ThemeChoice,
} from "./theme.ts";
import {
  type Code,
  chooseLanguage,
  type Fill,
  type Language,
  say,
  sayWords,
  type WordKey,
  type Words,
} from "./words.ts";

// The two things a person chooses about the page itself, its language and its
// theme, kept in this browser and held for every screen that reads them.
//
// localStorage rather than sessionStorage: they are lasting choices about how
// this page is read on this machine, like what was chosen under each computer
// (targetChoices.ts). A browser that keeps no storage still gets its own
// language and the system's theme, and a choice made there holds for the page.

const LANGUAGE_KEY = "alumia.language";
const THEME_KEY = "alumia.theme";
const SYSTEM_DARK = "(prefers-color-scheme: dark)";

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage disabled or blocked
  }
}

function keep(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not persisted; the choice still holds for this page.
  }
}

function storedLanguage(): Language {
  return chooseLanguage(stored(LANGUAGE_KEY), navigator.languages);
}

function storedTheme(): ThemeChoice {
  return chooseTheme(stored(THEME_KEY));
}

function paint(language: Language, theme: Theme): void {
  document.documentElement.lang = language;
  document.documentElement.dataset.alTheme = theme;
  // The colour a browser paints its own chrome in around the page it installed
  // (`theme-color`, index.html): the surface of the theme just painted, read
  // from the tokens rather than written a second time.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      "content",
      getComputedStyle(document.documentElement)
        .getPropertyValue("--al-surface-base")
        .trim(),
    );
}

/**
 * Put the kept language and theme on the document, before anything is rendered:
 * the first screen is painted in them rather than corrected to them.
 */
export function applyPreferences(): void {
  paint(
    storedLanguage(),
    resolveTheme(storedTheme(), matchMedia(SYSTEM_DARK).matches),
  );
}

interface Preferences {
  language: Language;
  setLanguage: (language: Language) => void;
  /** What was chosen: the system's, or one of the two. */
  theme: ThemeChoice;
  setTheme: (theme: ThemeChoice) => void;
  /** What the page is painted in, which the unlit glass is drawn from. */
  painted: Theme;
  /** A word of the interface, in the language chosen. */
  t: (key: WordKey, fill?: Fill) => string;
  /** Words or data, as the page says either. */
  said: (words: Words) => string;
  /**
   * A message of the error catalogue, in the language chosen: the words of
   * `cause` where the catalogue knows it, and of `place`'s general code where it
   * does not. It is asked for with its place, written out as a code where it
   * is shown, and never through `t`, which takes no code: that is what lets
   * tools/check-design.py find every place a message appears and hold the
   * catalogue to it.
   */
  message: (place: Code, cause?: Code, fill?: Fill) => string;
}

const PreferencesContext = createContext<Preferences | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState(storedLanguage);
  const [theme, setThemeState] = useState(storedTheme);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia(SYSTEM_DARK).matches,
  );

  // The system's theme can change under an open page, and "system" follows it.
  useEffect(() => {
    const query = matchMedia(SYSTEM_DARK);
    const changed = () => setSystemDark(query.matches);
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);

  const painted = resolveTheme(theme, systemDark);
  // Before any effect of what is drawn under this: the glass reads the theme off
  // the document as it draws (glass.ts), in an effect of its own, and an effect
  // of a child runs before its parent's. Written in an effect here, the theme
  // reached the document after the glass had drawn itself in the one before.
  useLayoutEffect(() => paint(language, painted), [language, painted]);

  const setLanguage = useCallback((next: Language) => {
    keep(LANGUAGE_KEY, next);
    setLanguageState(next);
  }, []);
  const setTheme = useCallback((next: ThemeChoice) => {
    keep(THEME_KEY, next);
    setThemeState(next);
  }, []);

  const value = useMemo<Preferences>(
    () => ({
      language,
      setLanguage,
      theme,
      setTheme,
      painted,
      t: (key, fill) => say(language, key, fill),
      said: (words) => sayWords(language, words),
      message: (place, cause, fill) => say(language, cause ?? place, fill),
    }),
    [language, setLanguage, theme, setTheme, painted],
  );
  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): Preferences {
  const preferences = useContext(PreferencesContext);
  if (!preferences) {
    throw new Error("usePreferences is used outside PreferencesProvider");
  }
  return preferences;
}
