import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AppVersion } from "./AppVersion.tsx";
import { appWindow, onAppWindowChange } from "./appWindow.ts";
import { ClipboardPanel } from "./ClipboardPanel.tsx";
import type { SessionKind } from "./connectionLabel.ts";
import { Dialog } from "./Dialog.tsx";
import DisplayPanel from "./DisplayPanel.tsx";
import { sizeWindowToDesktop } from "./desktopWindow.ts";
import { type Fault, fillOf, type Told } from "./fault.ts";
import {
  fullscreenSupported,
  isFullscreen,
  onFullscreenChange,
  toggleFullscreen,
} from "./fullscreen.ts";
import { Glyph, type GlyphName } from "./Glyph.tsx";
import { InfoSheet } from "./InfoSheet.tsx";
import { lookOf } from "./Message.tsx";
import type { AudioStreamInfo, VideoStreamInfo } from "./mediaLabel.ts";
import { PreferencesChoices } from "./PreferencesPanel.tsx";
import { usePreferences } from "./preferences.tsx";
import type {
  ClipboardSnapshot,
  DisplayInfo,
  HoldCause,
  RemoteClipboard,
} from "./protocol.ts";
import { Sheet } from "./Sheet.tsx";
import { SoftKeyboardPanel } from "./SoftKeyboardPanel.tsx";
import {
  type BarItem,
  barItems,
  type Handle,
  handleOf,
  type MoreItem,
  macKeysState,
  moreItems,
  mutedHere,
  muteGlyph,
  type Offers,
  type Open,
  offerState,
  veilOf,
  viewOnly,
} from "./sessionState.ts";
import { keyboardFormat } from "./softKeyboard.ts";
import ThroughputPanel, { useThroughputAvailable } from "./ThroughputPanel.tsx";
import {
  CAN_PINCH_ZOOM,
  densityLabel,
  type RemoteSize,
  sizeFollows,
} from "./useRemoteDesktop.ts";
import type { Code } from "./words.ts";

// The session's bar: a handle of glass at the top of the remote screen, which
// opens into the bar, and everything that hangs from it.
//
// The remote screen is edge to edge under it. What the bar offers is what the
// session has (sessionState.ts): a button with nothing to act on is absent, not
// greyed. Its menu, the clipboard, the list of displays, the information, the
// preferences and the meter each open as a sheet of glass from the bar's edge,
// one at a time; while one is open the remote takes no input and a line says so.
// The bar by itself leaves the remote live, and so does the keyboard, which is
// input. What goes wrong with the sound, the camera, the microphone or the full
// screen is said hanging from the bar, with what to do about it; with the bar
// closed, the handle carries a mark for it.
//
// Nothing in a session changes what the session was started with: its size, its
// sound, a passthrough. Mute is this browser's listening and no more.
//
// A display shown in a tab of its own, beside the session's page, has the same
// handle and the same bar with what is that tab's and no more: its own full
// screen, what its display is drawn at, and Disconnect, which stops showing the
// display here and ends nothing. The handle wears the display's number.

/** The sound, the camera or the microphone: what the bar is told of each. */
interface Offered {
  available: boolean;
  enabled: boolean;
  /** Why it stopped, when it did. */
  fault: Fault | null;
  onChange: (enabled: boolean) => void;
}

export interface SessionBarProps {
  /** The computer the session is on. */
  name: string;
  kind: SessionKind | null;
  size: RemoteSize | null;
  hostScale: number;
  renderPlan: string;
  oversize: HoldCause | null;
  displays: DisplayInfo[];
  activeDisplayId: number | null;
  onSelectDisplay: (id: number) => void;
  sound: Offered & { stream: AudioStreamInfo | null };
  videoStream: VideoStreamInfo | null;
  /** `streaming` is the remote using it now, as against merely offered it. */
  camera: Offered & { streaming: boolean };
  microphone: Offered & { streaming: boolean };
  macKeys: {
    /** This keyboard has a Command key. */
    host: boolean;
    remoteIsMac: boolean;
    enabled: boolean;
    onChange: (enabled: boolean) => void;
  };
  touch: {
    offered: boolean;
    enabled: boolean;
    /** Fingers reach the remote as touches now. */
    active: boolean;
    onChange: (enabled: boolean) => void;
  };
  remoteClipboard: RemoteClipboard | null;
  onFetchClipboard: () => Promise<ClipboardSnapshot | null>;
  onSendClipboard: (text: string) => void;
  sendKeyCombo: (codes: string[]) => void;
  /** The height the keyboard covers at the bottom of a phone, for the picture to end above it. */
  onKeyboardInset: (px: number) => void;
  /** A chord this bar took for itself, told to the input path. See useRemoteDesktop. */
  onLocalShortcut: () => void;
  /** Hands the keyboard back to the remote screen, where the key listeners live. */
  onFocusDesktop: () => void;
  /** Whether something of the bar's makes the remote take no input. */
  onViewOnlyChange: (viewOnly: boolean) => void;
  onEnd: () => void;
  onSignOut: () => void;
  onUnauthorized: () => void;
  /** The display this page shows in a tab of its own, or null on the session's page. */
  tab: number | null;
  /** Stops showing that display in this tab. */
  onDisconnect: () => void;
  /** What covers the remote screen, under the bar. */
  children: ReactNode;
}

/** One line of the menu. */
function Item({
  glyph,
  name,
  experimental = false,
  state,
  pressed,
  title,
  onPress,
}: {
  glyph: GlyphName;
  name: string;
  experimental?: boolean;
  /** What it is doing, in a word, beside the name. */
  state?: ReactNode;
  pressed?: boolean;
  title?: string;
  /** Left out for a line that cannot be pressed: it says why in its title. */
  onPress?: () => void;
}) {
  const { t } = usePreferences();
  const line = (
    <>
      <Glyph name={glyph} />
      <span className="al-itemname">
        <span>{name}</span>
        {experimental && (
          <>
            {" "}
            <span className="al-tag">{t("tag.experimental")}</span>
          </>
        )}
      </span>
      {state}
    </>
  );
  return onPress ? (
    <button
      type="button"
      className="al-moreitem"
      aria-pressed={pressed}
      title={title}
      onClick={onPress}
    >
      {line}
    </button>
  ) : (
    // biome-ignore lint/a11y/useSemanticElements: a disabled button says nothing of why; this line is read, and its title says it
    <div
      className="al-moreitem"
      role="button"
      aria-disabled="true"
      tabIndex={0}
      title={title}
    >
      {line}
    </div>
  );
}

/** A camera's or a microphone's state beside its name: the word, and the whole sentence for whoever asks. */
function OfferedState({
  offered,
  streaming,
  waiting,
  inUse,
}: {
  offered: boolean;
  streaming: boolean;
  /** The catalogue's sentence for each state. */
  waiting: string;
  inUse: string;
}) {
  const { t } = usePreferences();
  const state = offerState(offered, streaming);
  if (state === "off") {
    return null;
  }
  return state === "inuse" ? (
    <span className="al-itemstate al-live" title={inUse}>
      <Glyph name="circle-check" />
      <span>{t("state.inuse")}</span>
      <span className="al-sr">{inUse}</span>
    </span>
  ) : (
    <span className="al-itemstate" title={waiting}>
      <span>{t("state.waiting")}</span>
      <span className="al-sr">{waiting}</span>
    </span>
  );
}

/** Something that stopped, said hanging from the bar, with what to do about it. */
function Said({
  code,
  detail,
  children,
  onAgain,
}: {
  /** The cause, or the place's general code where there is none. */
  code: Code;
  /**
   * What whoever failed said of it, in their own words: beside the code for
   * whoever asks, and never in the sentence.
   */
  detail?: string;
  /** The sentence. */
  children: ReactNode;
  /** Turns it on again, where that is what there is to do. */
  onAgain?: () => void;
}) {
  const { t } = usePreferences();
  const look = lookOf(code);
  return (
    <>
      <p className={`al-msg${look.tone}`}>
        <Glyph name={look.glyph} />
        <span>
          <span>{children}</span>{" "}
          <span className="al-code" title={detail}>
            {code}
          </span>
        </span>
      </p>
      {onAgain && (
        <div className="al-acts">
          <button type="button" className="al-btn" onClick={onAgain}>
            {t("common.turnon")}
          </button>
        </div>
      )}
    </>
  );
}

// The chord that hides the handle, and with it the bar and what hangs from it.
// The middle modifier is the host's: Command on a Mac, where Option is a
// character-composing key and Ctrl+Alt chords are Windows vocabulary, and Alt
// everywhere else. Whichever it is, the *other* one has to be absent, so all four
// held — a Mac user's own Cmd+Ctrl+Alt+Shift+; hyper chord — stays theirs.
function isHideChord(event: KeyboardEvent, macHost: boolean): boolean {
  const middle = macHost
    ? event.metaKey && !event.altKey
    : event.altKey && !event.metaKey;
  return (
    event.code === "Semicolon" && event.ctrlKey && event.shiftKey && middle
  );
}

/**
 * Whether the handle is hidden by its chord, which is taken before the remote's
 * input path sees it. Not kept: a reload brings the handle back.
 */
function useHidden(macHost: boolean, onLocalShortcut: () => void): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const pressed = (event: KeyboardEvent) => {
      if (!isHideChord(event, macHost)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      // Command is held and the key it was held with has just been taken by this
      // page, so the input path never saw the chord and would read Command's
      // release as a bare tap — which is how the remote's Start menu opens.
      // Hiding a handle must not do that. See macKeys.ts.
      if (macHost) {
        onLocalShortcut();
      }
      setHidden((was) => !was);
    };
    window.addEventListener("keydown", pressed, { capture: true });
    return () =>
      window.removeEventListener("keydown", pressed, { capture: true });
  }, [macHost, onLocalShortcut]);
  return hidden;
}

/**
 * Tell the input path that the remote takes no input, for as long as it does
 * not. The input path is the other side of the page, so this is told rather than
 * read; turning it off again is the effect's cleanup, so there is no path where
 * the bar goes away and the remote stays inert.
 */
function useViewOnly(blocked: boolean, report: (viewOnly: boolean) => void) {
  useEffect(() => {
    if (!blocked) {
      return;
    }
    report(true);
    return () => report(false);
  }, [blocked, report]);
}

/**
 * The height of what `element` holds, which is where a sheet begins: measured,
 * not written down a second time. `when` names what changes it.
 */
function useHeight(
  element: RefObject<HTMLElement | null>,
  when: string,
): number {
  const [height, setHeight] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `when` is what puts another element behind the ref
  useEffect(() => {
    const measured = element.current;
    if (!measured) {
      return;
    }
    const measure = () => setHeight(measured.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(measured);
    return () => observer.disconnect();
  }, [element, when]);
  return height;
}

/**
 * What was measured, for the stylesheet to lay the sheets out by (alumia.css):
 * where the bar ends, and how tall the view-only line is while there is one.
 */
function measured(chrome: number, line: number): CSSProperties {
  return {
    "--al-chrome": `${chrome}px`,
    ...(line > 0 && { "--al-veil-h": `${line}px` }),
  } as CSSProperties;
}

/** Call `onOutside` for a press that lands outside `inside`, while `active`. */
function usePressOutside(
  inside: RefObject<HTMLElement | null>,
  active: boolean,
  onOutside: () => void,
) {
  useEffect(() => {
    if (!active) {
      return;
    }
    const pressed = (event: PointerEvent) => {
      if (!inside.current?.contains(event.target as Node)) {
        onOutside();
      }
    };
    document.addEventListener("pointerdown", pressed);
    return () => document.removeEventListener("pointerdown", pressed);
  }, [inside, active, onOutside]);
}

/** Whether a press came from a pointer: a key's click carries no count. */
const pointed = (event: ReactMouseEvent) => event.detail !== 0;

/**
 * Where the keyboard goes when the bar is used. The bar by itself leaves the
 * remote live, and the remote's keys are heard on its surface alone
 * (useRemoteDesktop.ts): so a press with a pointer, which is somebody reaching
 * for a control and going back to the remote, hands the focus back to it. A
 * press from the keyboard is somebody walking the bar with it, and keeps the
 * focus there: opened that way, the bar's first button takes it, for the handle
 * that had it is gone.
 */
function useBarFocus(
  chrome: RefObject<HTMLElement | null>,
  barOpen: boolean,
  onFocusDesktop: () => void,
) {
  const opened = useRef<"pointer" | "keys" | null>(null);
  useEffect(() => {
    const by = opened.current;
    opened.current = null;
    if (!barOpen || by === null) {
      return;
    }
    if (by === "pointer") {
      onFocusDesktop();
    } else {
      chrome.current?.querySelector("button")?.focus();
    }
  }, [chrome, barOpen, onFocusDesktop]);
  return {
    /** The handle was pressed. */
    opening: (event: ReactMouseEvent) => {
      opened.current = pointed(event) ? "pointer" : "keys";
    },
    /** A button of the bar that opens nothing was pressed. */
    used: (event: ReactMouseEvent) => {
      if (pointed(event)) {
        onFocusDesktop();
      }
    },
  };
}

/** Whether the remote is using what was offered it, now. */
function inUse(offered: Offered & { streaming: boolean }): boolean {
  return offered.enabled && offered.streaming;
}

/**
 * The full screen button: what to do when it is pressed, and what the browser
 * said when it refused, in words. A refusal changes nothing on screen, so it is
 * said, or the button would look broken.
 */
function useFullscreen(
  onFocusDesktop: () => void,
): [refused: Told | null, press: () => void] {
  const [refused, setRefused] = useState<Told | null>(null);
  const press = () => {
    setRefused(null);
    // Entering hands the keyboard over along with the screen: the button just
    // pressed otherwise keeps the focus, and the keys the lock just won would
    // land on the bar and reach nothing at all.
    toggleFullscreen().then(onFocusDesktop, (cause: unknown) => {
      // The two names a browser gives a request made without a press behind it:
      // a cause the catalogue knows. Anything else is the browser's own words,
      // kept beside the refusal's general sentence.
      const gesture =
        !(cause instanceof Error) ||
        cause.name === "TypeError" ||
        cause.name === "NotAllowedError";
      setRefused(gesture ? { code: "AL-5001" } : { detail: cause.message });
    });
  };
  return [refused, press];
}

/** Whether the browser will still ask before giving the camera: until it says otherwise, it will. */
function useCameraAsks(): boolean {
  const [asks, setAsks] = useState(true);
  useEffect(() => {
    let status: PermissionStatus | null = null;
    let gone = false;
    const read = () => setAsks(status?.state !== "granted");
    // Not every browser answers for the camera; one that does not is one that
    // may ask, which is the safe thing to assume.
    navigator.permissions
      ?.query({ name: "camera" as PermissionName })
      .then((found) => {
        // Answered after the bar went: there is nobody to tell.
        if (gone) {
          return;
        }
        status = found;
        read();
        found.addEventListener("change", read);
      })
      .catch(() => {});
    return () => {
      gone = true;
      status?.removeEventListener("change", read);
    };
  }, []);
  return asks;
}

/** The handle: what opens the bar, with a mark for what is in use and what went wrong. */
function HandleButton({
  handle,
  onOpen,
}: {
  handle: Handle;
  onOpen: (event: ReactMouseEvent) => void;
}) {
  const { t } = usePreferences();
  const { display } = handle;
  const ofDisplay = display !== null && { n: display };
  return (
    <button
      type="button"
      className="al-handle al-glass"
      aria-label={t(handle.says, ofDisplay || undefined)}
      // The hint is the handle's name, said once: the chord that hides it is
      // drawn as keys in Information, where a semicolon reads as a key.
      title={
        ofDisplay ? t("session.handle.display", ofDisplay) : t("session.handle")
      }
      onClick={onOpen}
    >
      <Glyph name="grip-horizontal" />
      {display !== null && <strong>{display}</strong>}
      {handle.marks.includes("camera") && (
        <span className="al-live">
          <Glyph name="camera" />
        </span>
      )}
      {handle.marks.includes("microphone") && (
        <span className="al-live">
          <Glyph name="mic" />
        </span>
      )}
      {/* Not in the colour of what is in use: nothing of the remote's is. */}
      {handle.marks.includes("muted") && <Glyph name="volume-x" />}
      {handle.marks.includes("error") && (
        <span className="al-msg--danger">
          <Glyph name="circle-alert" />
        </span>
      )}
    </button>
  );
}

/** What a display's tab says of its display on its bar: which, and what it is drawn at. */
function sizeNote(name: string, size: RemoteSize | null): string {
  if (!size) {
    return name;
  }
  const density = densityLabel(size.scale * 100).replace("x", "×");
  return `${name} · ${size.w} × ${size.h} · ${density}`;
}

/** The bar's buttons: only the ones the session has something for. */
function Bar({
  items,
  display,
  size,
  open,
  muted,
  keyboard,
  moreButton,
  onFullscreen,
  onToggle,
  onMute,
  onKeyboard,
  onEnd,
  onDisconnect,
}: {
  items: BarItem[];
  /** The display a tab of its own shows, whose bar this then is. */
  display: number | null;
  size: RemoteSize | null;
  open: Open | null;
  muted: boolean;
  keyboard: boolean;
  /** The button a closed sheet gives the focus back to. */
  moreButton: RefObject<HTMLButtonElement | null>;
  onFullscreen: () => void;
  onToggle: (which: Open) => void;
  onMute: (event: ReactMouseEvent) => void;
  onKeyboard: (event: ReactMouseEvent) => void;
  onEnd: () => void;
  onDisconnect: () => void;
}) {
  const { t } = usePreferences();
  const fullscreen = useSyncExternalStore(
    onFullscreenChange,
    isFullscreen,
    () => false,
  );
  return (
    <div
      className="al-bar al-glass"
      role="toolbar"
      aria-label={
        display === null
          ? t("session.bar")
          : t("session.bar.display", { n: display })
      }
    >
      {items.includes("fullscreen") && (
        <button
          type="button"
          className="al-btn"
          aria-pressed={fullscreen}
          title={t(
            fullscreen
              ? "session.fullscreen.leave"
              : "session.fullscreen.enter",
          )}
          onClick={onFullscreen}
        >
          <Glyph name={fullscreen ? "minimize" : "maximize"} />
          <span>{t("session.fullscreen")}</span>
        </button>
      )}
      {items.includes("displays") && (
        <button
          type="button"
          className="al-btn"
          aria-expanded={open === "displays"}
          onClick={() => onToggle("displays")}
        >
          <Glyph name="monitor" />
          <span>{t("session.displays")}</span>
        </button>
      )}
      {items.includes("mute") && (
        <button
          type="button"
          className="al-btn"
          aria-pressed={muted}
          onClick={onMute}
        >
          <Glyph name={muteGlyph(muted)} />
          <span>{t("session.mute")}</span>
        </button>
      )}
      {items.includes("keyboard") && (
        <button
          type="button"
          className="al-btn"
          aria-pressed={keyboard}
          onClick={onKeyboard}
        >
          <Glyph name="keyboard" />
          <span>{t("session.keyboard")}</span>
        </button>
      )}
      {items.includes("more") && (
        <button
          ref={moreButton}
          type="button"
          className="al-btn"
          aria-expanded={open === "more"}
          onClick={() => onToggle("more")}
        >
          <Glyph name="ellipsis" />
          <span>{t("session.more")}</span>
        </button>
      )}
      {items.includes("end") && (
        <button type="button" className="al-btn al-end" onClick={onEnd}>
          <Glyph name="power" />
          <span>{t("session.end")}</span>
        </button>
      )}
      {items.includes("size") && display !== null && (
        <span className="al-barnote" role="note">
          {sizeNote(t("displays.numbered", { n: display }), size)}
        </span>
      )}
      {items.includes("disconnect") && (
        <button type="button" className="al-btn al-end" onClick={onDisconnect}>
          <Glyph name="power" />
          <span>{t("session.disconnect")}</span>
        </button>
      )}
    </div>
  );
}

/** What stopped, hanging from the open bar: each with its cause, its code, and the way to turn it on again. */
function Stopped({
  refused,
  sound,
  camera,
  microphone,
}: {
  /** A full screen the browser refused, and why; null where it did not. */
  refused: Told | null;
  sound: Offered;
  camera: Offered;
  microphone: Offered;
}) {
  const { message } = usePreferences();
  const mic = microphone.fault;
  return (
    <div className="al-drop al-drop--menu al-glass al-say" role="alert">
      {refused !== null && (
        <Said code={refused.code ?? "AL-5000"} detail={refused.detail}>
          {message("AL-5000", refused.code)}
        </Said>
      )}
      {sound.fault && (
        <Said
          code={sound.fault.code}
          detail={sound.fault.detail}
          onAgain={() => sound.onChange(true)}
        >
          {message("AL-5100", sound.fault.code, fillOf(sound.fault))}
        </Said>
      )}
      {camera.fault && (
        <Said
          code={camera.fault.code}
          detail={camera.fault.detail}
          onAgain={() => camera.onChange(true)}
        >
          {message("AL-5300", camera.fault.code, fillOf(camera.fault))}
        </Said>
      )}
      {mic && (
        <Said
          code={mic.code}
          detail={mic.detail}
          onAgain={() => microphone.onChange(true)}
        >
          {message("AL-5500", mic.code, fillOf(mic))}
        </Said>
      )}
    </div>
  );
}

/** The Mac keys' line: on, off, or not applying to a Mac, which is said and cannot be pressed. */
function MacKeysItem({ macKeys }: { macKeys: SessionBarProps["macKeys"] }) {
  const { t } = usePreferences();
  const state = macKeysState(macKeys.enabled, macKeys.remoteIsMac);
  if (state === "na") {
    return (
      <Item
        glyph="command"
        name={t("session.mackeys")}
        title={t("session.mackeys.na")}
        state={<span className="al-itemstate">{t("state.na")}</span>}
      />
    );
  }
  return (
    <Item
      glyph="command"
      name={t("session.mackeys")}
      pressed={state === "on"}
      title={t("session.mackeys.note")}
      onPress={() => macKeys.onChange(!macKeys.enabled)}
      state={
        state === "on" && <span className="al-itemstate">{t("state.on")}</span>
      }
    />
  );
}

/** The bar's menu: what the computer and this device offer, and the ways on from here. */
function MoreMenu({
  menu,
  camera,
  microphone,
  macKeys,
  touch,
  onOpen,
  onCamera,
  onFit,
  onSignOut,
  onClose,
}: Pick<SessionBarProps, "camera" | "microphone" | "macKeys" | "touch"> & {
  menu: MoreItem[];
  onOpen: (which: Open) => void;
  onCamera: () => void;
  onFit: () => void;
  onSignOut: () => void;
  onClose: () => void;
}) {
  const { t, message } = usePreferences();
  return (
    <Sheet title={t("session.more")} kind="menu" onClose={onClose}>
      <Item
        glyph="clipboard"
        name={t("session.clipboard")}
        onPress={() => onOpen("clipboard")}
      />
      {menu.includes("camera") && (
        <Item
          glyph="camera"
          name={t("session.camera")}
          experimental
          pressed={camera.enabled}
          title={t("session.camera.hint")}
          onPress={onCamera}
          state={
            <OfferedState
              offered={camera.enabled}
              streaming={camera.streaming}
              waiting={message("AL-5200")}
              inUse={message("AL-5200", "AL-5201")}
            />
          }
        />
      )}
      {menu.includes("microphone") && (
        <Item
          glyph="mic"
          name={t("session.microphone")}
          experimental
          pressed={microphone.enabled}
          title={t("session.microphone.hint")}
          onPress={() => microphone.onChange(!microphone.enabled)}
          state={
            <OfferedState
              offered={microphone.enabled}
              streaming={microphone.streaming}
              waiting={message("AL-5400")}
              inUse={message("AL-5400", "AL-5401")}
            />
          }
        />
      )}
      {menu.includes("mackeys") && <MacKeysItem macKeys={macKeys} />}
      {menu.includes("touch") && (
        <Item
          glyph="pointer"
          name={t("session.touch")}
          pressed={touch.enabled}
          title={t("session.touch.note")}
          onPress={() => touch.onChange(!touch.enabled)}
          state={
            touch.enabled && (
              <span className="al-itemstate">{t("state.on")}</span>
            )
          }
        />
      )}
      {menu.includes("window") && (
        <Item
          glyph="app-window"
          name={t("session.window")}
          title={t("session.window.note")}
          onPress={onFit}
        />
      )}
      <Item
        glyph="info"
        name={t("session.info")}
        onPress={() => onOpen("info")}
      />
      <Item
        glyph="settings"
        name={t("prefs.title")}
        onPress={() => onOpen("prefs")}
      />
      <Item glyph="log-out" name={t("common.signout")} onPress={onSignOut} />
    </Sheet>
  );
}

/** The two things the bar asks about before it does them. */
function Asks({
  asking,
  name,
  onCancel,
  onSignOut,
  onCamera,
}: {
  asking: "signout" | "camera";
  /** The computer the session is on. */
  name: string;
  onCancel: () => void;
  onSignOut: () => void;
  onCamera: () => void;
}) {
  const { t } = usePreferences();
  if (asking === "camera") {
    return (
      <Dialog
        title={t("dialog.permission.title")}
        onCancel={onCancel}
        acts={
          <>
            <button type="button" className="al-btn" onClick={onCancel}>
              {t("common.notnow")}
            </button>
            <button
              type="button"
              className="al-btn al-btn--primary"
              onClick={onCamera}
            >
              {t("common.continue")}
            </button>
          </>
        }
      >
        <p>{t("dialog.permission.body")}</p>
      </Dialog>
    );
  }
  return (
    <Dialog
      alert
      title={t("dialog.destructive.title")}
      onCancel={onCancel}
      acts={
        <>
          <button
            type="button"
            className="al-btn"
            // biome-ignore lint/a11y/noAutofocus: in a dialog that ends something, the focus starts on the way out of it
            autoFocus
            onClick={onCancel}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="al-btn al-btn--danger"
            onClick={onSignOut}
          >
            {t("dialog.destructive.act")}
          </button>
        </>
      }
    >
      <p>{t("dialog.destructive.body.named", { name })}</p>
    </Dialog>
  );
}

/** What hangs from the bar, one at a time, besides its menu. */
function Sheets({
  open,
  props,
  metered,
  onOpen,
  onClose,
}: {
  open: Open;
  props: SessionBarProps;
  /** The gateway keeps a meter to open. */
  metered: boolean;
  onOpen: (which: Open) => void;
  onClose: () => void;
}) {
  const { t } = usePreferences();
  const { sound } = props;
  if (open === "clipboard") {
    return (
      <ClipboardPanel
        remoteClipboard={props.remoteClipboard}
        onFetch={props.onFetchClipboard}
        onSend={props.onSendClipboard}
        onClose={onClose}
      />
    );
  }
  if (open === "displays") {
    return (
      <DisplayPanel
        displays={props.displays}
        activeId={props.activeDisplayId}
        mirror={props.kind?.subtype === "ard-mirror"}
        onSelect={props.onSelectDisplay}
        onClose={onClose}
      />
    );
  }
  if (open === "info") {
    return (
      <InfoSheet
        name={props.name}
        kind={props.kind}
        size={props.size}
        hostScale={props.hostScale}
        renderPlan={props.renderPlan}
        oversize={props.oversize}
        audio={{
          available: sound.available,
          enabled: sound.enabled,
          error: sound.fault,
          stream: sound.stream,
        }}
        videoStream={props.videoStream}
        displays={props.displays}
        touchActive={props.touch.active}
        macHost={props.macKeys.host}
        onThroughput={metered ? () => onOpen("throughput") : null}
        onClose={onClose}
      />
    );
  }
  if (open === "prefs") {
    return (
      <Sheet title={t("prefs.title")} kind="list" onClose={onClose}>
        <PreferencesChoices />
        <AppVersion className="al-small" />
      </Sheet>
    );
  }
  return (
    <ThroughputPanel
      variant="sheet"
      onClose={() => onOpen("info")}
      onUnauthorized={props.onUnauthorized}
    />
  );
}

export function SessionBar(props: SessionBarProps) {
  const { sound, camera, microphone, macKeys, size } = props;
  const { onFocusDesktop, sendKeyCombo } = props;
  const { t, message } = usePreferences();
  const root = useRef<HTMLDivElement>(null);
  const chrome = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLOutputElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const [barOpen, setBarOpen] = useState(false);
  const [open, setOpen] = useState<Open | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const [asking, setAsking] = useState<"signout" | "camera" | null>(null);
  const [refused, pressFullscreen] = useFullscreen(onFocusDesktop);
  // Hidden by its chord, with what hangs from it; the keyboard has its own ✕.
  const hidden = useHidden(macKeys.host, props.onLocalShortcut);
  const installed = useSyncExternalStore(
    onAppWindowChange,
    appWindow,
    () => false,
  );
  const metered = useThroughputAvailable();
  const cameraAsks = useCameraAsks();
  // A phone is the device the engine calls one, whichever way it is held.
  const phone = sizeFollows() === null;
  const showing = hidden ? null : open;
  useViewOnly(viewOnly(showing, asking !== null), props.onViewOnlyChange);

  const offers: Offers = {
    fullscreen: fullscreenSupported(),
    displays: props.displays.length,
    sound: sound.available,
    camera: camera.available,
    microphone: microphone.available,
    macHost: macKeys.host,
    touch: props.touch.offered,
    appWindow: installed,
    pointer: !CAN_PINCH_ZOOM,
    tab: props.tab,
  };

  const barFocus = useBarFocus(chrome, barOpen, onFocusDesktop);
  // Measured again when the bar opens or closes, which is when its height changes.
  const edge = useHeight(chrome, `${barOpen} ${hidden} ${keyboard}`);
  // A press on the remote screen closes the bar: it is the remote's again.
  const shut = useCallback(() => setBarOpen(false), []);
  usePressOutside(root, barOpen && open === null, shut);

  // Closing what is open gives the focus back to the bar it hangs from, and to
  // the remote where the bar is not there to take it.
  const close = useCallback(() => {
    setOpen(null);
    if (moreButton.current) {
      moreButton.current.focus();
    } else {
      onFocusDesktop();
    }
  }, [onFocusDesktop]);

  const pressCamera = () => {
    if (camera.enabled) {
      camera.onChange(false);
    } else if (cameraAsks) {
      setAsking("camera");
    } else {
      camera.onChange(true);
    }
  };

  const fitWindow = () => {
    if (size) {
      setOpen(null);
      setBarOpen(false);
      sizeWindowToDesktop(size, size.scale);
    }
  };

  // A soft key is input, and a sheet over a view-only remote says input is not
  // happening: so a key takes down what is open as it sends.
  const softKey = useCallback(
    (codes: string[]) => {
      setOpen(null);
      sendKeyCombo(codes);
    },
    [sendKeyCombo],
  );

  const problem =
    refused !== null ||
    [sound, camera, microphone].some((offered) => offered.fault !== null);
  const handle = handleOf({
    cameraInUse: inUse(camera),
    microphoneInUse: inUse(microphone),
    muted: mutedHere(sound),
    problem,
    display: props.tab,
  });
  const veil = veilOf(showing);
  // How tall the view-only line is, which is the room a sheet leaves it: one line
  // in a wide window, two on a narrow phone.
  const lineHeight = useHeight(line, `${veil}`);
  // On a phone the keyboard takes the bar's place: the picture is what is above it.
  const chromeShown = !hidden && !(keyboard && phone);

  return (
    <div className="al al--over" ref={root} style={measured(edge, lineHeight)}>
      {props.children}

      {/* Under what is open: the browser's own pointer, and a press closes it. */}
      {veil && (
        // biome-ignore lint/a11y/noStaticElementInteractions: a press beside a sheet closes it, as one beside any menu does
        // biome-ignore lint/a11y/useKeyWithClickEvents: Escape and each sheet's own ✕ are the keyboard's way
        <div className="al-catch" onClick={close} />
      )}

      {chromeShown && (
        <div
          className="al-chrome"
          ref={chrome}
          data-al-shows={barOpen ? "bar" : "handle"}
        >
          {barOpen ? (
            <Bar
              items={barItems(offers)}
              display={props.tab}
              size={size}
              open={open}
              muted={!sound.enabled}
              keyboard={keyboard}
              moreButton={moreButton}
              onFullscreen={pressFullscreen}
              onToggle={(which) =>
                setOpen((was) => (was === which ? null : which))
              }
              onMute={(event) => {
                sound.onChange(!sound.enabled);
                barFocus.used(event);
              }}
              onKeyboard={(event) => {
                setKeyboard((was) => !was);
                barFocus.used(event);
              }}
              onEnd={props.onEnd}
              onDisconnect={props.onDisconnect}
            />
          ) : (
            <HandleButton
              handle={handle}
              onOpen={(event) => {
                barFocus.opening(event);
                setBarOpen(true);
              }}
            />
          )}
        </div>
      )}

      {/* What stopped, hanging from the open bar while nothing else does. */}
      {chromeShown && barOpen && open === null && problem && (
        <Stopped
          refused={refused}
          sound={sound}
          camera={camera}
          microphone={microphone}
        />
      )}

      {showing === "more" && (
        <MoreMenu
          menu={moreItems(offers)}
          camera={camera}
          microphone={microphone}
          macKeys={macKeys}
          touch={props.touch}
          onOpen={setOpen}
          onCamera={pressCamera}
          onFit={fitWindow}
          onSignOut={() => setAsking("signout")}
          onClose={close}
        />
      )}
      {showing && showing !== "more" && (
        <Sheets
          open={showing}
          props={props}
          metered={metered}
          onOpen={setOpen}
          onClose={close}
        />
      )}

      {veil && (
        <output className="al-veil al-glass" ref={line}>
          {message("AL-4700", undefined, { panel: t(veil) })}
        </output>
      )}

      {keyboard && (
        <SoftKeyboardPanel
          format={keyboardFormat(phone)}
          sendKeyCombo={softKey}
          onClose={() => {
            setKeyboard(false);
            onFocusDesktop();
          }}
          onDockedHeightChange={props.onKeyboardInset}
          onFocusDesktop={onFocusDesktop}
        />
      )}

      {asking && (
        <Asks
          asking={asking}
          name={props.name}
          onCancel={() => setAsking(null)}
          onSignOut={props.onSignOut}
          onCamera={() => {
            setAsking(null);
            camera.onChange(true);
          }}
        />
      )}
    </div>
  );
}
