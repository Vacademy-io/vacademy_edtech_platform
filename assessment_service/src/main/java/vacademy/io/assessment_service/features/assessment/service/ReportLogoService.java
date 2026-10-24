package vacademy.io.assessment_service.features.assessment.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import vacademy.io.common.media.service.FileService;

import javax.imageio.ImageIO;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.Base64;

/**
 * Turns an institute's stored logo into something a PDF can actually use.
 *
 * <p>Handing {@code <img src="<presigned url>">} straight to iText, which is
 * what the report builders did, has three problems that all show up as "the
 * logo looks wrong":
 *
 * <ol>
 *   <li><b>Size.</b> Institutes upload print masters. Shiksha Nation's logo is
 *       4167x4167 and 747KB; iText embeds it at full resolution to draw it 40px
 *       wide, so every single PDF carries three quarters of a megabyte of
 *       invisible detail.</li>
 *   <li><b>Padding.</b> Brand assets are usually exported on a square canvas
 *       with generous whitespace. Constrained to a 40px box, the actual mark
 *       renders at roughly half that and reads as a rendering fault rather than
 *       a logo.</li>
 *   <li><b>Fetch failure.</b> A presigned URL that has expired, or a media
 *       service blip, leaves a broken-image box on a document going out to
 *       parents — and iText fetches lazily, so it fails at render time, far
 *       from anything that could report it.</li>
 * </ol>
 *
 * <p>So the bytes are fetched once, trimmed of their uniform border, downscaled
 * and inlined as a data URI. Everything is best-effort: any failure falls back
 * to the plain URL, which is exactly the previous behaviour.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ReportLogoService {

    /** Longest edge kept after downscaling. The header box is ~52px; 4x covers retina print. */
    private static final int MAX_EDGE_PX = 240;
    /**
     * How close to the corner colour a pixel must be to count as border. Brand
     * exports are rarely pure #FFFFFF — JPEG ringing alone shifts edge pixels by
     * a few levels — so an exact match trims nothing at all.
     */
    private static final int BORDER_TOLERANCE = 12;
    /** Never trim more than this fraction off a side; a logo that IS mostly background stays intact. */
    private static final double MAX_TRIM_FRACTION = 0.42;
    /** Above this, treat the source as hostile and don't decode it at all. */
    private static final int MAX_SOURCE_BYTES = 12 * 1024 * 1024;

    private final FileService fileService;

    /**
     * Print-ready data URI for an institute logo, or null when it cannot be
     * produced (no file id, fetch failure, undecodable bytes) — callers treat
     * null as "fall back to the URL, or render no logo".
     *
     * <p>Cached per file id: institute logos change perhaps once a year, and a
     * bulk export would otherwise re-fetch and re-scale the same master image
     * once per report.
     */
    @Cacheable(value = "reportLogoDataUri", key = "#logoFileId", unless = "#result == null")
    public String resolveInlineLogo(String logoFileId) {
        if (logoFileId == null || logoFileId.isBlank()) {
            return null;
        }
        try {
            byte[] source = fileService.getFileFromFileId(logoFileId);
            return prepare(source);
        } catch (Exception e) {
            log.warn("Could not inline logo {} for a report: {}", logoFileId, e.getMessage());
            return null;
        }
    }

    /**
     * The pure half: raw image bytes in, {@code data:image/png;base64,...} out.
     * Separated from the fetch so it can be exercised on a local file without a
     * media service.
     *
     * @return a data URI, or null if the bytes are not a decodable image
     */
    public String prepare(byte[] source) {
        if (source == null || source.length == 0 || source.length > MAX_SOURCE_BYTES) {
            if (source != null && source.length > MAX_SOURCE_BYTES) {
                log.warn("Logo rejected: {} bytes exceeds the {} byte cap", source.length, MAX_SOURCE_BYTES);
            }
            return null;
        }
        try {
            BufferedImage image = ImageIO.read(new ByteArrayInputStream(source));
            if (image == null || image.getWidth() <= 0 || image.getHeight() <= 0) {
                return null;
            }
            BufferedImage trimmed = trimUniformBorder(image);
            BufferedImage scaled = downscale(trimmed);

            ByteArrayOutputStream out = new ByteArrayOutputStream();
            // PNG throughout: the trim can expose transparency, and a JPEG
            // re-encode of a flat-colour logo produces visible ringing.
            ImageIO.write(scaled, "png", out);
            byte[] bytes = out.toByteArray();
            log.debug("Logo prepared: {}x{} / {}B -> {}x{} / {}B",
                    image.getWidth(), image.getHeight(), source.length,
                    scaled.getWidth(), scaled.getHeight(), bytes.length);
            return "data:image/png;base64," + Base64.getEncoder().encodeToString(bytes);
        } catch (Exception e) {
            log.warn("Could not prepare a logo image for a report: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Crops the uniform margin around the mark, using the top-left pixel as the
     * reference background. Fully transparent pixels always count as border, so
     * a PNG with an alpha canvas trims correctly regardless of its RGB.
     */
    private BufferedImage trimUniformBorder(BufferedImage image) {
        int w = image.getWidth();
        int h = image.getHeight();
        int reference = image.getRGB(0, 0);

        int top = 0, bottom = h - 1, left = 0, right = w - 1;
        while (top < bottom && rowIsBorder(image, top, w, reference)) top++;
        while (bottom > top && rowIsBorder(image, bottom, w, reference)) bottom--;
        while (left < right && colIsBorder(image, left, h, reference)) left++;
        while (right > left && colIsBorder(image, right, h, reference)) right--;

        // Guard against trimming a logo that is legitimately mostly background.
        int maxTrimX = (int) (w * MAX_TRIM_FRACTION);
        int maxTrimY = (int) (h * MAX_TRIM_FRACTION);
        left = Math.min(left, maxTrimX);
        right = Math.max(right, w - 1 - maxTrimX);
        top = Math.min(top, maxTrimY);
        bottom = Math.max(bottom, h - 1 - maxTrimY);

        int newW = right - left + 1;
        int newH = bottom - top + 1;
        if (newW <= 0 || newH <= 0 || (newW == w && newH == h)) {
            return image;
        }
        return image.getSubimage(left, top, newW, newH);
    }

    private boolean rowIsBorder(BufferedImage image, int y, int width, int reference) {
        // Sampling every pixel of a 4000px row is wasted work — a stride still
        // catches any mark that touches the row.
        int stride = Math.max(1, width / 400);
        for (int x = 0; x < width; x += stride) {
            if (!isBorderPixel(image.getRGB(x, y), reference)) return false;
        }
        return true;
    }

    private boolean colIsBorder(BufferedImage image, int x, int height, int reference) {
        int stride = Math.max(1, height / 400);
        for (int y = 0; y < height; y += stride) {
            if (!isBorderPixel(image.getRGB(x, y), reference)) return false;
        }
        return true;
    }

    private static boolean isBorderPixel(int argb, int reference) {
        int alpha = (argb >>> 24) & 0xFF;
        if (alpha < 16) {
            return true;
        }
        int dr = Math.abs(((argb >> 16) & 0xFF) - ((reference >> 16) & 0xFF));
        int dg = Math.abs(((argb >> 8) & 0xFF) - ((reference >> 8) & 0xFF));
        int db = Math.abs((argb & 0xFF) - (reference & 0xFF));
        return dr <= BORDER_TOLERANCE && dg <= BORDER_TOLERANCE && db <= BORDER_TOLERANCE;
    }

    private BufferedImage downscale(BufferedImage image) {
        int w = image.getWidth();
        int h = image.getHeight();
        int longEdge = Math.max(w, h);
        if (longEdge <= MAX_EDGE_PX) {
            // Still redraw into an ARGB raster: getSubimage shares the parent's
            // buffer, which ImageIO writes out at the PARENT's dimensions.
            return copy(image, w, h);
        }
        double scale = (double) MAX_EDGE_PX / longEdge;
        return copy(image, Math.max(1, (int) Math.round(w * scale)), Math.max(1, (int) Math.round(h * scale)));
    }

    private BufferedImage copy(BufferedImage source, int width, int height) {
        BufferedImage target = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = target.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.drawImage(source, 0, 0, width, height, null);
        g.dispose();
        return target;
    }
}
