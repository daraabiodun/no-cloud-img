# nocloud.img

Compress, resize and convert images, and strip their metadata. Runs entirely in the browser. No backend, no upload, no build step.

## Run

Open `index.html`. That works from `file://` because the script is a classic script, not an ES module (Chrome blocks module scripts on `file://`).

For anything you intend to ship, serve it over HTTPS from any static host.

## What it does

| Tool | Behavior |
| --- | --- |
| Compress | Quality slider for JPEG, WebP and AVIF. Live size comparison against the original. |
| Resize | Presets (100, 75, 50, 25 percent) or exact width and height. Ratio lock on by default. Downscale only. |
| Convert | JPEG, PNG, WebP, and AVIF where the browser can encode it. Unsupported formats are not shown. |
| Strip metadata | Reads and displays EXIF (camera, lens, date, exposure, GPS), then removes all of it on export. |

Input: drop, tap to choose, or paste from the clipboard.

## How it works

1. `createImageBitmap(file, { imageOrientation: 'from-image' })` decodes the file and bakes in EXIF rotation, so orientation is never lost when the tag is dropped.
2. Scaling halves the image repeatedly until it is within 2x of the target, then does the final draw. A single large jump aliases badly.
3. `canvas.toBlob(type, quality)` encodes. The result is verified against the requested MIME type, because browsers silently fall back to PNG for formats they cannot encode.
4. Slider and size changes are debounced, and every encode carries a token so a slow stale result can never overwrite a newer one.
5. Metadata is read from the original file with `exifr` (lite build), loaded lazily. Export always goes through a canvas, so no metadata survives, by construction.

## Decisions and limits

- **Strip is not optional.** Canvas re-encoding drops all metadata. A "keep EXIF" toggle would mean re-injecting segments by hand and fixing the orientation tag so it does not double-rotate. Not worth it for a privacy tool.
- **No upscaling.** It only adds bytes.
- **Caps.** 50 MB input, 100 megapixels. iOS Safari limits canvas area well below that, so very large images can fail to encode. The error says so and suggests smaller dimensions.
- **Animated GIF and APNG** export their first frame only.
- **SVG and HEIC** are not supported. Decode support varies by browser, and the error message says so.
- **AVIF encoding** depends on the browser. It is feature-detected at startup, not assumed.
- **Color profiles** are not preserved. Output is treated as sRGB.

## Dependencies

One runtime dependency: [`exifr`](https://github.com/MikeKovarik/exifr) 7.1.3 (lite build), pinned and loaded from jsDelivr via dynamic `import()`. Dynamic imports cannot use Subresource Integrity, so this is a supply-chain trust decision. If it fails to load, metadata display degrades gracefully and export is unaffected.

For production, self-host that file and drop the CDN. Also set a CSP header, for example:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' blob: data:
```

(Add `https://cdn.jsdelivr.net` to `script-src` only if you keep the CDN import.)

Fonts (Geist, Geist Mono) come from Google Fonts and fall back to system fonts.

## Files

```
index.html   markup
style.css    styles
script.js    all logic, no globals
README.md    this file
```
