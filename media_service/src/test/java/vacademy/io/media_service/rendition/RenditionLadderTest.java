package vacademy.io.media_service.rendition;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RenditionLadderTest {

    @Test
    void an800PixelUploadYieldsThreeRenditions() {
        assertEquals(List.of(320, 640, 800), RenditionLadder.widthsFor(800));
    }

    @Test
    void a2000PixelUploadYieldsFour() {
        assertEquals(List.of(320, 640, 960, 1600), RenditionLadder.widthsFor(2000));
    }

    @Test
    void aSourceOnARungIsNotListedTwice() {
        assertEquals(List.of(320, 640), RenditionLadder.widthsFor(640));
        assertEquals(List.of(320, 640, 960, 1600), RenditionLadder.widthsFor(1600));
    }

    @Test
    void aSmallSourceGetsOnlyItsOwnWidth() {
        assertEquals(List.of(200), RenditionLadder.widthsFor(200));
        assertEquals(List.of(319), RenditionLadder.widthsFor(319));
        assertEquals(List.of(1), RenditionLadder.widthsFor(1));
    }

    @Test
    void nothingIsEverWiderThanTheSource() {
        for (int source = 1; source <= 4000; source += 7) {
            List<Integer> widths = RenditionLadder.widthsFor(source);
            assertFalse(widths.isEmpty());
            for (int width : widths) {
                assertTrue(width <= source, width + " is wider than the source " + source);
                assertTrue(width <= 1600);
            }
        }
    }

    @Test
    void heightKeepsTheAspectRatio() {
        assertEquals(800, RenditionLadder.heightFor(1600, 2000, 640));
        assertEquals(400, RenditionLadder.heightFor(800, 1000, 320));
        assertEquals(1, RenditionLadder.heightFor(4000, 2, 320));
    }

    @Test
    void aNonPositiveWidthIsRefused() {
        assertThrows(IllegalArgumentException.class, () -> RenditionLadder.widthsFor(0));
    }
}
