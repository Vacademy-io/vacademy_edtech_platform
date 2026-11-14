package vacademy.io.assessment_service.features.open_evaluation.submission;

/**
 * The public {@code rate_source} (spec 7.11): {@code standard} for the default API price,
 * {@code contract} when the institute (or its partner) has its own price. ai_service
 * reports {@code override:<id>} / {@code partner:<id>} / {@code global} / {@code default};
 * the override id is never shown to the partner.
 */
public final class RateSources {

    public static final String STANDARD = "standard";
    public static final String CONTRACT = "contract";

    private RateSources() {
    }

    public static String publicName(String rateSource) {
        if (rateSource == null || rateSource.isBlank()) {
            return STANDARD;
        }
        String s = rateSource.trim().toLowerCase();
        return s.startsWith("override") || s.startsWith("partner") || s.startsWith("contract") ? CONTRACT : STANDARD;
    }
}
