package vacademy.io.admin_core_service.features.packages.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.course.dto.AddFacultyToCourseDTO;
import vacademy.io.admin_core_service.features.course.dto.SubgroupDTO;
import vacademy.io.admin_core_service.features.enroll_invite.service.DefaultEnrollInviteService;
import vacademy.io.admin_core_service.features.faculty.service.FacultyService;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.learner_invitation.dto.AddLearnerInvitationDTO;
import vacademy.io.admin_core_service.features.learner_invitation.services.LearnerInvitationService;
import vacademy.io.admin_core_service.features.learner_invitation.util.LearnerInvitationDefaultFormGenerator;
import vacademy.io.admin_core_service.features.packages.dto.InventoryStatsDTO;
import vacademy.io.admin_core_service.features.packages.dto.ParentChildBatchMappingResponseDTO;
import vacademy.io.admin_core_service.features.packages.enums.PackageSessionStatusEnum;
import vacademy.io.admin_core_service.features.packages.enums.PackageStatusEnum;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Group;
import vacademy.io.common.institute.entity.Level;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.institute.entity.session.PackageSession;
import vacademy.io.common.institute.entity.session.Session;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.util.StringUtils;

@Slf4j
@Service
@RequiredArgsConstructor
public class PackageSessionService {

    private final PackageSessionRepository packageRepository;
    private final FacultyService facultyService;
    private final LearnerInvitationService learnerInvitationService;
    private final DefaultEnrollInviteService defaultEnrollInviteService;
    private final StudentSessionInstituteGroupMappingRepository studentSessionRepository;
    private final StockHoldService stockHoldService;

    public void createPackageSession(Level level, Session session, PackageEntity packageEntity, Group group,
            Date startTime, String instituteId, CustomUserDetails userDetails,
            List<AddFacultyToCourseDTO> addFacultyToCourseDTOS) {
        createPackageSession(level, session, packageEntity, group, startTime, instituteId, userDetails,
                addFacultyToCourseDTOS, null, null, null);
    }

    public void createPackageSession(Level level, Session session, PackageEntity packageEntity, Group group,
            Date startTime, String instituteId, CustomUserDetails userDetails,
            List<AddFacultyToCourseDTO> addFacultyToCourseDTOS, Integer maxSeats) {
        createPackageSession(level, session, packageEntity, group, startTime, instituteId, userDetails,
                addFacultyToCourseDTOS, maxSeats, null, null);
    }

    public PackageSession createPackageSession(Level level, Session session, PackageEntity packageEntity, Group group,
            Date startTime, String instituteId, CustomUserDetails userDetails,
            List<AddFacultyToCourseDTO> addFacultyToCourseDTOS, Integer maxSeats, Boolean isParent, String parentId) {
        PackageSession packageSession = new PackageSession();
        packageSession.setSession(session);
        packageSession.setLevel(level);
        packageSession.setPackageEntity(packageEntity);
        packageSession.setStatus(PackageStatusEnum.ACTIVE.name());
        packageSession.setStartTime(startTime);
        packageSession.setGroup(group);
        packageSession.setIsParent(isParent != null ? isParent : false);
        packageSession.setParentId(parentId);

        if (maxSeats != null) {
            packageSession.setMaxSeats(maxSeats);
            packageSession.setAvailableSlots(maxSeats);
        }

        packageSession = packageRepository.save(packageSession);
        createDefaultInvitationForm(packageSession, instituteId, userDetails);
        facultyService.addFacultyToBatch(addFacultyToCourseDTOS, packageSession.getId(), instituteId);
        defaultEnrollInviteService.createDefaultEnrollInvite(packageSession, instituteId);
        createLearnerInvitationForm(List.of(packageSession), instituteId, userDetails);
        return packageSession;
    }

    @Transactional
    public PackageSession updateInventory(String packageSessionId, Integer maxSeats, Integer availableSlots) {
        PackageSession packageSession = findById(packageSessionId);

        Integer currentMax = packageSession.getMaxSeats();
        Integer currentAvailable = packageSession.getAvailableSlots();

        // If admin is directly setting availableSlots (e.g., new books arrived, donated, damaged)
        if (availableSlots != null) {
            packageSession.setAvailableSlots(availableSlots);
            log.info("Admin directly set availableSlots to {} for packageSession {}", availableSlots, packageSessionId);
        }

        if (maxSeats == null && availableSlots == null) {
            // Switching to unlimited
            packageSession.setMaxSeats(null);
            packageSession.setAvailableSlots(null);
        } else if (maxSeats != null) {
            // Switching to limited or updating limit
            if (currentMax == null && availableSlots == null) {
                // Was unlimited, now limited.
                // We must check current usage to set accurate available slots.
                long currentEnrollments = studentSessionRepository.countByPackageSessionIdAndStatus(packageSessionId,
                        "ACTIVE");

                int newAvailable = maxSeats - (int) currentEnrollments;
                if (newAvailable < 0) {
                    // If we are already overbooked, we set available to 0.
                    // The admin is setting a limit lower than current students.
                    newAvailable = 0;
                }
                packageSession.setAvailableSlots(newAvailable);

            } else if (availableSlots == null) {
                // Adjust available slots by the difference (only if admin didn't directly set availableSlots)
                int diff = maxSeats - (currentMax != null ? currentMax : 0);
                if (currentAvailable == null) {
                    // Should not happen if maxSeats was not null, but for safety:
                    long currentEnrollments = studentSessionRepository
                            .countByPackageSessionIdAndStatus(packageSessionId, "ACTIVE");
                    int newAvailable = maxSeats - (int) currentEnrollments;
                    packageSession.setAvailableSlots(Math.max(newAvailable, 0));
                } else {
                    packageSession.setAvailableSlots(Math.max(currentAvailable + diff, 0));
                }
            }
            packageSession.setMaxSeats(maxSeats);
        }

        return packageRepository.save(packageSession);
    }

    // Every stock change below is one conditional UPDATE (PackageSessionRepository), not a
    // read-modify-save: two enrollments for the last copy can no longer both read "1 left",
    // and a version clash can no longer roll back the payment webhook that called us.

    @Transactional
    public void reserveSlot(String packageSessionId) {
        if (packageRepository.takeAvailableSlots(packageSessionId, 1) == 1) {
            return;
        }
        PackageSessionRepository.StockInfoProjection stock = stockInfo(packageSessionId);
        if (stock.getMaxSeats() == null) {
            return; // Unlimited
        }
        throw new ConflictException("No slots available");
    }

    @Transactional
    public void releaseSlot(String packageSessionId) {
        PackageSessionRepository.StockInfoProjection stock = stockInfo(packageSessionId); // not found -> same error as before
        if (stock.getMaxSeats() == null || stock.getAvailableSlots() == null) {
            return; // Unlimited, or no count kept yet: nothing to give back, as before
        }
        packageRepository.giveBackAvailableSlots(packageSessionId, 1);
    }

    /**
     * Decrements available slots when a user enrolls in a package session (borrows a book).
     * - If maxSeats is null (unlimited), we skip inventory update.
     * - If available slots are insufficient, we log a warning but do NOT block the enrollment
     *   (stops at 0, as before).
     *
     * @param packageSessionId the package session being enrolled into
     * @param count            number of slots to decrement (usually 1)
     */
    @Transactional
    public void decrementAvailability(String packageSessionId, int count) {
        if (count <= 0) {
            return;
        }
        if (packageRepository.decrementAvailableSlotsClamped(packageSessionId, count) == 1) {
            log.info("Decremented inventory for packageSession {} by {} (stops at 0)", packageSessionId, count);
            return;
        }
        // No throw from here on: these run inside enrollment / webhook transactions, and an
        // exception leaving this @Transactional method marks that whole transaction
        // rollback-only even when the caller catches it.
        PackageSessionRepository.StockInfoProjection stock = findStockInfo(packageSessionId);
        if (stock == null) {
            log.warn("Inventory decrement skipped — packageSession {} not found", packageSessionId);
            return;
        }
        if (stock.getMaxSeats() == null) {
            log.debug("Skipping inventory decrement for packageSession {} — unlimited seats", packageSessionId);
            return;
        }
        log.warn("Inventory decrement skipped for packageSession {} — availableSlots is {} but enrollment proceeding",
                packageSessionId, stock.getAvailableSlots());
    }

    /**
     * Increments available slots when a user returns a book / is de-assigned.
     * - If maxSeats is null (unlimited), we skip.
     * - Caps at maxSeats to prevent exceeding total stock.
     *
     * @param packageSessionId the package session being returned
     * @param count            number of slots to increment (usually 1)
     */
    @Transactional
    public void incrementAvailability(String packageSessionId, int count) {
        if (count <= 0) {
            return;
        }
        if (packageRepository.giveBackAvailableSlots(packageSessionId, count) == 1) {
            log.info("Incremented inventory for packageSession {} by {} (capped at maxSeats)", packageSessionId, count);
            return;
        }
        if (findStockInfo(packageSessionId) == null) {
            log.warn("Inventory increment skipped — packageSession {} not found", packageSessionId);
            return;
        }
        log.debug("Skipping inventory increment for packageSession {} — unlimited seats", packageSessionId);
    }

    /** Fresh stock read (never a stale entity); throws like {@link #findById} when the session is missing. */
    private PackageSessionRepository.StockInfoProjection stockInfo(String packageSessionId) {
        PackageSessionRepository.StockInfoProjection stock = findStockInfo(packageSessionId);
        if (stock == null) {
            throw new VacademyException("Package Session not found");
        }
        return stock;
    }

    private PackageSessionRepository.StockInfoProjection findStockInfo(String packageSessionId) {
        if (packageSessionId == null) {
            return null;
        }
        List<PackageSessionRepository.StockInfoProjection> rows =
                packageRepository.findStockInfoByIds(List.of(packageSessionId));
        return rows.isEmpty() ? null : rows.get(0);
    }

    public java.util.Map<String, Object> getAvailability(String packageSessionId) {
        PackageSession packageSession = findById(packageSessionId);
        java.util.Map<String, Object> map = new java.util.HashMap<>();
        map.put("packageSessionId", packageSessionId);
        map.put("maxSeats", packageSession.getMaxSeats());
        map.put("availableSlots", packageSession.getAvailableSlots());
        map.put("isUnlimited", packageSession.getMaxSeats() == null);
        // Stock taken by checkouts still being paid for; already out of availableSlots.
        map.put("held_slots", packageSession.getMaxSeats() == null ? 0
                : stockHoldService.heldQuantity(packageSessionId));
        return map;
    }

    public java.util.Map<String, java.util.Map<String, Object>> getBatchAvailability(List<String> packageSessionIds) {
        java.util.Map<String, java.util.Map<String, Object>> result = new java.util.HashMap<>();
        if (packageSessionIds == null || packageSessionIds.isEmpty()) {
            return result;
        }
        List<PackageSession> sessions = packageRepository.findAllById(packageSessionIds);
        // One grouped query for the whole page instead of one per session.
        java.util.Map<String, Integer> heldBySession = stockHoldService.heldQuantities(sessions.stream()
                .filter(ps -> ps.getMaxSeats() != null)
                .map(PackageSession::getId)
                .toList());
        for (PackageSession ps : sessions) {
            java.util.Map<String, Object> map = new java.util.HashMap<>();
            map.put("packageSessionId", ps.getId());
            map.put("maxSeats", ps.getMaxSeats());
            map.put("availableSlots", ps.getAvailableSlots());
            map.put("isUnlimited", ps.getMaxSeats() == null);
            map.put("held_slots", heldBySession.getOrDefault(ps.getId(), 0));
            result.put(ps.getId(), map);
        }
        return result;
    }

    public InventoryStatsDTO getInventoryStats(String instituteId) {
        PackageSessionRepository.InventoryStatsProjection projection =
                packageRepository.getInventoryStats(instituteId, List.of("ACTIVE"));
        return new InventoryStatsDTO(
                projection.getTotalSessions(),
                projection.getUnlimitedSessions(),
                projection.getLimitedSessions(),
                projection.getTotalCapacity(),
                projection.getTotalAvailable(),
                projection.getCriticalSessions(),
                projection.getLowAvailabilitySessions()
        );
    }

    @Async
    private void createDefaultInvitationForm(PackageSession packageSession, String instituteId,
            CustomUserDetails userDetails) {
        AddLearnerInvitationDTO learnerInvitationDTO = LearnerInvitationDefaultFormGenerator
                .generateSampleInvitation(packageSession, instituteId);
        learnerInvitationService.createLearnerInvitationCode(learnerInvitationDTO, userDetails);
    }

    public PackageSession updatePackageSession(String packageSessionId, String status, String instituteId,
            List<AddFacultyToCourseDTO> addFacultyToCourseDTOS) {
        PackageSession packageSession = packageRepository.findById(packageSessionId)
                .orElseThrow(() -> new VacademyException("Package session not found: " + packageSessionId));
        packageSession.setStatus(status);
        packageRepository.save(packageSession);
        facultyService.updateFacultyToSubjectPackageSession(addFacultyToCourseDTOS, packageSessionId, instituteId);
        return packageSession;
    }

    @Async
    public void createLearnerInvitationForm(List<PackageSession> packageSessions, String instituteId,
            CustomUserDetails userDetails) {
        List<AddLearnerInvitationDTO> addLearnerInvitationDTOS = new ArrayList<>();
        for (PackageSession packageSession : packageSessions) {
            AddLearnerInvitationDTO addLearnerInvitationDTO = LearnerInvitationDefaultFormGenerator
                    .generateSampleInvitation(packageSession, instituteId);
            addLearnerInvitationDTOS.add(addLearnerInvitationDTO);
        }
        learnerInvitationService.createLearnerInvitationCodes(addLearnerInvitationDTOS, userDetails);
    }

    public PackageSession findById(String id) {
        return packageRepository.findById(id).orElseThrow(() -> new VacademyException("Package Session not found"));
    }

    public List<PackageSession> findAllByIds(List<String> ids) {
        return packageRepository.findAllById(ids);
    }

    public void addInvitedPackageSessionForPackage(PackageEntity packageEntity) {
        Session session = new Session();
        Level level = new Level();
        session.setId("INVITED");
        level.setId("INVITED");
        PackageSession packageSession = new PackageSession();
        packageSession.setSession(session);
        packageSession.setLevel(level);
        packageSession.setPackageEntity(packageEntity);
        packageSession.setStatus(PackageSessionStatusEnum.INVITED.name());
        packageRepository.save(packageSession);
    }

    /**
     * Mark a package session as parent and assign one or more children by setting their parent_id.
     *
     * This is intentionally conservative:
     * - Validates that parent + children all belong to the given institute.
     * - Ensures parent is marked isParent = true and parentId = null.
     * - Sets parentId = parentPackageSessionId for each selected child.
     * - Does NOT automatically clear parentId from non-selected children.
     */
    @Transactional
    public ParentChildBatchMappingResponseDTO mapParentAndChildren(
            String instituteId,
            String parentPackageSessionId,
            List<String> childPackageSessionIds) {

        if (parentPackageSessionId == null || parentPackageSessionId.isBlank()) {
            throw new VacademyException("parentPackageSessionId is required");
        }

        // Normalize child IDs (allow null/empty list)
        List<String> safeChildIds = childPackageSessionIds != null ? childPackageSessionIds : List.of();

        // Build full set of IDs (parent + children), ensuring uniqueness
        Set<String> allIds = new HashSet<>();
        allIds.add(parentPackageSessionId);
        allIds.addAll(safeChildIds);

        // Fetch all sessions for this institute in a single query
        List<PackageSession> sessions = packageRepository
                .findPackageSessionsByInstituteIdAndIds(instituteId, new ArrayList<>(allIds));

        if (sessions.size() != allIds.size()) {
            throw new VacademyException("One or more package sessions not found for institute " + instituteId);
        }

        // Locate parent
        PackageSession parent = sessions.stream()
                .filter(ps -> ps.getId().equals(parentPackageSessionId))
                .findFirst()
                .orElseThrow(() -> new VacademyException("Parent package session not found"));

        // Mark parent
        parent.setIsParent(true);
        parent.setParentId(null);

        // Assign children
        for (PackageSession ps : sessions) {
            if (safeChildIds.contains(ps.getId())) {
                if (ps.getId().equals(parentPackageSessionId)) {
                    continue; // skip if someone accidentally selected parent as child
                }
                ps.setParentId(parentPackageSessionId);
            }
        }

        packageRepository.saveAll(sessions);

        return new ParentChildBatchMappingResponseDTO(
                parentPackageSessionId,
                safeChildIds.size(),
                safeChildIds
        );
    }

    /**
     * Sync child package sessions (subgroups) for a parent batch to match the requested list.
     * Used when editing course: update existing (by id), add new, remove ones no longer in the list.
     * - Subgroup with id: update that package_session's name (edit); if not found, create new.
     * - Subgroup without id: create new child batch.
     * - Existing children whose id is not in the list: mark DELETED.
     * Backward compatible: null or empty subgroups = remove all children (leave parent as-is).
     */
    @Transactional
    public void syncSubgroupsForParent(String parentPackageSessionId, List<SubgroupDTO> subgroups, String instituteId) {
        PackageSession parent = findById(parentPackageSessionId);
        List<PackageSession> existingChildren = packageRepository.findByParentIdAndStatusIn(
                parentPackageSessionId, List.of(PackageSessionStatusEnum.ACTIVE.name()));

        List<SubgroupDTO> requested = (subgroups != null ? subgroups : List.<SubgroupDTO>of()).stream()
                .filter(s -> s != null && StringUtils.hasText(s.getName()))
                .toList();

        List<String> keptChildIds = new ArrayList<>();

        for (SubgroupDTO s : requested) {
            String name = s.getName().trim();
            if (StringUtils.hasText(s.getId())) {
                var existingOpt = existingChildren.stream()
                        .filter(c -> s.getId().equals(c.getId()))
                        .findFirst();
                if (existingOpt.isPresent()) {
                    PackageSession child = existingOpt.get();
                    child.setName(name);
                    packageRepository.save(child);
                    keptChildIds.add(child.getId());
                } else {
                    PackageSession child = createChildPackageSession(parent, name, instituteId);
                    keptChildIds.add(child.getId());
                }
            } else {
                PackageSession child = createChildPackageSession(parent, name, instituteId);
                keptChildIds.add(child.getId());
            }
        }

        for (PackageSession child : existingChildren) {
            if (!keptChildIds.contains(child.getId())) {
                child.setStatus(PackageSessionStatusEnum.DELETED.name());
                packageRepository.save(child);
            }
        }

        if (!keptChildIds.isEmpty()) {
            mapParentAndChildren(instituteId, parentPackageSessionId, keptChildIds);
        } else {
            parent.setIsParent(false);
            parent.setParentId(null);
            packageRepository.save(parent);
        }
    }

    private PackageSession createChildPackageSession(PackageSession parent, String name, String instituteId) {
        PackageSession child = new PackageSession();
        child.setPackageEntity(parent.getPackageEntity());
        child.setLevel(parent.getLevel());
        child.setSession(parent.getSession());
        child.setGroup(parent.getGroup());
        child.setStatus(PackageSessionStatusEnum.ACTIVE.name());
        child.setStartTime(parent.getStartTime());
        child.setIsParent(false);
        child.setParentId(null);
        child.setName(name);
        child.setMaxSeats(parent.getMaxSeats());
        child.setAvailableSlots(parent.getAvailableSlots());
        child = packageRepository.save(child);
        defaultEnrollInviteService.createDefaultEnrollInvite(child, instituteId);
        return child;
    }
}
