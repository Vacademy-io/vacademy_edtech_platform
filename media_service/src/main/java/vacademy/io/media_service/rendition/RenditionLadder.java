package vacademy.io.media_service.rendition;

import java.util.ArrayList;
import java.util.List;

/**
 * The fixed widths of a product image.
 *
 * <p>An image is never enlarged. A source narrower than the widest rung also gets one rendition
 * at its own width, so the best available size is always served as WebP: 800 px gives 320, 640
 * and 800; 2,000 px gives 320, 640, 960 and 1,600.
 */
public final class RenditionLadder {

    public static final List<Integer> RUNGS = List.of(320, 640, 960, 1600);

    private RenditionLadder() {
    }

    /** Rendition widths for a source of this display width, ascending. */
    public static List<Integer> widthsFor(int sourceWidth) {
        if (sourceWidth < 1) {
            throw new IllegalArgumentException("sourceWidth must be positive");
        }
        List<Integer> widths = new ArrayList<>();
        for (int rung : RUNGS) {
            if (rung <= sourceWidth) {
                widths.add(rung);
            }
        }
        int widest = RUNGS.get(RUNGS.size() - 1);
        if (sourceWidth < widest && !widths.contains(sourceWidth)) {
            widths.add(sourceWidth);
        }
        return widths;
    }

    /** Height that keeps the aspect ratio, at least 1. */
    public static int heightFor(int sourceWidth, int sourceHeight, int targetWidth) {
        return Math.max(1, (int) Math.round((double) sourceHeight * targetWidth / sourceWidth));
    }
}
