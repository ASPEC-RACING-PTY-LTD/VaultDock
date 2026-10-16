"""Builds every VaultDock icon from the master logo (assets/brand/logo.png).

Requires Pillow. Run from anywhere: python scripts/make_icons.py
"""
import os

from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "assets", "brand", "logo.png")


def out(*parts):
    path = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


def square_master(margin=0.03):
    """Trims transparent edges and centres the logo on a square canvas."""
    im = Image.open(SOURCE).convert("RGBA")
    im = im.crop(im.getchannel("A").getbbox())
    side = int(max(im.size) * (1 + 2 * margin))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
    return canvas


def sized(master, px):
    im = master.resize((px, px), Image.LANCZOS)
    if px <= 48:
        # Small sizes lose edge contrast when downscaled; restore a little.
        im = im.filter(ImageFilter.UnsharpMask(radius=0.6, percent=60, threshold=1))
    return im


def save_png(master, px, *path):
    sized(master, px).save(out(*path), optimize=True)


def save_ico(master, sizes, *path):
    images = [sized(master, s) for s in sizes]
    images[-1].save(out(*path), format="ICO", sizes=[(s, s) for s in sizes], append_images=images[:-1])


def main():
    m = square_master()
    # Desktop app: Wails app icon (also the notification image), window and
    # installer icon, tray icon, and the logo inside the app.
    save_png(m, 1024, "desktop", "build", "appicon.png")
    save_ico(m, [16, 20, 24, 32, 40, 48, 64, 128, 256], "desktop", "build", "windows", "icon.ico")
    save_ico(m, [16, 20, 24, 32, 40, 48, 64], "desktop", "assets", "tray.ico")
    save_png(m, 256, "desktop", "frontend", "src", "logo.png")
    # Web app: favicon, touch icon and the logo in the sidebar and sign-in page.
    save_ico(m, [16, 32, 48], "web", "public", "favicon.ico")
    save_png(m, 64, "web", "public", "favicon.png")
    save_png(m, 180, "web", "public", "apple-touch-icon.png")
    save_png(m, 256, "web", "public", "logo.png")
    print("icons written")


if __name__ == "__main__":
    main()
