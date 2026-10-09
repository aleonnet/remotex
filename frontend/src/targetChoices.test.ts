// Which lines the list has, what each line's three places are, what its monitor
// shows, and what Open then sends. The properties under test are the list's
// rules: a Mac listed in both of its modes at one address is one line; a place
// is a key only where there is another choice behind it; the size is a choice
// only where there are two; a Mac's sound is said and never chosen; a stream is
// passed only where the gateway can do nothing else or the page's address asks;
// a target that can only be passed cannot start in a browser that cannot take
// it; nothing an older page remembered of a passthrough or a format is sent; and
// where the second display sits is a choice only where the host is told.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  type Abilities,
  type Asked,
  asked,
  type Choices,
  hereOf,
  lineNameOf,
  modeOf,
  type Place,
  placesOf,
  pressed,
  readRememberedChoices,
  readRememberedModes,
  rememberChoice,
  rememberMode,
  rowsOf,
  type TargetInfo,
  targetOptions,
} from "./targetChoices.ts";
import { say, sayWords, type Words } from "./words.ts";

// A desktop browser, whose window a desktop can follow.
const ABLE: Abilities = {
  appleMedia: true,
  rdpGraphics: true,
  follows: "window",
  fitted: false,
};
const UNABLE: Abilities = { ...ABLE, appleMedia: false, rdpGraphics: false };
const TABLET: Abilities = { ...ABLE, follows: "screen", fitted: true };
const PHONE: Abilities = { ...ABLE, follows: null, fitted: true };
const DEFAULT_SIZE = { w: 1440, h: 900 };

// A page opened at its plain address, and one whose address asks.
const PLAIN_ADDRESS: Asked = { passthrough: false, lossless: false };
const PASSED: Asked = { passthrough: true, lossless: false };
const LOSSLESS: Asked = { passthrough: false, lossless: true };

function target(offers: Partial<TargetInfo>): TargetInfo {
  return {
    name: "t",
    protocol: "vnc",
    subtype: null,
    host: "192.0.2.1",
    port: 5900,
    computer: null,
    here: false,
    resize: false,
    size: null,
    defaultSize: DEFAULT_SIZE,
    audio: false,
    passthrough: null,
    passthroughOnly: false,
    placement: false,
    ...offers,
  };
}

// The seven kinds of computer the list tells apart, as `/api/targets` lists them.
const RDP = target({
  protocol: "rdp",
  resize: true,
  audio: true,
  passthrough: "rdp-graphics",
});
const PLAIN = target({});
const WLSHARE = target({ subtype: "wlshare", resize: true, audio: true });
const STANDARD = target({ subtype: "ard", defaultSize: null });
const STANDARD_OWN = target({ subtype: "ard", resize: true });
const VIRTUAL = target({
  subtype: "ard-high-performance",
  resize: true,
  passthrough: "apple-media",
});
const MIRROR = target({
  subtype: "ard-mirror",
  resize: true,
  defaultSize: null,
  passthrough: "apple-media",
});

const SIZED = { w: 1920, h: 1080 };

/** What the list says for `words`, in English. */
const en = (words: Words) => sayWords("en-US", words);

/** A target's options on a page at its plain address. */
function options(
  offered: TargetInfo,
  remembered: Partial<Choices> | undefined = undefined,
  abilities: Abilities = ABLE,
  asks: Asked = PLAIN_ADDRESS,
) {
  return targetOptions(offered, remembered, abilities, asks);
}

/** The sizes a target offers a client, as `[value, label]`. */
function sizes(offered: TargetInfo, abilities: Abilities): string[][] {
  return options(offered, undefined, abilities).sizes.map((size) => [
    size.value,
    en(size.label),
  ]);
}

/** The three places of a line, each as its glyph, what it says, and whether it is a key. */
function places(
  offered: TargetInfo,
  remembered: Partial<Choices> | undefined = undefined,
  abilities: Abilities = ABLE,
  asks: Asked = PLAIN_ADDRESS,
  modes = false,
): ([string, string, boolean] | null)[] {
  const chosen = options(offered, remembered, abilities, asks);
  return placesOf(offered, chosen, abilities, modes).map(
    (place: Place | null) => place && [place.glyph, en(place.says), place.key],
  );
}

test("a Mac listed in both modes at one address is one line, under what its two names share", () => {
  const listed = [
    target({ name: "pi" }),
    { ...MIRROR, name: "mac-espelhado", host: "mac.lan" },
    { ...RDP, name: "pc", host: "pc.lan" },
    { ...VIRTUAL, name: "mac-virtual", host: "mac.lan" },
  ];
  const rows = rowsOf(listed);
  assert.deepEqual(
    rows.map((row) => [row.name, row.targets.map((t) => t.name)]),
    [
      ["pi", ["pi"]],
      // Where the first of the two stood, the virtual target first.
      ["mac", ["mac-virtual", "mac-espelhado"]],
      ["pc", ["pc"]],
    ],
  );
});

test("a line of the gateway's own computer is named as that computer names itself", () => {
  const here = { host: "127.0.0.1", computer: "AB MacBook Pro" };
  // Its two modes, one line: the computer's name, not what the two entries share.
  assert.deepEqual(
    rowsOf([
      { ...VIRTUAL, name: "mac-virtual", ...here },
      { ...MIRROR, name: "mac-espelhado", ...here },
      { ...RDP, name: "pc", host: "pc.lan" },
    ]).map((row) => [row.name, row.targets.map((t) => t.name)]),
    [
      ["AB MacBook Pro", ["mac-virtual", "mac-espelhado"]],
      ["pc", ["pc"]],
    ],
  );
  // Listed in one mode only, the same.
  assert.equal(
    rowsOf([{ ...MIRROR, name: "mac-espelhado", ...here }])[0].name,
    "AB MacBook Pro",
  );
  // What Open asks for is still the target, by the name its entry was given.
  const [row] = rowsOf([
    { ...VIRTUAL, name: "mac-virtual", ...here },
    { ...MIRROR, name: "mac-espelhado", ...here },
  ]);
  assert.equal(modeOf(row, {}).name, "mac-virtual");
});

test("a session is called by the name of the line its target stands on", () => {
  const here = { host: "127.0.0.1", computer: "AB MacBook Pro" };
  const listed = [
    { ...VIRTUAL, name: "mac-virtual", ...here },
    { ...MIRROR, name: "mac-espelhado", ...here },
    { ...VIRTUAL, name: "studio-virtual", host: "studio.lan" },
    { ...MIRROR, name: "studio-espelhado", host: "studio.lan" },
    { ...RDP, name: "pc", host: "pc.lan" },
  ];
  // Either of a line's two targets, by the computer's own name or by what the
  // two entries share; a line of one target, by its own.
  assert.equal(lineNameOf(listed, "mac-espelhado"), "AB MacBook Pro");
  assert.equal(lineNameOf(listed, "mac-virtual"), "AB MacBook Pro");
  assert.equal(lineNameOf(listed, "studio-espelhado"), "studio");
  assert.equal(lineNameOf(listed, "pc"), "pc");
  assert.equal(lineNameOf(listed, "gone"), null);
});

test("the name of a two-mode line ends at a whole word, or is the first target's", () => {
  const named = (first: string, second: string) =>
    rowsOf([
      { ...VIRTUAL, name: first },
      { ...MIRROR, name: second },
    ])[0].name;
  assert.equal(
    named("MacBook Pro virtual", "MacBook Pro espelhado"),
    "MacBook Pro",
  );
  assert.equal(named("MacBook Pro", "MacBook Pro espelhado"), "MacBook Pro");
  assert.equal(named("mac_a", "mac_b"), "mac");
  assert.equal(named("studio.virtual", "studio.mirror"), "studio");
  // Names that part inside a word share no whole word: the first is the name.
  assert.equal(named("mac1", "mac2"), "mac1");
  assert.equal(named("espelho", "especial"), "espelho");
  assert.equal(named("alpha", "beta"), "alpha");
  // Two words in, the third parting inside itself.
  assert.equal(named("Mac mini virtual", "Mac mini vidro"), "Mac mini");
});

test("everything that is not a Mac in both modes at one address is a line of its own", () => {
  const lone = (listed: TargetInfo[]) =>
    rowsOf(listed).map((row) => row.targets.map((t) => t.name));
  // Two Macs behind one address, a port each, as a tunnel lists them.
  assert.deepEqual(
    lone([
      { ...VIRTUAL, name: "a", host: "127.0.0.1", port: 5901 },
      { ...MIRROR, name: "b", host: "127.0.0.1", port: 5902 },
    ]),
    [["a"], ["b"]],
  );
  // Two Macs, each in one mode.
  assert.deepEqual(
    lone([
      { ...VIRTUAL, name: "a", host: "a.lan" },
      { ...MIRROR, name: "b", host: "b.lan" },
    ]),
    [["a"], ["b"]],
  );
  // A Mac in the compatible mode beside its two modes: the two are a line, and
  // nothing the gateway opens is dropped.
  assert.deepEqual(
    lone([
      { ...STANDARD, name: "c" },
      { ...VIRTUAL, name: "v" },
      { ...MIRROR, name: "m" },
      { ...STANDARD_OWN, name: "co" },
    ]),
    [["c"], ["v", "m"], ["co"]],
  );
  // A second target of a mode already taken at that address stays by itself.
  assert.deepEqual(
    lone([
      { ...VIRTUAL, name: "v1" },
      { ...VIRTUAL, name: "v2" },
      { ...MIRROR, name: "m" },
    ]),
    [["v1", "m"], ["v2"]],
  );
  // A Windows host and a wlshare one at a Mac's address are not its modes.
  assert.deepEqual(
    lone([
      { ...RDP, name: "pc" },
      { ...MIRROR, name: "m" },
      { ...WLSHARE, name: "w" },
    ]),
    [["pc"], ["m"], ["w"]],
  );
});

test("each kind of computer is named in the words under its name", () => {
  const named = (offered: TargetInfo) => en(options(offered).kind);
  assert.equal(named(MIRROR), "Mac");
  assert.equal(named(VIRTUAL), "Mac");
  assert.equal(named(STANDARD), "Compatible");
  // A Mac in the compatible mode on a screen of its own: an `ard` target that
  // keeps a size, which only a virtual display has to keep.
  assert.equal(named(STANDARD_OWN), "Compatible, its own screen");
  assert.equal(named(RDP), "Remote Desktop");
  assert.equal(named(WLSHARE), "Linux, wlshare");
  assert.equal(named(PLAIN), "VNC");
  assert.equal(sayWords("pt-BR", options(RDP).kind), "Área de Trabalho Remota");
  // A subtype this build has never heard of still names itself: the gateway and
  // this client ship together, so this is a build mismatch, and a line that
  // dropped the value would describe the computer wrongly.
  assert.deepEqual(options(target({ subtype: "ard-something-new" })).kind, {
    data: "VNC · ard-something-new",
  });
});

test("a target the window cannot drive keeps one size, on every client", () => {
  // A plain VNC server, and an RDP host on bitmap updates.
  for (const abilities of [ABLE, TABLET, PHONE]) {
    assert.deepEqual(sizes(PLAIN, abilities), [["target", "1440 × 900"]]);
    assert.deepEqual(sizes(target({ size: SIZED }), abilities), [
      ["target", "1920 × 1080"],
    ]);
    assert.equal(options(PLAIN, undefined, abilities).choices.size, "target");
  }
});

test("a desktop browser and a tablet follow, beside a configured size", () => {
  assert.deepEqual(sizes(RDP, ABLE), [["window", "The size of this window"]]);
  assert.deepEqual(sizes(RDP, TABLET), [["window", "The size of this screen"]]);
  // The configured size comes first, so it is the size until somebody chooses.
  const sized = { ...RDP, size: SIZED };
  assert.deepEqual(sizes(sized, ABLE), [
    ["target", "1920 × 1080"],
    ["window", "The size of this window"],
  ]);
  assert.deepEqual(sizes(sized, TABLET), [
    ["target", "1920 × 1080"],
    ["window", "The size of this screen"],
  ]);
  assert.equal(options(sized).choices.size, "target");
  assert.equal(options(RDP).choices.size, "window");
});

test("a phone is offered sizes the desktop keeps, never its window", () => {
  assert.deepEqual(sizes(RDP, PHONE), [["target", "1440 × 900"]]);
  assert.deepEqual(sizes({ ...RDP, size: SIZED }, PHONE), [
    ["target", "1920 × 1080"],
    ["default", "1440 × 900"],
  ]);
});

test("a Mac sharing its screens is shown at their size, and fitted where it is mirrored over the stream", () => {
  assert.deepEqual(sizes(STANDARD, ABLE), [
    ["target", "The computer's screens as they are"],
  ]);
  // The Mac's own screens over its media stream: nothing sizes them, and the
  // gateway fits their picture to the viewer. That is its one size.
  assert.deepEqual(sizes(MIRROR, ABLE), [
    ["window", "The size of this window"],
  ]);
  assert.equal(options(MIRROR).choices.size, "window");
  // The screens' own size, which an older page offered and remembered, is no
  // choice any more: what Open sends is the one size there is.
  assert.equal(options(MIRROR, { size: "target" }).choices.size, "window");
  // A tablet's screen, and a phone's, whose browser fits the picture to it.
  for (const client of [TABLET, PHONE]) {
    assert.deepEqual(sizes(MIRROR, client), [
      ["window", "The size of this screen"],
    ]);
    assert.equal(options(MIRROR, undefined, client).choices.size, "window");
  }
});

test("a line has its mode, its size and its sound, and a key only where there is another choice", () => {
  // A Mac on a screen of its own, by itself: nothing to choose.
  assert.deepEqual(places(VIRTUAL), [
    [
      "mode-virtual",
      "Virtual: picture and sound come here; the Mac is left without picture and without sound",
      false,
    ],
    ["fit", "The size of this window", false],
    ["volume-2", "Sound always comes with the picture", false],
  ]);
  // The same Mac in a line with both modes: the mode is a key, and nothing else.
  assert.deepEqual(
    places(VIRTUAL, undefined, ABLE, PLAIN_ADDRESS, true).map(
      (place) => place?.[2],
    ),
    [true, false, false],
  );
  // With a size configured there are two, and the size is a key.
  assert.deepEqual(
    places({ ...VIRTUAL, size: SIZED }).map((place) => place?.[2]),
    [false, true, false],
  );
  // Mirrored: always fitted, so the size is a mark and the mode the only key,
  // whatever an older page remembered.
  const fittedToWindow = ["fit", "Picture fitted to this window", false];
  assert.deepEqual(places(MIRROR, undefined, ABLE, PLAIN_ADDRESS, true), [
    ["mode-mirror", "Mirrored: mirrors everything, the sound perfect", true],
    fittedToWindow,
    ["volume-2", "Sound always comes with the picture", false],
  ]);
  assert.deepEqual(places(MIRROR, { size: "target" })[1], fittedToWindow);
  for (const client of [TABLET, PHONE]) {
    assert.deepEqual(places(MIRROR, undefined, client)[1], [
      "fit",
      "Picture fitted to this screen",
      false,
    ]);
  }
  // A Windows host with a size configured: the size and the sound are keys, and
  // it has no mode, whose room is kept.
  assert.deepEqual(places({ ...RDP, size: SIZED }), [
    null,
    ["one-to-one", "1920 × 1080", true],
    ["volume-x", "Without bringing the sound", true],
  ]);
  assert.deepEqual(
    places({ ...RDP, size: SIZED }, { size: "window", audio: "opus" }),
    [
      null,
      ["fit", "The size of this window", true],
      ["volume-2", "Sound brought here", true],
    ],
  );
  // A wlshare desktop follows the window, and that is its one size.
  assert.deepEqual(places(WLSHARE), [
    null,
    ["fit", "The size of this window", false],
    ["volume-x", "Without bringing the sound", true],
  ]);
  // A plain server, and a Mac in the compatible mode, have nothing to choose.
  for (const offered of [PLAIN, STANDARD, STANDARD_OWN]) {
    assert.deepEqual(
      places(offered).map((place) => place?.[2]),
      [undefined, false, false],
      offered.subtype ?? "vnc",
    );
    assert.deepEqual(places(offered)[2], ["volume-x", "No sound", false]);
  }
  // A phone chooses between two sizes the desktop keeps: the glyph is the same,
  // and what it says is the size.
  const phone = { ...RDP, size: SIZED };
  assert.deepEqual(places(phone, undefined, PHONE)[1], [
    "one-to-one",
    "1920 × 1080",
    true,
  ]);
  assert.deepEqual(places(phone, { size: "default" }, PHONE)[1], [
    "one-to-one",
    "1440 × 900",
    true,
  ]);
});

test("the monitor shows the picture filling the window, fitted inside it, or larger than it", () => {
  const here = (
    offered: TargetInfo,
    remembered: Partial<Choices> | undefined = undefined,
    abilities: Abilities = ABLE,
    asks: Asked = PLAIN_ADDRESS,
  ) =>
    hereOf(offered, options(offered, remembered, abilities, asks), abilities);
  assert.equal(here(VIRTUAL), "fill");
  assert.equal(here(RDP), "fill");
  assert.equal(here(MIRROR), "fit");
  assert.equal(here(MIRROR, { size: "target" }), "fit");
  assert.equal(here(MIRROR, undefined, PHONE), "fit");
  // A size the remote keeps is larger than the window, and scrolls, with a pointer.
  assert.equal(here({ ...RDP, size: SIZED }), "over");
  assert.equal(here(PLAIN), "over");
  // A passed stream is never fitted.
  assert.equal(here(MIRROR, undefined, ABLE, PASSED), "over");
  // A touch client fits a picture to its width whatever its size, and a tablet's
  // screen is what a desktop that follows it fills.
  assert.equal(here({ ...RDP, size: SIZED }, undefined, PHONE), "fit");
  assert.equal(here(PLAIN, undefined, TABLET), "fit");
  assert.equal(here(RDP, undefined, TABLET), "fill");
  assert.equal(here(MIRROR, undefined, TABLET), "fit");
});

test("pressing a key chooses the next size, round again, and the sound brought or not", () => {
  const sized = { ...RDP, size: SIZED };
  assert.deepEqual(pressed(options(sized), "size"), { size: "window" });
  assert.deepEqual(pressed(options(sized, { size: "window" }), "size"), {
    size: "target",
  });
  assert.deepEqual(pressed(options(sized, undefined, PHONE), "size"), {
    size: "default",
  });
  assert.deepEqual(pressed(options(sized), "sound"), { audio: "opus" });
  assert.deepEqual(pressed(options(sized, { audio: "opus" }), "sound"), {
    audio: "off",
  });
});

test("nothing is brought or passed until somebody asks, and what was chosen last time is what Open sends", () => {
  assert.deepEqual(options(RDP).choices, {
    size: "window",
    audio: "off",
    passthrough: false,
    placement: "right",
  });
  assert.equal(options(RDP).sound, false);
  const sized = { ...RDP, size: SIZED };
  const chosen = options(sized, { size: "window", audio: "opus" });
  assert.deepEqual(chosen.choices, {
    size: "window",
    audio: "opus",
    passthrough: false,
    placement: "right",
  });
  assert.equal(chosen.sound, true);
  // A choice remembered for something the target does not offer here is not
  // sent: a phone has no window, and a plain server neither that nor sound.
  assert.equal(
    options(sized, { size: "window" }, PHONE).choices.size,
    "target",
  );
  assert.deepEqual(options(PLAIN, { size: "window", audio: "opus" }).choices, {
    size: "target",
    audio: "off",
    passthrough: false,
    placement: "right",
  });
  // Nor is something this page never wrote there.
  assert.equal(options(RDP, { audio: true as never }).choices.audio, "off");
});

test("where the second display sits is the first place of a line whose host is told, and goes round", () => {
  // A Windows host opened with two virtual displays: no mode, so the first
  // place is where the second sits, a key, on the right until chosen.
  const two = { ...RDP, placement: true };
  const [first, size, sound] = places(two);
  assert.deepEqual(first, [
    "second-right",
    "Second display on the right",
    true,
  ]);
  assert.ok(size && sound, "and the other two places stay where they are");
  // The key goes round the four sides and back.
  let chosen: Partial<Choices> = {};
  const seen: string[] = [];
  for (let press = 0; press < 4; press += 1) {
    chosen = { ...chosen, ...pressed(options(two, chosen), "place") };
    seen.push(options(two, chosen).choices.placement);
    assert.equal(places(two, chosen)[0]?.[0], `second-${seen[press]}`);
  }
  assert.deepEqual(seen, ["left", "top", "bottom", "right"]);
  // Each side has its own words, in both languages.
  for (const side of ["right", "left", "top", "bottom"] as const) {
    for (const language of ["pt-BR", "en-US"] as const) {
      assert.ok(say(language, `list.says.second.${side}`).length > 0);
    }
  }
});

test("a computer that is not told where its second display goes has no such place, and sends the right", () => {
  // One display, a plain server, and a Mac, which places its second itself.
  for (const offered of [RDP, PLAIN, VIRTUAL, MIRROR]) {
    const chosen = options(offered, { placement: "bottom" });
    assert.equal(chosen.placementChoice, false);
    assert.equal(chosen.choices.placement, "right", offered.subtype ?? "rdp");
    const [first] = placesOf(offered, chosen, ABLE, false);
    assert.notEqual(first?.opt, "place");
  }
  // Nor is something this page never wrote there.
  const two = { ...RDP, placement: true };
  assert.equal(
    options(two, { placement: "middle" as never }).choices.placement,
    "right",
  );
  assert.equal(options(two, { placement: "top" }).choices.placement, "top");
});

test("a Mac's sound is always carried, and is nobody's choice", () => {
  for (const mac of [VIRTUAL, MIRROR]) {
    const chosen = options(mac, { audio: "opus" });
    assert.equal(chosen.soundChoice, false);
    assert.equal(chosen.choices.audio, "off");
    assert.equal(chosen.sound, true);
  }
  // A Mac in the compatible mode carries none.
  assert.equal(options(STANDARD).sound, false);
});

test("what an older page remembered of a passthrough or a format is not sent", () => {
  // A passthrough ticked in the options the list used to have.
  for (const offered of [VIRTUAL, MIRROR, RDP]) {
    const chosen = options(offered, { passthrough: true });
    assert.equal(chosen.choices.passthrough, false, offered.subtype ?? "rdp");
    assert.equal(chosen.stream, null);
  }
  // Lossless sound chosen there is sound brought, as Opus.
  assert.equal(options(RDP, { audio: "flac" }).choices.audio, "opus");
  assert.equal(options(WLSHARE, { audio: "flac" }).choices.audio, "opus");
});

test("the page's address asks for what no key offers", () => {
  assert.deepEqual(asked(""), PLAIN_ADDRESS);
  assert.deepEqual(asked("?passthrough=1"), PASSED);
  assert.deepEqual(asked("?sound=lossless"), LOSSLESS);
  assert.deepEqual(
    asked("?hevc_decoder=software&passthrough=1&sound=lossless"),
    {
      passthrough: true,
      lossless: true,
    },
  );
  // Anything else is not asking.
  assert.deepEqual(asked("?passthrough=0&sound=opus"), PLAIN_ADDRESS);

  // A stream this browser takes is passed, and the line says so.
  const mac = options(VIRTUAL, undefined, ABLE, PASSED);
  assert.equal(mac.choices.passthrough, true);
  assert.deepEqual(mac.stream, { passed: { key: "pass.on" } });
  assert.equal(en({ key: "pass.on" }), "The Mac's video passed through");
  const pc = options(RDP, undefined, ABLE, PASSED);
  assert.equal(pc.choices.passthrough, true);
  assert.deepEqual(pc.stream, { passed: { key: "pass.rdp.on" } });
  // A target with no stream to pass is asked nothing.
  assert.equal(
    options(WLSHARE, undefined, ABLE, PASSED).choices.passthrough,
    false,
  );
  assert.equal(options(WLSHARE, undefined, ABLE, PASSED).stream, null);
  // A passed stream is never fitted: a Mac mirroring its screens, passed, is at
  // their own size whatever the window was asked to be, and the size is no key.
  // `connect` still carries the window, which is what a session that stops
  // passing would go back to.
  const mirrored = options(MIRROR, undefined, ABLE, PASSED);
  assert.equal(mirrored.choices.size, "window");
  assert.deepEqual(places(MIRROR, undefined, ABLE, PASSED)[1], [
    "one-to-one",
    "The computer's screens as they are",
    false,
  ]);

  // Lossless is how a sound that is brought is sent, and brings none by itself.
  assert.equal(options(RDP, undefined, ABLE, LOSSLESS).choices.audio, "off");
  assert.equal(
    options(RDP, { audio: "opus" }, ABLE, LOSSLESS).choices.audio,
    "flac",
  );
  assert.equal(
    places(RDP, { audio: "opus" }, ABLE, LOSSLESS)[2]?.[1],
    "With lossless sound",
  );
});

test("a passthrough this browser cannot take is not sent, and the line says why", () => {
  for (const [offered, cause, reason] of [
    [RDP, "AL-2501", /WebGL 2/],
    [VIRTUAL, "AL-2502", /does not decode/],
  ] as const) {
    const chosen = options(offered, undefined, UNABLE, PASSED);
    assert.equal(chosen.choices.passthrough, false);
    assert.deepEqual(chosen.stream, { cause });
    assert.match(say("en-US", cause), reason);
    assert.equal(chosen.blocked, null, "the target still starts, encoded");
  }
});

test("a gateway that cannot decode the Mac's picture can only pass it", () => {
  const only = { ...VIRTUAL, passthroughOnly: true };
  // Passed with nothing asked, and the line says why.
  const able = options(only);
  assert.equal(able.choices.passthrough, true);
  assert.deepEqual(able.stream, { cause: "AL-2503" });
  assert.match(say("en-US", "AL-2503"), /always passed through/);
  assert.equal(able.blocked, null);

  // And where the browser cannot take it either, the target cannot start: the
  // list says so before the Mac is dialled.
  const unable = options(only, undefined, UNABLE);
  assert.equal(unable.blocked, "AL-2601");
  assert.match(say("en-US", "AL-2601"), /cannot decode the Mac's video/);
});

test("an RDP host's pipeline is never the only way, whatever the entry says", () => {
  // Every gateway composes the pipeline itself, so the flag means nothing here
  // and none of the Mac's wording reaches an RDP target.
  const flagged = { ...RDP, passthroughOnly: true };
  const able = options(flagged);
  assert.equal(able.choices.passthrough, false);
  assert.equal(able.stream, null);
  assert.equal(able.blocked, null);
  assert.equal(options(flagged, undefined, UNABLE).blocked, null);
});

const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  };
});

test("a size, a sound and where the second display sits are remembered per target", () => {
  assert.deepEqual(readRememberedChoices(), {});
  let remembered = rememberChoice({}, "win", { audio: "opus" });
  remembered = rememberChoice(remembered, "win", { size: "window" });
  remembered = rememberChoice(remembered, "mac", { size: "target" });
  remembered = rememberChoice(remembered, "win", { audio: "off" });
  remembered = rememberChoice(remembered, "win", { placement: "left" });
  const expected = {
    win: { audio: "off", size: "window", placement: "left" },
    mac: { size: "target" },
  };
  assert.deepEqual(remembered, expected);
  assert.deepEqual(readRememberedChoices(), expected, "and written through");
});

test("a two-mode Mac starts on Virtual, and then on the mode it was last on", () => {
  const [row] = rowsOf([
    { ...MIRROR, name: "mac-espelhado" },
    { ...VIRTUAL, name: "mac-virtual" },
  ]);
  assert.deepEqual(readRememberedModes(), {});
  assert.equal(modeOf(row, readRememberedModes()).name, "mac-virtual");
  const mirrored = rememberMode({}, row, "mirror");
  assert.equal(modeOf(row, mirrored).name, "mac-espelhado");
  assert.deepEqual(readRememberedModes(), mirrored, "and written through");
  assert.equal(
    modeOf(row, rememberMode(mirrored, row, "virtual")).name,
    "mac-virtual",
  );
  // A line with one target is on that target's, whatever is remembered.
  const [lone] = rowsOf([{ ...MIRROR, name: "mac-virtual" }]);
  assert.equal(modeOf(lone, mirrored).name, "mac-virtual");
});

// The gateway's own computer, listed to a browser that is at it.
const AT_IT = { host: "127.0.0.1", computer: "Mac da Ana", here: true };

test("the Mac this browser is on is opened mirrored, and its mode is a mark that says why", () => {
  const [row] = rowsOf([
    { ...VIRTUAL, name: "mac-virtual", ...AT_IT },
    { ...MIRROR, name: "mac-espelhado", ...AT_IT },
  ]);
  // Never on a screen of its own: the first time, and whatever was remembered
  // for it from a browser somewhere else.
  assert.equal(modeOf(row, {}).name, "mac-espelhado");
  assert.equal(
    modeOf(row, rememberMode({}, row, "virtual")).name,
    "mac-espelhado",
  );
  const on = modeOf(row, {});
  const [mode] = placesOf(on, options(on), ABLE, true);
  assert.deepEqual(mode && [mode.glyph, mode.key], ["mode-mirror", false]);
  assert.equal(
    mode && en(mode.says),
    "Mirrored. Virtual is off on this Mac: it would turn off the screens you are using.",
  );
  assert.equal(
    mode && sayWords("pt-BR", mode.says),
    "Espelhado. O Virtual fica desligado neste Mac: ele apagaria as telas que você está usando.",
  );
  assert.equal(options(on).blocked, null, "and it opens");

  // The same Mac, listed to a browser anywhere else, keeps both modes.
  const [away] = rowsOf([
    { ...VIRTUAL, name: "mac-virtual", ...AT_IT, here: false },
    { ...MIRROR, name: "mac-espelhado", ...AT_IT, here: false },
  ]);
  assert.equal(modeOf(away, {}).name, "mac-virtual");
  assert.deepEqual(
    places(modeOf(away, {}), undefined, ABLE, PLAIN_ADDRESS, true)[0],
    [
      "mode-virtual",
      "Virtual: picture and sound come here; the Mac is left without picture and without sound",
      true,
    ],
  );
});

test("the Mac this browser is on is not opened on a screen of its own, and the line says why", () => {
  // Listed in the virtual mode alone, and in the compatible one on a screen of
  // its own: each a line of one target, with no other mode to stand on.
  for (const offered of [VIRTUAL, STANDARD_OWN]) {
    const name = offered.subtype ?? "";
    assert.equal(options({ ...offered, ...AT_IT }).blocked, "AL-2602", name);
    assert.equal(options(offered).blocked, null, `${name}, from elsewhere`);
  }
  assert.match(say("en-US", "AL-2602"), /turn its screens off/);
  assert.match(say("pt-BR", "AL-2602"), /apagaria as telas dele/);
  // That comes before what this browser can take: nothing would open it here.
  assert.equal(
    options({ ...VIRTUAL, ...AT_IT, passthroughOnly: true }, undefined, UNABLE)
      .blocked,
    "AL-2602",
  );
  // Its screens as they are, mirrored or in the compatible mode, open as ever,
  // and a line of the mirrored mode alone says what it always said.
  for (const offered of [MIRROR, STANDARD]) {
    assert.equal(options({ ...offered, ...AT_IT }).blocked, null);
  }
  assert.deepEqual(places({ ...MIRROR, ...AT_IT })[0], [
    "mode-mirror",
    "Mirrored: mirrors everything, the sound perfect",
    false,
  ]);
});

test("unreadable storage remembers nothing and still returns the choice", () => {
  storage.set("alumia.targetChoices", "not json");
  storage.set("alumia.rowModes", "not json");
  assert.deepEqual(readRememberedChoices(), {});
  assert.deepEqual(readRememberedModes(), {});
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(readRememberedChoices(), {});
  assert.deepEqual(rememberChoice({}, "win", { size: "window" }), {
    win: { size: "window" },
  });
});
