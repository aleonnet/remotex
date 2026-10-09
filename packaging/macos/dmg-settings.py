# How the disk image's window is laid out, for dmgbuild, which writes the Finder's
# own record of it (`.DS_Store`) with no Finder and no script driving one.
#
#   dmgbuild -s packaging/macos/dmg-settings.py -D app=<Alumia.app> -D background=<picture> \
#     -D volume_icon=<the volume's icon.icns> \
#     -D width=<n> -D height=<n> -D bar=<n> -D icon=<n> -D row=<n> -D left=<n> -D right=<n> \
#     -D x=<n> -D y=<n> Alumia <out.dmg>
#
# The places are the approved mockup's (`.am-dmgbody`): the app on the left and the way to
# Applications on the right, and the arrow and the sentence between and under them, which
# packaging/macos/dmg-background.swift draws. The numbers are handed over by
# packaging/build-mac-dmg.sh, which gives the same to the drawing and reads them back from
# the image it made: none is typed here.

import os.path

app = defines["app"]  # noqa: F821 - dmgbuild's own
name = os.path.basename(app)


def number(key):
    return int(defines[key])  # noqa: F821


# Compressed and read only, which is what is handed out.
format = "UDZO"
files = [app]
# What makes dragging work: without it the window has the app alone, and whoever installs
# has to find the folder.
symlinks = {"Applications": "/Applications"}
# The volume wears the system's own disk with the app's icon over it, on the desktop and in
# a sidebar: the build draws it (packaging/macos/dmg-icon.swift), dmgbuild copies it to
# `.VolumeIcon.icns` and marks the volume as having one, and the build reads both back.
icon = defines["volume_icon"]  # noqa: F821

background = defines["background"]  # noqa: F821
default_view = "icon-view"
# Where the window opens, from the screen's bottom left, which is all a window's record
# can say of it; and the picture, with the title bar over it.
window_rect = ((number("x"), number("y")), (number("width"), number("height") + number("bar")))
# Asked of the Finder, which shows its path bar and its status bar all the same where
# its own settings have them on: the drawing keeps clear of the window's foot.
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False

arrange_by = None
icon_size = number("icon")
text_size = 12
label_pos = "bottom"
icon_locations = {name: (number("left"), number("row")), "Applications": (number("right"), number("row"))}
