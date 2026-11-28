package vacademy.io.admin_core_service.features.institute_import.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static vacademy.io.admin_core_service.features.institute_import.service.ImportContext.*;

/**
 * Memberships and their history: one user_plan + one access row (SSIGM) per enrolment, the
 * learner's own price locked on the plan, journey labels as tags, breaks and pauses, extra-class
 * access and offline payment history. Rows are inserted directly so no enrolment email,
 * workflow, receipt or ledger posting is triggered.
 */
@Component
@RequiredArgsConstructor
public class ImportMembershipSteps {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private final ImportStructureSteps structure;

    /**
     * Body: [ { external_id, student_external_id, batch_external_id, course, reg_number,
     *           admission_date, fee_plan, every_months, list_price, price, currency,
     *           next_payment_date, tag } ]
     * The membership runs from admission to the next payment date (its due date). Access has no
     * end of its own: the school decides through journey status and pauses, not the calendar.
     */
    public void enrolments(ImportContext c, JsonNode body) {
        for (JsonNode e : body) {
            c.item(keyOf(e), () -> {
            String ext = text(e, "external_id");
            Optional<String> userId = c.ref("LEARNER", text(e, "student_external_id"));
            Optional<String> psId = c.ref("BATCH", text(e, "batch_external_id"));
            if (userId.isEmpty() || psId.isEmpty()) {
                c.fail(ext, userId.isEmpty() ? "learner not imported yet" : "batch not imported yet");
                return;
            }
            int months = e.hasNonNull("every_months") ? Math.max(1, e.get("every_months").asInt()) : 1;
            Double price = number(e, "price");
            Double listPrice = number(e, "list_price");
            String currency = Optional.ofNullable(text(e, "currency")).orElse("INR");
            LocalDate start = Optional.ofNullable(date(e, "admission_date")).orElse(c.getToday());
            LocalDate due = date(e, "next_payment_date");
            if (price == null || due == null) {
                c.fail(ext, "price and next payment date are required");
                return;
            }
            double planPrice = listPrice != null ? listPrice : price;
            String planId = structure.ensurePlan(c, months, planPrice, currency, text(e, "fee_plan"));
            String optionId = structure.ensureOption(c, months, currency);
            String inviteId = structure.ensureInvite(c, text(e, "course"), currency);
            structure.linkInvite(c, inviteId, psId.get(), optionId);
            // The learner's own price, when it differs from the list: what reminders and renewals ask for.
            boolean memberPrice = Math.abs(price - planPrice) > 0.005;

            Optional<String> existingPlan = c.ref("ENROLMENT", ext);
            String userPlanId;
            if (existingPlan.isPresent()) {
                userPlanId = existingPlan.get();
                c.getJdbc().update("""
                        UPDATE user_plan SET plan_id = ?, payment_option_id = ?, enroll_invite_id = ?, start_date = ?, end_date = ?,
                               regional_price = ?, regional_currency = ?, updated_at = now()
                         WHERE id = ?
                        """, planId, optionId, inviteId, startOfDay(start), endOfDay(due),
                        memberPrice ? price : null, memberPrice ? currency : null, userPlanId);
                c.updated();
            } else {
                userPlanId = newId();
                c.getJdbc().update("""
                        INSERT INTO user_plan (id, user_id, plan_id, enroll_invite_id, payment_option_id, status, source,
                                               start_date, end_date, regional_price, regional_currency, auto_renewal_enabled)
                        VALUES (?, ?, ?, ?, ?, 'ACTIVE', 'USER', ?, ?, ?, ?, false)
                        """, userPlanId, userId.get(), planId, inviteId, optionId, startOfDay(start), endOfDay(due),
                        memberPrice ? price : null, memberPrice ? currency : null);
                c.putRef("ENROLMENT", ext, userPlanId);
                c.created();
            }

            Optional<String> access = c.ref("ACCESS", ext);
            if (access.isEmpty()) {
                String ssigmId = newId();
                c.getJdbc().update("""
                        INSERT INTO student_session_institute_group_mapping (id, user_id, package_session_id, institute_id, enrolled_date,
                                     status, institute_enrollment_number, user_plan_id)
                        VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
                        """, ssigmId, userId.get(), psId.get(), c.getInstituteId(), sqlDate(start), text(e, "reg_number"), userPlanId);
                c.putRef("ACCESS", ext, ssigmId);
            }
            String tag = text(e, "tag");
            if (tag != null) tagUser(c, userId.get(), tag);
                    });
        }
    }

    /**
     * Body: [ { enrollment_external_id, type, kind (HOLD|PAUSE|LEAVE), from, to, reason,
     *           stop_fee_reminders, remove_access } ]
     * A break covers its own batch only. Past breaks come in ENDED, current ones ACTIVE (a current
     * pause switches that batch's access off, exactly as starting a pause does), future ones
     * SCHEDULED. Informed leave is a note on attendance, not a break.
     */
    public void breaks(ImportContext c, JsonNode body) {
        for (JsonNode b : body) {
            c.item(keyOf(b), () -> {
            String enr = text(b, "enrollment_external_id");
            String kind = text(b, "kind");
            LocalDate from = date(b, "from");
            LocalDate to = date(b, "to");
            String key = enr + "|" + text(b, "type") + "|" + from;
            if ("LEAVE".equals(kind)) {
                c.skip(key, "informed leave is kept with attendance, not as a break");
                return;
            }
            Optional<String> userPlanId = c.ref("ENROLMENT", enr);
            Optional<String> ssigmId = c.ref("ACCESS", enr);
            if (userPlanId.isEmpty() || ssigmId.isEmpty() || from == null) {
                c.fail(key, "enrolment not imported yet");
                return;
            }
            if (c.ref("BREAK", key).isPresent()) {
                c.updated();
                return;
            }
            Map<String, Object> row = c.getJdbc().queryForMap(
                    "SELECT user_id, package_session_id FROM student_session_institute_group_mapping WHERE id = ?", ssigmId.get());
            String status = to != null && to.isBefore(c.getToday()) ? "ENDED"
                    : from.isAfter(c.getToday()) ? "SCHEDULED" : "ACTIVE";
            boolean pause = "PAUSE".equals(kind);
            boolean removeAccess = pause && b.path("remove_access").asBoolean(true);
            String pausedIds = null;
            if ("ACTIVE".equals(status) && removeAccess) {
                int n = c.getJdbc().update("UPDATE student_session_institute_group_mapping SET status = 'INACTIVE', updated_at = now() WHERE id = ? AND status = 'ACTIVE'",
                        ssigmId.get());
                pausedIds = n > 0 ? ssigmId.get() : null;
            }
            String id = newId();
            c.getJdbc().update("""
                    INSERT INTO enrolment_break (id, institute_id, user_id, package_session_id, user_plan_id, kind,
                           stop_class_reminders, stop_fee_reminders, remove_access, starts_on, ends_on, status, reason, note,
                           paused_access_ids, started_at, ended_at, end_kind, resume_mode, created_by_user_id)
                    VALUES (?, ?, ?, ?, ?, ?, true, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, id, c.getInstituteId(), row.get("user_id"), row.get("package_session_id"), userPlanId.get(),
                    pause ? "PAUSE" : "HOLD", b.path("stop_fee_reminders").asBoolean(true), removeAccess,
                    sqlDate(from), sqlDate(to), status, truncate(text(b, "type"), 100),
                    truncate("Imported: " + Optional.ofNullable(text(b, "reason")).orElse(text(b, "type")), 500),
                    pausedIds, "SCHEDULED".equals(status) ? null : startOfDay(from),
                    "ENDED".equals(status) ? endOfDay(to) : null, "ENDED".equals(status) ? "SCHEDULED" : null,
                    "ENDED".equals(status) ? "KEEP_DATES" : null, c.getRunByUserId());
            c.putRef("BREAK", key, id);
            c.created();
                    });
        }
    }

    /**
     * Body: [ { student_external_id, enrollment_external_id, batch_external_id, from, to, reason } ]
     * A second batch the learner also attends, on the same membership: access to that batch only.
     * Marked source EXTRA_CLASS, so it is listed and ended on the learner's Extra classes card
     * (features/extra_class) and kept out of the workflow roster.
     */
    public void extraClasses(ImportContext c, JsonNode body) {
        for (JsonNode x : body) {
            c.item(keyOf(x), () -> {
            String key = text(x, "student_external_id") + "|" + text(x, "batch_external_id") + "|" + text(x, "from");
            Optional<String> userId = c.ref("LEARNER", text(x, "student_external_id"));
            Optional<String> psId = c.ref("BATCH", text(x, "batch_external_id"));
            Optional<String> userPlanId = c.ref("ENROLMENT", text(x, "enrollment_external_id"));
            if (userId.isEmpty() || psId.isEmpty()) {
                c.fail(key, "learner or batch not imported yet");
                return;
            }
            if (c.ref("EXTRA", key).isPresent()) {
                c.updated();
                return;
            }
            LocalDate from = date(x, "from");
            LocalDate to = date(x, "to");
            String status = to != null && to.isBefore(c.getToday()) ? "EXPIRED" : "ACTIVE";
            String id = newId();
            c.getJdbc().update("""
                    INSERT INTO student_session_institute_group_mapping (id, user_id, package_session_id, institute_id, enrolled_date,
                                 expiry_date, status, user_plan_id, source)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'EXTRA_CLASS')
                    """, id, userId.get(), psId.get(), c.getInstituteId(), sqlDate(from), endOfDay(to), status,
                    userPlanId.orElse(null));
            c.putRef("EXTRA", key, id);
            c.created();
                    });
        }
    }

    /**
     * Body: [ { ref, invoice_number, enrollment_external_id, date, amount, currency, mode, reference,
     *           period_from, period_to } ]
     * Offline payment history (PAID), shown in the learner's payment history. Not allocated to
     * dues and not posted to the ledger: these were settled in the old system.
     */
    public void payments(ImportContext c, JsonNode body) {
        for (JsonNode p : body) {
            c.item(keyOf(p), () -> {
            String ref = text(p, "ref");
            Optional<String> userPlanId = c.ref("ENROLMENT", text(p, "enrollment_external_id"));
            Double amount = number(p, "amount");
            if (ref == null || userPlanId.isEmpty() || amount == null) {
                c.fail(ref, userPlanId.isEmpty() ? "enrolment not imported yet" : "amount missing");
                return;
            }
            if (c.ref("PAYMENT", ref).isPresent()) {
                c.updated();
                return;
            }
            String userId = c.getJdbc().queryForObject("SELECT user_id FROM user_plan WHERE id = ?", String.class, userPlanId.get());
            Map<String, Object> specific = new LinkedHashMap<>();
            specific.put("transaction_id", ref);
            specific.put("invoice_number", text(p, "invoice_number"));
            specific.put("period_from", text(p, "period_from"));
            specific.put("period_to", text(p, "period_to"));
            specific.put("source", "import");
            String id = newId();
            c.getJdbc().update("""
                    INSERT INTO payment_log (id, status, payment_status, user_id, vendor, vendor_id, date, currency, user_plan_id,
                                             payment_amount, payment_specific_data, payment_mode, payment_reference, recorded_by_user_id)
                    VALUES (?, 'ACTIVE', 'PAID', ?, 'OFFLINE', ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, id, userId, ref, sqlDate(date(p, "date")), Optional.ofNullable(text(p, "currency")).orElse("INR"),
                    userPlanId.get(), amount, json(specific), text(p, "mode"), text(p, "reference"), c.getRunByUserId());
            c.putRef("PAYMENT", ref, id);
            c.created();
                    });
        }
    }

    void tagUser(ImportContext c, String userId, String tagName) {
        List<String> tags = c.getJdbc().queryForList(
                "SELECT id FROM tags WHERE institute_id = ? AND tag_name = ? AND status = 'ACTIVE'", String.class, c.getInstituteId(), tagName);
        String tagId = tags.isEmpty() ? null : tags.get(0);
        if (tagId == null) {
            tagId = newId();
            c.getJdbc().update("INSERT INTO tags (id, tag_name, institute_id, status, created_by_user_id) VALUES (?, ?, ?, 'ACTIVE', ?)",
                    tagId, tagName, c.getInstituteId(), c.getRunByUserId());
        }
        c.getJdbc().update("""
                INSERT INTO user_tags (id, user_id, tag_id, institute_id, status, created_by_user_id)
                SELECT ?, ?, ?, ?, 'ACTIVE', ? WHERE NOT EXISTS
                  (SELECT 1 FROM user_tags WHERE user_id = ? AND tag_id = ? AND institute_id = ? AND status = 'ACTIVE')
                """, newId(), userId, tagId, c.getInstituteId(), c.getRunByUserId(), userId, tagId, c.getInstituteId());
    }

    private static String truncate(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max);
    }

    private static String json(Object o) {
        try {
            return MAPPER.writeValueAsString(o);
        } catch (Exception e) {
            return null;
        }
    }
}
