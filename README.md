# ASCII Vision

Turn any web page into hacker mode. Page text becomes green terminal text, and images and videos become live ASCII art.

<!-- Add a demo GIF here once you have one:
![ASCII Vision demo](docs/demo.gif)
-->

## What it does

- **Page text:** black background, glowing monospace text, faint scanlines.
- **Images and thumbnails:** converted to ASCII art, including CSS background images.
- **Videos:** converted to ASCII in real time (about 15 frames per second).
- **Icons:** turned into white glowing silhouettes.
- **Four looks:** Matrix green, amber terminal, white, or full-color ASCII.
- **Detail slider:** from 80 to 400 characters across.

Everything runs on your computer. Nothing is collected or sent anywhere (see [PRIVACY.md](PRIVACY.md)).

## Install (Chrome, Edge, Brave)

1. Click **Code**, then **Download ZIP** on this page, and unzip it.
2. Open `chrome://extensions` (in Edge: `edge://extensions`).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the **`extension`** folder inside the unzipped download.
5. Open any website, click the ASCII Vision icon, and press **TURN ON**.

Shortcut: **Alt + Shift + A** turns it on or off.

If you installed it while a tab was already open, just open the popup once and it will start working in that tab. Refresh the tab if anything looks off.

## Settings

| Setting | What it does |
|---|---|
| Color mode | Matrix green, amber, white, or full-color ASCII |
| Detail | Maximum characters across. Higher is sharper but uses more CPU |

Tip: full-color mode on a large video is the heaviest setting. If it lags, lower the detail or use green mode.

## Known limits

- **DRM video** (Netflix, Prime Video and similar) can't be read by any extension, so it stays black.
- **Logos with several colors** become a single white shape, because every color inside an icon turns black and then white.
- **Icon fonts** on some sites may show as plain words.
- Pages that draw their own backgrounds on SVG icons can still show a white box.
- It does not run on `chrome://` pages or the Chrome Web Store.

## Why it needs access to all sites

The extension restyles whatever page you are on, and it downloads images from other domains so it can read their pixels (browsers block that from page scripts). That is why it asks to read and change data on all sites. It does this only on your device. No page content leaves your computer.

| Permission | Why |
|---|---|
| `storage` | Remembers on/off, color mode and detail |
| `scripting`, `activeTab` | Starts the effect in the tab you are using |
| All sites | Restyle any page and fetch its images locally |

## How it works (short version)

1. A CSS layer recolors text, fonts and glow.
2. A scanner finds `<img>`, `<video>` and CSS background images.
3. Each picture is shrunk to a small grid, measured for brightness, auto-contrast stretched, and mapped to characters.
4. The ASCII drawing is placed over the original (videos redraw every frame).

The main code is in `extension/content.js`.

## Development

No build step. Edit the files in `extension/`, then press the reload icon on `chrome://extensions` and refresh the page.

## License

MIT. See [LICENSE](LICENSE).
# ASCII-VISION
