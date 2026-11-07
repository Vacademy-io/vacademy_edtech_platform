package vacademy.io.admin_core_service.features.live_session.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.live_session.client.LiveSessionUserDirectoryClient;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionInstructorDTO;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSessionInstructor;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionInstructorRepository;

import java.util.*;

/**
 * Owns the instructor list of a live session (V524).
 *
 * <p><b>The fallback is the contract.</b> "No ACTIVE instructor row" means
 * "the creator is the instructor", not "nobody". Every read here applies that
 * fallback, which is what lets the feature ship without backfilling the
 * pre-V524 sessions and without a NOT NULL instructor anywhere. Callers must
 * not query {@code LiveSessionInstructorRepository} directly for display or
 * authorization.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class LiveSessionInstructorService {

    private static final String ACTIVE = "ACTIVE";
    private static final String DELETED = "DELETED";

    private final LiveSessionInstructorRepository instructorRepository;
    private final LiveSessionUserDirectoryClient userDirectoryClient;

    /**
     * Makes the creator the default instructor of a freshly created session.
     *
     * <p>Only ever called on create, and only when the session has no rows yet,
     * so it can never resurrect an instructor an admin deliberately removed.
     */
    @Transactional
    public void seedCreatorAsInstructor(String sessionId, String creatorUserId) {
        if (!StringUtils.hasText(sessionId) || !StringUtils.hasText(creatorUserId)) {
            return;
        }
        if (!instructorRepository.findBySessionId(sessionId).isEmpty()) {
            return;
        }
        instructorRepository.save(LiveSessionInstructor.builder()
                .sessionId(sessionId)
                .userId(creatorUserId)
                .status(ACTIVE)
                .build());
    }

    /**
     * Reconciles the session's instructors to exactly {@code userIds}.
     *
     * <p>A {@code null} list is "the client didn't touch instructors" and is a
     * no-op — older clients that know nothing about this feature keep working.
     * An <b>empty</b> list is an explicit "remove them all", which is allowed:
     * the session then falls back to its creator rather than becoming
     * unreachable.
     */
    @Transactional
    public void syncInstructors(String sessionId, List<String> userIds) {
        if (!StringUtils.hasText(sessionId) || userIds == null) {
            return;
        }

        Set<String> desired = new LinkedHashSet<>();
        userIds.stream().filter(StringUtils::hasText).map(String::trim).forEach(desired::add);

        List<LiveSessionInstructor> existing = instructorRepository.findBySessionId(sessionId);
        Map<String, LiveSessionInstructor> byUserId = new HashMap<>();
        existing.forEach(row -> byUserId.put(row.getUserId(), row));

        List<LiveSessionInstructor> toSave = new ArrayList<>();

        // Reactivate or create the desired ones. Reactivation (rather than
        // insert) is required by the (session_id, user_id) unique index.
        for (String userId : desired) {
            LiveSessionInstructor row = byUserId.get(userId);
            if (row == null) {
                toSave.add(LiveSessionInstructor.builder()
                        .sessionId(sessionId)
                        .userId(userId)
                        .status(ACTIVE)
                        .build());
            } else if (!ACTIVE.equals(row.getStatus())) {
                row.setStatus(ACTIVE);
                toSave.add(row);
            }
        }

        // Soft-delete everything no longer listed.
        for (LiveSessionInstructor row : existing) {
            if (!desired.contains(row.getUserId()) && ACTIVE.equals(row.getStatus())) {
                row.setStatus(DELETED);
                toSave.add(row);
            }
        }

        if (!toSave.isEmpty()) {
            instructorRepository.saveAll(toSave);
        }
    }

    /**
     * The outcome of turning human-typed instructor identifiers into user ids.
     *
     * @param userIds    identifiers that resolved, in the order given
     * @param unresolved identifiers that matched nobody — reported to the
     *                   admin, never silently dropped
     */
    public record ResolvedIdentifiers(List<String> userIds, List<String> unresolved) {
        public static ResolvedIdentifiers empty() {
            return new ResolvedIdentifiers(List.of(), List.of());
        }
    }

    /**
     * Resolves user ids, emails or usernames against the institute's staff
     * directory — the bulk CSV's {@code instructors} column.
     *
     * <p>One directory fetch for the whole call, matched locally, because the
     * alternative is a cross-service lookup per spreadsheet row.
     *
     * <p>An identifier that looks like an id is accepted only if the directory
     * confirms it: an unchecked id would let a typo'd UUID, or a user from
     * another institute, be written in as an instructor.
     */
    public ResolvedIdentifiers resolveIdentifiers(String instituteId, List<String> identifiers) {
        if (identifiers == null || identifiers.isEmpty()) {
            return ResolvedIdentifiers.empty();
        }
        List<String> cleaned = identifiers.stream()
                .filter(StringUtils::hasText)
                .map(String::trim)
                .distinct()
                .toList();
        if (cleaned.isEmpty()) {
            return ResolvedIdentifiers.empty();
        }

        List<LiveSessionUserDirectoryClient.DirectoryUser> staff =
                userDirectoryClient.findInstituteStaff(instituteId, null);

        Map<String, String> byId = new HashMap<>();
        Map<String, String> byLowerKey = new HashMap<>();
        for (LiveSessionUserDirectoryClient.DirectoryUser user : staff) {
            byId.put(user.id(), user.id());
            if (StringUtils.hasText(user.email())) {
                byLowerKey.putIfAbsent(user.email().toLowerCase(), user.id());
            }
            if (StringUtils.hasText(user.username())) {
                byLowerKey.putIfAbsent(user.username().toLowerCase(), user.id());
            }
        }

        List<String> resolved = new ArrayList<>();
        List<String> unresolved = new ArrayList<>();
        for (String identifier : cleaned) {
            String userId = byId.get(identifier);
            if (userId == null) {
                userId = byLowerKey.get(identifier.toLowerCase());
            }
            if (userId == null) {
                unresolved.add(identifier);
            } else if (!resolved.contains(userId)) {
                resolved.add(userId);
            }
        }
        return new ResolvedIdentifiers(resolved, unresolved);
    }

    /** Explicitly listed instructors only — no creator fallback. */
    public List<String> getExplicitInstructorUserIds(String sessionId) {
        if (!StringUtils.hasText(sessionId)) {
            return List.of();
        }
        return instructorRepository.findActiveUserIdsBySessionId(sessionId);
    }

    /**
     * Who is actually presenting: the listed instructors, or the creator when
     * none are listed. This is the form every display and notification path
     * should use.
     */
    public List<String> getEffectiveInstructorUserIds(LiveSession session) {
        if (session == null) {
            return List.of();
        }
        List<String> explicit = getExplicitInstructorUserIds(session.getId());
        if (!explicit.isEmpty()) {
            return explicit;
        }
        return StringUtils.hasText(session.getCreatedByUserId())
                ? List.of(session.getCreatedByUserId())
                : List.of();
    }

    /** As {@link #getEffectiveInstructorUserIds} but for many sessions in one query. */
    public Map<String, List<String>> getEffectiveInstructorUserIdsBySession(Collection<LiveSession> sessions) {
        if (sessions == null || sessions.isEmpty()) {
            return Map.of();
        }
        List<String> sessionIds = sessions.stream()
                .filter(Objects::nonNull)
                .map(LiveSession::getId)
                .filter(StringUtils::hasText)
                .distinct()
                .toList();
        if (sessionIds.isEmpty()) {
            return Map.of();
        }

        Map<String, List<String>> explicitBySession = new HashMap<>();
        instructorRepository.findBySessionIdInAndStatus(sessionIds, ACTIVE).forEach(row ->
                explicitBySession.computeIfAbsent(row.getSessionId(), k -> new ArrayList<>())
                        .add(row.getUserId()));

        Map<String, List<String>> result = new HashMap<>();
        for (LiveSession session : sessions) {
            if (session == null || !StringUtils.hasText(session.getId())) {
                continue;
            }
            List<String> explicit = explicitBySession.get(session.getId());
            if (explicit != null && !explicit.isEmpty()) {
                result.put(session.getId(), explicit);
            } else if (StringUtils.hasText(session.getCreatedByUserId())) {
                result.put(session.getId(), List.of(session.getCreatedByUserId()));
            } else {
                result.put(session.getId(), List.of());
            }
        }
        return result;
    }

    /**
     * Instructors of a session with their display details, for the admin editor
     * and the learner cards. Users the directory couldn't resolve are still
     * returned, carrying only their id.
     */
    public List<LiveSessionInstructorDTO> getInstructorDetails(LiveSession session) {
        List<String> userIds = getEffectiveInstructorUserIds(session);
        return toInstructorDetails(userIds);
    }

    public List<LiveSessionInstructorDTO> toInstructorDetails(List<String> userIds) {
        if (userIds == null || userIds.isEmpty()) {
            return List.of();
        }
        Map<String, LiveSessionUserDirectoryClient.DirectoryUser> directory =
                userDirectoryClient.findUsersByIds(userIds);
        List<LiveSessionInstructorDTO> result = new ArrayList<>();
        for (String userId : userIds) {
            LiveSessionUserDirectoryClient.DirectoryUser user = directory.get(userId);
            result.add(LiveSessionInstructorDTO.builder()
                    .userId(userId)
                    .fullName(user != null ? user.fullName() : null)
                    .email(user != null ? user.email() : null)
                    .profilePicFileId(user != null ? user.profilePicFileId() : null)
                    .build());
        }
        return result;
    }
}
