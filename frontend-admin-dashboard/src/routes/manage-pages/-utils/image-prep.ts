/**
 * Browser side of an image upload in the page editor: read the picked file's
 * size, then upload it untouched or as a scaled-down copy (image-slots decides
 * which). Everything runs on the admin's machine before the upload; nothing on
 * the server changes.
 */
import { fitWithin, prepPlan, type ImageSlot, type Size } from './image-slots';

/** Natural size of an image file, or null when the browser cannot decode it. */
export const readImageSize = (file: Blob): Promise<Size | null> =>
    new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(null);
        };
        img.src = url;
    });

const loadImage = (file: Blob): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Could not read the image'));
        };
        img.src = url;
    });

/** Does any pixel let the background through? Sampled, so a large image stays quick. */
export const hasTransparency = (canvas: HTMLCanvasElement): boolean => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    // About 40k samples at most, always including the edges' first pixels.
    const step = Math.max(1, Math.floor((width * height) / 40000)) * 4;
    for (let i = 3; i < data.length; i += step) {
        if (data[i]! < 255) return true;
    }
    return false;
};

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

const baseName = (name: string) => name.replace(/\.[^.]+$/, '') || 'image';

/**
 * Encodes a canvas for the site: PNG for a PNG source or any transparency
 * (logos, screenshots, text stay sharp), else JPEG at high quality — the
 * formats every browser can both write and read.
 */
export const encodeCanvas = async (canvas: HTMLCanvasElement, name: string, sourceType: string): Promise<File> => {
    const png = sourceType === 'image/png' || hasTransparency(canvas);
    const type = png ? 'image/png' : 'image/jpeg';
    const blob = await toBlob(canvas, type, png ? undefined : 0.9);
    if (!blob) throw new Error('Could not encode the image');
    return new File([blob], `${baseName(name)}.${png ? 'png' : 'jpg'}`, { type });
};

/** Draws a source onto a new canvas at `size` (smooth downscale). */
const drawScaled = (source: CanvasImageSource, size: Size): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, size.width, size.height);
    return canvas;
};

/**
 * The file to upload for a picked image that was not cropped: the original
 * when it is already fine (small, or a type re-encoding would harm), else a
 * copy scaled to the slot's longer edge — and still the original if the copy
 * is not smaller.
 */
export const prepareOriginal = async (file: File, image: Size, slot: ImageSlot): Promise<File> => {
    const plan = prepPlan(file, image, slot);
    if (plan.keepOriginal) return file;
    try {
        const img = await loadImage(file);
        const out = await encodeCanvas(drawScaled(img, { width: plan.width, height: plan.height }), file.name, file.type);
        return out.size < file.size ? out : file;
    } catch {
        return file;
    }
};

/** The file to upload for a cropped image: the crop, capped at the slot's longer edge. */
export const prepareCropped = async (canvas: HTMLCanvasElement, source: File, slot: ImageSlot): Promise<File> => {
    const size = fitWithin({ width: canvas.width, height: canvas.height }, slot.maxEdge);
    const scaled = size.width === canvas.width && size.height === canvas.height ? canvas : drawScaled(canvas, size);
    return encodeCanvas(scaled, source.name, source.type);
};
