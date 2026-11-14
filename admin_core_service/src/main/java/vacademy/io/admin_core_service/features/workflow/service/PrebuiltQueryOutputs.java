package vacademy.io.admin_core_service.features.workflow.service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * The context keys a read-only prebuilt QUERY puts on the workflow context. The first key is
 * the list a send node iterates ({@code on: "#ctx['<key>']"}).
 *
 * <p>The QUERY node copies the query's result map onto the context as is: it never stores
 * anything under the node's {@code resultKey}, so these names are the only ones a later node
 * can read. Used by the builder's variable picker, the validator and the AI catalog, so the
 * three cannot disagree. A query not listed here is simply unknown (nothing is advertised or
 * checked for it).
 */
public final class PrebuiltQueryOutputs {

    private static final Map<String, List<String>> OUTPUT_KEYS = new LinkedHashMap<>();

    static {
        OUTPUT_KEYS.put("fetch_audience_responses_filtered", List.of("leads"));
        OUTPUT_KEYS.put("getAudienceResponsesByDayDifference", List.of("leads"));
        OUTPUT_KEYS.put("fetch_batch_attendance_report",
                List.of("students", "totalStudents", "batchCount", "startDate", "endDate"));
        OUTPUT_KEYS.put("fetch_students_by_batch", List.of("students", "totalStudents"));
        OUTPUT_KEYS.put("fetch_ssigm_by_package", List.of("ssigm_list", "mapping_count"));
        OUTPUT_KEYS.put("getUpcomingAutopayCharges", List.of("autopayDueList", "autopayDueCount"));
        OUTPUT_KEYS.put("getManualRenewalDuePlans", List.of("manualRenewalList", "manualRenewalCount"));
        OUTPUT_KEYS.put("getSSIGMByStatusAndPackageSessionIds", List.of("ssigmList"));
        OUTPUT_KEYS.put("fetch_institute_admin_emails", List.of("adminContacts", "totalAdmins", "rolesFetched"));
        OUTPUT_KEYS.put("fetch_expiring_memberships", List.of("expiringMemberships", "expiringCount"));
        OUTPUT_KEYS.put("fetch_live_session_attendance",
                List.of("presentStudents", "absentStudents", "presentCount", "absentCount", "sessionTitle"));
        OUTPUT_KEYS.put("getUpcomingFeeInstallments", List.of("feePaymentList"));
    }

    private PrebuiltQueryOutputs() {
    }

    /** The keys this query puts on the context, first = the list; empty when not catalogued. */
    public static Optional<List<String>> keysOf(String prebuiltKey) {
        if (prebuiltKey == null) return Optional.empty();
        return Optional.ofNullable(OUTPUT_KEYS.get(prebuiltKey.trim()));
    }
}
