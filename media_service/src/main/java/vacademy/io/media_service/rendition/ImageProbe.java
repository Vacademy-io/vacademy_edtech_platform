package vacademy.io.media_service.rendition;

import java.nio.charset.StandardCharsets;

/**
 * Reads the type and the pixel size of an upload from its first bytes, without decoding it.
 * The type comes from the content, never from the file name or the stored content type, and
 * the size is known before any pixel buffer is allocated (decompression bombs).
 */
public final class ImageProbe {

    public enum Format { JPEG, PNG, WEBP }

    /**
     * @param storedWidth  width as stored in the file
     * @param storedHeight height as stored in the file
     * @param orientation  EXIF orientation 1 to 8; 1 when absent
     * @param bitDepth     bits per sample (8, or 16 for a deep PNG)
     * @param progressive  a progressive JPEG, which the JDK decoder buffers whole in native memory
     */
    public record Info(Format format, int storedWidth, int storedHeight, int orientation, int bitDepth,
                       boolean progressive) {

        public Info(Format format, int storedWidth, int storedHeight, int orientation) {
            this(format, storedWidth, storedHeight, orientation, 8, false);
        }

        public boolean rotated() {
            return orientation >= 5;
        }

        /** Width as a viewer shows it, after the EXIF orientation. */
        public int displayWidth() {
            return rotated() ? storedHeight : storedWidth;
        }

        public int displayHeight() {
            return rotated() ? storedWidth : storedHeight;
        }

        public long pixels() {
            return (long) storedWidth * storedHeight;
        }
    }

    private ImageProbe() {
    }

    public static Info probe(byte[] b) throws RenditionException {
        if (b == null || b.length < 12) {
            throw notAnImage();
        }
        Info info;
        if (u8(b, 0) == 0xFF && u8(b, 1) == 0xD8 && u8(b, 2) == 0xFF) {
            info = jpeg(b);
        } else if (startsWith(b, 0, new int[] {0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A})) {
            info = png(b);
        } else if (ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP")) {
            info = webp(b);
        } else {
            throw notAnImage();
        }
        if (info.storedWidth() < 1 || info.storedHeight() < 1) {
            throw new RenditionException(RenditionError.UNSUPPORTED_IMAGE, "the image has no size");
        }
        return info;
    }

    private static Info jpeg(byte[] b) throws RenditionException {
        int orientation = 1;
        int i = 2;
        while (i + 4 <= b.length) {
            if (u8(b, i) != 0xFF) {
                break;
            }
            int marker = u8(b, i + 1);
            if (marker == 0xFF) {
                i++;
                continue;
            }
            if (marker == 0xD8 || marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
                i += 2;
                continue;
            }
            if (marker == 0xD9 || marker == 0xDA) {
                break;
            }
            int length = u16be(b, i + 2);
            if (length < 2 || i + 2 + length > b.length) {
                break;
            }
            if (marker == 0xE1) {
                int found = exifOrientation(b, i + 4, length - 2);
                if (found != 0) {
                    orientation = found;
                }
            } else if (isStartOfFrame(marker) && length >= 7) {
                boolean progressive = marker == 0xC2 || marker == 0xC6 || marker == 0xCA || marker == 0xCE;
                return new Info(Format.JPEG, u16be(b, i + 7), u16be(b, i + 5), orientation, 8, progressive);
            }
            i += 2 + length;
        }
        throw new RenditionException(RenditionError.UNSUPPORTED_IMAGE, "the JPEG file has no frame header");
    }

    private static boolean isStartOfFrame(int marker) {
        return marker >= 0xC0 && marker <= 0xCF && marker != 0xC4 && marker != 0xC8 && marker != 0xCC;
    }

    /** 0 when the segment is not EXIF or carries no usable orientation. */
    private static int exifOrientation(byte[] b, int offset, int length) {
        int end = offset + length;
        if (length < 14 || !ascii(b, offset, "Exif") || u8(b, offset + 4) != 0 || u8(b, offset + 5) != 0) {
            return 0;
        }
        int tiff = offset + 6;
        boolean little;
        if (u8(b, tiff) == 'I' && u8(b, tiff + 1) == 'I') {
            little = true;
        } else if (u8(b, tiff) == 'M' && u8(b, tiff + 1) == 'M') {
            little = false;
        } else {
            return 0;
        }
        if (u16(b, tiff + 2, little) != 42) {
            return 0;
        }
        long ifd = u32(b, tiff + 4, little);
        if (ifd < 8 || tiff + ifd + 2 > end) {
            return 0;
        }
        int at = (int) (tiff + ifd);
        int entries = u16(b, at, little);
        at += 2;
        for (int n = 0; n < entries && at + 12 <= end; n++, at += 12) {
            if (u16(b, at, little) == 0x0112) {
                int value = u16(b, at + 8, little);
                return value >= 1 && value <= 8 ? value : 0;
            }
        }
        return 0;
    }

    private static Info png(byte[] b) throws RenditionException {
        if (b.length < 24 || !ascii(b, 12, "IHDR")) {
            throw new RenditionException(RenditionError.UNSUPPORTED_IMAGE, "the PNG file has no header");
        }
        long width = u32(b, 16, false);
        long height = u32(b, 20, false);
        if (width > Integer.MAX_VALUE || height > Integer.MAX_VALUE) {
            throw new RenditionException(RenditionError.TOO_MANY_PIXELS, "the image is too large");
        }
        int bitDepth = u8(b, 24);
        return new Info(Format.PNG, (int) width, (int) height, 1, bitDepth == 16 ? 16 : 8, false);
    }

    private static Info webp(byte[] b) throws RenditionException {
        if (b.length < 30) {
            throw new RenditionException(RenditionError.UNSUPPORTED_IMAGE, "the WebP file is cut short");
        }
        if (ascii(b, 12, "VP8 ")) {
            if (u8(b, 23) != 0x9D || u8(b, 24) != 0x01 || u8(b, 25) != 0x2A) {
                throw new RenditionException(RenditionError.UNSUPPORTED_IMAGE, "the WebP file has no key frame");
            }
            return new Info(Format.WEBP, u16(b, 26, true) & 0x3FFF, u16(b, 28, true) & 0x3FFF, 1);
        }
        if (ascii(b, 12, "VP8L")) {
            if (u8(b, 20) != 0x2F) {
                throw new RenditionException(RenditionError.UNSUPPORTED_IMAGE, "the WebP file is damaged");
            }
            long bits = u32(b, 21, true);
            return new Info(Format.WEBP, (int) (bits & 0x3FFF) + 1, (int) ((bits >> 14) & 0x3FFF) + 1, 1);
        }
        if (ascii(b, 12, "VP8X")) {
            if ((u8(b, 20) & 0x02) != 0) {
                throw new RenditionException(RenditionError.UNSUPPORTED_IMAGE, "animated images are not taken");
            }
            int width = (u8(b, 24) | u8(b, 25) << 8 | u8(b, 26) << 16) + 1;
            int height = (u8(b, 27) | u8(b, 28) << 8 | u8(b, 29) << 16) + 1;
            return new Info(Format.WEBP, width, height, 1);
        }
        throw new RenditionException(RenditionError.UNSUPPORTED_IMAGE, "unknown WebP layout");
    }

    private static RenditionException notAnImage() {
        return new RenditionException(RenditionError.NOT_AN_IMAGE, "the file is not a JPEG, PNG or WebP image");
    }

    private static boolean startsWith(byte[] b, int offset, int[] expected) {
        if (offset + expected.length > b.length) {
            return false;
        }
        for (int i = 0; i < expected.length; i++) {
            if (u8(b, offset + i) != expected[i]) {
                return false;
            }
        }
        return true;
    }

    private static boolean ascii(byte[] b, int offset, String text) {
        byte[] expected = text.getBytes(StandardCharsets.US_ASCII);
        if (offset < 0 || offset + expected.length > b.length) {
            return false;
        }
        for (int i = 0; i < expected.length; i++) {
            if (b[offset + i] != expected[i]) {
                return false;
            }
        }
        return true;
    }

    private static int u8(byte[] b, int i) {
        return i >= 0 && i < b.length ? b[i] & 0xFF : -1;
    }

    private static int u16be(byte[] b, int i) {
        return u16(b, i, false);
    }

    private static int u16(byte[] b, int i, boolean little) {
        if (i < 0 || i + 2 > b.length) {
            return -1;
        }
        int first = b[i] & 0xFF;
        int second = b[i + 1] & 0xFF;
        return little ? first | second << 8 : first << 8 | second;
    }

    private static long u32(byte[] b, int i, boolean little) {
        if (i < 0 || i + 4 > b.length) {
            return -1;
        }
        long b0 = b[i] & 0xFF;
        long b1 = b[i + 1] & 0xFF;
        long b2 = b[i + 2] & 0xFF;
        long b3 = b[i + 3] & 0xFF;
        return little ? b0 | b1 << 8 | b2 << 16 | b3 << 24 : b0 << 24 | b1 << 16 | b2 << 8 | b3;
    }
}
