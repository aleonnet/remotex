import { type ReactNode, useEffect, useId, useRef } from "react";
import { Glyph } from "./Glyph.tsx";
import { keepTabWithin } from "./modalFocus.ts";
import { usePreferences } from "./preferences.tsx";

// A sheet of glass hanging from the session's bar: the menu, the clipboard, the
// list of displays, the information, the preferences, the meter.
//
// It begins at the bar's own edge, which is measured and not written down a
// second time (alumia.css, `--al-chrome`, kept by SessionBar.tsx): under the bar
// with a pointer, over it on a phone held upright, where the bar is at the
// bottom. While one is open the remote screen takes no input (sessionState.ts),
// so the keyboard is the sheet's: the focus goes into it, Tab stays in it, and
// Escape closes it. Whoever opened it takes the focus back when it closes.

export function Sheet({
  title,
  kind = "sheet",
  acts,
  onClose,
  children,
}: {
  /** What the sheet is, as its heading and its name. */
  title: string;
  /**
   * A sheet with its heading and its ✕; the menu, which is a list of things to
   * press and has neither; or a wide one, for what needs the room.
   */
  kind?: "sheet" | "menu" | "list" | "wide";
  /** What the sheet's head offers besides the way out, beside its title. */
  acts?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = usePreferences();
  const sheet = useRef<HTMLDivElement>(null);
  const heading = useId();

  useEffect(() => {
    sheet.current?.focus();
  }, []);
  useEffect(() => {
    const pressed = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // A dialog over the sheet takes Escape for itself, and is the one closed.
        if (!document.querySelector("dialog[open]")) {
          onClose();
        }
      } else if (event.key === "Tab") {
        keepTabWithin(sheet.current, document.activeElement, event);
      }
    };
    document.addEventListener("keydown", pressed);
    return () => document.removeEventListener("keydown", pressed);
  }, [onClose]);

  const shape = kind === "sheet" ? "" : ` al-drop--${kind}`;
  return (
    <div
      ref={sheet}
      className={`al-drop${shape} al-glass`}
      role="dialog"
      aria-labelledby={kind === "menu" ? undefined : heading}
      aria-label={kind === "menu" ? title : undefined}
      tabIndex={-1}
    >
      {kind !== "menu" && (
        <div className="al-panelhead">
          <h2 id={heading}>{title}</h2>
          {acts && <span className="al-acts">{acts}</span>}
          <button
            type="button"
            className="al-btn al-btn--icon al-btn--quiet"
            aria-label={t("common.close")}
            title={t("common.close")}
            onClick={onClose}
          >
            <Glyph name="x" />
          </button>
        </div>
      )}
      {children}
    </div>
  );
}
