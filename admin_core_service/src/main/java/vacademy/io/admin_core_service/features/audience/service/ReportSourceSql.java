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

    /**
     * Join for the student's FIRST enquiry in the institute (earliest audience_response, opt-out
     * rows excluded), exposing {@code <alias>.source_type}, {@code <alias>.campaign_type},
     * {@code <alias>.campaign_name} and {@code <alias>.audience_id}. Every report attributes a student to this one enquiry, so a
     * later form never moves an admission to another source.
     */
    static String firstEnquiryJoin(String alias, String userIdExpr, String instituteIdExpr) {
        return """
                LEFT JOIN LATERAL (
                    SELECT fr.source_type, fa.campaign_type, fa.campaign_name, fr.audience_id
                    FROM audience_response fr
                    JOIN audience fa ON fa.id = fr.audience_id
                    WHERE fr.user_id = %s
                      AND fa.institute_id = %s
                      AND (fr.source_type IS NULL OR fr.source_type <> 'OPT_OUT')
                    ORDER BY fr.created_at, fr.id
                    LIMIT 1
                ) %s ON true
                """.formatted(userIdExpr, instituteIdExpr, alias);
    }

    /**
     * Source of the first enquiry joined by {@link #firstEnquiryJoin}; a student with no enquiry
     * falls back to {@code fallbackSourceExpr} (the lead profile's best_source_type, which is
     * where a source recorded outside an enquiry lives).
     */
    static String firstEnquirySource(String alias, String fallbackSourceExpr) {
        return effective("COALESCE(" + alias + ".source_type, " + fallbackSourceExpr + ")", alias + ".campaign_type");
    }

    /** True when {@link #firstEnquirySource} came from the first enquiry's campaign type. */
    static String firstEnquiryFromCampaignType(String alias) {
        return fromCampaignType(alias + ".source_type", alias + ".campaign_type");
    }
}
