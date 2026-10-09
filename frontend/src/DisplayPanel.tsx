// Which of the remote's displays to look at.
//
// There is no state here at all. The list and the mark come from the server's
// `displays` control message, a press sends a `selectDisplay`, and the mark moves
// only when the remote reports that it moved. So a selection the remote refused —
// an unplugged screen, a capture that would not start — leaves this list agreeing
// with what is actually on screen rather than with what was pressed. The sheet
// stays open after a press, so the mark is seen to move.
//
// Standard Apple Screen Sharing (`subtype = "ard"`) sends the Mac's physical
// screens plus a "Combined Display" entry. High Performance mode sends one virtual
// display, leaving nothing to choose. A wlshare desktop sends the compositor's
// outputs, one of which it is capturing. A computer opened with two virtual
// displays sends the ones it laid out, and shows one of them or, on its "All
// Displays", the first here and the second in a browser tab of its own, which
// this sheet opens; every other session exposes one framebuffer and no list.
//
// The way to a display shown in a tab of its own is a link, and it opens in this
// browser, which is what lets its page in: it carries the sign-in, and is given
// nothing of the session's. A press shows the tab already open where there is one
// (displayTab.ts); a press the browser reads as its own, a modifier held, is left
// to it.
//
// A Mirrored session of a Mac with several screens lists them all, the mark on
// the one the Mac's stream carries, its main one, and the others unavailable:
// the stream carries the main screen whatever screen is asked for (measured on
// macOS 27, 2026-10-08; docs/apple-vnc-889.md), so a press on another would ask
// for what cannot come. The sheet says why, and the way to another screen,
// which is the Mac's Virtual mode.
//
// The gateway names a Mac's displays itself, in English; they are said in the
// page's language (serverWords.ts). A monitor's own name is said as it came.

import type { MouseEvent as ReactMouseEvent } from "react";
import { displayTabName, displayTabUrl, showDisplayTab } from "./displayTab.ts";
import { Glyph } from "./Glyph.tsx";
import { usePreferences } from "./preferences.tsx";
import type { DisplayInfo } from "./protocol.ts";
import { Sheet } from "./Sheet.tsx";
import { displayName, displayNote } from "./serverWords.ts";

/** Show the tab of display `tab`, unless the press is one the browser reads as its own. */
function pressed(event: ReactMouseEvent, tab: number) {
  const plain = !(
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey
  );
  if (plain && showDisplayTab(tab)) {
    event.preventDefault();
  }
}

export default function DisplayPanel({
  displays,
  activeId,
  mirror,
  onSelect,
  onClose,
}: {
  displays: DisplayInfo[];
  activeId: number | null;
  /** A Mirrored session: the screens other than the one carried cannot be chosen. */
  mirror: boolean;
  onSelect: (id: number) => void;
  onClose: () => void;
}) {
  const { t, said, message } = usePreferences();
  const held = mirror && displays.length > 1;
  return (
    <Sheet title={t("session.displays")} kind="list" onClose={onClose}>
      {/* `aria-pressed` rather than a radio group: these are buttons that act
          on the remote, not a form control whose value is read back on submit,
          and exactly one is pressed at a time. */}
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset draws a border and a legend, and the sheet's heading already names the list */}
      <div className="al-pick" role="group" aria-label={t("session.displays")}>
        {displays.map((display) => {
          const active = display.id === activeId;
          return (
            <button
              type="button"
              key={display.id}
              aria-pressed={active}
              disabled={held && !active}
              onClick={() => onSelect(display.id)}
            >
              {active ? <Glyph name="check" /> : <span />}
              <span>{said(displayName(display.label))}</span>
              <span className="al-small">
                {said(displayNote(display.detail))}
              </span>
            </button>
          );
        })}
      </div>
      {displays.some((display) => display.tab !== null) && (
        <div className="al-formrow">
          {displays.map(
            ({ id, label, tab }) =>
              tab !== null && (
                <a
                  key={id}
                  className="al-btn"
                  href={displayTabUrl(tab)}
                  target={displayTabName(tab)}
                  onClick={(event) => pressed(event, tab)}
                >
                  <Glyph name="app-window" />
                  <span>
                    {t("displays.opentab", { name: said(displayName(label)) })}
                  </span>
                </a>
              ),
          )}
        </div>
      )}
      {held && <p className="al-small">{message("AL-5900")}</p>}
      <p className="al-small">{t("displays.note")}</p>
    </Sheet>
  );
}
