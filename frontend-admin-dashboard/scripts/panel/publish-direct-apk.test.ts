import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    checkBaseUrl,
    inspectApk,
    isDebugCertificate,
    parseBinaryManifest,
    readSigningCertificates,
    readZipEntries,
    releaseBody,
    releaseObjectKey,
} from './publish-direct-apk.mjs';

// Self-signed certificates of throwaway keys, made for this test only.
const DEBUG_CERT_B64 =
    'MIIBiDCCAS6gAwIBAgIJAPetVp1e9KpCMAoGCCqGSM49BAMDMDcxCzAJBgNVBAYTAlVTMRAwDgYDVQQKEwdBbmRyb2lkMRYwFAYDVQQDEw1BbmRyb2lkIERlYnVnMCAXDTI2MTEwOTEzNTk1NFoYDzIxMjYxMDE2MTM1OTU0WjA3MQswCQYDVQQGEwJVUzEQMA4GA1UEChMHQW5kcm9pZDEWMBQGA1UEAxMNQW5kcm9pZCBEZWJ1ZzBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABGWpah9ejU4KsqVGBsZWeY1tUXwCJkRl+biX9uhl/6AQSpM0UtB4TdIEVdB/yxPRzWOBru0rsU1U5/4eIt0HxZajITAfMB0GA1UdDgQWBBRH8uRwrWWG3QPr8yzkW4apZEUnpzAKBggqhkjOPQQDAwNIADBFAiEAubQJFiOJexLkScK4RuXJC/meGMoKfXNrzEkZoSOW3/ACIEDdiCwd3rD3jPgNv6X/zFKbK/pUHvxwFJeulsM0S7m1';
const RELEASE_CERT_B64 =
    'MIIBZDCCAQugAwIBAgIIUMWjfBwJPSMwCgYIKoZIzj0EAwMwJjENMAsGA1UEChMEVGVzdDEVMBMGA1UEAxMMVGVzdCBSZWxlYXNlMCAXDTI2MTEwOTEzNTk1NFoYDzIxMjYxMDE2MTM1OTU0WjAmMQ0wCwYDVQQKEwRUZXN0MRUwEwYDVQQDEwxUZXN0IFJlbGVhc2UwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASYIM5Eq3y17JcyidtDAFCgnxAFgToNd9+aPzBW5VWrkad4ssM71HfKgeFCTASkc4qNGGxR6xsJqCnfb1l9yibNoyEwHzAdBgNVHQ4EFgQUPOijH1RzkA3jeGzQL5bDJY87tYwwCgYIKoZIzj0EAwMDRwAwRAIgCd/w3+w4ndiYM37X6Wt3XO8/45vj/A+nFcbKZbIZGdgCIDCLkt/JyXpzCYkm/VLtNdxFtLLdYHGPVNkRUqCdHMYH';
const DEBUG_CERT = Buffer.from(DEBUG_CERT_B64, 'base64');
const RELEASE_CERT = Buffer.from(RELEASE_CERT_B64, 'base64');
const RELEASE_CERT_SHA = crypto.createHash('sha256').update(RELEASE_CERT).digest('hex');

const FLAVOR = {
    applicationId: 'io.vacademy.classroom',
    versionName: '0.3.0',
    versionCode: 3,
    updateHosts: ['updates.example.org'],
};
const BASE = 'https://updates.example.org/classroom-releases/direct';

// ------------------------------------------------------------- fixture builders

function u16(n: number) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(n);
    return b;
}
function u32(n: number) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n >>> 0);
    return b;
}
function u64(n: number) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(n));
    return b;
}
function lp(...parts: Buffer[]) {
    const body = Buffer.concat(parts);
    return Buffer.concat([u32(body.length), body]);
}

/** Minimal binary AndroidManifest.xml: <manifest package versionCode versionName><uses-sdk minSdkVersion/>. */
function binaryManifest(pkg: string, versionCode: number, versionName: string, minSdk: number) {
    const strings = [
        'versionCode',
        'versionName',
        'minSdkVersion',
        'package',
        'manifest',
        'uses-sdk',
        pkg,
        versionName,
    ];
    const encoded = strings.map((s) => {
        const bytes = Buffer.from(s, 'utf8');
        return Buffer.concat([Buffer.from([s.length, bytes.length]), bytes, Buffer.from([0])]);
    });
    const offsets: number[] = [];
    let at = 0;
    for (const e of encoded) {
        offsets.push(at);
        at += e.length;
    }
    let data = Buffer.concat(encoded);
    while (data.length % 4) data = Buffer.concat([data, Buffer.from([0])]);
    const poolHeader = 28;
    const stringsStart = poolHeader + strings.length * 4;
    const pool = Buffer.concat([
        u16(0x0001),
        u16(poolHeader),
        u32(stringsStart + data.length),
        u32(strings.length),
        u32(0),
        u32(0x100),
        u32(stringsStart),
        u32(0),
        ...offsets.map(u32),
        data,
    ]);
    const ids = [0x0101021b, 0x0101021c, 0x0101020c];
    const resMap = Buffer.concat([u16(0x0180), u16(8), u32(8 + ids.length * 4), ...ids.map(u32)]);

    const attr = (name: number, raw: number, type: number, value: number) =>
        Buffer.concat([
            u32(0xffffffff),
            u32(name),
            u32(raw),
            u16(8),
            Buffer.from([0, type]),
            u32(value),
        ]);
    const element = (tag: number, attrs: Buffer[]) => {
        const ext = Buffer.concat([
            u32(0xffffffff),
            u32(tag),
            u16(20),
            u16(20),
            u16(attrs.length),
            u16(0),
            u16(0),
            u16(0),
        ]);
        const body = Buffer.concat([ext, ...attrs]);
        return Buffer.concat([
            u16(0x0102),
            u16(16),
            u32(16 + body.length),
            u32(1),
            u32(0xffffffff),
            body,
        ]);
    };
    const manifest = element(4, [
        attr(3, 6, 0x03, 6),
        attr(0, 0xffffffff, 0x10, versionCode),
        attr(1, 7, 0x03, 7),
    ]);
    const usesSdk = element(5, [attr(2, 0xffffffff, 0x10, minSdk)]);
    const body = Buffer.concat([pool, resMap, manifest, usesSdk]);
    return Buffer.concat([u16(0x0003), u16(8), u32(8 + body.length), body]);
}

/** APK Signing Block with one v2 signer per certificate. */
function signingBlock(certs: Buffer[]) {
    const signers = certs.map((cert) => {
        const signedData = Buffer.concat([lp(), lp(lp(cert)), lp()]);
        return lp(lp(signedData), lp(), lp());
    });
    const v2 = lp(...signers);
    const pair = Buffer.concat([u64(4 + v2.length), u32(0x7109871a), v2]);
    const size = pair.length + 8 + 16;
    return Buffer.concat([u64(size), pair, u64(size), Buffer.from('APK Sig Block 42', 'latin1')]);
}

/** Stored (uncompressed) zip with an optional signing block before the central directory. */
function zip(files: { name: string; data: Buffer }[], block?: Buffer) {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const f of files) {
        const name = Buffer.from(f.name, 'utf8');
        const local = Buffer.concat([
            u32(0x04034b50),
            u16(20),
            u16(0),
            u16(0),
            u16(0),
            u16(0),
            u32(0),
            u32(f.data.length),
            u32(f.data.length),
            u16(name.length),
            u16(0),
            name,
            f.data,
        ]);
        centrals.push(
            Buffer.concat([
                u32(0x02014b50),
                u16(20),
                u16(20),
                u16(0),
                u16(0),
                u16(0),
                u16(0),
                u32(0),
                u32(f.data.length),
                u32(f.data.length),
                u16(name.length),
                u16(0),
                u16(0),
                u16(0),
                u16(0),
                u32(0),
                u32(offset),
                name,
            ])
        );
        locals.push(local);
        offset += local.length;
    }
    const sig = block ?? Buffer.alloc(0);
    const cd = Buffer.concat(centrals);
    const cdOffset = offset + sig.length;
    const eocd = Buffer.concat([
        u32(0x06054b50),
        u16(0),
        u16(0),
        u16(files.length),
        u16(files.length),
        u32(cd.length),
        u32(cdOffset),
        u16(0),
    ]);
    return Buffer.concat([...locals, sig, cd, eocd]);
}

function apk(opts: { pkg?: string; code?: number; name?: string; certs?: Buffer[] | null } = {}) {
    const manifest = binaryManifest(
        opts.pkg ?? 'io.vacademy.classroom.direct',
        opts.code ?? 3,
        opts.name ?? '0.3.0-direct',
        24
    );
    const certs = opts.certs === undefined ? [RELEASE_CERT] : opts.certs;
    return zip(
        [
            { name: 'AndroidManifest.xml', data: manifest },
            { name: 'classes.dex', data: Buffer.from('dex\n035\0') },
        ],
        certs ? signingBlock(certs) : undefined
    );
}

// -------------------------------------------------------------------- tests

describe('publish-direct-apk', () => {
    it('reads the manifest of a binary AndroidManifest.xml', () => {
        expect(parseBinaryManifest(binaryManifest('a.b.c', 7, '1.2.3', 26))).toEqual({
            packageName: 'a.b.c',
            versionCode: 7,
            versionName: '1.2.3',
            minSdk: 26,
        });
    });

    it('reads the v2 signing certificate', () => {
        const buf = apk();
        const { cdOffset } = readZipEntries(buf);
        const signing = readSigningCertificates(buf, cdOffset);
        expect(signing?.scheme).toBe('v2');
        expect(signing?.certificates.map((c: { sha256: string }) => c.sha256)).toEqual([
            RELEASE_CERT_SHA,
        ]);
    });

    it('prints a DRAFT release body for a good APK', () => {
        const buf = apk();
        const { problems, info } = inspectApk(buf, { flavor: FLAVOR, baseUrl: BASE, notes: 'lab' });
        expect(problems).toEqual([]);
        const sha = crypto.createHash('sha256').update(buf).digest('hex');
        expect(info.objectKey).toBe(`classroom-releases/direct/3-${sha.slice(0, 8)}.apk`);
        expect(info.body).toEqual({
            channel: 'DIRECT',
            version_code: 3,
            version_name: '0.3.0-direct',
            apk_url: `${BASE}/3-${sha.slice(0, 8)}.apk`,
            sha256: sha,
            size_bytes: buf.length,
            min_sdk: 24,
            rollout_percent: 0,
            required: false,
            notes: 'lab',
            package_name: 'io.vacademy.classroom.direct',
            signing_cert_sha256: RELEASE_CERT_SHA,
        });
    });

    it.each([
        ['the store package', { pkg: 'io.vacademy.classroom' }, /package is/],
        ['another version code', { code: 4 }, /versionCode is 4/],
        ['a version name without -direct', { name: '0.3.0' }, /versionName is/],
        ['no v2/v3 signature', { certs: null }, /no APK Signature Scheme/],
        ['the debug certificate', { certs: [DEBUG_CERT] }, /debug certificate/],
        ['two signers', { certs: [RELEASE_CERT, DEBUG_CERT] }, /one signer/],
    ])('refuses %s', (_label, opts, problem) => {
        const { problems } = inspectApk(apk(opts), { flavor: FLAVOR, baseUrl: BASE });
        expect(problems.join('\n')).toMatch(problem);
    });

    it('checks --expect-cert', () => {
        expect(
            inspectApk(apk(), { flavor: FLAVOR, baseUrl: BASE, expectCert: RELEASE_CERT_SHA })
                .problems
        ).toEqual([]);
        expect(
            inspectApk(apk(), {
                flavor: FLAVOR,
                baseUrl: BASE,
                expectCert: 'ab'.repeat(32),
            }).problems.join()
        ).toMatch(/not --expect-cert/);
    });

    it('allows the debug certificate only when asked (lab builds)', () => {
        const { problems } = inspectApk(apk({ certs: [DEBUG_CERT] }), {
            flavor: FLAVOR,
            baseUrl: BASE,
            allowDebugCert: true,
        });
        expect(problems).toEqual([]);
        expect(isDebugCertificate('C=US, O=Android, CN=Android Debug')).toBe(true);
        expect(isDebugCertificate('CN=Android Debugger')).toBe(false);
    });

    it.each([
        ['http', 'http://updates.example.org/x', /https/],
        ['another host', 'https://other.example.org/x', /not in mobile-flavors/],
        ['a port', 'https://updates.example.org:8443/x', /default port/],
        ['credentials', 'https://u:p@updates.example.org/x', /credentials/],
        ['garbage', 'not a url', /not a URL/],
    ])('refuses a base URL with %s', (_label, url, problem) => {
        expect(checkBaseUrl(url, FLAVOR.updateHosts)).toMatch(problem);
    });

    it('builds immutable keys and caps notes', () => {
        expect(releaseObjectKey(12, 'abcdef0123456789')).toBe(
            'classroom-releases/direct/12-abcdef01.apk'
        );
        expect(
            releaseBody({
                versionCode: 1,
                versionName: 'x',
                apkUrl: 'u',
                sha256: 's',
                sizeBytes: 1,
                minSdk: 24,
                notes: 'n'.repeat(600),
            }).notes
        ).toHaveLength(500);
    });

    it('carries the build identity the server checks', () => {
        const body = releaseBody({
            versionCode: 3,
            versionName: '0.3.0-direct',
            apkUrl: 'u',
            sha256: 's',
            sizeBytes: 1,
            minSdk: 24,
            packageName: 'io.vacademy.classroom.direct',
            signingCertSha256: 'ab'.repeat(32),
        });
        expect(body.package_name).toBe('io.vacademy.classroom.direct');
        expect(body.signing_cert_sha256).toBe('ab'.repeat(32));
        expect(releaseBody({ versionCode: 1, versionName: 'x' }).package_name).toBeNull();
    });

    it('imports no network module', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const source = fs.readFileSync(path.join(__dirname, 'publish-direct-apk.mjs'), 'utf8');
        expect(source).not.toMatch(
            /from ['"](node:)?(https?|net|tls|dgram|http2|child_process)['"]/
        );
        expect(source).not.toMatch(/\bfetch\(/);
    });
});
