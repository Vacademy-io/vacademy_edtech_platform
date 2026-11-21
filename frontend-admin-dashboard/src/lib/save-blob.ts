import { saveAs } from 'file-saver';
import { isNative } from '@/native/platform';

/** Bytes per write to the native file: a multiple of 3, so each slice is whole base64. */
const CHUNK_BYTES = 3 * 1024 * 1024;

const toBase64 = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const url = String(reader.result ?? '');
            resolve(url.slice(url.indexOf(',') + 1));
        };
        reader.onerror = () => reject(reader.error ?? new Error('read failed'));
        reader.readAsDataURL(blob);
    });

/**
 * Save a generated file (a zip of checked copies, an export). On the web it is
 * a normal browser download. In the native apps a WebView cannot download a
 * blob, so the file is written to the app cache in slices (a single base64
 * string of a 100 MB zip would not survive the bridge) and handed to the share
 * sheet, where the user saves it to Files / Drive or sends it on.
 */
export const saveBlob = async (blob: Blob, fileName: string): Promise<void> => {
    if (!isNative()) {
        saveAs(blob, fileName);
        return;
    }
    const [{ Directory, Filesystem }, { Share }] = await Promise.all([
        import('@capacitor/filesystem'),
        import('@capacitor/share'),
    ]);
    const path = `exports/${fileName}`;
    await Filesystem.writeFile({
        path,
        data: await toBase64(blob.slice(0, CHUNK_BYTES)),
        directory: Directory.Cache,
        recursive: true,
    });
    for (let offset = CHUNK_BYTES; offset < blob.size; offset += CHUNK_BYTES) {
        await Filesystem.appendFile({
            path,
            data: await toBase64(blob.slice(offset, offset + CHUNK_BYTES)),
            directory: Directory.Cache,
        });
    }
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
    try {
        await Share.share({ title: fileName, files: [uri] });
    } catch (e) {
        // Closing the share sheet is not an error; anything else is.
        if (!/cancel/i.test(e instanceof Error ? e.message : String(e))) throw e;
    }
};
