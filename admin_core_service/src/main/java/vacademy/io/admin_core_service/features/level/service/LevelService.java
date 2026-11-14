package vacademy.io.admin_core_service.features.level.service;

import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.group.service.GroupService;
import vacademy.io.admin_core_service.features.learner_invitation.enums.LearnerInvitationSourceTypeEnum;
import vacademy.io.admin_core_service.features.learner_invitation.services.LearnerInvitationService;
import vacademy.io.admin_core_service.features.level.dto.AddLevelWithCourseDTO;
import vacademy.io.admin_core_service.features.level.dto.AddLevelWithSessionDTO;
import vacademy.io.admin_core_service.features.level.enums.LevelStatusEnum;
import vacademy.io.admin_core_service.features.level.repository.LevelRepository;
import vacademy.io.admin_core_service.features.packages.enums.PackageSessionStatusEnum;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.packages.service.PackageSessionService;
import vacademy.io.admin_core_service.features.session.repository.SessionRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.dto.LevelDTO;
import vacademy.io.common.institute.entity.Group;
import vacademy.io.common.institute.entity.Level;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.institute.entity.session.PackageSession;
import vacademy.io.common.institute.entity.session.Session;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Date;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

@Slf4j
@Service
@RequiredArgsConstructor
public class LevelService {
    private final LevelRepository levelRepository;
    private final PackageRepository packageRepository;
    private final PackageSessionService packageSessionService;
    private final SessionRepository sessionRepository;
    private final PackageSessionRepository packageSessionRepository;
    private final LearnerInvitationService learnerInvitationService;
    private final GroupService groupService;

    public Level createOrAddLevel(String id, boolean newLevel, String levelName, Integer durationInDays, String thumbnailFileId,String instituteId) {
        Level level = null;
        if (newLevel) {
            level = getLevel(levelName, durationInDays, thumbnailFileId,instituteId);
        } else {
            level = getLevelById(id);
            if (StringUtils.hasText(levelName)){
                level.setLevelName(levelName);
            }
            if (durationInDays != null){
                level.setDurationInDays(durationInDays);
            }
            if (StringUtils.hasText(thumbnailFileId)){
                level.setThumbnailFileId(thumbnailFileId);
            }
        }
        return levelRepository.save(level);
    }

    private Level getLevel(String levelName, Integer durationInDays, String thumbnailFileId,String instituteId) {
        Optional<Level>optionalLevel = levelRepository.findLatestLevelByNameAndInstitute(levelName,instituteId,List.of(LevelStatusEnum.ACTIVE.name()));
        if (optionalLevel.isPresent()) {
            return optionalLevel.get();
        }
        Level level = new Level();
        level.setLevelName(levelName);
        level.setDurationInDays(durationInDays);
        level.setStatus(LevelStatusEnum.ACTIVE.name());
        level.setThumbnailFileId(thumbnailFileId);
        return levelRepository.save(level);
    }

    public Level getLevelById(String levelId) {
        return levelRepository.findById(levelId).orElseThrow(() -> new VacademyException("Level not found"));
    }

    @Transactional
    public String addLevel(AddLevelWithCourseDTO addLevelWithCourseDTO, String packageId, String sessionId,String instituteId, CustomUserDetails user) {
        Optional<PackageEntity> optionalPackageEntity = packageRepository.findById(packageId);
        if (optionalPackageEntity.isEmpty()) {
            throw new VacademyException("Package not found");
        }
        Optional<Session> optionalSession = sessionRepository.findById(sessionId);
        if (optionalSession.isEmpty()) {
            throw new VacademyException("Session not found");
        }
        Level level = createOrAddLevel(addLevelWithCourseDTO.getId(), addLevelWithCourseDTO.getNewLevel(), addLevelWithCourseDTO.getLevelName(), addLevelWithCourseDTO.getDurationInDays(), addLevelWithCourseDTO.getThumbnailFileId(),instituteId);
        Group group = null;
        if (addLevelWithCourseDTO.getGroup() != null) {
            group = groupService.addGroup(addLevelWithCourseDTO.getGroup());
        }
        packageSessionService.createPackageSession(level, optionalSession.get(), optionalPackageEntity.get(), group,
                getStartDatePackageSessionDate(packageId, sessionId), instituteId, user,
                addLevelWithCourseDTO.getAddFacultyToCourse(), null,
                addLevelWithCourseDTO.getIsParent(), addLevelWithCourseDTO.getParentId());
        return level.getId();
    }

    public LevelDTO updateLevel(String levelId, LevelDTO levelDTO, CustomUserDetails user) {
        Level level = getLevelById(levelId);

        // Update level name only if the provided value is not null or empty.
        if (levelDTO.getLevelName() != null && !levelDTO.getLevelName().trim().isEmpty()) {
            level.setLevelName(levelDTO.getLevelName());
        }

        // Update duration only if the provided value is not null.
        if (levelDTO.getDurationInDays() != null) {
            level.setDurationInDays(levelDTO.getDurationInDays());
        }
        levelRepository.save(level);
        return new LevelDTO(level);
    }

    /** Largest id list one delete request may carry. */
    public static final int MAX_DELETE_IDS = 500;

    /** Level and session rows every institute shares; nobody may delete them. */
    private static final Set<String> SHARED_ROW_IDS = Set.of("DEFAULT", "INVITED");

    /** Role names of a learner-side login; holding only these does not allow a delete. */
    private static final Set<String> LEARNER_ROLE_NAMES = Set.of("STUDENT", "LEARNER", "PARENT", "GUARDIAN");

    /**
     * Marks DELETED the batches of the caller's institute that sit on the given levels, and the
     * level row itself only when no other institute still uses it. The institute is the clientId
     * header, and a batch is the institute's only when its course was linked to that institute
     * first (a later link, which any institute can add, owns nothing). Every refusal is thrown
     * before the first write.
     */
    @Transactional
    public String deleteLevels(List<String> levelIds, String instituteId, CustomUserDetails user) {
        String institute = requireDeleteCaller(instituteId, user, "Level");
        List<String> ids = cleanDeleteIds(levelIds, "level");

        List<PackageSession> packageSessions = packageSessionRepository.findByLevelIdsAndInstituteId(ids, institute);
        Set<String> ownedLevelIds = new HashSet<>();
        for (PackageSession packageSession : packageSessions) {
            if (packageSession.getLevel() != null) {
                ownedLevelIds.add(packageSession.getLevel().getId());
            }
        }
        requireAllOwned(ids, ownedLevelIds, institute, user, "Level");
        List<String> usedElsewhere = packageSessionRepository.findLevelIdsUsedOutsideInstitute(ids, institute);

        List<String> packageSessionIds = new ArrayList<>();
        for (PackageSession packageSession : packageSessions) {
            packageSession.setStatus(PackageSessionStatusEnum.DELETED.name());
            packageSessionIds.add(packageSession.getId());
        }
        packageSessionRepository.saveAll(packageSessions);

        List<String> retiredLevelIds = new ArrayList<>(ids);
        if (usedElsewhere != null) {
            retiredLevelIds.removeAll(usedElsewhere);
        }
        if (!retiredLevelIds.isEmpty()) {
            List<Level> levels = levelRepository.findAllById(retiredLevelIds);
            for (Level level : levels) {
                level.setStatus(LevelStatusEnum.DELETED.name());
            }
            levelRepository.saveAll(levels);
        }
        log.info("Level delete: user={} institute={} levels={} batches={} levelRowsRetired={}",
                user.getUserId(), institute, ids.size(), packageSessionIds.size(), retiredLevelIds.size());
        // Last on purpose: this call is asynchronous and does not roll back with this method.
        learnerInvitationService.deleteLearnerInvitationBySourceAndSourceId(LearnerInvitationSourceTypeEnum.PACKAGE_SESSION.name(), packageSessionIds);
        return "Levels deleted successfully";
    }

    /**
     * Who may delete levels or sessions: a caller that sent the clientId header and holds, in that
     * institute, at least one role other than the learner ones. The authorities on the principal
     * are loaded for the clientId institute only, so a role (or the root flag) the caller has in
     * another institute counts for nothing here. Returns the trimmed institute id.
     */
    public static String requireDeleteCaller(String instituteId, CustomUserDetails user, String what) {
        if (user == null) {
            throw new ForbiddenException("Access denied: sign in required");
        }
        if (!StringUtils.hasText(instituteId) || "null".equalsIgnoreCase(instituteId.trim())) {
            log.warn("{} delete refused: no clientId header, user={}", what, user.getUserId());
            throw new ForbiddenException("Access denied: clientId header required");
        }
        boolean staffRole = false;
        Collection<? extends GrantedAuthority> authorities = user.getAuthorities();
        if (authorities != null) {
            for (GrantedAuthority authority : authorities) {
                if (authority == null || !StringUtils.hasText(authority.getAuthority())) {
                    continue;
                }
                if (!LEARNER_ROLE_NAMES.contains(authority.getAuthority().trim().toUpperCase())) {
                    staffRole = true;
                    break;
                }
            }
        }
        if (!staffRole) {
            log.warn("{} delete refused: no staff role, user={} institute={}", what, user.getUserId(), instituteId.trim());
            throw new ForbiddenException("Access denied: a staff role in this institute is required");
        }
        return instituteId.trim();
    }

    /** Trims and de-duplicates the ids; 400 for an empty or oversized list and for a shared row. */
    public static List<String> cleanDeleteIds(List<String> rawIds, String what) {
        if (rawIds == null || rawIds.isEmpty()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "At least one " + what + " id is required");
        }
        if (rawIds.size() > MAX_DELETE_IDS) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "Too many " + what + " ids in one request (maximum " + MAX_DELETE_IDS + ")");
        }
        LinkedHashSet<String> ids = new LinkedHashSet<>();
        for (String rawId : rawIds) {
            if (!StringUtils.hasText(rawId)) {
                throw new VacademyException(HttpStatus.BAD_REQUEST, "A " + what + " id is empty");
            }
            String id = rawId.trim();
            if (SHARED_ROW_IDS.contains(id.toUpperCase())) {
                throw new VacademyException(HttpStatus.BAD_REQUEST,
                        "The " + what + " " + id.toUpperCase() + " is shared by every institute and cannot be deleted");
            }
            ids.add(id);
        }
        return new ArrayList<>(ids);
    }

    /** 403 unless every requested id has at least one batch on a course that belongs to the institute. */
    public static void requireAllOwned(List<String> ids, Set<String> ownedIds, String instituteId,
                                       CustomUserDetails user, String what) {
        for (String id : ids) {
            if (!ownedIds.contains(id)) {
                log.warn("{} delete refused: id not used by the institute, user={} institute={} requested={}",
                        what, user.getUserId(), instituteId, ids.size());
                throw new ForbiddenException("Access denied: " + what.toLowerCase() + " does not belong to this institute");
            }
        }
    }

    public List<LevelDTO> getLevelsByInstituteId(String instituteId) {
        return levelRepository.findAllLevelsByInstituteId(instituteId)
                .stream()
                .map(LevelDTO::new)
                .toList();
    }

    private Date getStartDatePackageSessionDate(String packageId, String sessionId) {
        Optional<PackageSession> optionalPackageSession = packageSessionRepository.findLatestPackageSessionByPackageIdAndSessionId(packageId, sessionId);
        if (optionalPackageSession.isEmpty()) {
            return new Date();
        } else {
            return optionalPackageSession.get().getStartTime();
        }
    }


    public void addOrUpdateLevel(AddLevelWithSessionDTO addLevelWithSessionDTO,Session session,PackageEntity packageEntity,String instituteId,CustomUserDetails user){
        Level level = createOrAddLevel(addLevelWithSessionDTO.getId(), addLevelWithSessionDTO.getNewLevel(), addLevelWithSessionDTO.getLevelName(), addLevelWithSessionDTO.getDurationInDays(), addLevelWithSessionDTO.getThumbnailFileId(),instituteId);
        if (addLevelWithSessionDTO.isNewPackageSession()) {
            // Idempotency guard: the (package, session, level) triple must be unique.
            // A re-save of the same course/edit can re-send this batch flagged as
            // "new" (isNewPackageSession=true) even though a non-deleted batch already
            // exists for it. Creating another one spawns a duplicate course card in the
            // catalog (and an orphan if the old session is later deleted). If an existing
            // non-deleted batch is found for this exact triple, reuse it instead of
            // creating a second one.
            Optional<PackageSession> existing = packageSessionRepository
                    .findByPackageIdAndSessionIdAndLevelIdAndStatusIn(
                            packageEntity.getId(), session.getId(), level.getId(),
                            List.of(PackageSessionStatusEnum.ACTIVE.name(),
                                    PackageSessionStatusEnum.HIDDEN.name(),
                                    PackageSessionStatusEnum.DRAFT.name()));
            if (existing.isPresent()) {
                PackageSession existingPs = existing.get();
                // Preserve the existing batch's status when the payload doesn't
                // specify one. A "new batch" payload often omits packageSessionStatus,
                // and updatePackageSession sets status unconditionally — passing null
                // would blank out a live batch.
                String status = StringUtils.hasText(addLevelWithSessionDTO.getPackageSessionStatus())
                        ? addLevelWithSessionDTO.getPackageSessionStatus()
                        : existingPs.getStatus();
                packageSessionService.updatePackageSession(existingPs.getId(), status, instituteId, addLevelWithSessionDTO.getAddFacultyToCourse());
                if (addLevelWithSessionDTO.getSubgroups() != null && !addLevelWithSessionDTO.getSubgroups().isEmpty()) {
                    packageSessionService.syncSubgroupsForParent(existingPs.getId(), addLevelWithSessionDTO.getSubgroups(), instituteId);
                }
                return;
            }
            PackageSession created = packageSessionService.createPackageSession(level, session, packageEntity, null, session.getStartDate(),
                    instituteId, user, addLevelWithSessionDTO.getAddFacultyToCourse(), null,
                    addLevelWithSessionDTO.getIsParent(), addLevelWithSessionDTO.getParentId());
            if (addLevelWithSessionDTO.getSubgroups() != null && !addLevelWithSessionDTO.getSubgroups().isEmpty()) {
                packageSessionService.syncSubgroupsForParent(created.getId(), addLevelWithSessionDTO.getSubgroups(), instituteId);
            }
        } else {
            String packageSessionId = addLevelWithSessionDTO.getPackageSessionId();
            if (StringUtils.hasText(packageSessionId)) {
                packageSessionService.updatePackageSession(packageSessionId, addLevelWithSessionDTO.getPackageSessionStatus(), instituteId, addLevelWithSessionDTO.getAddFacultyToCourse());
                if (addLevelWithSessionDTO.getSubgroups() != null) {
                    packageSessionService.syncSubgroupsForParent(packageSessionId, addLevelWithSessionDTO.getSubgroups(), instituteId);
                }
            }
        }
    }

}
