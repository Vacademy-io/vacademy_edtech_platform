package vacademy.io.media_service.rendition;

import javax.imageio.ImageIO;
import javax.imageio.ImageReadParam;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import javax.imageio.stream.MemoryCacheImageInputStream;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Iterator;

/**
 * Decoding and downscaling in plain Java. Output is always an sRGB image (TYPE_INT_RGB, or
 * TYPE_INT_ARGB when the source has transparency) in display orientation; nothing of the
 * source metadata survives because only pixels are carried over.
 */
public final class ImageScaler {

    private ImageScaler() {
    }

    /**
     * How much of the source to skip while decoding. A source several times wider than the
     * widest rendition is read at every n-th pixel, so the decoded buffer stays below three
     * times that rendition in each direction whatever the upload was.
     */
    public static int subsampling(int sourceDisplayWidth, int widestTarget) {
        if (widestTarget < 1) {
            return 1;
        }
        return Math.max(1, (int) (sourceDisplayWidth / (widestTarget * 1.5)));
    }

    /** Decodes a JPEG or PNG. The size limits must have been checked on the probe result before. */
    public static BufferedImage decode(byte[] bytes, ImageProbe.Format format, int subsampling)
            throws RenditionException {
        String name = format == ImageProbe.Format.JPEG ? "jpeg" : "png";
        Iterator<ImageReader> readers = ImageIO.getImageReadersByFormatName(name);
        if (!readers.hasNext()) {
            throw new RenditionException(RenditionError.UNSUPPORTED_IMAGE, "no decoder for " + name);
        }
        ImageReader reader = readers.next();
        try (ImageInputStream in = new MemoryCacheImageInputStream(new ByteArrayInputStream(bytes))) {
            reader.setInput(in, true, true);
            ImageReadParam param = reader.getDefaultReadParam();
            if (subsampling > 1) {
                param.setSourceSubsampling(subsampling, subsampling, 0, 0);
            }
            BufferedImage image = reader.read(0, param);
            if (image == null) {
                throw new RenditionException(RenditionError.UNSUPPORTED_IMAGE, "the image could not be decoded");
            }
            return image;
        } catch (IOException | RuntimeException e) {
            // The JDK decoder refuses CMYK JPEGs and damaged files here.
            throw new RenditionException(RenditionError.UNSUPPORTED_IMAGE,
                    "the image could not be decoded: " + e.getMessage(), e);
        } finally {
            reader.dispose();
        }
    }

    /**
     * One rendition: the decoded source scaled down to the given display size and turned as
     * its EXIF orientation says.
     */
    public static BufferedImage render(BufferedImage decoded, int orientation, int displayWidth, int displayHeight) {
        boolean rotated = orientation >= 5;
        int storedWidth = rotated ? displayHeight : displayWidth;
        int storedHeight = rotated ? displayWidth : displayHeight;
        return orient(scale(decoded, storedWidth, storedHeight), orientation);
    }

    /** Scales to exactly the given size; halves with averaging first so that fine detail does not alias. */
    static BufferedImage scale(BufferedImage source, int targetWidth, int targetHeight) {
        int type = source.getColorModel().hasAlpha() ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB;
        BufferedImage current = source;
        int width = source.getWidth();
        int height = source.getHeight();
        while (width / 2 >= targetWidth && height / 2 >= targetHeight) {
            width = width / 2;
            height = height / 2;
            current = draw(current, width, height, type, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        }
        if (width != targetWidth || height != targetHeight || current.getType() != type) {
            current = draw(current, targetWidth, targetHeight, type, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        }
        return current;
    }

    private static BufferedImage draw(BufferedImage source, int width, int height, int type, Object interpolation) {
        // Drawing onto an INT_RGB or INT_ARGB image converts the pixels to sRGB.
        BufferedImage target = new BufferedImage(width, height, type);
        Graphics2D g = target.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, interpolation);
            g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
            g.setRenderingHint(RenderingHints.KEY_COLOR_RENDERING, RenderingHints.VALUE_COLOR_RENDER_QUALITY);
            g.drawImage(source, 0, 0, width, height, null);
        } finally {
            g.dispose();
        }
        return target;
    }

    /** Applies an EXIF orientation (1 to 8) to an image that is still in stored orientation. */
    static BufferedImage orient(BufferedImage image, int orientation) {
        if (orientation <= 1 || orientation > 8) {
            return image;
        }
        int w = image.getWidth();
        int h = image.getHeight();
        boolean rotated = orientation >= 5;
        int outWidth = rotated ? h : w;
        int outHeight = rotated ? w : h;
        int[] in = image.getRGB(0, 0, w, h, null, 0, w);
        int[] out = new int[outWidth * outHeight];
        for (int y = 0; y < outHeight; y++) {
            for (int x = 0; x < outWidth; x++) {
                int sx;
                int sy;
                switch (orientation) {
                    case 2 -> { sx = w - 1 - x; sy = y; }
                    case 3 -> { sx = w - 1 - x; sy = h - 1 - y; }
                    case 4 -> { sx = x; sy = h - 1 - y; }
                    case 5 -> { sx = y; sy = x; }
                    case 6 -> { sx = y; sy = h - 1 - x; }
                    case 7 -> { sx = w - 1 - y; sy = h - 1 - x; }
                    default -> { sx = w - 1 - y; sy = x; }
                }
                out[y * outWidth + x] = in[sy * w + sx];
            }
        }
        BufferedImage result = new BufferedImage(outWidth, outHeight, image.getType());
        result.setRGB(0, 0, outWidth, outHeight, out, 0, outWidth);
        return result;
    }
}
