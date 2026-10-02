# Known issues

Faults that are reproducible, understood well enough to recognise, and not
understood well enough to fix. Each entry says what it looks like, what has been
ruled out, and what would move it — so hitting one costs a lookup rather than an
investigation.

An issue leaves this file in one of two ways: it is fixed, or it turns out to be
something remotex is doing wrong, in which case it becomes work rather than a
note.

## Blurry text after dragging the window to a new size, on an RDP host's graphics pipeline

**What it looks like.** In an RDP session started with resize, whose host draws
through the graphics pipeline
([MS-RDPEGFX](rdp-client.md#the-graphics-pipeline-ms-rdpegfx)), dragging the
browser window's edge to resize it can leave the desktop's text blurry. It does
not clear on its own: the text stays blurry until the connection to the host is
ended and made again.

**What has been ruled out.** That it is remotex's. Microsoft's own Remote Desktop
client on a Mac, the Windows App, shows the same blurry text when its window is
dragged to a new size against the same kind of host, so the picture is what the
host sends for a desktop resized that way and not something this client's
decoders or the page make of it.

**What would move it.** Only a new connection to the host is known to: the
gateway's to it, started again from the picker, as Microsoft's client has to
disconnect and reconnect its own. It is recorded so that blurry text after a
resize is recognised as the host's rather than investigated as a decoder or
scaling fault in the gateway or the page.
