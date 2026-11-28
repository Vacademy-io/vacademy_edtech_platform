package vacademy.io.admin_core_service.features.commerce.document.service;

import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceDocumentSeries;
import vacademy.io.admin_core_service.features.commerce.document.enums.DocumentChannel;
import vacademy.io.admin_core_service.features.commerce.document.enums.SeriesKind;
import vacademy.io.admin_core_service.features.commerce.document.enums.SeriesStatus;

import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/**
 * Chooses the series for a document by seller GSTIN, location, register, channel and document
 * type. A series field that is empty matches anything; a field
 * that is set must match. The most specific series wins, so a POS register with its own series
 * never waits on the row lock of the location's series.
 */
public final class SeriesPicker {

    private SeriesPicker() {
    }

    /**
     * @param candidates series of one institute, one document type and one financial year
     */
    public static Optional<CommerceDocumentSeries> pick(List<CommerceDocumentSeries> candidates,
                                                        String sellerGstin, String locationId,
                                                        String registerId, String channel) {
        return candidates.stream()
                .filter(s -> SeriesKind.SYSTEM.name().equals(s.getKind()))
                .filter(s -> SeriesStatus.ACTIVE.name().equals(s.getStatus()))
                .filter(s -> matches(s.getSellerGstin(), sellerGstin))
                .filter(s -> matches(s.getLocationId(), locationId))
                .filter(s -> matches(s.getRegisterId(), registerId))
                .filter(s -> DocumentChannel.ALL.name().equals(s.getChannel()) || s.getChannel().equals(channel))
                .max(Comparator.comparingInt(SeriesPicker::specificity)
                        // Equal specificity: the lowest prefix, so the choice never depends on row order.
                        .thenComparing(CommerceDocumentSeries::getPrefix, Comparator.reverseOrder()));
    }

    private static boolean matches(String seriesValue, String requested) {
        return seriesValue == null || seriesValue.equals(requested);
    }

    private static int specificity(CommerceDocumentSeries series) {
        int score = 0;
        if (series.getRegisterId() != null) {
            score += 8;
        }
        if (series.getLocationId() != null) {
            score += 4;
        }
        if (!DocumentChannel.ALL.name().equals(series.getChannel())) {
            score += 2;
        }
        if (series.getSellerGstin() != null) {
            score += 1;
        }
        return score;
    }
}
