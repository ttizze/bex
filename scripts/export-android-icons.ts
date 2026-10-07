#!/usr/bin/env node

// Renders the Android launcher and splash artwork from the Icon Composer sources.
//
// Icon Composer exports already contain a rounded-square silhouette, and Android masks
// the central 72dp of a 108dp adaptive canvas, so exporting them as a foreground produces
// a double-framed icon with the logo cropped by the mask. Instead, each variant gets a
// full-bleed background layer (the artwork behind the logo) and a transparent foreground
// that keeps the variant's logo layer inside the safe zone.
//
// The Android 12+ splash screen masks its icon to a circle covering the central two thirds
// of a 288dp canvas, which is the same proportion the launcher crops. Composing the two
// adaptive layers into one 288dp image therefore makes the splash frame the logo exactly
// like the launcher icon does.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import sharp from "sharp";

type IconVariant = "dev" | "nightly" | "prod";

// 108dp at xxxhdpi. Expo's prebuild derives every launcher density bucket from this.
const ADAPTIVE_CANVAS = 432;
// 288dp at xxxhdpi: the full Android 12+ splash canvas, so the icon needs no upscaling.
const SPLASH_CANVAS = 1152;
// Logo height as a fraction of the 108dp canvas. The visible area is 72dp (66dp
// guaranteed), so 0.5 leaves the logo inside the mask with room for the launcher's own
// zoom effects.
const LOGO_FRACTION = 0.5;
// Notification icons are a 24dp silhouette at xxxhdpi with a 2dp margin.
const NOTIFICATION_CANVAS = 96;
const NOTIFICATION_LOGO_FRACTION = 20 / 24;
// Icon Composer positions layers on a 1024pt canvas, with translation relative to center.
const COMPOSER_CANVAS_PT = 1024;
const SVG_DENSITY = 300;
const OUTPUT_DIRECTORY = "apps/mobile/assets";
// Production has no background artwork, so its splash composes onto the adaptive color.
const PRODUCTION_BACKGROUND_COLOR = "#FFFFFF";
// The production logo's ink and paper colors. The silhouette keeps ink (and the antenna)
// and drops paper, so the face reads as a cutout in the monochrome and notification icons.
const LOGO_INK = [27, 27, 31] as const;
const LOGO_PAPER = [253, 253, 252] as const;

export class AndroidIconRenderError extends Schema.TaggedError<AndroidIconRenderError>()(
  "AndroidIconRenderError",
  { layer: Schema.String, cause: Schema.Defect() },
) {}

// The layer sources clip to a 10pt rounded rectangle for the iOS silhouette. Android
// applies its own mask, so the layer must bleed to the canvas edge.
const fullBleed = (svg: string) =>
  svg.replace(/<rect width="128" height="128" rx="10"\/>/, '<rect width="128" height="128"/>');

const rasterize = (layer: string, svg: string, width: number, height = width) =>
  Effect.tryPromise({
    try: () =>
      sharp(Buffer.from(svg), { density: SVG_DENSITY }).resize(width, height).png().toBuffer(),
    catch: (cause) => new AndroidIconRenderError({ layer, cause }),
  });

const composite = (
  layer: string,
  base: Buffer,
  overlays: ReadonlyArray<{ input: Buffer; left?: number; top?: number }>,
) =>
  Effect.tryPromise({
    try: () =>
      sharp(base)
        .composite([...overlays])
        .png()
        .toBuffer(),
    catch: (cause) => new AndroidIconRenderError({ layer, cause }),
  });

const solidCanvas = (layer: string, size: number, background: string) =>
  Effect.tryPromise({
    try: () =>
      sharp({ create: { width: size, height: size, channels: 4, background } })
        .png()
        .toBuffer(),
    catch: (cause) => new AndroidIconRenderError({ layer, cause }),
  });

const readLayerSource = Effect.fn("androidIcons.readLayerSource")(function* (
  repositoryRoot: string,
  variant: IconVariant,
  file: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* fs.readFileString(
    path.join(repositoryRoot, "assets", variant, "app-icon.icon", "Assets", file),
  );
});

const logoLayerPath = (repositoryRoot: string, variant: IconVariant) =>
  Effect.map(Path.Path, (path) =>
    path.join(repositoryRoot, "assets", variant, "app-icon.icon", "Assets", "logo.png"),
  );

const renderForeground = Effect.fn("androidIcons.renderForeground")(function* (
  repositoryRoot: string,
  variant: IconVariant,
  size: number,
  fraction = LOGO_FRACTION,
) {
  const logo = yield* logoLayerPath(repositoryRoot, variant);
  const box = Math.round(size * fraction);
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
  return yield* Effect.tryPromise({
    try: async () => {
      const trimmed = await sharp(logo).trim().png().toBuffer();
      const fitted = await sharp(trimmed)
        .resize(box, box, { fit: "contain", background: transparent })
        .png()
        .toBuffer();
      return sharp({ create: { width: size, height: size, channels: 4, background: transparent } })
        .composite([{ input: fitted, gravity: "center" }])
        .png()
        .toBuffer();
    },
    catch: (cause) => new AndroidIconRenderError({ layer: `${variant}-foreground`, cause }),
  });
});

// A white silhouette whose alpha is the logo's coverage minus its paper, so Android can tint it.
const renderSilhouette = Effect.fn("androidIcons.renderSilhouette")(function* (
  repositoryRoot: string,
  size: number,
  fraction: number,
) {
  const foreground = yield* renderForeground(repositoryRoot, "prod", size, fraction);
  return yield* Effect.tryPromise({
    try: async () => {
      const { data, info } = await sharp(foreground).raw().toBuffer({ resolveWithObject: true });
      for (let offset = 0; offset < data.length; offset += 4) {
        const luminance = (data[offset]! + data[offset + 1]! + data[offset + 2]!) / 3;
        const ink = (LOGO_PAPER[0] - luminance) / (LOGO_PAPER[0] - LOGO_INK[0]);
        // The antenna's teal sits between ink and paper in luminance; treat it as ink.
        const chroma =
          Math.max(data[offset]!, data[offset + 1]!, data[offset + 2]!) -
          Math.min(data[offset]!, data[offset + 1]!, data[offset + 2]!);
        const coverage = Math.min(1, Math.max(0, ink + chroma / 128));
        data[offset] = 255;
        data[offset + 1] = 255;
        data[offset + 2] = 255;
        data[offset + 3] = Math.round(data[offset + 3]! * coverage);
      }
      return sharp(data, { raw: info }).png().toBuffer();
    },
    catch: (cause) => new AndroidIconRenderError({ layer: "silhouette", cause }),
  });
});

const renderDevelopmentBackground = Effect.fn("androidIcons.renderDevelopmentBackground")(
  function* (repositoryRoot: string, size: number) {
    const paper = yield* readLayerSource(repositoryRoot, "dev", "background.svg");
    return yield* rasterize("dev-background", fullBleed(paper), size);
  },
);

const renderNightlyBackground = Effect.fn("androidIcons.renderNightlyBackground")(function* (
  repositoryRoot: string,
  size: number,
) {
  // Positions mirror assets/nightly/app-icon.icon/icon.json. The SVG blur filter is
  // dropped because Icon Composer ignores it and it smears at this raster size.
  const clouds = [
    { file: "cloud-lower-left.svg", scale: 25, translation: [-309.6375, 268.66077693836917] },
    {
      file: "cloud-upper-right.svg",
      scale: 15,
      translation: [387.9605131881942, -134.30064713259117],
    },
  ] as const;
  const k = size / COMPOSER_CANVAS_PT;
  const overlays = yield* Effect.forEach(clouds, (cloud) =>
    Effect.gen(function* () {
      const width = Math.round(64 * cloud.scale * k);
      const height = Math.round(32 * cloud.scale * k);
      const left = Math.round((COMPOSER_CANVAS_PT / 2 + cloud.translation[0]) * k - width / 2);
      const top = Math.round((COMPOSER_CANVAS_PT / 2 + cloud.translation[1]) * k - height / 2);
      const source = yield* readLayerSource(repositoryRoot, "nightly", cloud.file);
      const png = yield* rasterize(
        cloud.file,
        source.replace(/ filter="url\(#soft\)"/, ""),
        width,
        height,
      );
      const x0 = Math.max(0, left);
      const y0 = Math.max(0, top);
      const x1 = Math.min(size, left + width);
      const y1 = Math.min(size, top + height);
      const clipped = yield* Effect.tryPromise({
        try: () =>
          sharp(png)
            .extract({ left: x0 - left, top: y0 - top, width: x1 - x0, height: y1 - y0 })
            .png()
            .toBuffer(),
        catch: (cause) => new AndroidIconRenderError({ layer: cloud.file, cause }),
      });
      return { input: clipped, left: x0, top: y0 };
    }),
  );
  const sky = yield* readLayerSource(repositoryRoot, "nightly", "background.svg");
  const background = yield* rasterize("nightly-background", fullBleed(sky), size);
  return yield* composite("nightly-background", background, overlays);
});

const renderBackground = Effect.fn("androidIcons.renderBackground")(function* (
  repositoryRoot: string,
  variant: IconVariant,
  size: number,
) {
  switch (variant) {
    case "dev":
      return yield* renderDevelopmentBackground(repositoryRoot, size);
    case "nightly":
      return yield* renderNightlyBackground(repositoryRoot, size);
    case "prod":
      return yield* solidCanvas("prod-background", size, PRODUCTION_BACKGROUND_COLOR);
  }
});

const renderSplashIcon = Effect.fn("androidIcons.renderSplashIcon")(function* (
  repositoryRoot: string,
  variant: IconVariant,
) {
  const background = yield* renderBackground(repositoryRoot, variant, SPLASH_CANVAS);
  const foreground = yield* renderForeground(repositoryRoot, variant, SPLASH_CANVAS);
  return yield* composite(`${variant}-splash`, background, [{ input: foreground }]);
});

const exportAndroidIcons = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repositoryRoot = path.resolve(import.meta.dirname, "..");
  const outputs = [
    [
      "android-icon-foreground.png",
      yield* renderForeground(repositoryRoot, "prod", ADAPTIVE_CANVAS),
    ],
    [
      "android-icon-foreground-light.png",
      yield* renderForeground(repositoryRoot, "dev", ADAPTIVE_CANVAS),
    ],
    [
      "android-icon-background-dev.png",
      yield* renderDevelopmentBackground(repositoryRoot, ADAPTIVE_CANVAS),
    ],
    [
      "android-icon-background-nightly.png",
      yield* renderNightlyBackground(repositoryRoot, ADAPTIVE_CANVAS),
    ],
    ["android-splash-icon-dev.png", yield* renderSplashIcon(repositoryRoot, "dev")],
    ["android-splash-icon-nightly.png", yield* renderSplashIcon(repositoryRoot, "nightly")],
    ["android-splash-icon-prod.png", yield* renderSplashIcon(repositoryRoot, "prod")],
    [
      "android-icon-mark.png",
      yield* renderSilhouette(repositoryRoot, ADAPTIVE_CANVAS, LOGO_FRACTION),
    ],
    [
      "android-notification-icon.png",
      yield* renderSilhouette(repositoryRoot, NOTIFICATION_CANVAS, NOTIFICATION_LOGO_FRACTION),
    ],
  ] as const;
  for (const [name, contents] of outputs) {
    yield* fs.writeFile(path.join(repositoryRoot, OUTPUT_DIRECTORY, name), contents);
    yield* Console.log(`wrote ${OUTPUT_DIRECTORY}/${name}`);
  }
});

if (import.meta.main) {
  exportAndroidIcons.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
