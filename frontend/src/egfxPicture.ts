// The picture of an RDP host's graphics pipeline, kept on the GPU and shown from
// there.
//
// The compositor's framebuffer is in the module's memory, which its threads share
// (egfxCompositor.ts), and the desktop's 2D canvas takes no image data out of a
// shared memory. A WebGL texture takes an upload from one as it is. So the
// pipeline's picture is a texture on a WebGL canvas, drawn whole after each
// upload — and that canvas is one the page shows, over the desktop's
// (RemoteDesktop.tsx). Drawing the painted rectangles from it onto the desktop's
// canvas instead made the GPU copy the whole picture again for every run, which
// on an integrated GPU was more work than everything else presenting it.
//
// The canvas outlives a pipeline: it is the page's, handed to the paint worker
// once, and its WebGL context is the one it will ever have. A picture is what one
// pipeline keeps in that context, and gives back.
//
// Without WebGL 2 there is no pipeline: the page says so, and the gateway's own
// encoding is how such a browser sees such a host.
import type { ComposedRun } from "./egfxCompositor.ts";

export interface GraphicsPicture {
  /**
   * Take a run's painted rectangles into the picture, and draw it. Throws once
   * the browser has taken the GPU away (a lost context), after which nothing more
   * is drawn.
   */
  upload(run: ComposedRun): void;
  /**
   * The picture at this size, black: the desktop's canvas was replaced at it, and
   * the pipeline's reset that draws the new desktop has not been composed yet.
   */
  blank(width: number, height: number): void;
  /**
   * Give the GPU its memory back, and leave the canvas black: what it shows next
   * is another pipeline's.
   */
  close(): void;
}

// One triangle over the whole canvas, the texture's top row at the top: the
// framebuffer is top row first, where the canvas's rows go up.
const VERTEX = `#version 300 es
out vec2 uv;
void main() {
  uv = vec2((gl_VertexID & 1) * 2, gl_VertexID & 2);
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;
// Texel coordinates at full precision: at half precision a wide desktop's
// neighbouring columns share a value, and NEAREST then repeats or drops one.
const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D picture;
in vec2 uv;
out vec4 color;
void main() {
  color = vec4(texture(picture, vec2(uv.x, 1.0 - uv.y)).rgb, 1.0);
}`;

function shader(gl: WebGL2RenderingContext, kind: number, source: string) {
  const made = gl.createShader(kind);
  if (!made) {
    throw new Error("WebGL 2 gave no shader");
  }
  gl.shaderSource(made, source);
  gl.compileShader(made);
  return made;
}

/** A pipeline's picture on `canvas`, the one the page shows it on. */
export function createGraphicsPicture(
  canvas: OffscreenCanvas,
): GraphicsPicture {
  // The canvas's one context: made by the first pipeline, the same one after.
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!gl) {
    throw new Error("WebGL 2 is not available");
  }
  if (gl.isContextLost()) {
    throw new Error("the browser took the picture's WebGL context away");
  }
  let lost = false;
  const listening = new AbortController();
  canvas.addEventListener(
    "webglcontextlost",
    (event) => {
      event.preventDefault();
      lost = true;
    },
    { signal: listening.signal },
  );
  const vertex = shader(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(
      `WebGL 2 refused the picture's shaders: ${gl.getProgramInfoLog(program)}`,
    );
  }
  gl.useProgram(program);
  const largest = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  let texture: WebGLTexture | null = null;
  let width = 0;
  let height = 0;

  // A texture of the framebuffer's size, blank: WebGL zero-fills what it makes.
  // WebGL reports a refused size or allocation as an error flag, not an
  // exception, and a draw from the texture it did not make is blank: so each
  // is checked here, and ends the pipeline rather than acknowledging a blank.
  const resize = (w: number, h: number) => {
    if (w > largest || h > largest) {
      throw new Error(
        `the GPU takes no picture over ${largest} pixels a side (the host's is ${w}x${h})`,
      );
    }
    canvas.width = w;
    canvas.height = h;
    if (gl.drawingBufferWidth !== w || gl.drawingBufferHeight !== h) {
      throw new Error(
        `the GPU gave a ${gl.drawingBufferWidth}x${gl.drawingBufferHeight} canvas for a ${w}x${h} picture`,
      );
    }
    gl.viewport(0, 0, w, h);
    if (texture) {
      gl.deleteTexture(texture);
    }
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      throw new Error(
        `the GPU refused a ${w}x${h} picture (WebGL error 0x${error.toString(16)})`,
      );
    }
    width = w;
    height = h;
  };

  const usable = () => {
    if (lost) {
      throw new Error("the browser took the picture's WebGL context away");
    }
  };

  return {
    upload(run) {
      usable();
      if (run.width === 0 || run.height === 0) {
        return;
      }
      if (run.resized || run.width !== width || run.height !== height) {
        resize(run.width, run.height);
      }
      // Each rectangle straight out of the framebuffer, at its stride.
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, width);
      const rects = run.painted;
      for (let i = 0; i + 3 < rects.length; i += 4) {
        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, rects[i]);
        gl.pixelStorei(gl.UNPACK_SKIP_ROWS, rects[i + 1]);
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          rects[i],
          rects[i + 1],
          rects[i + 2],
          rects[i + 3],
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          run.pixels,
          0,
        );
      }
      // Whole, every time: the canvas's drawing buffer is not kept from one frame
      // the browser shows to the next.
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    blank(w, h) {
      usable();
      if (w === 0 || h === 0) {
        return;
      }
      resize(w, h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    close() {
      listening.abort();
      if (lost) {
        return;
      }
      // One black pixel: a canvas sized to nothing keeps showing its last frame.
      canvas.width = 1;
      canvas.height = 1;
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.deleteTexture(texture);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      texture = null;
    },
  };
}
