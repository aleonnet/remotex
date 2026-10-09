import { type ReactNode, useId, useLayoutEffect, useRef } from "react";

// A dialog: what interrupts, for a decision that has to be made before anything
// else happens. Five are drawn with it: a confirmation, a destructive one, an
// error that ended something, a permission the browser is about to ask for, and
// an acknowledgement.
//
// It is the browser's own <dialog>, opened with showModal(), as the design
// system asks (docs/design/2026-10-03-0003-design-system.md, "Diálogos"): the
// browser keeps the focus inside it, makes the rest of the page inert, and gives
// the focus back to whatever had it when it closes. Esc is Cancel, where there is
// one to give; a dialog with a single way on is not closed by Esc. In a
// destructive dialog the focus starts on Cancel, which is what `autoFocus` on
// that button is for.

export function Dialog({
  title,
  children,
  acts,
  alert = false,
  onCancel,
}: {
  title: string;
  /** What will happen, in a sentence or two. */
  children: ReactNode;
  /** The buttons, each a verb, the main one last. */
  acts: ReactNode;
  /** Something went wrong or is about to be lost: announced as an alert. */
  alert?: boolean;
  /** What Esc does. Left out, Esc does nothing: there is only one way on. */
  onCancel?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();

  // A layout effect, for its cleanup: it runs while the dialog is still in the
  // page, which is when closing it gives the focus back. A dialog taken out of
  // the page while open gives the focus to nothing.
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) {
      return;
    }
    element.showModal();
    return () => element.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="al-dialog"
      role={alert ? "alertdialog" : undefined}
      aria-labelledby={heading}
      onClose={() => {
        // A browser may close a dialog by itself: a second Escape with nothing
        // pressed in between is not the page's to refuse. Closed that way it is
        // Cancel where there is one, and where there is a single way on it is
        // put back, so the page and the screen never disagree about it.
        const element = dialog.current;
        if (!element || element.open) {
          return;
        }
        if (onCancel) {
          onCancel();
        } else {
          element.showModal();
        }
      }}
      onCancel={(event) => {
        // The page decides what closing means, and unmounts this when it has.
        event.preventDefault();
        onCancel?.();
      }}
    >
      <h2 id={heading}>{title}</h2>
      {children}
      <div className="al-dialogacts">{acts}</div>
    </dialog>
  );
}
