#!/usr/bin/env node
// App Store Connect side of registering a white-label iOS app.
//
//   node asc.mjs bundle-id   <config.json>          register bundle id + Push / Associated Domains / Sign in with Apple
//   node asc.mjs profile     <config.json>          App Store provisioning profile, installed for xcodebuild
//   node asc.mjs wait-app    <config.json> [min]    poll until the ASC app record exists (created in the web UI)
//   node asc.mjs attach      <config.json> <buildNo> wait for the uploaded build to process, attach it to version 1.x
//   node asc.mjs publish     <config.json>          description / URLs / notes / category / age rating / price / rights / screenshots
//   node asc.mjs submit      <config.json> [--wait] create the review submission and submit (retries while App Privacy is unpublished)
//   node asc.mjs status      <config.json>
//
// Auth: an ASC API key. Defaults to ~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8 with
// ASC_KEY_ID / ASC_ISSUER_ID from the environment (falls back to the Vidyayatan team key).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const KEY_ID = process.env.ASC_KEY_ID || "KGSU6BPA68";
const ISSUER = process.env.ASC_ISSUER_ID || "b488efb0-528d-4e05-8241-8ff52160ddef";
const KEY_PATH =
  process.env.ASC_KEY_PATH ||
  path.join(process.env.HOME, ".appstoreconnect/private_keys", `AuthKey_${KEY_ID}.p8`);
const API = "https://api.appstoreconnect.apple.com";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function token() {
  const key = fs.readFileSync(KEY_PATH);
  const iat = Math.floor(Date.now() / 1000);
  const input =
    b64({ alg: "ES256", kid: KEY_ID, typ: "JWT" }) +
    "." +
    b64({ iss: ISSUER, iat, exp: iat + 900, aud: "appstoreconnect-v1" });
  const sig = crypto
    .sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" })
    .toString("base64url");
  return `${input}.${sig}`;
}

async function api(method, p, body) {
  const r = await fetch(API + p, {
    method,
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) {
    const err = new Error(`${method} ${p} -> ${r.status} ${text.slice(0, 600)}`);
    err.status = r.status;
    err.body = text;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const readText = (p, base) => {
  if (!p) return "";
  const full = path.isAbsolute(p) ? p : path.join(base, p);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8").trim() : p;
};

function loadConfig(file) {
  const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  cfg._dir = path.dirname(path.resolve(file));
  for (const k of ["key", "targetName", "displayName", "bundleId", "domain", "subdomain", "configDir"])
    if (!cfg[k]) throw new Error(`config: missing "${k}"`);
  cfg.profileName = cfg.profileName || `${cfg.targetName} App Store`;
  return cfg;
}

// ---------------------------------------------------------------- bundle id
async function findBundleId(identifier) {
  const r = await api("GET", `/v1/bundleIds?filter[identifier]=${encodeURIComponent(identifier)}&limit=5`);
  return r.data.find((b) => b.attributes.identifier === identifier) || null;
}

async function cmdBundleId(cfg) {
  let rec = await findBundleId(cfg.bundleId);
  if (rec) console.log(`bundle id exists: ${cfg.bundleId} (${rec.id})`);
  else {
    rec = (
      await api("POST", "/v1/bundleIds", {
        data: { type: "bundleIds", attributes: { identifier: cfg.bundleId, name: cfg.targetName, platform: "IOS" } },
      })
    ).data;
    console.log(`registered bundle id ${cfg.bundleId} (${rec.id})`);
  }
  const have = new Set(
    (await api("GET", `/v1/bundleIds/${rec.id}/bundleIdCapabilities`)).data.map((c) => c.attributes.capabilityType)
  );
  const wanted = [
    ["PUSH_NOTIFICATIONS", undefined],
    ["ASSOCIATED_DOMAINS", undefined],
    ["APPLE_ID_AUTH", [{ key: "APPLE_ID_AUTH_APP_CONSENT", options: [{ key: "PRIMARY_APP_CONSENT" }] }]],
  ];
  for (const [type, settings] of wanted) {
    if (have.has(type)) { console.log(`  capability ${type}: present`); continue; }
    await api("POST", "/v1/bundleIdCapabilities", {
      data: {
        type: "bundleIdCapabilities",
        attributes: { capabilityType: type, ...(settings ? { settings } : {}) },
        relationships: { bundleId: { data: { type: "bundleIds", id: rec.id } } },
      },
    });
    console.log(`  capability ${type}: added`);
  }
  return rec;
}

// ---------------------------------------------------------------- profile
async function cmdProfile(cfg) {
  const rec = await findBundleId(cfg.bundleId);
  if (!rec) throw new Error(`bundle id ${cfg.bundleId} not registered yet — run bundle-id first`);
  const existing = (await api("GET", `/v1/profiles?filter[name]=${encodeURIComponent(cfg.profileName)}&limit=5`)).data.find(
    (p) => p.attributes.name === cfg.profileName && p.attributes.profileState === "ACTIVE"
  );
  let profile = existing;
  if (!profile) {
    const certs = (await api("GET", "/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=10")).data.filter(
      (c) => new Date(c.attributes.expirationDate) > new Date()
    );
    if (!certs.length) throw new Error("no valid DISTRIBUTION certificate in this team");
    profile = (
      await api("POST", "/v1/profiles", {
        data: {
          type: "profiles",
          attributes: { name: cfg.profileName, profileType: "IOS_APP_STORE" },
          relationships: {
            bundleId: { data: { type: "bundleIds", id: rec.id } },
            certificates: { data: [{ type: "certificates", id: certs[0].id }] },
          },
        },
      })
    ).data;
    console.log(`created profile "${cfg.profileName}"`);
  } else console.log(`profile exists: "${cfg.profileName}"`);
  // xcodebuild -exportArchive resolves manual profiles from this directory.
  const dir = path.join(process.env.HOME, "Library/MobileDevice/Provisioning Profiles");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${profile.attributes.uuid}.mobileprovision`);
  fs.writeFileSync(out, Buffer.from(profile.attributes.profileContent, "base64"));
  console.log(`installed ${out} (expires ${profile.attributes.expirationDate})`);
}

// ---------------------------------------------------------------- app record + version
async function findApp(bundleId) {
  const r = await api("GET", `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&fields[apps]=name,bundleId,sku`);
  return r.data.find((a) => a.attributes.bundleId === bundleId) || null;
}
async function requireApp(cfg) {
  const app = await findApp(cfg.bundleId);
  if (!app)
    throw new Error(
      `No App Store Connect app record for ${cfg.bundleId}. Create it in the web UI: My Apps -> + -> New App ` +
        `(iOS, name "${cfg.displayName}", bundle id ${cfg.bundleId}, any SKU), then re-run.`
    );
  return app;
}
async function iosVersion(appId) {
  const r = await api(
    "GET",
    `/v1/apps/${appId}/appStoreVersions?filter[platform]=IOS&fields[appStoreVersions]=versionString,appVersionState,appStoreState&limit=1`
  );
  if (!r.data.length) throw new Error("app has no iOS version record");
  return r.data[0];
}

async function cmdWaitApp(cfg, minutes = 60) {
  const deadline = Date.now() + minutes * 60_000;
  for (;;) {
    const app = await findApp(cfg.bundleId);
    if (app) { console.log(`app record: ${app.id} "${app.attributes.name}"`); return app; }
    if (Date.now() > deadline) throw new Error("timed out waiting for the ASC app record");
    process.stdout.write(`waiting for the "${cfg.displayName}" app record in App Store Connect (create it in the web UI)...\n`);
    await sleep(90_000);
  }
}

// ---------------------------------------------------------------- build
async function cmdAttach(cfg, buildNo, minutes = 40) {
  const app = await requireApp(cfg);
  const version = await iosVersion(app.id);
  const deadline = Date.now() + minutes * 60_000;
  let build;
  for (;;) {
    const r = await api(
      "GET",
      `/v1/builds?filter[app]=${app.id}&filter[version]=${encodeURIComponent(buildNo)}&fields[builds]=version,processingState,usesNonExemptEncryption&sort=-uploadedDate&limit=1`
    );
    build = r.data[0];
    const state = build?.attributes.processingState || "NOT_LISTED_YET";
    if (state === "VALID") break;
    if (state === "INVALID" || state === "FAILED") throw new Error(`build ${buildNo} is ${state}`);
    if (Date.now() > deadline) throw new Error(`build ${buildNo} still ${state} after ${minutes} min`);
    console.log(`build ${buildNo}: ${state}, waiting...`);
    await sleep(60_000);
  }
  if (build.attributes.usesNonExemptEncryption == null)
    await api("PATCH", `/v1/builds/${build.id}`, {
      data: { type: "builds", id: build.id, attributes: { usesNonExemptEncryption: false } },
    });
  await api("PATCH", `/v1/appStoreVersions/${version.id}/relationships/build`, {
    data: { type: "builds", id: build.id },
  });
  console.log(`attached build ${buildNo} (${build.id}) to version ${version.attributes.versionString}`);
}

// ---------------------------------------------------------------- metadata
async function uploadScreenshots(locId, dir, brandKey) {
  const kinds = [
    ["iphone", "APP_IPHONE_65"],
    ["ipad", "APP_IPAD_PRO_3GEN_129"],
  ];
  for (const [kind, display] of kinds) {
    const folder = path.join(dir, kind);
    if (!fs.existsSync(folder)) continue;
    const files = fs.readdirSync(folder).filter((f) => f.endsWith(".png")).sort();
    if (!files.length) continue;
    let set = (await api("GET", `/v1/appStoreVersionLocalizations/${locId}/appScreenshotSets`)).data.find(
      (s) => s.attributes.screenshotDisplayType === display
    );
    if (!set)
      set = (
        await api("POST", "/v1/appScreenshotSets", {
          data: {
            type: "appScreenshotSets",
            attributes: { screenshotDisplayType: display },
            relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: locId } } },
          },
        })
      ).data;
    const have = (await api("GET", `/v1/appScreenshotSets/${set.id}/appScreenshots`)).data;
    const haveNames = new Set(have.map((s) => s.attributes.fileName));
    for (const f of files) {
      const fileName = `${brandKey}_${kind}_${f}`.toLowerCase();
      if (haveNames.has(fileName)) { console.log(`  screenshot present: ${fileName}`); continue; }
      const buf = fs.readFileSync(path.join(folder, f));
      const res = (
        await api("POST", "/v1/appScreenshots", {
          data: {
            type: "appScreenshots",
            attributes: { fileName, fileSize: buf.length },
            relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: set.id } } },
          },
        })
      ).data;
      for (const op of res.attributes.uploadOperations) {
        const headers = Object.fromEntries(op.requestHeaders.map((h) => [h.name, h.value]));
        const r = await fetch(op.url, { method: op.method, headers, body: buf.subarray(op.offset, op.offset + op.length) });
        if (!r.ok) throw new Error(`screenshot chunk upload ${r.status}`);
      }
      await api("PATCH", `/v1/appScreenshots/${res.id}`, {
        data: {
          type: "appScreenshots",
          id: res.id,
          attributes: { uploaded: true, sourceFileChecksum: crypto.createHash("md5").update(buf).digest("hex") },
        },
      });
      console.log(`  uploaded ${display} ${fileName}`);
    }
  }
}

async function cmdPublish(cfg) {
  const app = await requireApp(cfg);
  const version = await iosVersion(app.id);
  console.log(`app ${app.id}, version ${version.attributes.versionString} (${version.attributes.appVersionState})`);

  // version-level text
  const description = readText(cfg.description, cfg._dir);
  const locs = (await api("GET", `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`)).data;
  let loc = locs.find((l) => l.attributes.locale === "en-US") || locs[0];
  const vAttrs = { keywords: cfg.keywords || "Education", supportUrl: cfg.supportUrl, ...(description ? { description } : {}) };
  if (loc) await api("PATCH", `/v1/appStoreVersionLocalizations/${loc.id}`, { data: { type: "appStoreVersionLocalizations", id: loc.id, attributes: vAttrs } });
  else
    loc = (
      await api("POST", "/v1/appStoreVersionLocalizations", {
        data: { type: "appStoreVersionLocalizations", attributes: { locale: "en-US", ...vAttrs }, relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } } },
      })
    ).data;
  await api("PATCH", `/v1/appStoreVersions/${version.id}`, {
    data: { type: "appStoreVersions", id: version.id, attributes: { copyright: `© ${new Date().getFullYear()} ${cfg.displayName}` } },
  });
  console.log("version text ok");

  // app-info level: privacy policy URL lives on appInfoLocalizations, category on appInfos
  const infos = (await api("GET", `/v1/apps/${app.id}/appInfos`)).data;
  const info = infos.find((i) => i.attributes.state === "PREPARE_FOR_SUBMISSION") || infos[0];
  const ilocs = (await api("GET", `/v1/appInfos/${info.id}/appInfoLocalizations`)).data;
  const iloc = ilocs.find((l) => l.attributes.locale === "en-US") || ilocs[0];
  const iAttrs = { ...(cfg.privacyPolicyUrl ? { privacyPolicyUrl: cfg.privacyPolicyUrl } : {}) };
  if (iloc) await api("PATCH", `/v1/appInfoLocalizations/${iloc.id}`, { data: { type: "appInfoLocalizations", id: iloc.id, attributes: iAttrs } });
  else
    await api("POST", "/v1/appInfoLocalizations", {
      data: { type: "appInfoLocalizations", attributes: { locale: "en-US", name: cfg.displayName, ...iAttrs }, relationships: { appInfo: { data: { type: "appInfos", id: info.id } } } },
    });
  await api("PATCH", `/v1/appInfos/${info.id}`, {
    data: { type: "appInfos", id: info.id, relationships: { primaryCategory: { data: { type: "appCategories", id: cfg.category || "EDUCATION" } } } },
  });
  console.log("app info ok (privacy URL, category)");

  // age rating: copy the template app's answers (skip the deprecated override field or Apple 409s)
  if (cfg.templateAppId) {
    const tInfos = (await api("GET", `/v1/apps/${cfg.templateAppId}/appInfos`)).data;
    const tDecl = (await api("GET", `/v1/appInfos/${tInfos[0].id}/ageRatingDeclaration`)).data.attributes;
    const attrs = Object.fromEntries(Object.entries(tDecl).filter(([k, v]) => v != null && k !== "ageRatingOverride"));
    await api("PATCH", `/v1/ageRatingDeclarations/${info.id}`, { data: { type: "ageRatingDeclarations", id: info.id, attributes: attrs } });
    console.log("age rating copied from template app");
  }

  // review details
  const notes = readText(cfg.reviewNotes, cfg._dir);
  const rd = {
    ...(cfg.demo ? { demoAccountName: cfg.demo.username, demoAccountPassword: cfg.demo.password, demoAccountRequired: true } : {}),
    ...(notes ? { notes } : {}),
    contactFirstName: cfg.contact?.firstName || "Shreyash",
    contactLastName: cfg.contact?.lastName || "Jain",
    contactEmail: cfg.contact?.email || "shreyash@vidyayatan.com",
    contactPhone: cfg.contact?.phone || "+919425677707",
  };
  let existing = null;
  try { existing = (await api("GET", `/v1/appStoreVersions/${version.id}/appStoreReviewDetail`)).data; } catch {}
  if (existing) await api("PATCH", `/v1/appStoreReviewDetails/${existing.id}`, { data: { type: "appStoreReviewDetails", id: existing.id, attributes: rd } });
  else await api("POST", "/v1/appStoreReviewDetails", { data: { type: "appStoreReviewDetails", attributes: rd, relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } } } });
  console.log("review details ok");

  // new-app submission gates: content rights + a free price schedule
  await api("PATCH", `/v1/apps/${app.id}`, {
    data: { type: "apps", id: app.id, attributes: { contentRightsDeclaration: cfg.contentRights || "USES_THIRD_PARTY_CONTENT" } },
  });
  let hasPrice = false;
  try { hasPrice = !!(await api("GET", `/v1/apps/${app.id}/appPriceSchedule`)).data; } catch {}
  if (!hasPrice) {
    const pp = (await api("GET", `/v1/apps/${app.id}/appPricePoints?filter[territory]=USA&limit=1&fields[appPricePoints]=customerPrice`)).data[0];
    if (pp.attributes.customerPrice !== "0.0") throw new Error("first USA price point is not free");
    await api("POST", "/v1/appPriceSchedules", {
      data: {
        type: "appPriceSchedules",
        relationships: {
          app: { data: { type: "apps", id: app.id } },
          baseTerritory: { data: { type: "territories", id: "USA" } },
          manualPrices: { data: [{ type: "appPrices", id: "${price0}" }] },
        },
      },
      included: [{ type: "appPrices", id: "${price0}", attributes: { startDate: null }, relationships: { appPricePoint: { data: { type: "appPricePoints", id: pp.id } } } }],
    });
    console.log("price schedule: Free (USA base)");
  } else console.log("price schedule: present");

  if (cfg.screenshotsDir) {
    const dir = path.isAbsolute(cfg.screenshotsDir) ? cfg.screenshotsDir : path.join(cfg._dir, cfg.screenshotsDir);
    if (fs.existsSync(dir)) await uploadScreenshots(loc.id, dir, cfg.key);
    else console.log(`(no screenshots dir at ${dir})`);
  }
  console.log("PUBLISH DONE. Still manual in the ASC UI: App Privacy label (and DSA trader status, once per account).");
}

// ---------------------------------------------------------------- submit
async function cmdSubmit(cfg, wait) {
  const app = await requireApp(cfg);
  const version = await iosVersion(app.id);
  if (["WAITING_FOR_REVIEW", "IN_REVIEW", "READY_FOR_DISTRIBUTION"].includes(version.attributes.appVersionState)) {
    console.log(`version already ${version.attributes.appVersionState}`);
    return;
  }
  // an older UNRESOLVED_ISSUES submission pins the version; cancel it first
  const subs = (await api("GET", `/v1/reviewSubmissions?filter[app]=${app.id}&filter[platform]=IOS`)).data;
  for (const s of subs.filter((s) => s.attributes.state === "UNRESOLVED_ISSUES")) {
    await api("PATCH", `/v1/reviewSubmissions/${s.id}`, { data: { type: "reviewSubmissions", id: s.id, attributes: { canceled: true } } });
    for (let i = 0; i < 12; i++) {
      await sleep(5000);
      if ((await api("GET", `/v1/reviewSubmissions/${s.id}`)).data.attributes.state === "COMPLETE") break;
    }
    console.log(`cancelled stale submission ${s.id}`);
  }
  let sub = subs.find((s) => s.attributes.state === "READY_FOR_REVIEW");
  if (!sub)
    sub = (
      await api("POST", "/v1/reviewSubmissions", {
        data: { type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: { data: { type: "apps", id: app.id } } } },
      })
    ).data;
  for (;;) {
    try {
      await api("POST", "/v1/reviewSubmissionItems", {
        data: {
          type: "reviewSubmissionItems",
          relationships: {
            reviewSubmission: { data: { type: "reviewSubmissions", id: sub.id } },
            appStoreVersion: { data: { type: "appStoreVersions", id: version.id } },
          },
        },
      });
      break;
    } catch (e) {
      if (e.status === 409 && /data usages/.test(e.body) && wait) {
        console.log("App Privacy label not published yet — publish it in the ASC UI; retrying in 2 min");
        await sleep(120_000);
        continue;
      }
      if (e.status === 409 && /already/.test(e.body)) break;
      throw e;
    }
  }
  const r = await api("PATCH", `/v1/reviewSubmissions/${sub.id}`, {
    data: { type: "reviewSubmissions", id: sub.id, attributes: { submitted: true } },
  });
  console.log(`submitted: ${r.data.attributes.state} (${sub.id})`);
}

async function cmdStatus(cfg) {
  const app = await findApp(cfg.bundleId);
  const bid = await findBundleId(cfg.bundleId);
  console.log(`bundle id: ${bid ? bid.id : "not registered"}`);
  if (!app) { console.log("app record: none (create in the ASC web UI)"); return; }
  const version = await iosVersion(app.id);
  console.log(`app record: ${app.id} "${app.attributes.name}"`);
  console.log(`version ${version.attributes.versionString}: ${version.attributes.appVersionState}`);
  const builds = (await api("GET", `/v1/builds?filter[app]=${app.id}&fields[builds]=version,processingState&sort=-uploadedDate&limit=5`)).data;
  console.log(`builds: ${builds.map((b) => `${b.attributes.version}:${b.attributes.processingState}`).join(" ") || "none"}`);
}

// ---------------------------------------------------------------- main
const [cmd, cfgPath, ...rest] = process.argv.slice(2);
if (!cmd || !cfgPath) {
  console.error(fs.readFileSync(new URL(import.meta.url)).toString().split("\n").slice(1, 12).join("\n"));
  process.exit(1);
}
const cfg = loadConfig(cfgPath);
const run = {
  "bundle-id": () => cmdBundleId(cfg),
  profile: () => cmdProfile(cfg),
  "wait-app": () => cmdWaitApp(cfg, Number(rest[0] || 60)),
  attach: () => cmdAttach(cfg, rest[0] || cfg.buildNumber || "1"),
  publish: () => cmdPublish(cfg),
  submit: () => cmdSubmit(cfg, rest.includes("--wait")),
  status: () => cmdStatus(cfg),
}[cmd];
if (!run) { console.error(`unknown command ${cmd}`); process.exit(1); }
run().catch((e) => { console.error(e.message); process.exit(1); });
