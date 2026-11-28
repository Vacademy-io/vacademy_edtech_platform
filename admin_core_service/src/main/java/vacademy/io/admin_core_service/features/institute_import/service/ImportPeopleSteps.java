package vacademy.io.admin_core_service.features.institute_import.service;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.common.auth.dto.UserDTO;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import static vacademy.io.admin_core_service.features.institute_import.service.ImportContext.*;

/**
 * Staff and learners. Accounts are created through auth_service with notifications OFF, keyed on
 * email (one email = one account, so a person who already has a Vacademy account keeps it and
 * just gains the role here). No username is sent: auth falls back to matching on username, and a
 * school's own numbers could collide with another person's username. The school's student number
 * goes into the enrolment number instead.
 */
@Component
@RequiredArgsConstructor
public class ImportPeopleSteps {

    private final AuthService authService;

    /** Body: [ { external_id, full_name, email, phone, vacademy_roles[], active } ] */
    public void staff(ImportContext c, JsonNode body) {
        for (JsonNode p : body) {
            c.item(keyOf(p), () -> {
            String ext = text(p, "external_id");
            String email = lower(text(p, "email"));
            if (ext == null || email == null) {
                c.skip(ext, "no email, so no login");
                return;
            }
            if (c.ref("STAFF", ext).isPresent()) {
                c.updated();
                return;
            }
            if (c.isDryRun()) {
                c.created();
                return;
            }
            UserDTO u = new UserDTO();
            u.setEmail(email);
            u.setFullName(text(p, "full_name"));
            u.setMobileNumber(text(p, "phone"));
            List<String> roles = ImportStructureSteps.list(p.get("vacademy_roles"));
            u.setRoles(roles.isEmpty() ? List.of("TEACHER") : roles);
            UserDTO saved = authService.createUserFromAuthService(u, c.getInstituteId(), false);
            c.putRef("STAFF", ext, saved.getId());
            c.putRef("STAFF_NAME", ext, text(p, "full_name") == null ? "" : text(p, "full_name"));
            c.created();
                    });
        }
    }

    /**
     * Body: [ { external_id, reg_number, full_name, email, phone, whatsapp, date_of_birth, gender,
     *           guardian_name, guardian_phone, guardian_email, country, city, health_issues } ]
     */
    public void learners(ImportContext c, JsonNode body) {
        for (JsonNode l : body) {
            c.item(keyOf(l), () -> {
            String ext = text(l, "external_id");
            String email = lower(text(l, "email"));
            if (ext == null || email == null) {
                c.skip(ext, "no email, so no login");
                return;
            }
            Optional<String> known = c.ref("LEARNER", ext);
            if (c.isDryRun()) {
                if (known.isPresent()) c.updated(); else c.created();
                return;
            }
            String userId = known.orElse(null);
            if (userId == null) {
                UserDTO u = new UserDTO();
                u.setEmail(email);
                u.setFullName(text(l, "full_name"));
                u.setMobileNumber(text(l, "phone"));
                u.setGender(text(l, "gender"));
                u.setCity(text(l, "city"));
                u.setRegion(text(l, "country"));
                LocalDate dob = date(l, "date_of_birth");
                if (dob != null) u.setDateOfBirth(java.sql.Date.valueOf(dob));
                u.setRoles(List.of("STUDENT"));
                userId = authService.createUserFromAuthService(u, c.getInstituteId(), false).getId();
                c.putRef("LEARNER", ext, userId);
                c.created();
            } else {
                c.updated();
            }
            upsertStudent(c, userId, email, l);
                    });
        }
    }

    /** The admin_core copy of the learner's profile, filled only where it is still blank. */
    private void upsertStudent(ImportContext c, String userId, String email, JsonNode l) {
        Object[] values = {
                text(l, "full_name"), email, text(l, "phone"), text(l, "gender"), sqlDate(date(l, "date_of_birth")),
                text(l, "city"), text(l, "country"), text(l, "guardian_name"), text(l, "guardian_phone"),
                lower(text(l, "guardian_email")), text(l, "health_issues"), text(l, "reg_number")};
        List<String> ids = c.getJdbc().queryForList("SELECT id FROM student WHERE user_id = ? ORDER BY created_at DESC NULLS LAST LIMIT 1",
                String.class, userId);
        if (ids.isEmpty()) {
            c.getJdbc().update("""
                    INSERT INTO student (id, user_id, full_name, email, mobile_number, gender, date_of_birth, city, region,
                                         guardian_name, guardian_mobile, guardian_email, medical_conditions, admission_no)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, prepend(newId(), userId, values));
        } else {
            c.getJdbc().update("""
                    UPDATE student SET full_name = COALESCE(NULLIF(full_name, ''), ?), email = COALESCE(NULLIF(email, ''), ?),
                           mobile_number = COALESCE(NULLIF(mobile_number, ''), ?), gender = COALESCE(NULLIF(gender, ''), ?),
                           date_of_birth = COALESCE(date_of_birth, ?), city = COALESCE(NULLIF(city, ''), ?),
                           region = COALESCE(NULLIF(region, ''), ?), guardian_name = COALESCE(NULLIF(guardian_name, ''), ?),
                           guardian_mobile = COALESCE(NULLIF(guardian_mobile, ''), ?), guardian_email = COALESCE(NULLIF(guardian_email, ''), ?),
                           medical_conditions = COALESCE(NULLIF(medical_conditions, ''), ?), admission_no = COALESCE(NULLIF(admission_no, ''), ?)
                     WHERE id = ?
                    """, append(values, ids.get(0)));
        }
    }

    private static Object[] prepend(Object a, Object b, Object[] rest) {
        Object[] out = new Object[rest.length + 2];
        out[0] = a;
        out[1] = b;
        System.arraycopy(rest, 0, out, 2, rest.length);
        return out;
    }

    private static Object[] append(Object[] rest, Object last) {
        Object[] out = java.util.Arrays.copyOf(rest, rest.length + 1);
        out[rest.length] = last;
        return out;
    }

    private static String lower(String s) {
        return s == null ? null : s.trim().toLowerCase();
    }
}
