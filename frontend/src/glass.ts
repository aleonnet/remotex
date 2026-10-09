// The glass: what is behind the screens before a session, and the three moments
// of a screen lighting.
//
// Before a session it is a still. The grid of subpixels barely shows, and with a
// mouse a lens around the pointer shows more of it; a finger shows nothing. When
// a computer is opened the dark glass comes on as a tube does, read backwards
// from how a tube goes off: a spot at the centre, the spot drawn out into a
// line, the line opened into the picture with red ahead of green ahead of blue,
// and then the glow rising as the tube warms, after which it stays lit. When the
// first picture arrives the lit grid leaves cell by cell over it. And when the
// session ends, or the opening is cancelled, the screen goes off as a tube
// does: it closes to a line across the middle, and the line draws in to a spot.
// What the picture leaves as it closes is the glass not lit, as it is before a
// session, lens and all. It is drawn in WebGL 2, at one device pixel per CSS pixel, and only when
// something changed. Its colours are the tokens', read from the page: none is
// written in a shader.
//
// What a tube really does, and what is licence here, is in
// docs/research/2026-10-04-1314-tela-de-tubo.md.
//
// Everything that moves here is a subscriber of the one clock (clock.ts). Where
// motion is reduced a moment is not played: its end state is drawn at once.
//
// It is decoration with no function. A browser without WebGL 2 is given a still
// of CSS in its place (alumia.css, `.al-still`) and the page works the same.

import { moves, run, stop } from "./clock.ts";

const VERTEX = `#version 300 es
in vec2 a_corner;
void main() { gl_Position = vec4(a_corner, 0.0, 1.0); }`;

// The unlit glass: a still, with a lens around the pointer.
const GLASS = `#version 300 es
precision mediump float;
uniform vec2 u_size; uniform vec2 u_pointer; uniform float u_cell; uniform float u_lens; uniform float u_grain;
uniform vec3 u_base; uniform vec3 u_red; uniform vec3 u_green; uniform vec3 u_blue;
out vec4 colour;
vec3 subpixel(vec2 at) {
  float column = mod(floor(at.x / u_cell), 3.0);
  float gap = step(0.18, fract(at.x / u_cell)) * step(0.12, fract(at.y / (u_cell * 3.0)));
  vec3 lit = column < 0.5 ? u_red : (column < 1.5 ? u_green : u_blue);
  return lit * gap;
}
void main() {
  vec2 at = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y);
  float near = u_lens * smoothstep(240.0, 0.0, distance(at, u_pointer));
  vec3 cell = subpixel(at);
  float lit = max(cell.r, max(cell.g, cell.b));
  colour = vec4(mix(u_base, cell, step(0.001, lit) * (u_grain + 0.46 * near * near)), 1.0);
}`;

// The screen comes on. Up to SPOT of the way it is a spot at the centre; up to
// LINE the spot is drawn out into a line; up to OPEN the line opens into the
// whole picture, each colour's edge a little behind the one before it; and from
// there the glow rises to the end. A still part of the way (`settled`) is past
// OPEN, so it is the whole grid, half warm.
const IGNITE = `#version 300 es
precision mediump float;
uniform vec2 u_size; uniform float u_cell; uniform float u_progress;
uniform vec3 u_base; uniform vec3 u_red; uniform vec3 u_green; uniform vec3 u_blue;
out vec4 colour;
const float SPOT = 0.03; const float LINE = 0.09; const float OPEN = 0.24;
void main() {
  vec2 at = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y);
  vec2 from = abs(at - u_size * 0.5);
  float column = mod(floor(at.x / u_cell), 3.0);
  float gap = step(0.18, fract(at.x / u_cell)) * step(0.12, fract(at.y / (u_cell * 3.0)));
  vec3 lit = column < 0.5 ? u_red : (column < 1.5 ? u_green : u_blue);
  // The beam: a spot, then the line it is drawn out into, fading as the picture opens.
  float reach = 3.0 + smoothstep(SPOT, LINE, u_progress) * u_size.x * 0.5;
  float shows = smoothstep(0.0, SPOT, u_progress) * (1.0 - smoothstep(LINE + 0.02, OPEN, u_progress));
  float beam = shows * (1.0 - smoothstep(0.0, 2.5, from.y)) * (1.0 - smoothstep(reach - 3.0, reach, from.x));
  float halo = shows * 0.35 * (1.0 - smoothstep(0.0, 14.0, from.y)) * (1.0 - smoothstep(reach - 3.0, reach + 10.0, from.x));
  // The picture opening, a colour at a time, and warming once it is open.
  float opened = smoothstep(LINE, OPEN, u_progress - column * 0.02) * u_size.y * 0.56;
  float inside = step(LINE, u_progress) * (1.0 - smoothstep(opened - 2.0, opened + 2.0, from.y));
  float warm = 0.26 + 0.34 * smoothstep(OPEN, 1.0, u_progress);
  vec3 grid = lit * gap * (0.035 + warm * inside);
  vec3 light = (u_red + u_green + u_blue) * (beam * 0.62 + halo * 0.3);
  colour = vec4(u_base + grid + light, 1.0);
}`;

// Dissolving into the frame: the lit grid leaves cell by cell, over the real picture.
const DISSOLVE = `#version 300 es
precision mediump float;
uniform vec2 u_size; uniform float u_cell; uniform float u_progress;
uniform vec3 u_base; uniform vec3 u_red; uniform vec3 u_green; uniform vec3 u_blue;
out vec4 colour;
float chance(vec2 cell) { return fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 at = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y);
  float column = mod(floor(at.x / u_cell), 3.0);
  float gap = step(0.18, fract(at.x / u_cell)) * step(0.12, fract(at.y / (u_cell * 3.0)));
  vec3 lit = column < 0.5 ? u_red : (column < 1.5 ? u_green : u_blue);
  float stays = step(u_progress, chance(floor(at / (u_cell * 3.0))));
  colour = vec4((u_base + lit * gap * 0.635) * stays, stays);
}`;

// The screen goes off. To FALL of the way it closes from above and from below
// on a line across the middle; from there the line draws in to a spot, which is
// what is left when it ends. Where the picture has gone it is the glass not
// lit: the grid barely showing, and more of it around the pointer, as before a
// session. Where it is still open, over a session it is the remote's picture,
// seen through (`u_over` 1); over the lighting it is the lit grid. Its end is a
// still of its own (`out`), which is what goes over the list that comes back
// (alumia.css, `.al-afterglow`).
const OFF = `#version 300 es
precision mediump float;
uniform vec2 u_size; uniform vec2 u_pointer; uniform float u_cell; uniform float u_lens; uniform float u_grain;
uniform float u_progress; uniform float u_over;
uniform vec3 u_base; uniform vec3 u_red; uniform vec3 u_green; uniform vec3 u_blue;
out vec4 colour;
const float FALL = 0.56;
void main() {
  vec2 at = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y);
  vec2 from = abs(at - u_size * 0.5);
  float column = mod(floor(at.x / u_cell), 3.0);
  float gap = step(0.18, fract(at.x / u_cell)) * step(0.12, fract(at.y / (u_cell * 3.0)));
  vec3 lit = column < 0.5 ? u_red : (column < 1.5 ? u_green : u_blue);
  float fall = smoothstep(0.0, FALL, u_progress);
  float draw = smoothstep(FALL, 1.0, u_progress);
  // What is still open of the picture, by its half height: nothing, once it has fallen.
  float open = (1.0 - fall * fall) * u_size.y * 0.5;
  float inside = step(0.5, open) * (1.0 - smoothstep(open - 1.0, open + 1.0, from.y));
  // The line the picture falls to, brighter as the picture closes on it, and the spot.
  float reach = 3.0 + (1.0 - draw) * u_size.x * 0.5;
  float shows = smoothstep(0.4, 1.0, fall);
  float beam = shows * (1.0 - smoothstep(0.0, 2.5, from.y)) * (1.0 - smoothstep(reach - 3.0, reach, from.x));
  float halo = shows * 0.35 * (1.0 - smoothstep(0.0, 14.0, from.y)) * (1.0 - smoothstep(reach - 3.0, reach + 10.0, from.x));
  vec3 light = (u_red + u_green + u_blue) * (beam * 0.62 + halo * 0.3);
  // The glass not lit, and the grid still lit where it is the lighting that goes off.
  float near = u_lens * smoothstep(240.0, 0.0, distance(at, u_pointer));
  vec3 unlit = mix(u_base, lit, gap * (u_grain + 0.46 * near * near));
  vec3 glass = mix(unlit, u_base + lit * gap * 0.635, inside * (1.0 - u_over));
  // Seen through where the picture is still open over a session; the glass elsewhere.
  float covers = max(1.0 - inside * u_over, min(1.0, beam + halo));
  colour = vec4(glass * covers + light, covers);
}`;

const FRAGMENTS = {
  glass: GLASS,
  ignite: IGNITE,
  dissolve: DISSOLVE,
  off: OFF,
};

type Shader = keyof typeof FRAGMENTS;

/** A moment of the screen lighting, and how long each lasts, in milliseconds. */
export type Moment = "ignite" | "dissolve" | "off";

export const LASTS: Record<Moment, number> = {
  ignite: 5000,
  dissolve: 600,
  off: 400,
};

/**
 * What the glass shows while nothing moves: the unlit glass of the theme; the
 * dark glass lit (after the lighting), lit part of the way (a session that is
 * waited for without having been opened here), waiting (lit part of the way and
 * breathing, over a session whose picture has not come: Waiting.tsx), or not lit
 * at all; and a screen that went off, which is the dark glass as it is before a
 * session, with the spot at its centre.
 */
export type Still = "glass" | "lit" | "settled" | "waiting" | "unlit" | "out";

// How far the lighting has gone in each still that is the lighting's.
const LIT: Record<Exclude<Still, "glass" | "out">, number> = {
  lit: 1,
  settled: 0.62,
  waiting: 0.62,
  unlit: 0,
};

// The waiting still breathes: the light swells this far either way of where it
// stands, one breath taking this long. Slow enough to say "alive" and not
// "busy", on the one clock, and not at all where motion is reduced.
const BREATH = 0.1;
const BREATH_MS = 4000;

/** A subpixel's width in pixels. */
const CELL = 2;

/** How much of the grid shows where nothing is lit: a little more on the light
 *  ground, where a faint tint is harder to see. */
const GRAIN = { light: 0.07, dark: 0.045 };

// Where the mouse last was on the window, which is what a lens is drawn around.
// It is followed for every glass at once, so one mounted after the mouse moved
// has its lens where the pointer is and does not wait for the next move. A
// finger shows nothing.
const mouse = { x: 0, y: 0, known: false };
const following = new Set<() => void>();
let followed = false;

/** Tell `moved` of every move of the mouse, until what is returned is called. */
function follow(moved: () => void): () => void {
  if (!followed) {
    followed = true;
    addEventListener(
      "pointermove",
      (event) => {
        if (event.pointerType !== "mouse") {
          return;
        }
        mouse.x = event.clientX;
        mouse.y = event.clientY;
        mouse.known = true;
        for (const tell of following) {
          tell();
        }
      },
      { passive: true },
    );
  }
  following.add(moved);
  return () => following.delete(moved);
}

let able: boolean | null = null;

/**
 * Whether this browser draws the glass at all, which is whether it has WebGL 2:
 * asked once. Where it does not, nothing of a screen moves: the still stands.
 */
export function draws(): boolean {
  if (able === null) {
    const gl = document.createElement("canvas").getContext("webgl2");
    able = gl !== null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
  return able;
}

/** The glass on a canvas, drawn again by whoever knows something changed. */
export interface Glass {
  /** Draw what it shows now again: the theme or the size changed. */
  draw: () => void;
  /** Show `still`, ending any moment under way. */
  show: (still: Still) => void;
  /**
   * Play `moment`, and call `then` when it ends. The lighting ends lit and
   * stays so; the grid leaving ends with nothing left to show; and going off
   * ends on the screen that went off (`out`). `over` is whether
   * what goes off is a session's picture under the glass, as against the
   * lighting itself. Where motion is reduced the end is drawn, and `then`
   * called, at once. `then` is told whether the moment was played, which is
   * whether there was anything to see.
   */
  play: (
    moment: Moment,
    then: (played: boolean) => void,
    over?: boolean,
  ) => void;
  /** Stop following the pointer and the size, and give the context back. */
  release: () => void;
}

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) {
    return null;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

function link(
  gl: WebGL2RenderingContext,
  vertex: WebGLShader,
  source: string,
): WebGLProgram | null {
  const fragment = compile(gl, gl.FRAGMENT_SHADER, source);
  if (!fragment) {
    return null;
  }
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, "a_corner");
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

function programs(
  gl: WebGL2RenderingContext,
): Record<Shader, WebGLProgram> | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  if (!vertex) {
    return null;
  }
  const built: Partial<Record<Shader, WebGLProgram>> = {};
  for (const [name, source] of Object.entries(FRAGMENTS)) {
    const program = link(gl, vertex, source);
    if (!program) {
      return null;
    }
    built[name as Shader] = program;
  }
  return built as Record<Shader, WebGLProgram>;
}

/**
 * Draw the glass on `canvas`, showing `still`, in the colours `scene` has for
 * the tokens, with its lens following the mouse. Null where the browser has no
 * WebGL 2 or will not build the shaders: the caller shows the still of CSS.
 */
export function mountGlass(
  canvas: HTMLCanvasElement,
  scene: HTMLElement,
  still: Still = "glass",
): Glass | null {
  const gl = canvas.getContext("webgl2", {
    premultipliedAlpha: true,
    antialias: false,
  });
  const probe = document
    .createElement("canvas")
    .getContext("2d", { willReadFrequently: true });
  const built = gl && programs(gl);
  if (!gl || !built || !probe) {
    return null;
  }
  // One triangle that covers the canvas.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // A token's colour as the three numbers a shader takes. The browser does the
  // conversion: the colour is painted on one pixel and read back.
  const colour = (token: string): [number, number, number] => {
    probe.canvas.width = probe.canvas.height = 1;
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = getComputedStyle(scene).getPropertyValue(token).trim();
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
    return [r / 255, g / 255, b / 255];
  };

  // Whether what goes off is a session's picture, seen through the glass.
  let over = true;
  // What is on the canvas: a still, or a moment and how far it has gone.
  let shown: Still = still;
  let moment: Moment | null = null;

  const paint = (shader: Shader, progress: number) => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const program = built[shader];
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook
    gl.useProgram(program);
    const put = (uniform: string, ...value: number[]) => {
      const where = gl.getUniformLocation(program, uniform);
      if (!where) {
        return;
      }
      if (value.length === 1) {
        gl.uniform1f(where, value[0]);
      } else if (value.length === 2) {
        gl.uniform2f(where, value[0], value[1]);
      } else {
        gl.uniform3f(where, value[0], value[1], value[2]);
      }
    };
    // A screen is the dark glass in either theme; only the glass before a
    // session follows the theme.
    const light =
      shader === "glass" &&
      document.documentElement.dataset.alTheme === "light";
    const box = canvas.getBoundingClientRect();
    gl.viewport(0, 0, width, height);
    put("u_size", width, height);
    put("u_cell", CELL);
    put("u_grain", light ? GRAIN.light : GRAIN.dark);
    put("u_progress", progress);
    put("u_pointer", mouse.x - box.left, mouse.y - box.top);
    // No lens where nothing moves: it would stand where the mouse once was.
    put("u_lens", mouse.known && moves() ? 1 : 0);
    put("u_over", over ? 1 : 0);
    put(
      "u_base",
      ...colour(
        shader === "glass" ? "--al-surface-base" : "--al-color-brand-glass",
      ),
    );
    put("u_red", ...colour("--al-color-brand-red"));
    put("u_green", ...colour("--al-color-brand-green"));
    put("u_blue", ...colour("--al-color-brand-blue"));
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // The waiting still's breath: a subscriber of the clock for as long as that
  // still is shown, and the still alone where the clock refuses to run it.
  let breath: ((now: number) => boolean) | null = null;
  const breathe = () => {
    if (breath) {
      return;
    }
    const step = (now: number) => {
      if (breath !== step) {
        return false;
      }
      paint(
        "ignite",
        LIT.waiting + BREATH * Math.sin((now / BREATH_MS) * 2 * Math.PI),
      );
      return true;
    };
    breath = step;
    if (!run(step)) {
      breath = null;
      paint("ignite", LIT.waiting);
    }
  };
  const rest = () => {
    if (breath) {
      stop(breath);
      breath = null;
    }
  };

  const draw = () => {
    if (moment) {
      return;
    }
    if (shown === "glass") {
      paint("glass", 0);
    } else if (shown === "out") {
      paint("off", 1);
    } else if (shown === "waiting") {
      breathe();
    } else {
      paint("ignite", LIT[shown]);
    }
  };

  let playing: ((now: number) => boolean) | null = null;
  const end = () => {
    if (playing) {
      stop(playing);
      playing = null;
    }
    rest();
    moment = null;
  };

  // The lens is the one thing of a still that moves, so it goes through the
  // clock: one frame for where the pointer is now, and none where motion is
  // reduced. Only the glass not lit has one.
  const lens = () => {
    draw();
    return false;
  };
  const unfollow = follow(() => {
    if (!moment && (shown === "glass" || shown === "out")) {
      run(lens);
    }
  });
  const resized = new ResizeObserver(draw);
  resized.observe(canvas);

  return {
    draw,
    show: (next) => {
      end();
      shown = next;
      draw();
    },
    play: (name, then, through = true) => {
      end();
      over = through;
      moment = name;
      // What is left when it ends, should it be drawn again: the lighting
      // leaves the glass lit, and going off the screen that went off.
      if (name === "ignite") {
        shown = "lit";
      } else if (name === "off") {
        shown = "out";
      }
      let started = 0;
      const step = (now: number) => {
        started ||= now;
        const progress = Math.min(1, (now - started) / LASTS[name]);
        paint(name, progress);
        if (progress < 1) {
          return true;
        }
        playing = null;
        moment = null;
        then(true);
        return false;
      };
      playing = step;
      if (!run(step)) {
        // Reduced motion: the end, at once.
        playing = null;
        moment = null;
        paint(name, 1);
        then(false);
      }
    },
    release: () => {
      end();
      unfollow();
      resized.disconnect();
      stop(lens);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
