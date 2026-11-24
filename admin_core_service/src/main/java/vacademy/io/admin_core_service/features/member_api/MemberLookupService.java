package vacademy.io.admin_core_service.features.member_api;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Query;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Read model behind the public Member Lookup API: given one learner identifier, returns
 * whether the user exists in the institute, their profile + custom fields, their
 * memberships (with access expiry and plan dates) and their sub-org standing (as admin:
 * the team and its members, as member: the sub-org and its admins).
 *
 * <p>Everything is scoped to the institute of the API key. Rules mirror the rest of the
 * platform:
 * <ul>
 *   <li>A user "exists" in the institute when any non-DELETED mapping links them to it.</li>
 *   <li>Membership rows exclude DELETED mappings, ABANDONED_CART / PAYMENT_FAILED rows (they
 *       never granted access) and DELIVERY_CHARGE / SECURITY_DEPOSIT packages.</li>
 *   <li>A membership is current when its status is ACTIVE and its access expiry
 *       (mapping expiry_date, the date that governs access) is null or in the future. The
 *       plan dates (user_plan start/end) are reported beside it, never instead of it.</li>
 *   <li>A learner's sub-org is COALESCE(mapping.sub_org_id, invite.sub_org_id): learners who
 *       self-enrolled through a sub-org invite carry it only on the invite.</li>
 *   <li>Sub-org admin = an ACTIVE mapping in that sub-org with ADMIN or ROOT_ADMIN in its roles.</li>
 * </ul>
 */
@Slf4j
@Service
public class MemberLookupService {

    public static final int MAX_MATCHES = 5;
    public static final int DEFAULT_TEAM_PAGE_SIZE = 100;
    public static final int MAX_TEAM_PAGE_SIZE = 500;
    /** Members embedded in a lookup response for a sub-org admin; the rest via the members endpoint. */
    public static final int EMBEDDED_TEAM_LIMIT = 200;

    private static final String VALID_MAPPING =
            "m.status <> 'DELETED' AND (m.type IS NULL OR m.type NOT IN ('ABANDONED_CART', 'PAYMENT_FAILED'))";

    private static final String SUB_ORG_OF_MAPPING = "COALESCE(m.sub_org_id, ei.sub_org_id)";

    @PersistenceContext
    private EntityManager em;

    // ── Identifier ──────────────────────────────────────────────────────────

    /** Exactly one of the four, trimmed. Phone keeps only digits (last 10 are matched). */
    public record Identifier(String type, String value) {
        public static Identifier of(String userId, String email, String username, String phone) {
            List<Identifier> given = new ArrayList<>();
            if (notBlank(userId)) given.add(new Identifier("user_id", userId.trim()));
            if (notBlank(email)) given.add(new Identifier("email", email.trim().toLowerCase(Locale.ROOT)));
            if (notBlank(username)) given.add(new Identifier("username", username.trim().toLowerCase(Locale.ROOT)));
            if (notBlank(phone)) {
                String digits = phone.replaceAll("\\D", "");
                if (digits.length() < 7) {
                    throw new MemberApiException(HttpStatus.BAD_REQUEST, "invalid_request",
                            "phone must have at least 7 digits.");
                }
                given.add(new Identifier("phone", digits.length() > 10 ? digits.substring(digits.length() - 10) : digits));
            }
            if (given.size() != 1) {
                throw new MemberApiException(HttpStatus.BAD_REQUEST, "invalid_request",
                        "Send exactly one of: user_id, email, username, phone.");
            }
            return given.get(0);
        }

        public Map<String, Object> view() {
            return Map.of(type, value);
        }
    }

    // ── Lookup ──────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public Map<String, Object> lookup(String instituteId, Identifier id, boolean includeTeamMembers) {
        List<String> userIds = resolveUserIds(instituteId, id);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("found", !userIds.isEmpty());
        out.put("match_count", userIds.size());
        if (userIds.isEmpty()) {
            out.put("user", null);
            out.put("membership", null);
            out.put("sub_orgs", List.of());
            return out;
        }

        // Several users can share a phone (or a re-used email). Prefer the one with a current
        // membership, then the most recently enrolled.
        Map<String, Map<String, Object>> memberships = new LinkedHashMap<>();
        for (String uid : userIds) memberships.put(uid, membership(instituteId, uid));
        String chosen = userIds.stream()
                .max(Comparator.<String, Boolean>comparing(u -> Boolean.TRUE.equals(memberships.get(u).get("is_active")))
                        .thenComparing(u -> String.valueOf(memberships.get(u).get("last_enrolled_at"))))
                .orElse(userIds.get(0));

        List<Map<String, Object>> fieldTemplate = customFieldTemplate(instituteId);
        Map<String, Map<String, String>> values = customFieldValues(instituteId, List.of(chosen));
        Map<String, Map<String, Object>> profiles = profiles(userIds);

        Map<String, Object> user = new LinkedHashMap<>(profiles.getOrDefault(chosen, Map.of("user_id", chosen)));
        user.put("custom_fields", customFieldsView(fieldTemplate, values.get(chosen)));
        out.put("user", user);
        Map<String, Object> membership = new LinkedHashMap<>(memberships.get(chosen));
        membership.remove("last_enrolled_at");
        out.put("membership", membership);
        out.put("sub_orgs", subOrgs(instituteId, chosen, includeTeamMembers, fieldTemplate));
        if (userIds.size() > 1) {
            List<Map<String, Object>> others = new ArrayList<>();
            for (String uid : userIds) {
                if (uid.equals(chosen)) continue;
                Map<String, Object> p = profiles.getOrDefault(uid, Map.of("user_id", uid));
                Map<String, Object> o = new LinkedHashMap<>();
                o.put("user_id", uid);
                o.put("username", p.get("username"));
                o.put("full_name", p.get("full_name"));
                o.put("email", p.get("email"));
                o.put("phone", p.get("phone"));
                o.put("has_active_membership", memberships.get(uid).get("is_active"));
                others.add(o);
            }
            out.put("other_matches", others);
        }
        return out;
    }

    /** The institute's user ids matching the identifier (at most {@link #MAX_MATCHES}). */
    List<String> resolveUserIds(String instituteId, Identifier id) {
        String condition = switch (id.type()) {
            case "user_id" -> "s.user_id = :v";
            case "email" -> "LOWER(TRIM(s.email)) = :v";
            case "username" -> "LOWER(TRIM(s.username)) = :v";
            case "phone" -> "RIGHT(REGEXP_REPLACE(COALESCE(s.mobile_number, ''), '[^0-9]', '', 'g'), 10) = :v";
            default -> throw new IllegalArgumentException(id.type());
        };
        String sql = "SELECT s.user_id FROM student s "
                + "WHERE " + condition + " "
                + "AND EXISTS (SELECT 1 FROM student_session_institute_group_mapping m "
                + "  WHERE m.user_id = s.user_id AND m.institute_id = :inst AND " + VALID_MAPPING + ") "
                + "GROUP BY s.user_id ORDER BY MAX(s.created_at) DESC NULLS LAST LIMIT " + MAX_MATCHES;
        Query q = em.createNativeQuery(sql);
        q.setParameter("v", id.value());
        q.setParameter("inst", instituteId);
        List<String> ids = new ArrayList<>();
        for (Object row : q.getResultList()) ids.add(String.valueOf(row));
        return ids;
    }

    // ── Profile ─────────────────────────────────────────────────────────────

    Map<String, Map<String, Object>> profiles(Collection<String> userIds) {
        Map<String, Map<String, Object>> out = new LinkedHashMap<>();
        if (userIds.isEmpty()) return out;
        String sql = "SELECT DISTINCT ON (s.user_id) s.user_id, s.username, s.full_name, s.email, s.mobile_number, "
                + "s.gender, s.date_of_birth, s.address_line, s.city, s.region, s.pin_code, s.country, "
                + "s.fathers_name, s.mothers_name, s.parents_mobile_number, s.parents_email, "
                + "s.linked_institute_name, s.created_at "
                + "FROM student s WHERE s.user_id IN (:ids) "
                + "ORDER BY s.user_id, s.created_at DESC NULLS LAST";
        Query q = em.createNativeQuery(sql);
        q.setParameter("ids", userIds);
        for (Object o : q.getResultList()) {
            Object[] r = (Object[]) o;
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("user_id", str(r[0]));
            p.put("username", str(r[1]));
            p.put("full_name", str(r[2]));
            p.put("email", str(r[3]));
            p.put("phone", str(r[4]));
            p.put("gender", str(r[5]));
            p.put("date_of_birth", date(r[6]));
            Map<String, Object> address = new LinkedHashMap<>();
            address.put("line", str(r[7]));
            address.put("city", str(r[8]));
            address.put("region", str(r[9]));
            address.put("pin_code", str(r[10]));
            address.put("country", str(r[11]));
            p.put("address", address);
            Map<String, Object> parents = new LinkedHashMap<>();
            parents.put("father_name", str(r[12]));
            parents.put("mother_name", str(r[13]));
            parents.put("mobile", str(r[14]));
            parents.put("email", str(r[15]));
            p.put("parents", parents);
            p.put("linked_institute_name", str(r[16]));
            p.put("created_at", iso(r[17]));
            out.put(str(r[0]), p);
        }
        return out;
    }

    // ── Custom fields ───────────────────────────────────────────────────────

    /** The institute's active custom fields, one per field_key, in form order. */
    List<Map<String, Object>> customFieldTemplate(String instituteId) {
        String sql = "SELECT cf.field_key, cf.field_name, cf.field_type, cf.is_hidden "
                + "FROM institute_custom_fields icf JOIN custom_fields cf ON cf.id = icf.custom_field_id "
                + "WHERE icf.institute_id = :inst AND icf.status = 'ACTIVE' "
                + "AND (cf.status IS NULL OR cf.status <> 'DELETED') "
                + "ORDER BY cf.form_order NULLS LAST, cf.created_at";
        Query q = em.createNativeQuery(sql);
        q.setParameter("inst", instituteId);
        Map<String, Map<String, Object>> byKey = new LinkedHashMap<>();
        for (Object o : q.getResultList()) {
            Object[] r = (Object[]) o;
            String key = str(r[0]);
            if (key == null || byKey.containsKey(key)) continue;
            Map<String, Object> f = new LinkedHashMap<>();
            f.put("key", key);
            f.put("name", str(r[1]));
            f.put("type", str(r[2]));
            f.put("hidden", Boolean.TRUE.equals(r[3]));
            byKey.put(key, f);
        }
        return new ArrayList<>(byKey.values());
    }

    /** userId -> (field_key -> latest value), for fields of this institute. */
    Map<String, Map<String, String>> customFieldValues(String instituteId, Collection<String> userIds) {
        Map<String, Map<String, String>> out = new LinkedHashMap<>();
        if (userIds.isEmpty()) return out;
        String sql = "SELECT DISTINCT ON (v.source_id, cf.field_key) v.source_id, cf.field_key, v.value "
                + "FROM custom_field_values v "
                + "JOIN custom_fields cf ON cf.id = v.custom_field_id "
                + "JOIN institute_custom_fields icf ON icf.custom_field_id = cf.id "
                + "  AND icf.institute_id = :inst AND icf.status = 'ACTIVE' "
                + "WHERE v.source_type = 'USER' AND v.source_id IN (:ids) "
                + "ORDER BY v.source_id, cf.field_key, v.created_at DESC NULLS LAST";
        Query q = em.createNativeQuery(sql);
        q.setParameter("inst", instituteId);
        q.setParameter("ids", userIds);
        for (Object o : q.getResultList()) {
            Object[] r = (Object[]) o;
            out.computeIfAbsent(str(r[0]), k -> new LinkedHashMap<>()).put(str(r[1]), str(r[2]));
        }
        return out;
    }

    static List<Map<String, Object>> customFieldsView(List<Map<String, Object>> template, Map<String, String> values) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> f : template) {
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("key", f.get("key"));
            v.put("name", f.get("name"));
            v.put("type", f.get("type"));
            v.put("value", values == null ? null : values.get((String) f.get("key")));
            out.add(v);
        }
        return out;
    }

    // ── Membership ──────────────────────────────────────────────────────────

    Map<String, Object> membership(String instituteId, String userId) {
        String sql = "SELECT m.id, m.package_session_id, p.package_name, l.level_name, se.session_name, "
                + "m.status, m.enrolled_date, m.expiry_date, " + SUB_ORG_OF_MAPPING + ", "
                + "up.id, up.status, up.start_date, up.end_date, pp.name, po.name, up.auto_renewal_enabled, "
                + "up.is_trial, up.next_charge_at, m.comma_separated_org_roles "
                + "FROM student_session_institute_group_mapping m "
                + "LEFT JOIN package_session ps ON ps.id = m.package_session_id "
                + "LEFT JOIN package p ON p.id = ps.package_id "
                + "LEFT JOIN level l ON l.id = ps.level_id "
                + "LEFT JOIN session se ON se.id = ps.session_id "
                + "LEFT JOIN user_plan up ON up.id = m.user_plan_id "
                + "LEFT JOIN enroll_invite ei ON ei.id = up.enroll_invite_id "
                + "LEFT JOIN payment_plan pp ON pp.id = up.plan_id "
                + "LEFT JOIN payment_option po ON po.id = up.payment_option_id "
                + "WHERE m.user_id = :uid AND m.institute_id = :inst AND " + VALID_MAPPING + " "
                + "AND (p.package_type IS NULL OR p.package_type NOT IN ('DELIVERY_CHARGE', 'SECURITY_DEPOSIT')) "
                + "ORDER BY m.enrolled_date DESC NULLS LAST, m.created_at DESC";
        Query q = em.createNativeQuery(sql);
        q.setParameter("uid", userId);
        q.setParameter("inst", instituteId);
        Instant now = Instant.now();

        List<Map<String, Object>> all = new ArrayList<>();
        Map<String, Object> current = null;
        Instant currentExpiry = null;
        boolean currentLifetime = false;
        boolean anyExpired = false;
        String lastEnrolled = null;
        for (Object o : q.getResultList()) {
            Object[] r = (Object[]) o;
            Instant expiry = instant(r[7]);
            String status = str(r[5]);
            boolean expired = expiry != null && !expiry.isAfter(now);
            boolean active = "ACTIVE".equals(status) && !expired;
            anyExpired |= expired;

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("enrollment_id", str(r[0]));
            row.put("package_session_id", str(r[1]));
            row.put("course_name", str(r[2]));
            row.put("level_name", str(r[3]));
            row.put("session_name", str(r[4]));
            row.put("status", status);
            row.put("is_active", active);
            row.put("is_expired", expired);
            row.put("enrolled_at", iso(r[6]));
            row.put("access_expires_at", iso(r[7]));
            row.put("sub_org_id", str(r[8]));
            row.put("sub_org_roles", roles(str(r[18])));
            if (r[9] != null) {
                Map<String, Object> plan = new LinkedHashMap<>();
                plan.put("user_plan_id", str(r[9]));
                plan.put("status", str(r[10]));
                plan.put("start_date", iso(r[11]));
                plan.put("end_date", iso(r[12]));
                plan.put("plan_name", str(r[13]));
                plan.put("payment_option_name", str(r[14]));
                plan.put("auto_renewal_enabled", r[15]);
                plan.put("is_trial", r[16]);
                plan.put("next_charge_at", iso(r[17]));
                row.put("plan", plan);
            } else {
                row.put("plan", null);
            }
            all.add(row);
            if (lastEnrolled == null && r[6] != null) lastEnrolled = iso(r[6]);

            // Current = the active membership that lasts longest (no expiry = lifetime, wins).
            if (active) {
                boolean better = current == null
                        || (!currentLifetime && (expiry == null || expiry.isAfter(currentExpiry)));
                if (better) {
                    current = row;
                    currentExpiry = expiry;
                    currentLifetime = expiry == null;
                }
            }
        }

        String overall = current != null ? "ACTIVE"
                : all.isEmpty() ? "NONE"
                : anyExpired ? "EXPIRED"
                : "INACTIVE";
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("status", overall);
        out.put("is_active", current != null);
        out.put("expiry_date", current == null ? null : current.get("access_expires_at"));
        out.put("is_lifetime", current != null && currentLifetime);
        out.put("days_remaining", currentExpiry == null ? null
                : Math.max(0, java.time.Duration.between(now, currentExpiry).toDays()));
        out.put("current", current);
        out.put("memberships", all);
        out.put("last_enrolled_at", lastEnrolled);
        return out;
    }

    // ── Sub-orgs ────────────────────────────────────────────────────────────

    List<Map<String, Object>> subOrgs(String instituteId, String userId, boolean includeTeamMembers,
                                      List<Map<String, Object>> fieldTemplate) {
        String sql = "SELECT " + SUB_ORG_OF_MAPPING + " AS so, "
                + "STRING_AGG(COALESCE(m.comma_separated_org_roles, ''), ',') "
                + "FROM student_session_institute_group_mapping m "
                + "LEFT JOIN user_plan up ON up.id = m.user_plan_id "
                + "LEFT JOIN enroll_invite ei ON ei.id = up.enroll_invite_id "
                + "WHERE m.user_id = :uid AND m.institute_id = :inst AND m.status = 'ACTIVE' "
                + "AND " + SUB_ORG_OF_MAPPING + " IS NOT NULL "
                + "GROUP BY " + SUB_ORG_OF_MAPPING + " "
                + "ORDER BY MAX(m.enrolled_date) DESC NULLS LAST";
        Query q = em.createNativeQuery(sql);
        q.setParameter("uid", userId);
        q.setParameter("inst", instituteId);
        Map<String, List<String>> rolesBySubOrg = new LinkedHashMap<>();
        for (Object o : q.getResultList()) {
            Object[] r = (Object[]) o;
            rolesBySubOrg.put(str(r[0]), roles(str(r[1])));
        }
        if (rolesBySubOrg.isEmpty()) return List.of();

        Map<String, Map<String, Object>> info = subOrgInfo(new ArrayList<>(rolesBySubOrg.keySet()));
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map.Entry<String, List<String>> e : rolesBySubOrg.entrySet()) {
            String subOrgId = e.getKey();
            boolean admin = isAdmin(e.getValue());
            Map<String, Object> so = new LinkedHashMap<>(info.getOrDefault(subOrgId, Map.of("sub_org_id", subOrgId)));
            so.put("role", admin ? "ADMIN" : "MEMBER");
            so.put("roles", e.getValue());
            so.put("admins", admins(instituteId, subOrgId));
            if (admin) {
                Map<String, Object> team = members(instituteId, subOrgId, 0, EMBEDDED_TEAM_LIMIT,
                        includeTeamMembers, fieldTemplate);
                so.put("team", team);
            }
            out.add(so);
        }
        return out;
    }

    Map<String, Map<String, Object>> subOrgInfo(Collection<String> subOrgIds) {
        Map<String, Map<String, Object>> out = new LinkedHashMap<>();
        if (subOrgIds.isEmpty()) return out;
        Query q = em.createNativeQuery("SELECT i.id, i.name, i.email, i.mobile_number, i.address_line, i.city, "
                + "i.state, i.country, i.pin_code FROM institutes i WHERE i.id IN (:ids)");
        q.setParameter("ids", subOrgIds);
        for (Object o : q.getResultList()) {
            Object[] r = (Object[]) o;
            Map<String, Object> so = new LinkedHashMap<>();
            so.put("sub_org_id", str(r[0]));
            so.put("name", str(r[1]));
            so.put("email", str(r[2]));
            so.put("phone", str(r[3]));
            Map<String, Object> address = new LinkedHashMap<>();
            address.put("line", str(r[4]));
            address.put("city", str(r[5]));
            address.put("state", str(r[6]));
            address.put("country", str(r[7]));
            address.put("pin_code", str(r[8]));
            so.put("address", address);
            out.put(str(r[0]), so);
        }
        return out;
    }

    /** True when the sub-org has at least one valid mapping in this institute. */
    @Transactional(readOnly = true)
    public boolean subOrgBelongsToInstitute(String instituteId, String subOrgId) {
        Query q = em.createNativeQuery("SELECT EXISTS (SELECT 1 FROM student_session_institute_group_mapping m "
                + "LEFT JOIN user_plan up ON up.id = m.user_plan_id "
                + "LEFT JOIN enroll_invite ei ON ei.id = up.enroll_invite_id "
                + "WHERE m.institute_id = :inst AND " + SUB_ORG_OF_MAPPING + " = :so AND m.status = 'ACTIVE')");
        q.setParameter("inst", instituteId);
        q.setParameter("so", subOrgId);
        return Boolean.TRUE.equals(q.getSingleResult());
    }

    @Transactional(readOnly = true)
    public Map<String, Object> subOrgTeam(String instituteId, String subOrgId, int page, int size) {
        if (!subOrgBelongsToInstitute(instituteId, subOrgId)) {
            throw new MemberApiException(HttpStatus.NOT_FOUND, "not_found",
                    "No sub-org with this id has members in your institute.");
        }
        Map<String, Object> out = new LinkedHashMap<>(
                subOrgInfo(List.of(subOrgId)).getOrDefault(subOrgId, Map.of("sub_org_id", subOrgId)));
        out.put("admins", admins(instituteId, subOrgId));
        out.put("team", members(instituteId, subOrgId, page, size, true, customFieldTemplate(instituteId)));
        return out;
    }

    List<Map<String, Object>> admins(String instituteId, String subOrgId) {
        return rosterRows(instituteId, subOrgId, true, 0, 50);
    }

    /** One page of the sub-org's members (every role), with custom fields when asked. */
    Map<String, Object> members(String instituteId, String subOrgId, int page, int size, boolean includeMembers,
                                List<Map<String, Object>> fieldTemplate) {
        Query count = em.createNativeQuery("SELECT COUNT(DISTINCT m.user_id) "
                + "FROM student_session_institute_group_mapping m "
                + "LEFT JOIN user_plan up ON up.id = m.user_plan_id "
                + "LEFT JOIN enroll_invite ei ON ei.id = up.enroll_invite_id "
                + "WHERE m.institute_id = :inst AND m.status = 'ACTIVE' AND " + SUB_ORG_OF_MAPPING + " = :so");
        count.setParameter("inst", instituteId);
        count.setParameter("so", subOrgId);
        long total = ((Number) count.getSingleResult()).longValue();

        Map<String, Object> team = new LinkedHashMap<>();
        team.put("member_count", total);
        if (!includeMembers) {
            team.put("members", null);
            team.put("members_included", false);
            return team;
        }
        List<Map<String, Object>> members = rosterRows(instituteId, subOrgId, false, page, size);
        List<String> ids = members.stream().map(m -> (String) m.get("user_id")).toList();
        Map<String, Map<String, String>> values = customFieldValues(instituteId, ids);
        for (Map<String, Object> m : members) {
            m.put("custom_fields", customFieldsView(fieldTemplate, values.get((String) m.get("user_id"))));
        }
        team.put("members_included", true);
        team.put("page", page);
        team.put("size", size);
        team.put("has_more", (long) (page + 1) * size < total);
        team.put("members", members);
        return team;
    }

    /** Per user: profile basics, roles, courses, earliest enrolment, latest access expiry. */
    List<Map<String, Object>> rosterRows(String instituteId, String subOrgId, boolean adminsOnly, int page, int size) {
        String sql = "SELECT m.user_id, MAX(s.username), MAX(s.full_name), MAX(s.email), MAX(s.mobile_number), "
                + "STRING_AGG(COALESCE(m.comma_separated_org_roles, ''), ','), MIN(m.enrolled_date), "
                + "CASE WHEN BOOL_OR(m.expiry_date IS NULL) THEN NULL ELSE MAX(m.expiry_date) END, "
                + "STRING_AGG(DISTINCT p.package_name, ' | ') "
                + "FROM student_session_institute_group_mapping m "
                + "LEFT JOIN user_plan up ON up.id = m.user_plan_id "
                + "LEFT JOIN enroll_invite ei ON ei.id = up.enroll_invite_id "
                + "LEFT JOIN package_session ps ON ps.id = m.package_session_id "
                + "LEFT JOIN package p ON p.id = ps.package_id "
                + "LEFT JOIN LATERAL (SELECT st.username, st.full_name, st.email, st.mobile_number FROM student st "
                + "  WHERE st.user_id = m.user_id ORDER BY st.created_at DESC NULLS LAST LIMIT 1) s ON TRUE "
                + "WHERE m.institute_id = :inst AND m.status = 'ACTIVE' AND " + SUB_ORG_OF_MAPPING + " = :so "
                + (adminsOnly ? "AND m.comma_separated_org_roles LIKE '%ADMIN%' " : "")
                + "GROUP BY m.user_id "
                + "ORDER BY MIN(m.enrolled_date) NULLS LAST, m.user_id "
                + "LIMIT :lim OFFSET :off";
        Query q = em.createNativeQuery(sql);
        q.setParameter("inst", instituteId);
        q.setParameter("so", subOrgId);
        q.setParameter("lim", size);
        q.setParameter("off", (long) page * size);
        Instant now = Instant.now();
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object o : q.getResultList()) {
            Object[] r = (Object[]) o;
            List<String> roles = roles(str(r[5]));
            Instant expiry = instant(r[7]);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("user_id", str(r[0]));
            m.put("username", str(r[1]));
            m.put("full_name", str(r[2]));
            m.put("email", str(r[3]));
            m.put("phone", str(r[4]));
            m.put("role", isAdmin(roles) ? "ADMIN" : "MEMBER");
            m.put("roles", roles);
            m.put("enrolled_at", iso(r[6]));
            m.put("access_expires_at", iso(r[7]));
            m.put("is_active", expiry == null || expiry.isAfter(now));
            String courses = str(r[8]);
            m.put("courses", courses == null ? List.of() : List.of(courses.split(" \\| ")));
            out.add(m);
        }
        return out;
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    static List<String> roles(String csv) {
        Set<String> out = new LinkedHashSet<>();
        if (csv != null) {
            for (String r : csv.split(",")) {
                String t = r.trim().toUpperCase(Locale.ROOT);
                if (!t.isEmpty()) out.add(t);
            }
        }
        return new ArrayList<>(out);
    }

    static boolean isAdmin(List<String> roles) {
        return roles.contains("ADMIN") || roles.contains("ROOT_ADMIN");
    }

    private static String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    static Instant instant(Object o) {
        if (o == null) return null;
        if (o instanceof Instant i) return i;
        if (o instanceof java.sql.Timestamp t) return t.toInstant();
        if (o instanceof OffsetDateTime odt) return odt.toInstant();
        if (o instanceof LocalDateTime ldt) return ldt.toInstant(ZoneOffset.UTC);
        if (o instanceof java.sql.Date d) return d.toLocalDate().atStartOfDay().toInstant(ZoneOffset.UTC);
        if (o instanceof LocalDate d) return d.atStartOfDay().toInstant(ZoneOffset.UTC);
        if (o instanceof java.util.Date d) return d.toInstant();
        return null;
    }

    static String iso(Object o) {
        Instant i = instant(o);
        return i == null ? (o == null ? null : String.valueOf(o)) : i.toString();
    }

    private static String date(Object o) {
        if (o == null) return null;
        if (o instanceof java.sql.Date d) return d.toLocalDate().toString();
        if (o instanceof LocalDate d) return d.toString();
        Instant i = instant(o);
        return i == null ? String.valueOf(o) : i.atZone(ZoneOffset.UTC).toLocalDate().toString();
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }
}
