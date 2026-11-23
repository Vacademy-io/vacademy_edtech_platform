package vacademy.io.admin_core_service.features.learner_home.model;

import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.*;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;

/** Lists and rewrites the images of a block (publish fills in URLs and renditions). */
public final class HomeImages {

    public static final String SLOT_BANNER_PHONE = "bannerPhone";
    public static final String SLOT_BANNER_DESKTOP = "bannerDesktop";
    public static final String SLOT_TILE_ICON = "tileIcon";
    public static final String SLOT_CARD = "card";

    private HomeImages() {
    }

    /** Minimum recommended width of a slot (spec section 9). */
    public static int minWidth(String slot) {
        return switch (slot) {
            case SLOT_BANNER_PHONE -> 800;
            case SLOT_BANNER_DESKTOP -> 1600;
            case SLOT_TILE_ICON -> 128;
            default -> 640;
        };
    }

    public static List<ImageSlotRef> images(Block b) {
        List<ImageSlotRef> out = new ArrayList<>();
        BlockConfig c = b.config();
        if (c instanceof BannerConfig bc) {
            for (int i = 0; i < bc.slides().size(); i++) {
                Slide s = bc.slides().get(i);
                add(out, "config.slides[" + i + "].image", s.image(), SLOT_BANNER_PHONE);
                add(out, "config.slides[" + i + "].desktop_image", s.desktopImage(), SLOT_BANNER_DESKTOP);
            }
        } else if (c instanceof ShortcutsConfig sc) {
            for (int i = 0; i < sc.tiles().size(); i++) {
                TileIcon icon = sc.tiles().get(i).icon();
                if (icon != null) add(out, "config.tiles[" + i + "].icon.image", icon.image(), SLOT_TILE_ICON);
            }
        } else if (c instanceof NoticeConfig n) {
            add(out, "config.image", n.image(), SLOT_CARD);
        } else if (c instanceof EventConfig e) {
            add(out, "config.image", e.image(), SLOT_CARD);
        }
        return out;
    }

    private static void add(List<ImageSlotRef> out, String path, ImageRef image, String slot) {
        if (image != null) out.add(new ImageSlotRef(path, image, slot));
    }

    /** The block with every image replaced by {@code fn(slotRef)}. */
    public static Block mapImages(Block b, Function<ImageSlotRef, ImageRef> fn) {
        BlockConfig c = b.config();
        if (c instanceof BannerConfig bc) {
            List<Slide> slides = new ArrayList<>();
            for (int i = 0; i < bc.slides().size(); i++) {
                Slide s = bc.slides().get(i);
                slides.add(new Slide(s.key(),
                        map(fn, "config.slides[" + i + "].image", s.image(), SLOT_BANNER_PHONE),
                        map(fn, "config.slides[" + i + "].desktop_image", s.desktopImage(), SLOT_BANNER_DESKTOP),
                        s.link(), s.startsAt(), s.endsAt()));
            }
            return b.withConfig(new BannerConfig(bc.title(), bc.autoRotate(), List.copyOf(slides)));
        }
        if (c instanceof ShortcutsConfig sc) {
            List<Tile> tiles = new ArrayList<>();
            for (int i = 0; i < sc.tiles().size(); i++) {
                Tile t = sc.tiles().get(i);
                TileIcon icon = t.icon();
                if (icon != null && icon.image() != null) {
                    icon = new TileIcon(icon.kind(), icon.name(),
                            map(fn, "config.tiles[" + i + "].icon.image", icon.image(), SLOT_TILE_ICON));
                }
                tiles.add(new Tile(t.key(), t.label(), icon, t.link()));
            }
            return b.withConfig(new ShortcutsConfig(sc.title(), List.copyOf(tiles)));
        }
        if (c instanceof NoticeConfig n) {
            return b.withConfig(new NoticeConfig(n.title(), n.body(), map(fn, "config.image", n.image(), SLOT_CARD),
                    n.button(), n.tone(), n.dismissible(), n.requireAck(), n.ackLabel()));
        }
        if (c instanceof EventConfig e) {
            return b.withConfig(new EventConfig(e.title(), e.subtitle(), map(fn, "config.image", e.image(), SLOT_CARD),
                    e.source(), e.liveSessionId(), e.startsAt(), e.endsAt(), e.registerCta(), e.joinCta(),
                    e.joinOpensMinutes(), e.showCountdown()));
        }
        return b;
    }

    private static ImageRef map(Function<ImageSlotRef, ImageRef> fn, String path, ImageRef image, String slot) {
        return image == null ? null : fn.apply(new ImageSlotRef(path, image, slot));
    }
}
