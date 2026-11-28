package vacademy.io.media_service.rendition;

import java.awt.image.BufferedImage;

/** The only part of the pipeline that is not plain Java, kept behind an interface for tests. */
public interface WebpCodec {

    /** Lossy WebP of an sRGB image, with no metadata. Quality is 1 to 100. */
    byte[] encode(BufferedImage image, int quality) throws RenditionException;

    /** Decodes a still WebP file. */
    BufferedImage decode(byte[] webp) throws RenditionException;
}
