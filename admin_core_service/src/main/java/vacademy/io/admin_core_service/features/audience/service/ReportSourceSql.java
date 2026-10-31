package vacademy.io.admin_core_service.features.audience.service;

/**
 * How the reports name a lead's source.
 *
 * <p>The source is the type of the campaign the lead came in through (Facebook, Reference, Website
 * ... in the institute's own words): that is how an institute sorts its leads, and it is the only
 * channel a lead submitted through one of its own forms carries (their source_type is the generic
 * {@code AUDIENCE_CAMPAIGN}). A lead whose campaign has no type keeps its source_type (Meta lead
 * ads, walk-in, self sign-up ...).
 *
 * <p>The SQL is built from column expressions so the same rule serves per-enquiry queries
 * ({@code ar.source_type} + the enquiry's campaign) and per-lead ones (the profile's
 * {@code best_source_type} + the campaign of its best-scoring enquiry).
 */
final class ReportSourceSql {

    private ReportSourceSql() {
    }

    /** True when the lead's source is read from its campaign's type. */
    static String fromCampaignType(String sourceTypeExpr, String campaignTypeExpr) {
        return "(NULLIF(TRIM(" + campaignTypeExpr + "), '') IS NOT NULL)";
    }

    /** The source a report shows: the campaign's type when set, else source_type. */
    static String effective(String sourceTypeExpr, String campaignTypeExpr) {
        return "(CASE WHEN " + fromCampaignType(sourceTypeExpr, campaignTypeExpr)
                + " THEN TRIM(" + campaignTypeExpr + ") ELSE COALESCE(" + sourceTypeExpr + ", 'UNKNOWN') END)";
    }
}
