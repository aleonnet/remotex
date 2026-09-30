// The picture of an RDP host's graphics pipeline, kept on the GPU and shown from
// there.
//
// The compositor's framebuffer is in the module's memory, which its threads share
// (egfxCompositor.ts), and the desktop's 2D canvas takes no image data out of a
// shared memory. A WebGL texture takes an upload from one as it is. So the
// pipeline's picture is a texture on the WebGL canvas the page shows over the
// desktop's (glPicture.ts), drawn whole after each upload. Drawing the painted
// rectangles from it onto the desktop's canvas instead made the GPU copy the whole
// picture again for every run, which on an integrated GPU was more work than
// everything else presenting it.
import type { ComposedRun } from "./egfxCompositor.ts";
import { openPictureCanvas } from "./glPicture.ts";

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

// The texture's top row at the top: the framebuffer is top row first, where the
// canvas's rows go up. Texel coordinates at full precision: at half precision a
// wide desktop's neighbouring columns share a value, and NEAREST then repeats or
// drops one.
const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D picture;
in vec2 uv;
out vec4 color;
void main() {
  color = vec4(texture(picture, vec2(uv.x, 1.0 - uv.y)).rgb, 1.0);
}`;

/** A pipeline's picture on `canvas`, the one the page shows it on. */
export function createGraphicsPicture(
  canvas: OffscreenCanvas,
): GraphicsPicture {
  const surface = openPictureCanvas(canvas, FRAGMENT);
  const { gl } = surface;
  let texture: WebGLTexture | null = null;
  let width = 0;
  let height = 0;

  // A texture of the framebuffer's size, blank: WebGL zero-fills what it makes.
  // WebGL reports a refused allocation as an error flag, not an exception, and a
  // draw from the texture it did not make is blank: so it is checked here, and
  // ends the pipeline rather than acknowledging a blank.
  const resize = (w: number, h: number) => {
    surface.resize(w, h);
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

  return {
    upload(run) {
      surface.usable();
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
      surface.draw();
    },
    blank(w, h) {
      surface.usable();
      if (w === 0 || h === 0) {
        return;
      }
      resize(w, h);
      surface.draw();
    },
    close() {
      gl.deleteTexture(texture);
      texture = null;
      surface.close();
    },
  };
}
