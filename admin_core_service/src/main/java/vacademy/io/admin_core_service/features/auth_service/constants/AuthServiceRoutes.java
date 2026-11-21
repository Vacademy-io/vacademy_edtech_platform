package vacademy.io.admin_core_service.features.auth_service.constants;

public class AuthServiceRoutes {

    private AuthServiceRoutes() {
        // Private constructor to hide the implicit public one
    }

    public static final String INVITE_USER_ROUTE = "/auth-service/internal/v1/user-invitation/invite";
    public static final String GET_USERS_FROM_AUTH_SERVICE = "/auth-service/internal/user/user-details-list";
    public static final String GET_USERS_BY_INSTITUTE_ROLE = "/auth-service/internal/user/v1/users-by-institute-role";
    public static final String GET_INSTITUTE_ROLES = "/auth-service/internal/user/v1/institute-roles";
    public static final String UPDATE_USER_ROUTE = "/auth-service/v1/user/internal/update-user";
    public static final String UPDATE_PASSWORD_ROUTE = "/auth-service/v1/user-operation/update-password";
    public static final String GET_USER_BY_ID_WITH_PASSWORD = "/auth-service/internal/user/user-by-id-with-password";
    public static final String GENERATE_TOKEN_FOR_LEARNER = "/auth-service/v1/internal/generate-token-for-learner";
    public static final String SEND_CRED_TO_USERS = "/auth-service/internal/v1/user-operation/send-passwords";
    /** One user's current login details, branded for an institute, linking to a given portal. */
    public static final String RESEND_LOGIN_DETAILS = "/auth-service/internal/v1/user-operation/resend-login-details";
    public static final String CREATE_OR_GET_EXISTING_BY_ID = "/auth-service/internal/user/create-or-get-existing-by-id";
    public static final String GET_STUDENT_LOGIN_STATS = "/auth-service/analytics/student-login-stats";
    public static final String CREATE_MULTIPLE_USERS = "/auth-service/v1/user/internal/create-multiple-users";
    public static final String GET_USERS_WITH_CHILDREN = "/auth-service/v1/user/internal/users-with-children";
    public static final String GET_USER_BY_MOBILE = "/auth-service/v1/user/internal/user-by-mobile";
    public static final String UPDATE_INSTITUTE_SETTINGS = "/auth-service/internal/institute-settings";
    public static final String AUTOSUGGEST_USERS = "/auth-service/internal/user/autosuggest-users";

    /**
     * Substring search on full_name / email / mobile_number, optionally scoped to
     * an institute. Returns user IDs only. Used by the leads search bar to
     * pre-fetch matching users from auth_service so admin_core can OR them
     * against ar.user_id in its own audience_response query.
     */
    public static final String SEARCH_USER_IDS = "/auth-service/internal/user/search-ids";

    /**
     * Returns users with a given role for a specific institute.
     * Query params: instituteId, roleName.
     * Used by the doubt-notification cascade to fall back to ADMIN users when no faculty is mapped.
     */
    public static final String GET_USERS_BY_ROLE = "/auth-service/v1/users/by-role";

    /**
     * Idempotently adds the supplied roles to a user (no-op when the user
     * already has an ACTIVE row for that {institute, role}). HMAC-internal
     * variant of {@code /auth-service/v1/user-roles/add-user-roles}.
     *
     * <p>Body: {@code { user_id, roles, institute_id }} (snake_case).
     *
     * <p>Used by the bulk-assign flow to make sure existing-user enrollments
     * (e.g. leads) get the {@code STUDENT} role so the learner-portal login
     * passes its role check.
     */
    public static final String ADD_USER_ROLES_INTERNAL = "/auth-service/internal/v1/user-roles/add-user-roles";

    /**
     * HMAC-internal "users holding any of these roles" lookup. Body: JSON array
     * of role names; query param: instituteId. Returns UserWithRolesDTO list,
     * ACTIVE user_role rows only — the same RoleService path that powers the
     * staff-management screen, and DTO-based end to end.
     *
     * <p>Deliberately NOT {@code /auth-service/v1/users/by-role}: that endpoint
     * @Cacheable's raw User ENTITIES whose lazy/circular refs fail Redis cache
     * serialization, turning every call into an HTTP 400 (fixed in auth, but
     * this route is the safer contract regardless).
     */
    public static final String USERS_OF_STATUS_INTERNAL = "/auth-service/internal/v1/user-roles/users-of-status";

    public static final String GET_USER_BY_EMAIL = "/auth-service/internal/user/by-email";

    /** Every (institute, role, status) row of one user. Query param: userId. */
    public static final String USER_ROLE_MEMBERSHIPS = "/auth-service/internal/v1/user-roles/memberships";

    /**
     * Pause (DISABLED) / restore (ACTIVE) only the named roles of one user in one institute.
     * Query params: instituteId, userId, status; body: JSON array of role names.
     */
    public static final String USER_ROLE_STATUS_INTERNAL = "/auth-service/internal/v1/user-roles/role-status";

    // ── Organization teams (hybrid: flat teams + user-to-user inside) ──────
    // organization_team is the team list. organization_team_member has
    // one row per (team, user) PLUS parent_user_id which captures who that
    // person reports to inside that team. Same person can be in multiple
    // teams with different managers in each.
    public static final String ORG_TEAM_BASE = "/auth-service/internal/organization-team";
    public static final String ORG_TEAM_BY_ID = "/auth-service/internal/organization-team/{teamId}";
    public static final String ORG_TEAM_LIST = "/auth-service/internal/organization-team";
    public static final String ORG_TEAM_CHART = "/auth-service/internal/organization-team/{teamId}/chart";
    public static final String ORG_TEAM_MEMBERS = "/auth-service/internal/organization-team/{teamId}/members";
    public static final String ORG_TEAM_MEMBER_BY_ID = "/auth-service/internal/organization-team/{teamId}/members/{mappingId}";
    public static final String ORG_TEAM_ANCESTORS = "/auth-service/internal/organization-team/{teamId}/members/{mappingId}/ancestors";
    public static final String ORG_TEAM_DESCENDANTS = "/auth-service/internal/organization-team/{teamId}/members/{mappingId}/descendants";
    public static final String ORG_TEAM_USER_MEMBERSHIPS = "/auth-service/internal/organization-team/members/by-user/{userId}";

    // ── Guardian (parent-student) linking ───────────────────────────────
    public static final String LINK_PARENT_CHILD = "/auth-service/v1/user/internal/link-parent-child";
    public static final String CHILDREN_OF_PARENT = "/auth-service/v1/user/internal/children-of-parent";
    public static final String BACKFILL_PARENTS = "/auth-service/v1/user/internal/backfill-parents";
    /** Bulk username/password lookup — used to re-share an existing guardian's credentials. */
    public static final String USERS_CREDENTIALS = "/auth-service/v1/user/internal/users-credential";
}
