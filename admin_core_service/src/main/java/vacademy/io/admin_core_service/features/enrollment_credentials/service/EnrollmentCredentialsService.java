package vacademy.io.admin_core_service.features.enrollment_credentials.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.ArrayList;
import java.util.List;

/**
 * Builds the ready-to-send WhatsApp text carrying a learner's login details.
 *
 * Why this exists as a text-returning endpoint rather than a data API: Meta will
 * not approve a WhatsApp template whose body carries credentials — any
 * "Login ID"/"password"/"log in" wording is classified as AUTHENTICATION, whose
 * body is fixed-format, so the template hard-rejects with INCORRECT_CATEGORY in
 * every category. The only channel that can carry credentials is a FREE-TEXT
 * session message inside the 24-hour window, which the chatbot flow sends. That
 * flow's HTTP_WEBHOOK node stores a response body as an opaque string and has no
 * JSON-path extraction, so it can only forward text that is already final.
 *
 * Scope is deliberately narrow: credentials are returned ONLY for learners with
 * an ACTIVE enrollment in a package whose name matches {@link #PACKAGE_NAME_LIKE}.
 * A phone with no such enrollment yields empty, never an arbitrary learner's
 * password.
 *
 * Shared numbers are real here (24 numbers across 50 accounts in this cohort), so
 * every matching account on the number is listed rather than guessing one.
 */
@Service
@Slf4j
public class EnrollmentCredentialsService {

    /** Only this cohort is exposed. Widen deliberately, never with a wildcard. */
    private static final String PACKAGE_NAME_LIKE = "%unlockx scholarship%";

    private static final String ANDROID_URL =
            "https://play.google.com/store/apps/details?id=com.shikshanation.new.app";
    private static final String IOS_URL =
            "https://apps.apple.com/in/app/shiksha-nation/id6785750270";

    @PersistenceContext
    private EntityManager entityManager;

    @Autowired
    private AuthService authService;

    /**
     * @return the message text, or {@code null} when the number has no ACTIVE
     *         enrollment in scope. Callers must treat null as "send nothing".
     */
    @Transactional(readOnly = true)
    public String buildCredentialsText(String phoneNumber) {
        List<String> userIds = findEnrolledUserIdsByPhone(phoneNumber);
        if (userIds.isEmpty()) {
            log.info("No in-scope enrollment for phone ending {}, returning no text", tail(phoneNumber));
            return null;
        }

        List<UserDTO> users = new ArrayList<>();
        for (String userId : userIds) {
            try {
                UserDTO u = authService.getUsersFromAuthServiceWithPasswordByUserId(userId);
                // A blank username or password would render "Username: " with nothing
                // after it, so drop the account instead of sending a broken line.
                if (u != null && hasText(u.getUsername()) && hasText(u.getPassword())) {
                    users.add(u);
                }
            } catch (Exception e) {
                log.warn("Credential lookup failed for user {}: {}", userId, e.getMessage());
            }
        }
        if (users.isEmpty()) {
            return null;
        }
        return users.size() == 1 ? single(users.get(0)) : multiple(users);
    }

    /**
     * auth_service matches phones on the last 10 digits, so the same is done here:
     * the student record may carry a country code, spaces or a leading +.
     */
    private List<String> findEnrolledUserIdsByPhone(String phoneNumber) {
        String digits = phoneNumber == null ? "" : phoneNumber.replaceAll("\\D", "");
        if (digits.length() < 10) {
            return List.of();
        }
        String last10 = digits.substring(digits.length() - 10);

        @SuppressWarnings("unchecked")
        List<String> ids = entityManager.createNativeQuery("""
                SELECT DISTINCT s.user_id
                FROM student s
                JOIN student_session_institute_group_mapping m ON m.user_id = s.user_id
                JOIN package_session ps ON ps.id = m.package_session_id
                JOIN package p ON p.id = ps.package_id
                WHERE m.status = 'ACTIVE'
                  AND lower(p.package_name) LIKE :pkg
                  AND right(regexp_replace(COALESCE(s.mobile_number,''), '\\D', '', 'g'), 10) = :last10
                """)
                .setParameter("pkg", PACKAGE_NAME_LIKE)
                .setParameter("last10", last10)
                .getResultList();
        return ids;
    }

    private String single(UserDTO u) {
        return "Hi " + greeting(u) + ",\n\n"
                + "Here are your Shiksha Nation login details for the "
                + "UnlockX Scholarship Test 2026:\n\n"
                + "Username: " + u.getUsername() + "\n"
                + "Password: " + u.getPassword() + "\n\n"
                + "Android: " + ANDROID_URL + "\n"
                + "iOS: " + IOS_URL + "\n\n"
                + "Log in with the above to see your registered test and account "
                + "information.\n\n"
                + "Shiksha Nation";
    }

    private String multiple(List<UserDTO> users) {
        StringBuilder sb = new StringBuilder("Hi,\n\n")
                .append("Here are the Shiksha Nation login details for the UnlockX ")
                .append("Scholarship Test 2026 registrations on this number:\n\n");
        int i = 1;
        for (UserDTO u : users) {
            sb.append(i++).append(") ").append(label(u)).append("\n")
              .append("   Username: ").append(u.getUsername()).append("\n")
              .append("   Password: ").append(u.getPassword()).append("\n\n");
        }
        sb.append("Android: ").append(ANDROID_URL).append("\n")
          .append("iOS: ").append(IOS_URL).append("\n\n")
          .append("Log in with the details above to see the registered test and ")
          .append("account information.\n\n")
          .append("Shiksha Nation");
        return sb.toString();
    }

    /**
     * 22 learners in this cohort have a full_name with no letters at all — phone
     * numbers and single characters typed into the name field. "Hi 654985359780,"
     * reads like a scam, so those fall back to a neutral greeting.
     */
    private String greeting(UserDTO u) {
        return hasLetter(u.getFullName()) ? u.getFullName().trim() : "there";
    }

    private String label(UserDTO u) {
        return hasLetter(u.getFullName()) ? u.getFullName().trim() : u.getUsername();
    }

    private static boolean hasLetter(String s) {
        if (s == null) return false;
        for (char c : s.toCharArray()) {
            if (Character.isLetter(c)) return true;
        }
        return false;
    }

    private static boolean hasText(String s) {
        return s != null && !s.isBlank();
    }

    private static String tail(String phone) {
        return phone == null || phone.length() < 4 ? "?" : phone.substring(phone.length() - 4);
    }
}
