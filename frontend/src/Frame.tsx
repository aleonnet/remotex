import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Glyph } from "./Glyph.tsx";
import { type Glass, mountGlass } from "./glass.ts";
import { PreferencesPanel } from "./PreferencesPanel.tsx";
import { usePreferences } from "./preferences.tsx";

// What the screens before a session share: the unlit glass behind them, the mark
// and the gear at the top, and a foot. "Cannot start" has neither gear nor foot:
// there is nothing to prefer in a page that will not run.
//
// The mark is the product's and always says "alumia". The name a deployment
// gives itself (`[branding]`) is the sign-in's title, not this.

const PREFERENCES_ID = "al-prefs";

export function Frame({
  children,
  foot,
  notice,
  onSignOut,
  busy = false,
  gear: withGear = true,
  top,
}: {
  children: ReactNode;
  foot?: ReactNode;
  /** The app's notice, pinned at the top over whatever it interrupted. */
  notice?: ReactNode;
  /** Ends the login: offered in the preferences where there is one to end. */
  onSignOut?: () => void;
  /** Something is under way that a sign-out must not cut across. */
  busy?: boolean;
  /** Whether the preferences are offered, under the gear. */
  gear?: boolean;
  /**
   * What stands at the top in the mark's place: the way back, on a page that
   * was opened from another.
   */
  top?: ReactNode;
}) {
  const { t, painted } = usePreferences();
  const scene = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const gear = useRef<HTMLButtonElement>(null);
  const glass = useRef<Glass | null>(null);
  // Whether the glass is drawn, or the still stands in for it: null until asked.
  const [drawn, setDrawn] = useState<boolean | null>(null);
  const [preferences, setPreferences] = useState(false);

  useEffect(() => {
    if (!canvas.current || !scene.current) {
      return;
    }
    const mounted = mountGlass(canvas.current, scene.current);
    glass.current = mounted;
    setDrawn(mounted !== null);
    return () => {
      mounted?.release();
      glass.current = null;
    };
  }, []);

  // Its colours are the theme's, so a change of theme is drawn again. `painted`
  // is read by the drawing from the document, and named here as what changed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => glass.current?.draw(), [painted, drawn]);

  // Closing gives the focus back to the gear, which is where it came from.
  const closePreferences = useCallback(() => {
    setPreferences(false);
    gear.current?.focus();
  }, []);

  return (
    <div className="al" ref={scene}>
      {/* Decoration, behind everything and out of a screen reader's way. */}
      <div className="al-fx" aria-hidden="true" hidden={drawn === false}>
        <canvas ref={canvas} />
      </div>
      {drawn === false && <div className="al-still" />}
      <div className="al-scene">
        <header className="al-top">
          {top ?? (
            <span className="al-brand">
              <span className="al-mark" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="al-wordmark">alumia</span>
            </span>
          )}
          {withGear && (
            <button
              ref={gear}
              type="button"
              className="al-btn al-btn--icon al-btn--quiet"
              aria-label={t("prefs.title")}
              title={t("prefs.title")}
              aria-expanded={preferences}
              aria-controls={PREFERENCES_ID}
              onClick={() => setPreferences((open) => !open)}
            >
              <Glyph name="settings" />
            </button>
          )}
        </header>
        <main className="al-page">{children}</main>
        {foot && <footer className="al-foot">{foot}</footer>}
        {notice}
        {preferences && (
          <PreferencesPanel
            id={PREFERENCES_ID}
            onClose={closePreferences}
            onSignOut={onSignOut}
            busy={busy}
          />
        )}
      </div>
    </div>
  );
}
