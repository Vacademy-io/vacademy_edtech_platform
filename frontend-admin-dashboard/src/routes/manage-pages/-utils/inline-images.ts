/**
 * Inline (base64) images in pasted HTML.
 *
 * HTML from an AI tool, a Word/Docs export or an old site often carries its
 * images as `data:image/...;base64,...` text. One banner is hundreds of KB of
 * text, which pushes a blog post past the server's body limit and makes every
 * page load download it again. Before saving, each such image is uploaded to
 * S3 once and its data URI is swapped for the public URL — in `<img src>`,
 * `srcset` and CSS `url(...)` alike, since the swap is a plain text replace.
 */

/** Below this many base64 chars (~1.5 KB) an icon is cheaper to keep inline. */
const MIN_BASE64_CHARS = 2000;

const INLINE_IMAGE_RE = /data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})/g;

const EXTENSIONS: Record<string, string> = {
    jpeg: 'jpg',
    jpg: 'jpg',
    png: 'png',
    gif: 'gif',
    webp: 'webp',
    avif: 'avif',
    'svg+xml': 'svg',
    bmp: 'bmp',
};

export interface InlineImage {
    /** The full `data:image/...;base64,...` text as it appears in the HTML. */
    uri: string;
    mime: string;
    base64: string;
}

/** Distinct inline images worth uploading, in order of first appearance. */
export const findInlineImages = (html: string): InlineImage[] => {
    const seen = new Set<string>();
    const found: InlineImage[] = [];
    for (const m of html.matchAll(INLINE_IMAGE_RE)) {
        const [uri, subtype = '', base64 = ''] = m;
        if (base64.length < MIN_BASE64_CHARS || seen.has(uri)) continue;
        seen.add(uri);
        found.push({ uri, mime: `image/${subtype.toLowerCase()}`, base64 });
    }
    return found;
};

export const inlineImageToFile = (image: InlineImage, index: number): File => {
    const binary = atob(image.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ext = EXTENSIONS[image.mime.slice('image/'.length)] ?? 'img';
    return new File([bytes], `blog-image-${Date.now()}-${index + 1}.${ext}`, { type: image.mime });
};

/** Thrown when an inline image cannot be uploaded; `message` is shown to the admin. */
export class InlineImageUploadError extends Error {}

/**
 * Upload every inline image in `html` and return the HTML with each data URI
 * replaced by its URL. Nothing is replaced unless all uploads succeed, so a
 * failure never saves a half-converted body.
 */
export const replaceInlineImages = async (
    html: string,
    upload: (file: File) => Promise<string>,
    onProgress?: (done: number, total: number) => void
): Promise<{ html: string; uploaded: number }> => {
    const images = findInlineImages(html);
    if (images.length === 0) return { html, uploaded: 0 };

    const urls: string[] = [];
    for (const [i, image] of images.entries()) {
        onProgress?.(i, images.length);
        let url = '';
        try {
            url = await upload(inlineImageToFile(image, i));
        } catch {
            url = '';
        }
        if (!/^https?:\/\//.test(url)) {
            throw new InlineImageUploadError(
                images.length === 1
                    ? 'The image in the article could not be uploaded. Please try saving again.'
                    : `Image ${i + 1} of ${images.length} in the article could not be uploaded. Please try saving again.`
            );
        }
        urls.push(url);
    }
    onProgress?.(images.length, images.length);

    let out = html;
    images.forEach((image, i) => {
        out = out.split(image.uri).join(urls[i]);
    });
    return { html: out, uploaded: images.length };
};
