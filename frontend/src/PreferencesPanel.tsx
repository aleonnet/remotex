import { useEffect, useRef } from "react";
import { AppVersion } from "./AppVersion.tsx";
import { Glyph } from "./Glyph.tsx";
import { usePreferences } from "./preferences.tsx";
import { THEME_CHOICES, type ThemeChoice } from "./theme.ts";
import { LANGUAGES, type Language, type WordKey } from "./words.ts";

// The preferences, under the gear: the theme, the language and the version, and
// past the sign-in the way out.
//
// A panel beside what it was opened over, not a dialog that takes the page: both
// choices show their effect on the page behind it as they are made. Escape and
// the ✕ close it, and so does the gear that opened it (Frame.tsx).
//
// In a session the same two choices hang from the bar, on glass (SessionBar.tsx):
// `PreferencesChoices` is what the two share.

const THEME_WORD: Record<ThemeChoice, WordKey> = {
  system: "prefs.theme.system",
  light: "prefs.theme.light",
  dark: "prefs.theme.dark",
};

// A language is named in itself, whatever language the page is in: somebody who
// cannot read the page has to be able to find their own.
const LANGUAGE_NAME: Record<Language, string> = {
  "pt-BR": "Português (Brasil)",
  "en-US": "English (US)",
};

/** The theme and the language, each a choice of a few side by side. */
export function PreferencesChoices() {
  const { t, language, setLanguage, theme, setTheme } = usePreferences();
  return (
    <>
      <div className="al-field">
        <span className="al-small" id="al-prefs-theme">
          {t("prefs.theme")}
        </span>
        {/* biome-ignore lint/a11y/useSemanticElements: a fieldset draws its legend into its border, and this group's name is a line above it */}
        <span className="al-seg" role="group" aria-labelledby="al-prefs-theme">
          {THEME_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              aria-pressed={theme === choice}
              onClick={() => setTheme(choice)}
            >
              {t(THEME_WORD[choice])}
            </button>
          ))}
        </span>
      </div>
      <div className="al-field">
        <span className="al-small" id="al-prefs-language">
          {t("prefs.language")}
        </span>
        {/* biome-ignore lint/a11y/useSemanticElements: as above */}
        <span
          className="al-seg"
          role="group"
          aria-labelledby="al-prefs-language"
        >
          {LANGUAGES.map((choice) => (
            <button
              key={choice}
              type="button"
              lang={choice}
              aria-pressed={language === choice}
              onClick={() => setLanguage(choice)}
            >
              {LANGUAGE_NAME[choice]}
            </button>
          ))}
        </span>
      </div>
    </>
  );
}

export function PreferencesPanel({
  id,
  onClose,
  onSignOut,
  busy,
}: {
  /** The panel's id, which the gear names as what it controls. */
  id: string;
  onClose: () => void;
  /** Ends the login, where there is one to end: absent on the sign-in. */
  onSignOut?: () => void;
  /** An Open is waiting on the server: the way out waits with it. */
  busy: boolean;
}) {
  const { t } = usePreferences();
  const close = useRef<HTMLButtonElement>(null);

  // Focus starts inside, so Tab goes on from the panel and not from the gear
  // behind it.
  useEffect(() => close.current?.focus(), []);
  useEffect(() => {
    const pressed = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", pressed);
    return () => document.removeEventListener("keydown", pressed);
  }, [onClose]);

  return (
    <div
      className="al-pop"
      id={id}
      role="dialog"
      aria-labelledby="al-prefs-title"
    >
      <div className="al-panelhead">
        <h2 id="al-prefs-title">{t("prefs.title")}</h2>
        <button
          ref={close}
          type="button"
          className="al-btn al-btn--icon al-btn--quiet"
          aria-label={t("common.close")}
          title={t("common.close")}
          onClick={onClose}
        >
          <Glyph name="x" />
        </button>
      </div>
      <PreferencesChoices />
      {onSignOut && (
        <div>
          <button
            type="button"
            className="al-btn"
            onClick={onSignOut}
            disabled={busy}
          >
            <Glyph name="log-out" />
            <span>{t("common.signout")}</span>
          </button>
        </div>
      )}
      <AppVersion className="al-small" />
    </div>
  );
}
