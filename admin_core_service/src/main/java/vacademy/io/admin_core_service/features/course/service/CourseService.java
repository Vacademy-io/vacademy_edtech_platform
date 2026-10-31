package vacademy.io.admin_core_service.features.course.service;

import org.springframework.transaction.annotation.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.course.dto.AddCourseDTO;
import vacademy.io.admin_core_service.features.course.dto.AddFacultyToCourseDTO;
import vacademy.io.admin_core_service.features.enroll_invite.repository.PackageSessionLearnerInvitationToPaymentOptionRepository;
import vacademy.io.admin_core_service.features.enroll_invite.service.DefaultEnrollInviteService;
import vacademy.io.admin_core_service.features.faculty.service.FacultyService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.learner_invitation.enums.LearnerInvitationSourceTypeEnum;
import vacademy.io.admin_core_service.features.learner_invitation.services.LearnerInvitationService;
import vacademy.io.admin_core_service.features.level.service.LevelService;
import vacademy.io.admin_core_service.features.packages.enums.PackageSessionStatusEnum;
import vacademy.io.admin_core_service.features.packages.enums.PackageStatusEnum;
import vacademy.io.admin_core_service.features.packages.repository.PackageInstituteRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.packages.service.PackagePageContentService;
import vacademy.io.admin_core_service.features.packages.service.PackageService;
import vacademy.io.admin_core_service.features.packages.service.PackageSessionService;
import vacademy.io.admin_core_service.features.session.dto.AddNewSessionDTO;
import vacademy.io.admin_core_service.features.course.dto.CourseBatchDTO;
import vacademy.io.admin_core_service.features.session.service.SessionService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.dto.PackageDTO;
import vacademy.io.common.institute.entity.Level;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.institute.entity.PackageInstitute;
import vacademy.io.common.institute.entity.session.PackageSession;
import vacademy.io.common.institute.entity.session.Session;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.stream.Collectors;
import org.springframework.util.StringUtils;

@Service
@RequiredArgsConstructor
public class CourseService {

    private static final org.slf4j.Logger log =
            org.slf4j.LoggerFactory.getLogger(CourseService.class);

    private final PackageRepository packageRepository;
    private final LevelService levelService;
    private final PackageSessionService packageSessionService;
    private final SessionService sessionService;
    private final PackageInstituteRepository packageInstituteRepository;
    private final InstituteRepository instituteRepository;
    private final PackageSessionRepository packageSessionRepository;
    private final LearnerInvitationService learnerInvitationService;
    private final FacultyService facultyService;
    private final PackageService packageService;
    private final PackageSessionLearnerInvitationToPaymentOptionRepository packageSessionLearnerInvitationToPaymentOptionRepository;
    private final vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository enrollInviteRepository;
    private final DefaultEnrollInviteService defaultEnrollInviteService;
    private final vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService workflowTriggerService;
    private final PackagePageContentService packagePageContentService;

    @Transactional
    public String addCourse(AddCourseDTO addCourseDTO, CustomUserDetails user, String instituteId) {
        PackageEntity savedPackage;

        // Reject a malformed course_page_json (HTTP 400) before anything is written.
        PackagePageContentService.validate(addCourseDTO.getCoursePageJson());

        // Set created_by_user_id from user context if not already set in DTO
        if (!StringUtils.hasText(addCourseDTO.getCreatedByUserId()) && user != null) {
            addCourseDTO.setCreatedByUserId(user.getId());
        }

        if (addCourseDTO.getNewCourse()) {
            savedPackage = getCourse(addCourseDTO, instituteId);
        } else {
            savedPackage = packageRepository.findById(addCourseDTO.getId())
                    .orElseThrow(() -> new VacademyException("Package not found"));
            updateCourseDetails(addCourseDTO, savedPackage);
        }

        savedPackage = packageRepository.save(savedPackage);
        createPackageInstitute(savedPackage, instituteId);

        if (Boolean.TRUE.equals(addCourseDTO.getNewCourse())) {
            packagePageContentService.applyOnCreate(savedPackage.getId(), addCourseDTO.getCoursePageJson());
        } else {
            packagePageContentService.applyOnUpdate(savedPackage.getId(), addCourseDTO.getCoursePageJson());
        }

        if (addCourseDTO.getContainLevels()) {
            createPackageSession(savedPackage, addCourseDTO.getSessions(), user, instituteId);
        } else {
            createPackageSessionForDefaultLevelAndSession(savedPackage, addCourseDTO.getAddFacultyToCourse(),
                    instituteId, user);
        }

        // Optionally create subgroup package sessions and map parent/children.
        handleSubgroups(savedPackage, addCourseDTO, instituteId, user);

        // Fire COURSE_CREATED workflow trigger so admin-team recipes can react
        // (e.g. notify the teaching team that a new course is published).
        // Only fires for genuinely new courses, not updates. Wrapped so a
        // workflow failure can't undo the course creation.
        if (Boolean.TRUE.equals(addCourseDTO.getNewCourse())
                && instituteId != null && !instituteId.isBlank()) {
            try {
                java.util.Map<String, Object> ctx = new java.util.HashMap<>();
                ctx.put("packageId", savedPackage.getId());
                ctx.put("packageName", savedPackage.getPackageName());
                ctx.put("createdByUserId", addCourseDTO.getCreatedByUserId());
                workflowTriggerService.handleTriggerEvents(
                        vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent.COURSE_CREATED.name(),
                        savedPackage.getId(),
                        instituteId,
                        ctx);
            } catch (Exception wfe) {
                log.warn("Failed to trigger COURSE_CREATED for package {}: {}",
                        savedPackage.getId(), wfe.getMessage());
            }
        }

        return savedPackage.getId();
    }

    private void createPackageSessionForDefaultLevelAndSession(PackageEntity savedPackage,
            List<AddFacultyToCourseDTO> addFacultyToCourseDTOS,
            String instituteId,
            CustomUserDetails user) {
        Level level = levelService.getLevelById("DEFAULT");
        Session session = sessionService.getSessionById("DEFAULT");
        packageSessionService.createPackageSession(level, session, savedPackage, null, new Date(), instituteId, user,
                addFacultyToCourseDTOS);
    }

    private void createPackageSession(PackageEntity savedPackage,
            List<AddNewSessionDTO> addNewSessionDTOS,
            CustomUserDetails user,
            String instituteId) {
        if (Objects.isNull(addNewSessionDTOS) || addNewSessionDTOS.isEmpty()) {
            throw new VacademyException(
                    "Levels and Sessions cannot be null or empty. You must provide at least one level.");
        }

        for (AddNewSessionDTO addNewSessionDTO : addNewSessionDTOS) {
            addNewSessionDTO.getLevels().forEach(level -> level.setPackageId(savedPackage.getId()));
            sessionService.addNewSession(addNewSessionDTO, instituteId, user);
        }
    }

    /**
     * If the request declares that the course contains subgroups, create additional
     * package sessions for each subgroup and map them as children under a parent
     * batch using PackageSessionService.mapParentAndChildren.
     *
     * Backward compatible: if contains_subgroup is null/false or no subgroups
     * are provided, this is a no-op.
     */
    private void handleSubgroups(PackageEntity savedPackage,
                                 AddCourseDTO addCourseDTO,
                                 String instituteId,
                                 CustomUserDetails user) {
        // Backward-compatible handler for legacy payloads where subgroups are sent
        // at the root level of AddCourseDTO (course-wide subgroups).
        // Newer payloads should prefer nested subgroups on AddLevelWithSessionDTO;
        // those are handled inside SessionService.createPackageSession.
        if (addCourseDTO == null
                || addCourseDTO.getContainsSubgroup() == null
                || !addCourseDTO.getContainsSubgroup()
                || addCourseDTO.getSubgroups() == null
                || addCourseDTO.getSubgroups().isEmpty()) {
            return;
        }

        // Choose a parent batch for this course: the first ACTIVE package session.
        List<PackageSession> activeSessionsForCourse = packageSessionRepository
                .findByPackageEntity_IdAndStatus(savedPackage.getId(), PackageSessionStatusEnum.ACTIVE.name());

        if (activeSessionsForCourse == null || activeSessionsForCourse.isEmpty()) {
            // No active sessions to attach subgroups to; nothing to do.
            return;
        }

        PackageSession parent = activeSessionsForCourse.get(0);

        List<String> childIds = new ArrayList<>();

        addCourseDTO.getSubgroups().forEach(subgroupDTO -> {
            if (subgroupDTO == null || !org.springframework.util.StringUtils.hasText(subgroupDTO.getName())) {
                return;
            }

            PackageSession child = new PackageSession();
            child.setPackageEntity(parent.getPackageEntity());
            child.setLevel(parent.getLevel());
            child.setSession(parent.getSession());
            child.setGroup(parent.getGroup());
            child.setStatus(PackageSessionStatusEnum.ACTIVE.name());
            child.setStartTime(parent.getStartTime());
            child.setIsParent(false);
            child.setParentId(null);
            child.setName(subgroupDTO.getName());

            // Copy inventory if present on parent
            child.setMaxSeats(parent.getMaxSeats());
            child.setAvailableSlots(parent.getAvailableSlots());

            child = packageSessionRepository.save(child);
            defaultEnrollInviteService.createDefaultEnrollInvite(child, instituteId);
            childIds.add(child.getId());
        });

        if (childIds.isEmpty()) {
            return;
        }

        // Mark parent and assign children in a validated, institute-aware way.
        packageSessionService.mapParentAndChildren(instituteId, parent.getId(), childIds);
    }

    private void validateRequest(AddCourseDTO addCourseDTO) {
        if (Objects.isNull(addCourseDTO) || Objects.isNull(addCourseDTO.getCourseName())) {
            throw new VacademyException("Invalid request: Course name cannot be null");
        }
    }

    public PackageEntity getCourse(AddCourseDTO addCourseDTO, String instituteId) {
        validateRequest(addCourseDTO);
        if (Boolean.TRUE.equals(addCourseDTO.getForceNewCourse())) {
            // Never merge into an existing same-named course: uniquify the name
            // instead. AI-generated names are deterministic (derived from the
            // source material), so without this a regeneration silently appends
            // its chapters into the previous run's course.
            String baseName = addCourseDTO.getCourseName();
            String candidate = baseName;
            for (int n = 2; n <= 50 && packageRepository
                    .findTopByPackageNameAndSessionStatusAndInstitute(candidate,
                            List.of(PackageStatusEnum.ACTIVE.name(), PackageSessionStatusEnum.HIDDEN.name()),
                            List.of(PackageStatusEnum.ACTIVE.name(), PackageStatusEnum.DRAFT.name()),
                            instituteId)
                    .isPresent(); n++) {
                candidate = baseName + " (" + n + ")";
            }
            addCourseDTO.setCourseName(candidate);
        } else {
            Optional<PackageEntity> optionalPackageEntity = packageRepository
                    .findTopByPackageNameAndSessionStatusAndInstitute(addCourseDTO.getCourseName(),
                            List.of(PackageStatusEnum.ACTIVE.name(), PackageSessionStatusEnum.HIDDEN.name()),
                            List.of(PackageStatusEnum.ACTIVE.name(), PackageStatusEnum.DRAFT.name()),
                            instituteId);
            if (optionalPackageEntity.isPresent()) {
                return optionalPackageEntity.get();
            }
        }
        PackageEntity packageEntity = new PackageEntity();
        packageEntity.setPackageName(addCourseDTO.getCourseName());
        packageEntity.setThumbnailFileId(addCourseDTO.getThumbnailFileId());

        // Set status - default to DRAFT for teacher approval workflow
        if (StringUtils.hasText(addCourseDTO.getStatus())) {
            packageEntity.setStatus(addCourseDTO.getStatus());
        } else {
            packageEntity.setStatus(PackageStatusEnum.ACTIVE.name());
        }

        // Set created by user ID for teacher approval workflow
        if (StringUtils.hasText(addCourseDTO.getCreatedByUserId())) {
            packageEntity.setCreatedByUserId(addCourseDTO.getCreatedByUserId());
        }

        // Set original course ID if this is a copy
        if (StringUtils.hasText(addCourseDTO.getOriginalCourseId())) {
            packageEntity.setOriginalCourseId(addCourseDTO.getOriginalCourseId());
        }

        // Set version number
        if (addCourseDTO.getVersionNumber() != null) {
            packageEntity.setVersionNumber(addCourseDTO.getVersionNumber());
        } else {
            packageEntity.setVersionNumber(1); // Default version
        }

        packageEntity.setIsCoursePublishedToCatalaouge(addCourseDTO.getIsCoursePublishedToCatalaouge());
        packageEntity.setCoursePreviewImageMediaId(addCourseDTO.getCoursePreviewImageMediaId());
        packageEntity.setCourseBannerMediaId(addCourseDTO.getCourseBannerMediaId());
        packageEntity.setCourseMediaId(addCourseDTO.getCourseMediaId());
        packageEntity.setWhyLearn(addCourseDTO.getWhyLearnHtml());
        packageEntity.setWhoShouldLearn(addCourseDTO.getWhoShouldLearnHtml());
        packageEntity.setAboutTheCourse(addCourseDTO.getAboutTheCourseHtml());

        if (addCourseDTO.getTags() != null && !addCourseDTO.getTags().isEmpty()) {
            packageEntity.setTags(addCourseDTO.getTags().stream()
                    .map(String::trim)
                    .collect(Collectors.joining(",")));
        }

        packageEntity.setCourseDepth(addCourseDTO.getCourseDepth());
        packageEntity.setCourseHtmlDescription(addCourseDTO.getCourseHtmlDescription());
        if (StringUtils.hasText(addCourseDTO.getCourseSetting())) {
            packageEntity.setCourseSetting(addCourseDTO.getCourseSetting());
        }
        PackageEntity savedPackage = packageRepository.save(packageEntity);
        packageSessionService.addInvitedPackageSessionForPackage(savedPackage);
        return savedPackage;
    }

    public PackageEntity updateCourseDetails(AddCourseDTO addCourseDTO, PackageEntity packageEntity) {
        validateRequest(addCourseDTO);

        if (isNotBlank(addCourseDTO.getCourseName())) {
            packageEntity.setPackageName(addCourseDTO.getCourseName());
        }

        if (isNotBlank(addCourseDTO.getThumbnailFileId())) {
            packageEntity.setThumbnailFileId(addCourseDTO.getThumbnailFileId());
        }

        // Update status if provided
        if (StringUtils.hasText(addCourseDTO.getStatus())) {
            packageEntity.setStatus(addCourseDTO.getStatus());
        }

        // Update created by user ID if provided (usually shouldn't change, but for
        // completeness)
        if (StringUtils.hasText(addCourseDTO.getCreatedByUserId())) {
            packageEntity.setCreatedByUserId(addCourseDTO.getCreatedByUserId());
        }

        // Update original course ID if provided (for copy operations)
        if (StringUtils.hasText(addCourseDTO.getOriginalCourseId())) {
            packageEntity.setOriginalCourseId(addCourseDTO.getOriginalCourseId());
        }

        // Update version number if provided
        if (addCourseDTO.getVersionNumber() != null) {
            packageEntity.setVersionNumber(addCourseDTO.getVersionNumber());
        }

        if (addCourseDTO.getIsCoursePublishedToCatalaouge() != null) {
            packageEntity.setIsCoursePublishedToCatalaouge(addCourseDTO.getIsCoursePublishedToCatalaouge());
        }

        if (isNotBlank(addCourseDTO.getCoursePreviewImageMediaId())) {
            packageEntity.setCoursePreviewImageMediaId(addCourseDTO.getCoursePreviewImageMediaId());
        }

        if (isNotBlank(addCourseDTO.getCourseBannerMediaId())) {
            packageEntity.setCourseBannerMediaId(addCourseDTO.getCourseBannerMediaId());
        }

        if (isNotBlank(addCourseDTO.getCourseMediaId())) {
            packageEntity.setCourseMediaId(addCourseDTO.getCourseMediaId());
        }

        if (isNotBlank(addCourseDTO.getWhyLearnHtml())) {
            packageEntity.setWhyLearn(addCourseDTO.getWhyLearnHtml());
        }

        if (isNotBlank(addCourseDTO.getWhoShouldLearnHtml())) {
            packageEntity.setWhoShouldLearn(addCourseDTO.getWhoShouldLearnHtml());
        }

        if (isNotBlank(addCourseDTO.getAboutTheCourseHtml())) {
            packageEntity.setAboutTheCourse(addCourseDTO.getAboutTheCourseHtml());
        }

        if (addCourseDTO.getTags() != null && !addCourseDTO.getTags().isEmpty()) {
            packageEntity.setTags(addCourseDTO.getTags().stream()
                    .map(String::toLowerCase)
                    .map(String::trim)
                    .collect(Collectors.joining(",")));
        }

        if (addCourseDTO.getCourseDepth() != null) {
            packageEntity.setCourseDepth(addCourseDTO.getCourseDepth());
        }

        if (isNotBlank(addCourseDTO.getCourseHtmlDescription())) {
            packageEntity.setCourseHtmlDescription(addCourseDTO.getCourseHtmlDescription());
        }

        if (isNotBlank(addCourseDTO.getCourseSetting())) {
            packageEntity.setCourseSetting(addCourseDTO.getCourseSetting());
        }

        return packageRepository.save(packageEntity);
    }

    private boolean isNotBlank(String str) {
        return str != null && !str.trim().isEmpty();
    }

    private PackageInstitute createPackageInstitute(PackageEntity packageEntity, String instituteId) {
        return packageInstituteRepository.findByPackageIdAndInstituteId(packageEntity.getId(), instituteId)
                .orElseGet(() -> {
                    PackageInstitute packageInstitute = new PackageInstitute();
                    packageInstitute.setPackageEntity(packageEntity);
                    packageInstitute.setInstituteEntity(instituteRepository.findById(instituteId)
                            .orElseThrow(() -> new VacademyException("Institute not found with ID: " + instituteId)));
                    return packageInstituteRepository.save(packageInstitute);
                });
    }

    public String updateCourse(PackageDTO packageDTO, CustomUserDetails user, String packageId) {
        PackageEntity packageEntity = packageRepository.findById(packageId)
                .orElseThrow(() -> new VacademyException("Course not found"));

        packageEntity.setPackageName(packageDTO.getPackageName());
        packageEntity.setThumbnailFileId(packageDTO.getThumbnailFileId());
        packageEntity.setIsCoursePublishedToCatalaouge(packageDTO.getIsCoursePublishedToCatalaouge());
        packageEntity.setCoursePreviewImageMediaId(packageDTO.getCoursePreviewImageMediaId());
        packageEntity.setCourseBannerMediaId(packageDTO.getCourseBannerMediaId());
        packageEntity.setCourseMediaId(packageDTO.getCourseMediaId());
        packageEntity.setWhyLearn(packageDTO.getWhyLearnHtml());
        packageEntity.setWhoShouldLearn(packageDTO.getWhoShouldLearnHtml());
        packageEntity.setAboutTheCourse(packageDTO.getAboutTheCourseHtml());

        if (packageDTO.getTags() != null && !packageDTO.getTags().isEmpty()) {
            packageEntity.setTags(packageDTO.getTags().stream()
                    .map(String::toLowerCase)
                    .map(String::trim)
                    .collect(Collectors.joining(",")));
        } else {
            packageEntity.setTags(null);
        }

        packageEntity.setCourseDepth(packageDTO.getCourseDepth());
        packageEntity.setCourseHtmlDescription(packageDTO.getCourseHtmlDescriptionHtml());

        packageRepository.save(packageEntity);
        return "Course updated successfully";
    }

    public String deleteCourses(List<String> courseIds, CustomUserDetails userDetails) {
        List<PackageEntity> courses = packageRepository.findAllById(courseIds);
        courses.forEach(course -> course.setStatus(PackageStatusEnum.DELETED.name()));
        packageRepository.saveAll(courses);

        List<PackageSession> packageSessions = packageSessionRepository.findAllByPackageIds(courseIds);
        List<String> packageSessionIds = new ArrayList<>();

        for (PackageSession packageSession : packageSessions) {
            packageSession.setStatus(PackageStatusEnum.DELETED.name());
            packageSessionIds.add(packageSession.getId());
        }

        packageSessionRepository.saveAll(packageSessions);
        
        // Delete learner invitations for these package sessions
        learnerInvitationService.deleteLearnerInvitationBySourceAndSourceId(
                LearnerInvitationSourceTypeEnum.PACKAGE_SESSION.name(), packageSessionIds);

        // Handle enroll_invite cleanup
        if (!packageSessionIds.isEmpty()) {
            // Find all affected enroll_invite_ids before marking junction table as deleted
            List<String> affectedEnrollInviteIds = packageSessionLearnerInvitationToPaymentOptionRepository
                    .findDistinctEnrollInviteIdsByPackageSessionIds(packageSessionIds);
            
            // Mark the enroll invite junction table entries as deleted
            packageSessionLearnerInvitationToPaymentOptionRepository.updateStatusByPackageSessionIds(
                    packageSessionIds, PackageStatusEnum.DELETED.name());
            
            // Find enroll_invites that now have zero active package sessions
            if (!affectedEnrollInviteIds.isEmpty()) {
                List<Object[]> activeCounts = packageSessionLearnerInvitationToPaymentOptionRepository
                        .countActiveByEnrollInviteIds(affectedEnrollInviteIds);
                
                // Convert to map for efficient lookup: enrollInviteId -> activeCount
                Map<String, Long> activeCountMap = activeCounts.stream()
                        .collect(Collectors.toMap(
                                arr -> (String) arr[0],
                                arr -> (Long) arr[1]
                        ));
                
                // Find enroll_invites with zero active sessions
                List<String> enrollInvitesToDelete = affectedEnrollInviteIds.stream()
                        .filter(id -> activeCountMap.getOrDefault(id, 0L) == 0L)
                        .collect(Collectors.toList());
                
                // Bulk update enroll_invites to DELETED status
                if (!enrollInvitesToDelete.isEmpty()) {
                    enrollInviteRepository.updateStatusByIds(enrollInvitesToDelete, PackageStatusEnum.DELETED.name());
                }
            }
        }

        return "Course deleted successfully";
    }

    public String addOrUpdateCourse(AddCourseDTO addCourseDTO, String instituteId, CustomUserDetails userDetails) {
        packageService.addOrUpdatePackage(addCourseDTO, instituteId, userDetails);
        return "done!!!";
    }

    @Transactional(readOnly = true)
    public List<CourseBatchDTO> getBatchesForCourse(String courseId) {
        List<PackageSession> packageSessions = packageSessionRepository.findByPackageEntity_IdAndStatus(courseId,
                PackageSessionStatusEnum.ACTIVE.name());

        return packageSessions.stream().map(packageSession -> CourseBatchDTO.builder()
                .id(packageSession.getId())
                .packageDto(CourseBatchDTO.MiniPackageDTO.builder()
                        .id(packageSession.getPackageEntity().getId())
                        .packageName(packageSession.getPackageEntity().getPackageName())
                        .build())
                .level(CourseBatchDTO.MiniLevelDTO.builder()
                        .id(packageSession.getLevel().getId())
                        .levelName(packageSession.getLevel().getLevelName())
                        .build())
                .session(CourseBatchDTO.MiniSessionDTO.builder()
                        .id(packageSession.getSession().getId())
                        .sessionName(packageSession.getSession().getSessionName())
                        .startDate(packageSession.getSession().getStartDate())
                        .build())
                .readTimeInMinutes(0)
                .isParent(packageSession.getIsParent())
                .parentId(packageSession.getParentId())
                .packageSessionName(
                        StringUtils.hasText(packageSession.getName())
                                ? packageSession.getPackageEntity().getPackageName() + " " + packageSession.getName()
                                : null)
                .build())
                .collect(Collectors.toList());
    }
}
