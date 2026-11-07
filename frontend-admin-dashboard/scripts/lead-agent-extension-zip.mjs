// The Lead Agent Chrome extension (../lead-agent-extension) as a download: every build adds
// /downloads/lead-agent-extension.zip, so the zip is always the extension in this commit. The dev
// server serves the same file. The zip holds one folder, lead-agent-extension/, which is what
// chrome://extensions -> "Load unpacked" takes after unzipping. Tests and package.json stay out.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

export const EXTENSION_ZIP_PATH = 'downloads/lead-agent-extension.zip';
const FOLDER = 'lead-agent-extension';
const LEFT_OUT = new Set(['test', 'package.json', 'node_modules', '.DS_Store']);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});

function crc32(buf) {
    let c = 0xffffffff;
    for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function files(dir, prefix = '') {
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => !LEFT_OUT.has(e.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .flatMap((e) => {
            const rel = prefix ? `${prefix}/${e.name}` : e.name;
            const full = path.join(dir, e.name);
            return e.isDirectory() ? files(full, rel) : [{ rel, full }];
        });
}

/** A zip (deflate) of the extension folder, with fixed timestamps so the same files give the same bytes. */
export function buildExtensionZip(sourceDir) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    const DOS_TIME = 0;
    const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01
    for (const { rel, full } of files(sourceDir)) {
        const data = fs.readFileSync(full);
        const packed = zlib.deflateRawSync(data, { level: 9 });
        const name = Buffer.from(`${FOLDER}/${rel}`, 'utf8');
        const crc = crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4); // version needed
        local.writeUInt16LE(0x0800, 6); // UTF-8 names
        local.writeUInt16LE(8, 8); // deflate
        local.writeUInt16LE(DOS_TIME, 10);
        local.writeUInt16LE(DOS_DATE, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(packed.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        locals.push(local, name, packed);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4); // version made by
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(8, 10);
        central.writeUInt16LE(DOS_TIME, 12);
        central.writeUInt16LE(DOS_DATE, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(packed.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, name);
        offset += local.length + name.length + packed.length;
    }
    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(centrals.length / 2, 8);
    end.writeUInt16LE(centrals.length / 2, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
}

/** Vite plugin: emits the zip into the build and serves it from the dev server. */
export function leadAgentExtensionZip(sourceDir) {
    return {
        name: 'lead-agent-extension-zip',
        generateBundle() {
            if (!fs.existsSync(path.join(sourceDir, 'manifest.json'))) {
                this.warn(
                    `lead-agent-extension not found at ${sourceDir}: no extension download in this build`
                );
                return;
            }
            this.emitFile({
                type: 'asset',
                fileName: EXTENSION_ZIP_PATH,
                source: buildExtensionZip(sourceDir),
            });
        },
        configureServer(server) {
            server.middlewares.use(`/${EXTENSION_ZIP_PATH}`, (_req, res) => {
                res.setHeader('Content-Type', 'application/zip');
                res.end(buildExtensionZip(sourceDir));
            });
        },
    };
}
