package vacademy.io.admin_core_service.features.institute_import.service;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.security.SecureRandom;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static vacademy.io.admin_core_service.features.institute_import.service.ImportContext.*;

/**
 * Courses, stages and batches, written the way "create course" writes them (package +
 * package_institute + level + session + package_session + teacher mapping) but without the
 * COURSE_CREATED workflow or invite emails. Fee plans become payment options and plans.
 *
 * <p>Model: a course per syllabus, a level per stage, a session per batch, so each batch is its
 * own package_session and a break or pause can apply to one batch only.
 */
@Component
public class ImportStructureSteps {

    private static final SecureRandom RANDOM = new SecureRandom();

    /** Body: { "<course name>": { "art_form", "track", "levels": { "<stage>": {"order", ...} } } } */
    public void courses(ImportContext c, JsonNode body) {
        Iterator<Map.Entry<String, JsonNode>> it = body.fields();
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> e = it.next();
            c.item(e.getKey(), () -> course(c, e.getKey(), e.getValue()));
        }
    }

    private void course(ImportContext c, String course, JsonNode value) {
        {
            String packageId = c.ref("COURSE", course).orElse(null);
            if (packageId == null) {
                packageId = newId();
                c.getJdbc().update("INSERT INTO package (id, package_name, status, package_type, comma_separated_tags) VALUES (?, ?, 'ACTIVE', 'COURSE', ?)",
                        packageId, course, text(value, "art_form"));
                c.getJdbc().update("INSERT INTO package_institute (id, package_id, institute_id) VALUES (?, ?, ?)",
                        newId(), packageId, c.getInstituteId());
                // The INVITED batch "create course" always adds; enrolment links use it.
                c.getJdbc().update("INSERT INTO package_session (id, package_id, level_id, session_id, status) VALUES (?, ?, 'INVITED', 'INVITED', 'INVITED')",
                        newId(), packageId);
                c.putRef("COURSE", course, packageId);
                c.created();
            } else {
                c.getJdbc().update("UPDATE package SET package_name = ?, updated_at = now() WHERE id = ?", course, packageId);
                c.updated();
            }
            JsonNode levels = value.path("levels");
            Iterator<String> names = levels.fieldNames();
            while (names.hasNext()) {
                String stage = names.next();
                String key = course + "|" + stage;
                if (c.ref("LEVEL", key).isEmpty()) {
                    String levelId = newId();
                    Integer months = levels.path(stage).hasNonNull("months") ? levels.path(stage).get("months").asInt() : null;
                    c.getJdbc().update("INSERT INTO level (id, level_name, status, duration_in_days) VALUES (?, ?, 'ACTIVE', ?)",
                            levelId, stage, months == null ? null : months * 30);
                    c.putRef("LEVEL", key, levelId);
                }
            }
        }
    }

    /**
     * Body: [ { external_id, name, course, level, teacher_external_id, type, audience, days[],
     *           start_time_ist, duration_min, start_date, active } ]
     * Inactive batches are HIDDEN: kept for history (attendance, recordings), not offered.
     */
    public void batches(ImportContext c, JsonNode body) {
        for (JsonNode b : body) {
            c.item(keyOf(b), () -> {
            String ext = text(b, "external_id");
            String name = text(b, "name");
            Optional<String> packageId = c.ref("COURSE", text(b, "course"));
            Optional<String> levelId = c.ref("LEVEL", text(b, "course") + "|" + text(b, "level"));
            if (ext == null || name == null || packageId.isEmpty() || levelId.isEmpty()) {
                c.fail(ext, "course or stage not imported yet: " + text(b, "course") + " / " + text(b, "level"));
                return;
            }
            String status = b.path("active").asBoolean(true) ? "ACTIVE" : "HIDDEN";
            Optional<String> existing = c.ref("BATCH", ext);
            String psId;
            if (existing.isPresent()) {
                psId = existing.get();
                c.getJdbc().update("UPDATE package_session SET status = ?, level_id = ?, updated_at = now() WHERE id = ?",
                        status, levelId.get(), psId);
                c.getJdbc().update("UPDATE session SET session_name = ? WHERE id = (SELECT session_id FROM package_session WHERE id = ?)",
                        name, psId);
                c.updated();
            } else {
                String sessionId = newId();
                psId = newId();
                c.getJdbc().update("INSERT INTO session (id, session_name, status, start_date) VALUES (?, ?, 'ACTIVE', ?)",
                        sessionId, name, sqlDate(date(b, "start_date")));
                c.getJdbc().update("INSERT INTO package_session (id, package_id, level_id, session_id, status, start_time, name) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        psId, packageId.get(), levelId.get(), sessionId, status, sqlDate(date(b, "start_date")), name);
                c.putRef("BATCH", ext, psId);
                c.created();
            }
            String teacher = text(b, "teacher_external_id");
            if (teacher != null) {
                Optional<String> teacherUserId = c.ref("STAFF", teacher);
                if (teacherUserId.isEmpty()) {
                    c.skip(ext, "teacher " + teacher + " not imported yet; batch kept without teacher");
                } else {
                    Integer n = c.getJdbc().queryForObject(
                            "SELECT COUNT(*) FROM faculty_subject_package_session_mapping WHERE user_id = ? AND package_session_id = ? AND status = 'ACTIVE'",
                            Integer.class, teacherUserId.get(), psId);
                    if (n == null || n == 0) {
                        String teacherName = c.getJdbc().queryForList(
                                "SELECT internal_id FROM institute_import_ref WHERE institute_id = ? AND kind = 'STAFF_NAME' AND external_id = ?",
                                String.class, c.getInstituteId(), teacher).stream().findFirst().orElse(null);
                        c.getJdbc().update("INSERT INTO faculty_subject_package_session_mapping (id, user_id, package_session_id, name, status) VALUES (?, ?, ?, ?, 'ACTIVE')",
                                newId(), teacherUserId.get(), psId, teacherName);
                    }
                }
            }
                    });
        }
    }

    /**
     * Body: [ { name, months, price, currency, region } ]. One SUBSCRIPTION payment option per
     * payment cycle (every N months), one payment plan per list price in it, and one enrolment
     * invite per course so every membership has the invite and option the rest of the platform
     * (renewals, reminders, reports) expects.
     */
    public void feePlans(ImportContext c, JsonNode body) {
        for (JsonNode p : body) {
            c.item(keyOf(p), () -> {
            Integer months = p.hasNonNull("months") ? p.get("months").asInt() : null;
            Double price = number(p, "price");
            if (months == null || months <= 0 || price == null) {
                c.fail(text(p, "name"), "months and price are required");
                return;
            }
            boolean existed = c.ref("FEE_PLAN", planKey(months, price)).isPresent();
            ensurePlan(c, months, price, text(p, "currency"), text(p, "name"));
            if (existed) c.updated(); else c.created();
                    });
        }
    }

    static String planKey(int months, double price) {
        return months + "|" + Math.round(price * 100);
    }

    /** The option for a cycle, created on first use. */
    String ensureOption(ImportContext c, int months, String currency) {
        String key = String.valueOf(months);
        Optional<String> id = c.ref("FEE_OPTION", key);
        if (id.isPresent()) return id.get();
        String optionId = newId();
        String label = months == 1 ? "Monthly" : months == 3 ? "Quarterly" : months == 6 ? "Half-yearly"
                : months == 12 ? "Yearly" : "Every " + months + " months";
        c.getJdbc().update("""
                INSERT INTO payment_option (id, name, status, source, source_id, type, require_approval, unit)
                VALUES (?, ?, 'ACTIVE', 'INSTITUTE', ?, 'SUBSCRIPTION', false, 'month')
                """, optionId, label + " (imported)", c.getInstituteId());
        c.putRef("FEE_OPTION", key, optionId);
        return optionId;
    }

    /** The plan for a cycle and list price, created on first use. Returns its id. */
    String ensurePlan(ImportContext c, int months, double price, String currency, String name) {
        String key = planKey(months, price);
        Optional<String> id = c.ref("FEE_PLAN", key);
        if (id.isPresent()) return id.get();
        String optionId = ensureOption(c, months, currency);
        String planId = newId();
        c.getJdbc().update("""
                INSERT INTO payment_plan (id, payment_option_id, name, status, validity_in_days, actual_price, elevated_price, currency)
                VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?)
                """, planId, optionId, (name == null ? "Plan" : name) + " · " + Math.round(price), months * 30, price, price,
                currency == null ? "INR" : currency);
        c.putRef("FEE_PLAN", key, planId);
        return planId;
    }

    /** One enrolment invite per course for imported memberships; linked to the batch and option on use. */
    String ensureInvite(ImportContext c, String course, String currency) {
        Optional<String> id = c.ref("INVITE", course);
        if (id.isPresent()) return id.get();
        String inviteId = newId();
        c.getJdbc().update("""
                INSERT INTO enroll_invite (id, name, invite_code, status, institute_id, currency, start_date, created_by_user_id)
                VALUES (?, ?, ?, 'ACTIVE', ?, ?, CURRENT_DATE, ?)
                """, inviteId, course + " · imported memberships", inviteCode(), c.getInstituteId(),
                currency == null ? "INR" : currency, c.getRunByUserId());
        c.putRef("INVITE", course, inviteId);
        return inviteId;
    }

    void linkInvite(ImportContext c, String inviteId, String packageSessionId, String optionId) {
        Integer n = c.getJdbc().queryForObject("""
                SELECT COUNT(*) FROM package_session_learner_invitation_to_payment_option
                 WHERE enroll_invite_id = ? AND package_session_id = ? AND payment_option_id = ?
                """, Integer.class, inviteId, packageSessionId, optionId);
        if (n == null || n == 0) {
            c.getJdbc().update("""
                    INSERT INTO package_session_learner_invitation_to_payment_option (id, enroll_invite_id, package_session_id, payment_option_id, status)
                    VALUES (?, ?, ?, ?, 'ACTIVE')
                    """, newId(), inviteId, packageSessionId, optionId);
        }
    }

    private static String inviteCode() {
        String abc = "abcdefghijklmnopqrstuvwxyz0123456789";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 6; i++) sb.append(abc.charAt(RANDOM.nextInt(abc.length())));
        return sb.toString();
    }

    static List<String> list(JsonNode arr) {
        return arr == null || !arr.isArray() ? List.of()
                : java.util.stream.StreamSupport.stream(arr.spliterator(), false).map(JsonNode::asText).toList();
    }
}
