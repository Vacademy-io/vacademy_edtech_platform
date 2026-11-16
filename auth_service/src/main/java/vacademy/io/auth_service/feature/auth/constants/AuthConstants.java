package vacademy.io.auth_service.feature.auth.constants;

import java.util.List;
import java.util.Locale;

public class AuthConstants {

    public static final String CREATE_INSTITUTES_PATH = "/admin-core-service/institute/v1/internal/create";

    public static final String ADMIN_ROLE = "ADMIN";

    public static final String STUDENT_ROLE = "STUDENT";

    public static final String LEARNER_ENROLL_PATH = "/admin-core-service/v1/learner/enroll";

    /**
     * Shop staff roles of the commerce module (seeded by V28). Only an institute ADMIN may grant
     * or remove them, and a user holding nothing else is not general institute staff.
     */
    public static final List<String> COMMERCE_ROLES = List.of("COMMERCE_STORE_MANAGER",
            "COMMERCE_WAREHOUSE_STAFF", "COMMERCE_POS_CASHIER", "COMMERCE_ACCOUNTANT");

    /** True for a commerce role name in any case, with or without padding. Null-safe. */
    public static boolean isCommerceRole(String roleName) {
        return roleName != null && COMMERCE_ROLES.contains(roleName.strip().toUpperCase(Locale.ROOT));
    }

    // The commerce roles are listed so shop staff can sign in to the admin portal.
    public static final List<String> VALID_ROLES_FOR_ADMIN_PORTAL = List.of("ADMIN", "TEACHER", "EVALUATOR",
            "COMMERCE_STORE_MANAGER", "COMMERCE_WAREHOUSE_STAFF", "COMMERCE_POS_CASHIER", "COMMERCE_ACCOUNTANT");

    public  static final List<String> VALID_ROLES_FOR_STUDENT_PORTAL = List.of("STUDENT", "PARENT");

    public static final String ADD_LEARNER = "/admin-core-service/institute/open_learner/v1/add-learner";

    public static final String SELF_SIGNUP_LEAD_PATH = "/admin-core-service/internal/audience/self-signup-lead";
}
