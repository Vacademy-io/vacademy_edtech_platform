#!/usr/bin/env node
/**
 * Generator for the felted-clay icon set used by the Play and Cleaner Play
 * themes (and reused by the parent portal).
 *
 *   OPENROUTER_API_KEY=sk-... node scripts/generate-theme-icons.mjs
 *   OPENROUTER_API_KEY=sk-... node scripts/generate-theme-icons.mjs --only=books --force
 *   OPENROUTER_API_KEY=sk-... node scripts/generate-theme-icons.mjs --dry-run
 *
 * Sibling of scripts/generate-parent-icons.mjs, which stays as-is for the
 * assistant "teacher" character frames (it carries image-editing logic to keep
 * one character consistent across frames). This script covers the abstract
 * object icons and fixes two things that blocked that script's icon half:
 *
 *   1. BACKGROUND. generate-parent-icons.mjs's STYLE asks for a "Fully
 *      transparent background", which its own header warns makes the model
 *      paint a literal CHECKERBOARD. That is very likely why its `payments`
 *      and `attention` entries were never produced. Here we always render on
 *      solid white and key the background out afterwards.
 *   2. NO sharp DEPENDENCY. sharp is not installed in this repo, so that script
 *      silently degrades to writing unoptimised raw PNGs. Post-processing here
 *      runs through Pillow (scripts/lib/icon-postprocess.py), which is present,
 *      and does the alpha keying, optical-size trim, resize and WebP encode.
 *
 * OUTPUT CONTRACT — matches the shipped set exactly, verified against it:
 * 200x200 RGBA WebP with a transparent background for cleaner-play icons.
 * Anything else shows a white box on tinted cards and gradient surfaces.
 *
 * Raw model output goes to <dir>/raw/ which is gitignored; only the optimised
 * .webp is committed.
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, "..", "src", "assets");
const POSTPROCESS = join(__dirname, "lib", "icon-postprocess.py");
const URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * MODEL CHOICE.
 * `bytedance-seed/seedream-5-0-pro` is NOT available on OpenRouter — the
 * catalogue lists no seedream model at all (the bytedance-seed/* entries are
 * text-only), and requesting it returns a bare HTTP 500 rather than a clean
 * 404. google/gemini-3.1-flash-image is the model that produced the existing
 * felted-clay set (see generate-parent-icons.mjs), so using it again is also
 * the best guarantee that new icons sit in the same visual language.
 * Swap this if a closer model appears; keep the style constants identical.
 */
const MODEL = "google/gemini-3.1-flash-image";

/**
 * Style contract, kept deliberately close to generate-parent-icons.mjs's STYLE
 * so the two batches match, with the transparency instruction replaced by an
 * explicit white-background one (see note 1 above).
 */
const STYLE =
  "Matte felted-clay / soft plasticine texture with visible fibre grain. One centred object, " +
  "chunky rounded friendly shapes, no sharp edges. Soft warm palette: peach, terracotta, cream, " +
  "sage, warm off-white. Soft diffused studio lighting from upper left. " +
  "Solid pure white background (#FFFFFF) — no checkerboard, no transparency, no border, no gradient, " +
  "and NO shadow cast onto the background. " +
  "No text, no letters, no numbers, no UI, no hands, no people. Isolated app-icon style, " +
  "generous even padding, square 1:1 composition. Cheerful, warm, approachable — legible at 56 pixels.";

/**
 * Each entry: { dir, subject }.
 *
 * `dir` selects the asset folder, which also selects the output size:
 *   cleaner-play -> 200px (matches the 12 shipped icon-*.webp)
 *   parent-icons -> 256px (matches the shipped chat-teacher frames)
 *
 * Every entry below fills a VERIFIED gap — a surface that today renders a bare
 * Phosphor glyph while its neighbours render felted-clay art, or a
 * ParentIconKey with no Tier-1/Tier-2 art. Names match the consuming import.
 */
const ICONS = {
  // --- cleaner-play: dashboard widgets currently on bare Phosphor glyphs ---
  "icon-books": {
    dir: "cleaner-play",
    subject: "a small neat stack of three closed hardcover books",
  },
  "icon-orders": {
    dir: "cleaner-play",
    // Must NOT read as a gift — icon-referral is deliberately the gift box, and
    // the first pass produced two near-identical ribboned boxes.
    subject:
      "a plain closed corrugated cardboard shipping carton with a small pale shipping label on the " +
      "front and no decoration — absolutely no ribbon, no bow, no gift wrap",
  },
  "icon-mentors": {
    dir: "cleaner-play",
    // First pass overlapped the bubbles into an unreadable blob; they need a
    // visible gap and clearly distinct silhouettes.
    subject:
      "two separate rounded speech bubbles arranged side by side with a clear visible gap between " +
      "them, the front one larger with a tail pointing down-left and the back one smaller and " +
      "offset up-right, each with its own distinct clean silhouette",
  },
  // --- cleaner-play: routes that exist but have no themed art ---
  "icon-certificate": {
    dir: "cleaner-play",
    subject: "a rolled certificate scroll tied with a ribbon, with a small rosette seal",
  },
  "icon-reports": {
    dir: "cleaner-play",
    subject: "a clipboard holding a sheet with a simple rising bar chart on it",
  },
  "icon-leaderboard": {
    dir: "cleaner-play",
    subject:
      "a winners podium seen straight from the front with three clearly distinct stepped blocks of " +
      "obviously different heights, the tallest in the centre, a lower one on the left and a lowest " +
      "one on the right, and one small star floating above the centre block",
  },
  "icon-chat": {
    dir: "cleaner-play",
    subject: "a single soft rounded speech bubble with three dots inside",
  },
  "icon-downloads": {
    dir: "cleaner-play",
    subject: "a downward arrow resting above a soft open tray",
  },
  "icon-referral": {
    dir: "cleaner-play",
    subject: "a wrapped gift box with a soft bow on top",
  },
  // --- parent-icons: the two ParentIconKeys generate-parent-icons.mjs declared
  //     but never produced (blocked by the checkerboard issue above) ---
  payments: {
    dir: "parent-icons",
    subject: "a small stack of coins beside a paid receipt with a checkmark",
  },
  attention: {
    dir: "parent-icons",
    subject: "a soft rounded bell with a gentle glow",
  },
};

const SIZE_BY_DIR = { "cleaner-play": 200, "parent-icons": 256 };

async function main() {
  const key = process.env.OPENROUTER_API_KEY;
  const dryRun = process.argv.includes("--dry-run");
  if (!key && !dryRun) {
    console.error("ERROR: OPENROUTER_API_KEY is not set. Aborting (no key is ever hardcoded).");
    process.exit(1);
  }
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.split("=")[1] : null;
  const force = process.argv.includes("--force");

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const [name, entry] of Object.entries(ICONS)) {
    if (only && name !== only) continue;

    const outDir = join(ASSETS, entry.dir);
    const rawDir = join(outDir, "raw");
    mkdirSync(rawDir, { recursive: true });

    const webpPath = join(outDir, `${name}.webp`);
    if (existsSync(webpPath) && !force) {
      console.log(`skip ${name} (exists; --force to regenerate)`);
      skipped++;
      continue;
    }

    const promptText = `A single 3D rendered icon of ${entry.subject}. ${STYLE}`;
    if (dryRun) {
      console.log(`[dry-run] ${name} -> ${entry.dir}/${name}.webp`);
      console.log(`          ${promptText.slice(0, 110)}...`);
      continue;
    }

    console.log(`generating ${name} (${entry.dir})...`);
    let data;
    try {
      const res = await fetch(URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: promptText }],
          modalities: ["image"],
          image_config: { aspect_ratio: "1:1" },
        }),
      });
      if (!res.ok) {
        console.error(`  API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
        failed++;
        continue;
      }
      data = await res.json();
    } catch (e) {
      console.error(`  request failed: ${e.message}`);
      failed++;
      continue;
    }

    let b64 = null;
    let mime = "png";
    for (const choice of data.choices ?? []) {
      for (const img of choice.message?.images ?? []) {
        const url = img.image_url?.url ?? "";
        if (url) {
          if (url.startsWith("data:image/jpeg")) mime = "jpg";
          b64 = url.includes(",") ? url.split(",", 2)[1] : url;
          break;
        }
      }
      if (b64) break;
    }
    if (!b64) {
      console.error(`  no image in response for ${name}`);
      failed++;
      continue;
    }

    const rawPath = join(rawDir, `${name}.${mime}`);
    writeFileSync(rawPath, Buffer.from(b64, "base64"));

    const size = SIZE_BY_DIR[entry.dir] ?? 200;
    const r = spawnSync(
      "python3",
      [POSTPROCESS, rawPath, webpPath, "--size", String(size), "--tol", "32"],
      { encoding: "utf8" }
    );
    if (r.status !== 0) {
      console.error(`  post-process failed: ${r.stderr || r.stdout}`);
      failed++;
      continue;
    }
    process.stdout.write(r.stdout);
    generated++;
  }

  console.log(`\ndone. generated=${generated} skipped=${skipped} failed=${failed}`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
