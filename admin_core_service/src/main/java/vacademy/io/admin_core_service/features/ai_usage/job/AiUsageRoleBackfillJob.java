package vacademy.io.admin_core_service.features.ai_usage.job;

import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Nightly fill-in of WHO spent AI credits, for usage events whose writer could not tell.
 *
 * <p>ai_service writes one {@code ai_usage_event} per AI charge. When the call carried no
 * readable roles (a service-token call, an expired JWT, a Java caller that knows only the
 * user id) the row is stored with {@code role_source = 'UNRESOLVED'}. ai_service cannot
 * read auth tables (they are auth_service-only), but admin_core can ask auth_service, so
 * this job looks the user up and writes back the institute roles, the role class and the
 * display name.
 *
 * <p>Scope is deliberately narrow:
 * <ul>
 *   <li>Only {@code ai_usage_event} rows from the last 7 days with
 *       {@code role_source = 'UNRESOLVED'} and a non-null {@code actor_user_id}.</li>
 *   <li>Only four columns are written: {@code actor_roles_raw}, {@code actor_role_class},
 *       {@code role_source = 'AUTH_LOOKUP'} and {@code actor_display_name} (kept when
 *       already set); plus, in a second pass, {@code subject_display_name} where an event
 *       names a subject user but not their name. Never credits, ledger rows or balances.</li>
 *   <li>Batches of {@value #BATCH_SIZE} rows, at most {@value #MAX_BATCHES} batches a run.
 *       A user auth_service returns no roles for stays UNRESOLVED.</li>
 * </ul>
 *
 * <p>Switched by the platform setting {@value #SETTING_KEY} in {@code ai_platform_settings}
 * (absent = on, since it only writes the new table). While the metering migration is not
 * applied the first query fails, the job logs once and does nothing.
 *
 * <p>{@code @SchedulerLock}: admin_core runs several replicas; one run a night is enough.
 */
@Slf4j
@Component
public class AiUsageRoleBackfillJob {

    public static final String SETTING_KEY = "metering.role_backfill.enabled";

    static final int BATCH_SIZE = 500;
    static final int MAX_BATCHES = 40;
    /** auth_service takes the ids on a GET query string; keep each request short. */
    static final int AUTH_CHUNK = 100;

    static final String FALLBACK_ROLE_CLASS = "STAFF";
    static final int FALLBACK_PRECEDENCE = 35;
    static final String SOURCE_AUTH_LOOKUP = "AUTH_LOOKUP";

    /** Lowest possible uuid: the keyset cursor's starting point. */
    static final String FIRST_CURSOR = "00000000-0000-0000-0000-000000000000";

    static final String SELECT_SETTING =
            "SELECT CAST(setting_value AS text) FROM ai_platform_settings WHERE setting_key = ?";

    static final String SELECT_ROLE_MAP =
            "SELECT role_name, role_class, precedence FROM ai_role_class_map";

    /** Keyset by id so rows left UNRESOLVED are not re-read within one run. */
    static final String SELECT_BATCH = """
            SELECT CAST(id AS text) AS id, institute_id, actor_user_id
            FROM ai_usage_event
            WHERE role_source = 'UNRESOLVED'
              AND actor_user_id IS NOT NULL
              AND institute_id IS NOT NULL
              AND occurred_at > now() - INTERVAL '7 days'
              AND id > CAST(? AS uuid)
            ORDER BY id
            LIMIT ?""";

    /**
     * Every unresolved row of one (institute, user) in the window at once. The roles go in
     * as one string split on the unit-separator character, so no driver array is needed.
     */
    static final String UPDATE_ACTOR = """
            UPDATE ai_usage_event
            SET actor_roles_raw = string_to_array(?, chr(31)),
                actor_role_class = ?,
                role_source = 'AUTH_LOOKUP',
                actor_display_name = COALESCE(actor_display_name, ?)
            WHERE institute_id = ?
              AND actor_user_id = ?
              AND role_source = 'UNRESOLVED'
              AND occurred_at > now() - INTERVAL '7 days'""";

    static final String ROLE_SEPARATOR = "\u001f";

    /** Events naming a subject (the learner a report / insight is about) but not their name. */
    static final String SELECT_SUBJECT_BATCH = """
            SELECT CAST(id AS text) AS id, subject_user_id
            FROM ai_usage_event
            WHERE subject_user_id IS NOT NULL
              AND subject_display_name IS NULL
              AND institute_id IS NOT NULL
              AND occurred_at > now() - INTERVAL '7 days'
              AND id > CAST(? AS uuid)
            ORDER BY id
            LIMIT ?""";

    static final String UPDATE_SUBJECT_NAME = """
            UPDATE ai_usage_event
            SET subject_display_name = ?
            WHERE subject_user_id = ?
              AND subject_display_name IS NULL
              AND occurred_at > now() - INTERVAL '7 days'""";

    private final JdbcTemplate jdbcTemplate;
    private final AuthService authService;

    /** Set once the missing-table case has been logged, so it is not logged every night. */
    private volatile boolean loggedMissingTables = false;

    public AiUsageRoleBackfillJob(JdbcTemplate jdbcTemplate, AuthService authService) {
        this.jdbcTemplate = jdbcTemplate;
        this.authService = authService;
    }

    /** 02:40 UTC (08:10 IST) daily, off-peak and clear of the 03:xx jobs. */
    @Scheduled(cron = "0 40 2 * * *", zone = "UTC")
    @SchedulerLock(name = "AiUsageRoleBackfillJob", lockAtMostFor = "PT30M", lockAtLeastFor = "PT1M")
    public void run() {
        try {
            Result r = runOnce();
            if (r.rowsSeen() > 0) {
                log.info("[metering-role-backfill] rows seen {}, users resolved {}, rows updated {}, unresolved users {}",
                        r.rowsSeen(), r.usersResolved(), r.rowsUpdated(), r.usersUnresolved());
            }
            int subjects = fillSubjectNames();
            if (subjects > 0) {
                log.info("[metering-role-backfill] subject names filled on {} rows", subjects);
            }
        } catch (Exception e) {
            log.error("[metering-role-backfill] run failed", e);
        }
    }

    /** One pass. Exposed for tests and a manual one-off. */
    public Result runOnce() {
        if (!isEnabled()) {
            log.info("[metering-role-backfill] {} is false; skipping", SETTING_KEY);
            return Result.EMPTY;
        }
        Map<String, RoleClass> roleMap;
        try {
            roleMap = loadRoleMap();
        } catch (Exception e) {
            logMissingTablesOnce(e);
            return Result.EMPTY;
        }

        String cursor = FIRST_CURSOR;
        Set<String> donePairs = new HashSet<>();
        int rowsSeen = 0;
        int usersResolved = 0;
        int usersUnresolved = 0;
        int rowsUpdated = 0;

        for (int batch = 0; batch < MAX_BATCHES; batch++) {
            List<Map<String, Object>> rows;
            try {
                rows = jdbcTemplate.queryForList(SELECT_BATCH, cursor, BATCH_SIZE);
            } catch (Exception e) {
                logMissingTablesOnce(e);
                break;
            }
            if (rows.isEmpty()) {
                break;
            }
            rowsSeen += rows.size();
            cursor = String.valueOf(rows.get(rows.size() - 1).get("id"));

            // institute -> users still to look up in this batch
            Map<String, Set<String>> byInstitute = new LinkedHashMap<>();
            for (Map<String, Object> row : rows) {
                String institute = str(row.get("institute_id"));
                String user = str(row.get("actor_user_id"));
                if (institute == null || user == null || !isUuid(user)) {
                    continue; // demo-*, apikey:* and the like are not auth users
                }
                if (donePairs.add(institute + "|" + user)) {
                    byInstitute.computeIfAbsent(institute, k -> new LinkedHashSet<>()).add(user);
                }
            }
            if (byInstitute.isEmpty()) {
                if (rows.size() < BATCH_SIZE) break;
                continue;
            }

            Set<String> allUsers = new LinkedHashSet<>();
            byInstitute.values().forEach(allUsers::addAll);
            Map<String, String> names = lookupNames(new ArrayList<>(allUsers));

            for (Map.Entry<String, Set<String>> e : byInstitute.entrySet()) {
                String institute = e.getKey();
                Map<String, List<String>> roles = lookupRoles(institute, new ArrayList<>(e.getValue()));
                for (String user : e.getValue()) {
                    List<String> userRoles = roles.get(user);
                    if (userRoles == null || userRoles.isEmpty()) {
                        usersUnresolved++;
                        continue;
                    }
                    RoleClass rc = resolveRoleClass(userRoles, roleMap);
                    try {
                        rowsUpdated += jdbcTemplate.update(UPDATE_ACTOR,
                                String.join(ROLE_SEPARATOR, userRoles), rc.roleClass(), names.get(user),
                                institute, user);
                        usersResolved++;
                    } catch (Exception ex) {
                        log.warn("[metering-role-backfill] update failed for institute {} user {}: {}",
                                institute, user, ex.getMessage());
                    }
                }
            }
            if (rows.size() < BATCH_SIZE) {
                break;
            }
        }
        return new Result(rowsSeen, usersResolved, usersUnresolved, rowsUpdated);
    }

    /**
     * Fills {@code subject_display_name} (the learner a report or insight was about) from
     * auth_service, for the last 7 days' events that name a subject id but no name. Same
     * switch, same batch limits; only that one column is written. Returns rows updated.
     */
    public int fillSubjectNames() {
        if (!isEnabled()) {
            return 0;
        }
        String cursor = FIRST_CURSOR;
        Set<String> done = new HashSet<>();
        int updated = 0;
        for (int batch = 0; batch < MAX_BATCHES; batch++) {
            List<Map<String, Object>> rows;
            try {
                rows = jdbcTemplate.queryForList(SELECT_SUBJECT_BATCH, cursor, BATCH_SIZE);
            } catch (Exception e) {
                logMissingTablesOnce(e);
                break;
            }
            if (rows.isEmpty()) {
                break;
            }
            cursor = String.valueOf(rows.get(rows.size() - 1).get("id"));
            List<String> users = new ArrayList<>();
            for (Map<String, Object> row : rows) {
                String user = str(row.get("subject_user_id"));
                if (user != null && isUuid(user) && done.add(user)) {
                    users.add(user);
                }
            }
            if (!users.isEmpty()) {
                Map<String, String> names = lookupNames(users);
                for (Map.Entry<String, String> e : names.entrySet()) {
                    try {
                        updated += jdbcTemplate.update(UPDATE_SUBJECT_NAME, e.getValue(), e.getKey());
                    } catch (Exception ex) {
                        log.warn("[metering-role-backfill] subject name update failed for {}: {}",
                                e.getKey(), ex.getMessage());
                    }
                }
            }
            if (rows.size() < BATCH_SIZE) {
                break;
            }
        }
        return updated;
    }

    /** The switch. Absent or unreadable = on (the job only writes ai_usage_event). */
    boolean isEnabled() {
        try {
            List<String> rows = jdbcTemplate.queryForList(SELECT_SETTING, String.class, SETTING_KEY);
            return rows.isEmpty() || !isFalse(rows.get(0));
        } catch (Exception e) {
            log.debug("[metering-role-backfill] could not read {}: {}", SETTING_KEY, e.getMessage());
            return true;
        }
    }

    /** jsonb text {@code false} or {@code "false"} turns the job off; anything else leaves it on. */
    static boolean isFalse(String raw) {
        if (raw == null) {
            return false;
        }
        String v = raw.trim();
        if (v.length() >= 2 && v.startsWith("\"") && v.endsWith("\"")) {
            v = v.substring(1, v.length() - 1).trim();
        }
        return "false".equalsIgnoreCase(v);
    }

    Map<String, RoleClass> loadRoleMap() {
        Map<String, RoleClass> map = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(SELECT_ROLE_MAP)) {
            String name = normalizeRole(str(row.get("role_name")));
            String cls = str(row.get("role_class"));
            Object p = row.get("precedence");
            if (name == null || cls == null) continue;
            int precedence = p instanceof Number n ? n.intValue() : FALLBACK_PRECEDENCE;
            map.put(name, new RoleClass(cls.trim().toUpperCase(Locale.ROOT), precedence));
        }
        return map;
    }

    /**
     * The role class of a set of institute roles: the mapped class with the lowest
     * precedence number wins (ADMIN 10 beats LEARNER 50). STUDENT is LEARNER even when the
     * map lacks it; any other unmapped role counts as STAFF at precedence 35.
     */
    static RoleClass resolveRoleClass(List<String> roles, Map<String, RoleClass> roleMap) {
        RoleClass best = null;
        for (String raw : roles) {
            String name = normalizeRole(raw);
            if (name == null) continue;
            RoleClass rc = roleMap.get(name);
            if (rc == null) {
                rc = ("STUDENT".equals(name) || "LEARNER".equals(name))
                        ? new RoleClass("LEARNER", 50)
                        : new RoleClass(FALLBACK_ROLE_CLASS, FALLBACK_PRECEDENCE);
            }
            if (best == null || rc.precedence() < best.precedence()) {
                best = rc;
            }
        }
        return best != null ? best : new RoleClass(FALLBACK_ROLE_CLASS, FALLBACK_PRECEDENCE);
    }

    /** UPPER, spaces and hyphens to '_' (the rule ai_service applies to JWT roles). */
    static String normalizeRole(String role) {
        if (role == null) return null;
        String r = role.trim();
        if (r.isEmpty()) return null;
        return r.toUpperCase(Locale.ROOT).replace(' ', '_').replace('-', '_');
    }

    private Map<String, List<String>> lookupRoles(String instituteId, List<String> userIds) {
        Map<String, List<String>> out = new HashMap<>();
        for (int i = 0; i < userIds.size(); i += AUTH_CHUNK) {
            List<String> chunk = userIds.subList(i, Math.min(i + AUTH_CHUNK, userIds.size()));
            try {
                Map<String, List<String>> got = authService.getInstituteRoles(instituteId, chunk);
                if (got != null) out.putAll(got);
            } catch (Exception e) {
                log.warn("[metering-role-backfill] role lookup failed for institute {}: {}",
                        instituteId, e.getMessage());
            }
        }
        return out;
    }

    private Map<String, String> lookupNames(List<String> userIds) {
        Map<String, String> out = new HashMap<>();
        for (int i = 0; i < userIds.size(); i += AUTH_CHUNK) {
            List<String> chunk = userIds.subList(i, Math.min(i + AUTH_CHUNK, userIds.size()));
            try {
                List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(new ArrayList<>(chunk));
                if (users == null) continue;
                for (UserDTO u : users) {
                    if (u != null && u.getId() != null && u.getFullName() != null && !u.getFullName().isBlank()) {
                        String name = u.getFullName().trim();
                        out.put(u.getId(), name.length() <= 255 ? name : name.substring(0, 255));
                    }
                }
            } catch (Exception e) {
                // Names are a nicety; roles are written without them.
                log.warn("[metering-role-backfill] name lookup failed: {}", e.getMessage());
            }
        }
        return out;
    }

    private void logMissingTablesOnce(Exception e) {
        if (!loggedMissingTables) {
            loggedMissingTables = true;
            log.warn("[metering-role-backfill] metering tables unavailable (migration not applied?); "
                    + "job is idle: {}", e.getMessage());
        }
    }

    private static boolean isUuid(String s) {
        try {
            UUID.fromString(s);
            return s.length() == 36;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    private static String str(Object o) {
        if (o == null) return null;
        String s = o.toString().trim();
        return s.isEmpty() ? null : s;
    }

    record RoleClass(String roleClass, int precedence) {}

    public record Result(int rowsSeen, int usersResolved, int usersUnresolved, int rowsUpdated) {
        static final Result EMPTY = new Result(0, 0, 0, 0);
    }
}
