package vacademy.io.admin_core_service.features.packages.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.chapter.enums.ChapterStatus;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.course.dto.AddCourseDTO;
import vacademy.io.admin_core_service.features.faculty.enums.FacultyStatusEnum;
import vacademy.io.admin_core_service.features.faculty.service.CourseRoleLabelService;
import vacademy.io.admin_core_service.features.level.enums.LevelStatusEnum;
import vacademy.io.admin_core_service.features.packages.dto.CustomPage;
import vacademy.io.admin_core_service.features.packages.dto.LearnerPackageFilterDTO;
import vacademy.io.admin_core_service.features.packages.dto.PackageDetailDTO;
import vacademy.io.admin_core_service.features.packages.dto.PackageDetailProjection;
import vacademy.io.admin_core_service.features.packages.enums.PackageSessionStatusEnum;
import vacademy.io.admin_core_service.features.packages.enums.PackageStatusEnum;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;
import vacademy.io.admin_core_service.features.session.dto.AddNewSessionDTO;
import vacademy.io.admin_core_service.features.session.service.SessionService;
import vacademy.io.admin_core_service.features.slide.enums.QuestionStatusEnum;
import vacademy.io.admin_core_service.features.slide.enums.SlideStatus;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.core.standard_classes.ListService;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.PackageEntity;

import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class PackageService {

    @Autowired
    private PackageRepository packageRepository;

    @Autowired
    private AuthService authService;

    @Autowired
    private CourseRoleLabelService courseRoleLabelService;

    @Autowired
    private SessionService sessionService;

    @Autowired
    private PackagePageContentService packagePageContentService;

    @Transactional(readOnly = true)
    public Page<PackageDetailDTO> getcourseCatalogDetail(
            LearnerPackageFilterDTO learnerPackageFilterDTO,
            String instituteId,
            int pageNo,
            int pageSize) {

        Sort thisSort = ListService.createSortObject(learnerPackageFilterDTO.getSortColumns());
        Pageable pageable = PageRequest.of(pageNo, pageSize, thisSort);

        // Use package_session_filter from request only (no institute-level default)
        String effectiveFilter = null;
        if (learnerPackageFilterDTO != null
                && learnerPackageFilterDTO.getPackageSessionFilter() != null
                && !learnerPackageFilterDTO.getPackageSessionFilter().isBlank()) {
            String v = learnerPackageFilterDTO.getPackageSessionFilter();
            if ("PARENTS_ONLY".equals(v) || "CHILDREN_ONLY".equals(v)) {
                effectiveFilter = v;
            }
        }

        Page<PackageDetailProjection> learnerPackageDetail;

        if (Boolean.TRUE.equals(learnerPackageFilterDTO.getPackageView())) {
            // Package-view mode: fetch ALL sessions, group by package, paginate in Java
            Pageable unpaged = PageRequest.of(0, 10000, thisSort);
            learnerPackageDetail = fetchAdminDetail(learnerPackageFilterDTO, instituteId,
                    effectiveFilter, null, unpaged);

            List<PackageDetailDTO> allDtos = mapProjectionsToDTOs(learnerPackageDetail.getContent());

            // Group by package ID preserving order
            Map<String, List<PackageDetailDTO>> grouped = new LinkedHashMap<>();
            for (PackageDetailDTO dto : allDtos) {
                grouped.computeIfAbsent(dto.getId(), k -> new ArrayList<>()).add(dto);
            }

            // Paginate by distinct packages
            List<String> allPackageIds = new ArrayList<>(grouped.keySet());
            int totalPackages = allPackageIds.size();

            int fromIndex = Math.min(pageNo * pageSize, totalPackages);
            int toIndex = Math.min(fromIndex + pageSize, totalPackages);
            List<String> pagePackageIds = allPackageIds.subList(fromIndex, toIndex);

            // Collect all session rows for packages on this page
            List<PackageDetailDTO> pageDtos = new ArrayList<>();
            for (String pkgId : pagePackageIds) {
                pageDtos.addAll(grouped.get(pkgId));
            }

            return new CustomPage<>(pageDtos, pageable, totalPackages);
        } else {
            // Default mode: paginate by session
            learnerPackageDetail = fetchAdminDetail(learnerPackageFilterDTO, instituteId,
                    effectiveFilter, null, pageable);

            List<PackageDetailDTO> dtos = mapProjectionsToDTOs(learnerPackageDetail.getContent());
            return new PageImpl<>(dtos, pageable, learnerPackageDetail.getTotalElements());
        }
    }

    private Page<PackageDetailProjection> fetchAdminDetail(
            LearnerPackageFilterDTO filterDTO,
            String instituteId,
            String effectiveFilter,
            List<String> overridePackageIds,
            Pageable pageable) {

        List<String> packageIds = overridePackageIds != null ? overridePackageIds : filterDTO.getPackageIds();

        if (StringUtils.hasText(filterDTO.getSearchByName())) {
            return packageRepository.getCatalogPackageDetail(
                    filterDTO.getSearchByName(),
                    filterDTO.getFacultyIds(),
                    instituteId,
                    List.of(PackageStatusEnum.ACTIVE.name()),
                    filterDTO.getPackageTypes(),
                    List.of(PackageSessionStatusEnum.ACTIVE.name(), PackageSessionStatusEnum.HIDDEN.name()),
                    List.of(LevelStatusEnum.ACTIVE.name()),
                    List.of(StatusEnum.ACTIVE.name()),
                    List.of(StatusEnum.ACTIVE.name()),
                    List.of(QuestionStatusEnum.ACTIVE.name()),
                    List.of(QuestionStatusEnum.ACTIVE.name()),
                    List.of(SlideStatus.DRAFT.name(), SlideStatus.PUBLISHED.name(), SlideStatus.UNSYNC.name()),
                    List.of(ChapterStatus.ACTIVE.name()),
                    packageIds,
                    filterDTO.getPackageSessionIds(),
                    effectiveFilter,
                    filterDTO.getSessionIds(),
                    filterDTO.getLevelIds(),
                    filterDTO.getTag(),
                    pageable);
        } else {
            return packageRepository.getCatalogPackageDetail(
                    instituteId,
                    filterDTO.getLevelIds(),
                    List.of(PackageStatusEnum.ACTIVE.name()),
                    filterDTO.getPackageTypes(),
                    List.of(PackageSessionStatusEnum.ACTIVE.name(), PackageSessionStatusEnum.HIDDEN.name()),
                    filterDTO.getFacultyIds(),
                    List.of(StatusEnum.ACTIVE.name()),
                    filterDTO.getTag(),
                    List.of(LevelStatusEnum.ACTIVE.name()),
                    List.of(StatusEnum.ACTIVE.name()),
                    List.of(QuestionStatusEnum.ACTIVE.name()),
                    List.of(QuestionStatusEnum.ACTIVE.name()),
                    List.of(SlideStatus.DRAFT.name(), SlideStatus.PUBLISHED.name(), SlideStatus.UNSYNC.name()),
                    List.of(ChapterStatus.ACTIVE.name()),
                    packageIds,
                    filterDTO.getPackageSessionIds(),
                    effectiveFilter,
                    filterDTO.getSessionIds(),
                    pageable);
        }
    }

    private List<PackageDetailDTO> mapProjectionsToDTOs(List<PackageDetailProjection> projections) {
        List<String> instructorIds = projections.stream()
                .map(PackageDetailProjection::getFacultyUserIds)
                .filter(Objects::nonNull)
                .flatMap(List::stream)
                .distinct()
                .collect(Collectors.toList());

        List<UserDTO> userDTOS = authService.getUsersFromAuthServiceByUserIds(instructorIds);
        Map<String, UserDTO> userMap = userDTOS.stream()
                .filter(u -> u != null && u.getId() != null)
                .collect(Collectors.toMap(UserDTO::getId, Function.identity(), (a, b) -> a));
        Map<String, Map<String, String>> roleLabels = courseRoleLabelService.labelsByPackage(
                        projections.stream().map(p -> p.getId()).toList());

        return projections.stream().map(projection -> {
            List<UserDTO> instructors = courseRoleLabelService.withRoleLabels(Optional.ofNullable(projection.getFacultyUserIds())
                    .orElse(List.of()).stream()
                    .map(userMap::get)
                    .filter(Objects::nonNull)
                    .collect(Collectors.toList()),
                    roleLabels.get(projection.getId()));

            return new PackageDetailDTO(
                    projection.getId(),
                    projection.getPackageName(),
                    projection.getThumbnailFileId(),
                    projection.getIsCoursePublishedToCatalaouge(),
                    projection.getCoursePreviewImageMediaId(),
                    projection.getCourseBannerMediaId(),
                    projection.getCourseMediaId(),
                    projection.getWhyLearnHtml(),
                    projection.getWhoShouldLearnHtml(),
                    projection.getAboutTheCourseHtml(),
                    projection.getCommaSeparetedTags(),
                    projection.getCourseDepth(),
                    projection.getCourseHtmlDescriptionHtml(),
                    projection.getPercentageCompleted(),
                    projection.getRating(),
                    projection.getPackageSessionId(),
                    projection.getPackageSessionName(),
                    projection.getLevelId(),
                    projection.getLevelName(),
                    projection.getDripConditionJson(),
                    instructors,
                    projection.getLevelIds(),
                    projection.getReadTimeInMinutes(),
                    projection.getPackageType(),
                    projection.getSessionId(),
                    projection.getSessionName(),
                    projection.getEnrolledStudentCount());
        }).toList();
    }

    @Transactional(readOnly = true)
    public PackageDetailDTO getPackageDetailById(
            String packageId) {
        Optional<PackageDetailProjection> optionalProjection = packageRepository
                .getPackageDetailByIdWithSessionAndFacultyStatus(packageId,
                        List.of(PackageSessionStatusEnum.ACTIVE.name(), PackageSessionStatusEnum.HIDDEN.name()),
                        List.of(FacultyStatusEnum.ACTIVE.name()), List.of(StatusEnum.ACTIVE.name()));

        if (optionalProjection.isEmpty()) {
            throw new VacademyException("Package not found");
        }

        PackageDetailProjection projection = optionalProjection.get();

        // Fetch instructor details if available
        List<String> instructorIds = Optional.ofNullable(projection.getFacultyUserIds())
                .orElse(List.of());

        List<UserDTO> userDTOS = authService.getUsersFromAuthServiceByUserIds(instructorIds);
        Map<String, UserDTO> userMap = userDTOS.stream()
                .filter(u -> u != null && u.getId() != null)
                .collect(Collectors.toMap(UserDTO::getId, Function.identity(), (a, b) -> a));
        Map<String, Map<String, String>> roleLabels = courseRoleLabelService.labelsByPackage(
                        Collections.singletonList(projection.getId()));

        List<UserDTO> instructors = courseRoleLabelService.withRoleLabels(instructorIds.stream()
                .map(userMap::get)
                .filter(Objects::nonNull)
                .collect(Collectors.toList()),
                roleLabels.get(projection.getId()));

        PackageDetailDTO dto = new PackageDetailDTO(
                projection.getId(),
                projection.getPackageName(),
                projection.getThumbnailFileId(),
                projection.getIsCoursePublishedToCatalaouge(),
                projection.getCoursePreviewImageMediaId(),
                projection.getCourseBannerMediaId(),
                projection.getCourseMediaId(),
                projection.getWhyLearnHtml(),
                projection.getWhoShouldLearnHtml(),
                projection.getAboutTheCourseHtml(),
                projection.getCommaSeparetedTags(),
                projection.getCourseDepth(),
                projection.getCourseHtmlDescriptionHtml(),
                projection.getPercentageCompleted(),
                projection.getRating(),
                projection.getPackageSessionId(),
                projection.getPackageSessionName(),
                projection.getLevelId(),
                projection.getLevelName(),
                projection.getDripConditionJson(),
                instructors,
                projection.getLevelIds(),
                projection.getReadTimeInMinutes(),
                projection.getPackageType(),
                projection.getSessionId(),
                projection.getSessionName(),
                projection.getEnrolledStudentCount());

        return dto;
    }

    public void addOrUpdatePackage(AddCourseDTO addCourseDTO, String instituteId, CustomUserDetails userDetails) {
        PackageEntity packageEntity;

        // Reject a malformed course_page_json (HTTP 400) before anything is written.
        PackagePageContentService.validate(addCourseDTO.getCoursePageJson());

        // Set created_by_user_id from user context if not already set in DTO
        if (!StringUtils.hasText(addCourseDTO.getCreatedByUserId()) && userDetails != null) {
            addCourseDTO.setCreatedByUserId(userDetails.getId());
        }

        if (addCourseDTO.getNewCourse()) {
            packageEntity = getCourse(addCourseDTO, instituteId);
        } else {
            packageEntity = packageRepository.findById(addCourseDTO.getId())
                    .orElseThrow(() -> new VacademyException("Package not found"));
            updateCourse(addCourseDTO, packageEntity);
        }
        if (Boolean.TRUE.equals(addCourseDTO.getNewCourse())) {
            packagePageContentService.applyOnCreate(packageEntity.getId(), addCourseDTO.getCoursePageJson());
        } else {
            packagePageContentService.applyOnUpdate(packageEntity.getId(), addCourseDTO.getCoursePageJson());
        }
        for (AddNewSessionDTO addNewSessionDTO : addCourseDTO.getSessions()) {
            sessionService.addOrUpdateSession(addNewSessionDTO, packageEntity, instituteId, userDetails);
        }
    }

    public PackageEntity getCourse(AddCourseDTO addCourseDTO, String instituteId) {
        Optional<PackageEntity> optionalPackageEntity = packageRepository
                .findTopByPackageNameAndSessionStatusAndInstitute(addCourseDTO.getCourseName(),
                        List.of(PackageSessionStatusEnum.ACTIVE.name(), PackageSessionStatusEnum.HIDDEN.name()),
                        List.of(PackageStatusEnum.ACTIVE.name(), PackageStatusEnum.DRAFT.name()),
                        instituteId);
        if (optionalPackageEntity.isPresent()) {
            return optionalPackageEntity.get();
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
                    .map(String::toLowerCase)
                    .map(String::trim)
                    .collect(Collectors.joining(",")));
        }

        packageEntity.setCourseDepth(addCourseDTO.getCourseDepth());
        packageEntity.setCourseHtmlDescription(addCourseDTO.getCourseHtmlDescription());
        return packageRepository.save(packageEntity);
    }

    public void updateCourse(AddCourseDTO addCourseDTO, PackageEntity packageEntity) {
        if (addCourseDTO == null || packageEntity == null) {
            return;
        }

        // Directly overwrite every field — even if null or empty
        packageEntity.setPackageName(addCourseDTO.getCourseName());
        packageEntity.setThumbnailFileId(addCourseDTO.getThumbnailFileId());

        // Approval-workflow fields are owned by the approval flow (submit /
        // approve / publish / editable copy), not by a details edit. Only apply
        // them when the caller explicitly sent a value, and never re-own a
        // course that already has a creator — otherwise a teacher's published
        // course flipped back to DRAFT and an admin edit stole ownership so the
        // teacher could no longer publish or submit it.
        if (StringUtils.hasText(addCourseDTO.getStatus())) {
            packageEntity.setStatus(addCourseDTO.getStatus());
        }
        if (!StringUtils.hasText(packageEntity.getCreatedByUserId())
                && StringUtils.hasText(addCourseDTO.getCreatedByUserId())) {
            packageEntity.setCreatedByUserId(addCourseDTO.getCreatedByUserId());
        }
        if (StringUtils.hasText(addCourseDTO.getOriginalCourseId())) {
            packageEntity.setOriginalCourseId(addCourseDTO.getOriginalCourseId());
        }
        if (addCourseDTO.getVersionNumber() != null) {
            packageEntity.setVersionNumber(addCourseDTO.getVersionNumber());
        }
        packageEntity.setIsCoursePublishedToCatalaouge(addCourseDTO.getIsCoursePublishedToCatalaouge());
        packageEntity.setCoursePreviewImageMediaId(addCourseDTO.getCoursePreviewImageMediaId());
        packageEntity.setCourseBannerMediaId(addCourseDTO.getCourseBannerMediaId());
        packageEntity.setCourseMediaId(addCourseDTO.getCourseMediaId());
        packageEntity.setWhyLearn(addCourseDTO.getWhyLearnHtml());
        packageEntity.setWhoShouldLearn(addCourseDTO.getWhoShouldLearnHtml());
        packageEntity.setAboutTheCourse(addCourseDTO.getAboutTheCourseHtml());
        packageEntity.setCourseDepth(addCourseDTO.getCourseDepth());
        packageEntity.setCourseHtmlDescription(addCourseDTO.getCourseHtmlDescription());

        // Handle tags safely — even if null
        if (addCourseDTO.getTags() != null) {
            packageEntity.setTags(addCourseDTO.getTags().stream()
                    .map(String::toLowerCase)
                    .map(String::trim)
                    .collect(Collectors.joining(",")));
        } else {
            packageEntity.setTags(null);
        }

        packageRepository.save(packageEntity);
    }

}
