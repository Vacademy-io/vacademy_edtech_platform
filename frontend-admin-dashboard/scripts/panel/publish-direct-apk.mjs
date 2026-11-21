#!/usr/bin/env node
/**
 * Prepare a direct-channel Vacademy Classroom APK for release. Reads a built APK and prints
 * what the owner registers; it never uploads anything and never opens a network connection.
 *
 *   # 1. build (android/, with keystore-direct.properties present)
 *   ./gradlew assembleVacademyClassroomDirect
 *   # 2. inspect and print the release body
 *   node scripts/panel/publish-direct-apk.mjs [--apk <file>] [--base-url https://<update host>/<prefix>]
 *        [--expect-cert <sha256 of the signing certificate>] [--notes "<text>"] [--json]
 *
 * Checks, each one fatal:
 *   - the APK's package is the classroom applicationId + ".direct", its versionCode and
 *     versionName are the ones in android/app/mobile-flavors.json ("-direct" suffix);
 *   - it carries an APK Signature Scheme v2/v3 block, and its signing certificate is not the
 *     Android debug certificate (and equals --expect-cert when given);
 *   - the download URL is https on a host listed in mobile-flavors.json `updateHosts`
 *     (the installed app refuses any other host).
 *
 * Output: the immutable object key to upload to, the sha256 / size / certificate digest,
 * and the JSON body for POST /auth-service/super-admin/v1/panel/releases (created as DRAFT
 * with rollout 0; the rollout is stepped later with PATCH).
 *
 * Node built-ins only (fs, path, crypto, zlib). No dependency, no network module.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FLAVORS_FILE = path.join(ROOT, 'android/app/mobile-flavors.json');
const FLAVOR_KEY = 'vacademy-classroom';
const DIRECT_SUFFIX = '.direct';
const DEFAULT_APK = path.join(
    ROOT,
    'android/app/build/outputs/apk/vacademyClassroom/direct/app-vacademyClassroom-direct.apk'
);
export const RELEASE_PREFIX = 'classroom-releases/direct';
export const RELEASES_ENDPOINT = '/auth-service/super-admin/v1/panel/releases';

// ---------------------------------------------------------------------------- zip

/** Central-directory entries of a zip/APK buffer: name → {method, compressedSize, offset}. */
export function readZipEntries(buf) {
    const eocd = findEocd(buf);
    const count = buf.readUInt16LE(eocd + 10);
    const cdSize = buf.readUInt32LE(eocd + 12);
    const cdOffset = buf.readUInt32LE(eocd + 16);
    const entries = new Map();
    let p = cdOffset;
    for (let i = 0; i < count; i++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip central directory');
        const method = buf.readUInt16LE(p + 10);
        const compressedSize = buf.readUInt32LE(p + 20);
        const nameLen = buf.readUInt16LE(p + 28);
        const extraLen = buf.readUInt16LE(p + 30);
        const commentLen = buf.readUInt16LE(p + 32);
        const offset = buf.readUInt32LE(p + 42);
        const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
        entries.set(name, { method, compressedSize, offset });
        p += 46 + nameLen + extraLen + commentLen;
    }
    return { entries, cdOffset, cdSize };
}

function findEocd(buf) {
    const min = Math.max(0, buf.length - 0xffff - 22);
    for (let p = buf.length - 22; p >= min; p--) {
        if (buf.readUInt32LE(p) === 0x06054b50) return p;
    }
    throw new Error('not a zip file (no end of central directory)');
}

/** The uncompressed bytes of one entry. */
export function readZipEntry(buf, entry) {
    const p = entry.offset;
    if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error('corrupt zip local header');
    const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
    const data = buf.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) return Buffer.from(data);
    if (entry.method === 8) return zlib.inflateRawSync(data);
    throw new Error(`unsupported zip compression method ${entry.method}`);
}

// -------------------------------------------------------------- binary manifest

const RES_STRING_POOL = 0x0001;
const RES_XML_RESOURCE_MAP = 0x0180;
const RES_XML_START_ELEMENT = 0x0102;
const UTF8_FLAG = 0x100;
const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;
const ATTR_IDS = {
    0x0101021b: 'versionCode',
    0x0101021c: 'versionName',
    0x0101020c: 'minSdkVersion',
};

function readStringPool(buf, start) {
    const count = buf.readUInt32LE(start + 8);
    const flags = buf.readUInt32LE(start + 16);
    const stringsStart = buf.readUInt32LE(start + 20);
    const utf8 = (flags & UTF8_FLAG) !== 0;
    const strings = [];
    for (let i = 0; i < count; i++) {
        let p = start + stringsStart + buf.readUInt32LE(start + 28 + i * 4);
        if (utf8) {
            p += buf[p] & 0x80 ? 2 : 1; // length in characters
            let len = buf[p];
            if (len & 0x80) {
                len = ((len & 0x7f) << 8) | buf[p + 1];
                p += 2;
            } else {
                p += 1;
            }
            strings.push(buf.toString('utf8', p, p + len));
        } else {
            let len = buf.readUInt16LE(p);
            if (len & 0x8000) {
                len = ((len & 0x7fff) << 16) | buf.readUInt16LE(p + 2);
                p += 4;
            } else {
                p += 2;
            }
            strings.push(buf.toString('utf16le', p, p + len * 2));
        }
    }
    return strings;
}

/**
 * package, versionCode, versionName and minSdkVersion from a compiled (binary XML)
 * AndroidManifest.xml.
 */
export function parseBinaryManifest(buf) {
    if (buf.readUInt16LE(0) !== 0x0003) throw new Error('AndroidManifest.xml is not binary XML');
    let strings = [];
    let resourceIds = [];
    const out = { packageName: null, versionCode: null, versionName: null, minSdk: null };
    let p = buf.readUInt16LE(2);
    while (p + 8 <= buf.length) {
        const type = buf.readUInt16LE(p);
        const headerSize = buf.readUInt16LE(p + 2);
        const size = buf.readUInt32LE(p + 4);
        if (size < 8) break;
        if (type === RES_STRING_POOL) {
            strings = readStringPool(buf, p);
        } else if (type === RES_XML_RESOURCE_MAP) {
            resourceIds = [];
            for (let q = p + headerSize; q < p + size; q += 4)
                resourceIds.push(buf.readUInt32LE(q));
        } else if (type === RES_XML_START_ELEMENT) {
            const ext = p + headerSize;
            const tag = strings[buf.readUInt32LE(ext + 4)];
            if (tag === 'manifest' || tag === 'uses-sdk') {
                const attrStart = buf.readUInt16LE(ext + 8);
                const attrSize = buf.readUInt16LE(ext + 10);
                const attrCount = buf.readUInt16LE(ext + 12);
                for (let i = 0; i < attrCount; i++) {
                    const a = ext + attrStart + i * attrSize;
                    const nameIndex = buf.readUInt32LE(a + 4);
                    const raw = buf.readUInt32LE(a + 8);
                    const dataType = buf[a + 15];
                    const data = buf.readUInt32LE(a + 16);
                    const name = ATTR_IDS[resourceIds[nameIndex]] || strings[nameIndex];
                    const value =
                        dataType === TYPE_STRING
                            ? strings[data]
                            : dataType === TYPE_INT_DEC || dataType === TYPE_INT_HEX
                              ? data
                              : raw !== 0xffffffff
                                ? strings[raw]
                                : null;
                    if (tag === 'manifest' && name === 'package') out.packageName = value;
                    if (tag === 'manifest' && name === 'versionCode')
                        out.versionCode = Number(value);
                    if (tag === 'manifest' && name === 'versionName')
                        out.versionName = value == null ? null : String(value);
                    if (tag === 'uses-sdk' && name === 'minSdkVersion') out.minSdk = Number(value);
                }
            }
        }
        p += size;
    }
    return out;
}

// -------------------------------------------------------------- signing block

const APK_SIG_MAGIC = 'APK Sig Block 42';
const SIG_V2 = 0x7109871a;
const SIG_V3 = 0xf05368c0;

function lengthPrefixed(buf, p) {
    const len = buf.readUInt32LE(p);
    return { value: buf.subarray(p + 4, p + 4 + len), next: p + 4 + len };
}

/** First certificate (DER) of every signer in a v2 or v3 signature scheme block. */
function signerCertificates(block) {
    const certs = [];
    const signers = lengthPrefixed(block, 0).value;
    for (let p = 0; p < signers.length; ) {
        const signer = lengthPrefixed(signers, p);
        p = signer.next;
        const signedData = lengthPrefixed(signer.value, 0).value;
        const digests = lengthPrefixed(signedData, 0);
        const certificates = lengthPrefixed(signedData, digests.next).value;
        if (certificates.length >= 4)
            certs.push(Buffer.from(lengthPrefixed(certificates, 0).value));
    }
    return certs;
}

/**
 * The signing certificates from the APK Signing Block: v3 when present (it names the
 * current key after a rotation), else v2. Null when the APK has neither.
 */
export function readSigningCertificates(buf, cdOffset) {
    if (cdOffset < 32 || buf.toString('latin1', cdOffset - 16, cdOffset) !== APK_SIG_MAGIC)
        return null;
    const blockSize = Number(buf.readBigUInt64LE(cdOffset - 24));
    const start = cdOffset - blockSize - 8;
    if (start < 0) return null;
    const blocks = new Map();
    for (let p = start + 8; p < cdOffset - 24; ) {
        const len = Number(buf.readBigUInt64LE(p));
        const id = buf.readUInt32LE(p + 8);
        blocks.set(id, buf.subarray(p + 12, p + 8 + len));
        p += 8 + len;
    }
    const scheme = blocks.has(SIG_V3) ? 'v3' : blocks.has(SIG_V2) ? 'v2' : null;
    if (!scheme) return null;
    const certs = signerCertificates(blocks.get(scheme === 'v3' ? SIG_V3 : SIG_V2));
    return {
        scheme,
        certificates: certs.map((der) => {
            const x509 = new crypto.X509Certificate(der);
            return {
                sha256: crypto.createHash('sha256').update(der).digest('hex'),
                subject: x509.subject.replace(/\n/g, ', '),
                validTo: x509.validTo,
            };
        }),
    };
}

/** True for the SDK's auto-generated debug certificate. */
export function isDebugCertificate(subject) {
    return /(^|[\s,])CN=Android Debug([,\s]|$)/.test(subject || '');
}

// -------------------------------------------------------------- release body

/** https URL on one of the allowed hosts, default port, no credentials. */
export function checkBaseUrl(baseUrl, updateHosts) {
    let url;
    try {
        url = new URL(baseUrl);
    } catch {
        return `not a URL: ${baseUrl}`;
    }
    if (url.protocol !== 'https:') return 'the base URL must be https';
    if (url.username || url.password) return 'the base URL must not carry credentials';
    if (url.port && url.port !== '443') return 'the base URL must use the default port';
    const hosts = (updateHosts || []).map((h) => String(h).toLowerCase());
    if (!hosts.includes(url.hostname.toLowerCase())) {
        return `host ${url.hostname} is not in mobile-flavors.json updateHosts (${hosts.join(', ') || 'none'})`;
    }
    return null;
}

/** Immutable object key: classroom-releases/direct/<versionCode>-<sha8>.apk */
export function releaseObjectKey(versionCode, sha256) {
    return `${RELEASE_PREFIX}/${versionCode}-${sha256.slice(0, 8)}.apk`;
}

/**
 * The POST body for the releases endpoint (snake_case, DRAFT, rollout 0, not required).
 * package_name and signing_cert_sha256 are the build identity: the server refuses a direct
 * release whose identity differs from the one it is configured with.
 */
export function releaseBody({
    versionCode,
    versionName,
    apkUrl,
    sha256,
    sizeBytes,
    minSdk,
    notes,
    packageName,
    signingCertSha256,
}) {
    return {
        channel: 'DIRECT',
        version_code: versionCode,
        version_name: versionName,
        apk_url: apkUrl,
        sha256,
        size_bytes: sizeBytes,
        min_sdk: minSdk,
        rollout_percent: 0,
        required: false,
        notes: notes ? String(notes).slice(0, 500) : null,
        package_name: packageName ?? null,
        signing_cert_sha256: signingCertSha256 ?? null,
    };
}

/**
 * Everything checked on one APK buffer. Returns {problems, info}: problems is empty when
 * the APK may be released.
 */
export function inspectApk(buf, { flavor, baseUrl, expectCert, allowDebugCert, notes }) {
    const problems = [];
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const { entries, cdOffset } = readZipEntries(buf);
    const manifestEntry = entries.get('AndroidManifest.xml');
    if (!manifestEntry) throw new Error('no AndroidManifest.xml in the APK');
    const manifest = parseBinaryManifest(readZipEntry(buf, manifestEntry));

    const expectedPackage = `${flavor.applicationId}${DIRECT_SUFFIX}`;
    const expectedName = `${flavor.versionName}-direct`;
    if (manifest.packageName !== expectedPackage) {
        problems.push(
            `package is ${manifest.packageName}, expected ${expectedPackage} (build assembleVacademyClassroomDirect)`
        );
    }
    if (manifest.versionCode !== Number(flavor.versionCode)) {
        problems.push(
            `versionCode is ${manifest.versionCode}, mobile-flavors.json says ${flavor.versionCode}`
        );
    }
    if (manifest.versionName !== expectedName) {
        problems.push(`versionName is ${manifest.versionName}, expected ${expectedName}`);
    }

    const signing = readSigningCertificates(buf, cdOffset);
    const certs = signing ? signing.certificates : [];
    if (!signing || certs.length === 0) {
        problems.push('no APK Signature Scheme v2/v3 block: the APK is unsigned or v1-only');
    } else {
        if (certs.length !== 1) problems.push(`expected one signer, found ${certs.length}`);
        if (certs.some((c) => isDebugCertificate(c.subject)) && !allowDebugCert) {
            problems.push(
                'signed with the Android debug certificate: add android/keystore-direct.properties and rebuild'
            );
        }
        if (
            expectCert &&
            !certs.some((c) => c.sha256 === String(expectCert).toLowerCase().replace(/:/g, ''))
        ) {
            problems.push(
                `signing certificate ${certs.map((c) => c.sha256).join(',')} is not --expect-cert`
            );
        }
    }

    const baseProblem = checkBaseUrl(baseUrl, flavor.updateHosts);
    if (baseProblem) problems.push(baseProblem);

    const key = releaseObjectKey(manifest.versionCode, sha256);
    const apkUrl = `${String(baseUrl).replace(/\/+$/, '')}/${key.slice(RELEASE_PREFIX.length + 1)}`;
    const body = releaseBody({
        versionCode: manifest.versionCode,
        versionName: manifest.versionName,
        apkUrl,
        sha256,
        sizeBytes: buf.length,
        minSdk: manifest.minSdk || 24,
        notes,
        packageName: manifest.packageName,
        signingCertSha256: certs.length === 1 ? certs[0].sha256 : null,
    });
    return {
        problems,
        info: { manifest, sha256, sizeBytes: buf.length, signing, objectKey: key, apkUrl, body },
    };
}

// -------------------------------------------------------------------- CLI

function parseArgs(argv) {
    const args = {
        apk: DEFAULT_APK,
        baseUrl: null,
        expectCert: null,
        notes: null,
        json: false,
        allowDebugCert: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => {
            if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
            return argv[++i];
        };
        if (a === '--apk') args.apk = path.resolve(next());
        else if (a === '--base-url') args.baseUrl = next();
        else if (a === '--expect-cert') args.expectCert = next();
        else if (a === '--notes') args.notes = next();
        else if (a === '--json') args.json = true;
        else if (a === '--allow-debug-cert')
            args.allowDebugCert = true; // lab builds only
        else if (a === '--help' || a === '-h') args.help = true;
        else throw new Error(`unknown argument ${a}`);
    }
    return args;
}

function main() {
    let args;
    try {
        args = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(`[publish-direct-apk] ${error.message}`);
        process.exit(2);
    }
    if (args.help) {
        console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
        return;
    }
    const flavors = JSON.parse(fs.readFileSync(FLAVORS_FILE, 'utf8'));
    const flavor = flavors[FLAVOR_KEY];
    if (!flavor) throw new Error(`no ${FLAVOR_KEY} entry in mobile-flavors.json`);
    const hosts = flavor.updateHosts || [];
    const baseUrl = args.baseUrl || (hosts[0] ? `https://${hosts[0]}/${RELEASE_PREFIX}` : '');
    if (!fs.existsSync(args.apk)) {
        console.error(
            `[publish-direct-apk] no APK at ${args.apk}\n  build it in android/: ./gradlew assembleVacademyClassroomDirect`
        );
        process.exit(2);
    }

    const { problems, info } = inspectApk(fs.readFileSync(args.apk), {
        flavor,
        baseUrl,
        expectCert: args.expectCert,
        allowDebugCert: args.allowDebugCert,
        notes: args.notes,
    });

    if (args.json) {
        console.log(JSON.stringify({ ok: problems.length === 0, problems, ...info }, null, 2));
        process.exit(problems.length === 0 ? 0 : 1);
    }

    const cert = info.signing && info.signing.certificates[0];
    console.log(`APK          ${args.apk}`);
    console.log(`package      ${info.manifest.packageName}`);
    console.log(
        `version      ${info.manifest.versionName} (code ${info.manifest.versionCode}), minSdk ${info.manifest.minSdk}`
    );
    console.log(`size         ${info.sizeBytes} bytes`);
    console.log(`sha256       ${info.sha256}`);
    console.log(
        `signature    ${info.signing ? info.signing.scheme : 'none'}${cert ? `, ${cert.subject}` : ''}`
    );
    console.log(`cert sha256  ${cert ? cert.sha256 : '-'}`);
    if (problems.length) {
        console.error('\nNOT READY:');
        for (const problem of problems) console.error(`  - ${problem}`);
        process.exit(1);
    }
    console.log('\nOwner steps (this script contacts nothing):');
    console.log(
        `  1. Upload the APK to object key\n       ${info.objectKey}\n     with Cache-Control: public, max-age=31536000, immutable`
    );
    console.log(
        `  2. Check that ${info.apkUrl} serves exactly ${info.sizeBytes} bytes with the sha256 above.`
    );
    console.log(`  3. POST ${RELEASES_ENDPOINT} (super admin) with:`);
    console.log(JSON.stringify(info.body, null, 2));
    console.log('  4. Step the rollout with PATCH .../releases/<id>:');
    console.log(
        '       {"status":"LIVE","rollout_percent":5} → {"rollout_percent":25} → {"rollout_percent":100}'
    );
    console.log(
        '     Stop offering it with {"status":"PULLED"}. Leave "required" false until most panels have it.'
    );
    console.log(
        `  5. Keep the certificate digest above: every later direct build must show the same one.`
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        main();
    } catch (error) {
        console.error(`[publish-direct-apk] ${error.message}`);
        process.exit(1);
    }
}
