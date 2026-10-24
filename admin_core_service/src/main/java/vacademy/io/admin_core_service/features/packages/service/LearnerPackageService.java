package vacademy.io.admin_core_service.features.packages.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.*;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.chapter.enums.ChapterStatus;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.faculty.enums.FacultyStatusEnum;
import vacademy.io.admin_core_service.features.faculty.service.CourseRoleLabelService;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerStatusEnum;
import vacademy.io.admin_core_service.features.learner_operation.enums.LearnerOperationEnum;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.packages.dto.PackageDetailDTO;
import vacademy.io.admin_core_service.features.packages.dto.PackageDetailProjection;
import vacademy.io.admin_core_service.features.packages.dto.LearnerPackageFilterDTO;
import vacademy.io.admin_core_service.features.packages.enums.PackageSessionStatusEnum;
import vacademy.io.admin_core_service.features.packages.enums.PackageStatusEnum;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;
import vacademy.io.admin_core_service.features.slide.enums.QuestionStatusEnum;
import vacademy.io.admin_core_service.features.slide.enums.SlideStatus;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.core.standard_classes.ListService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@Slf4j
public class LearnerPackageService {

        @Autowired
        private PackageRepository packageRepository;

        @Autowired
        private AuthService authService;

        @Autowired
        private CourseRoleLabelService courseRoleLabelService;

        @Autowired
        private StudentSessionInstituteGroupMappingRepository studentSessionInstituteGroupMappingRepository;

        public Page<PackageDetailDTO> getLearnerPackageDetail(
                        LearnerPackageFilterDTO learnerPackageFilterDTO,
                        String userId,
                        String instituteId,
                        int pageNo,
                        int pageSize) {
                try {

                // Postgres cannot infer a data type for a bare parameter, so a null list
                // filter reaching a native query surfaces as
                // "could not determine data type of parameter $N" instead of a result set.
                // Null and empty mean the same thing to every one of these queries
                // (each guards with `#param == null || #param.isEmpty()`), so normalise
                // up front rather than at each of the six call sites below.
                normaliseListFilters(learnerPackageFilterDTO);

                Sort thisSort = ListService.createSortObject(learnerPackageFilterDTO.getSortColumns());
                Pageable pageable = PageRequest.of(pageNo, pageSize, thisSort);
                Page<PackageDetailProjection> learnerPackageDetail;

                if (StringUtils.hasText(learnerPackageFilterDTO.getType())
                                && learnerPackageFilterDTO.getType().equalsIgnoreCase("COMPLETED")) {
                        learnerPackageDetail = getCompletedLearnerPackageDetail(learnerPackageFilterDTO, instituteId,
                                        pageable, userId);
                } else if (StringUtils.hasText(learnerPackageFilterDTO.getType())
                                && learnerPackageFilterDTO.getType().equalsIgnoreCase("PROGRESS")) {
                        learnerPackageDetail = getInProgressLearnerPackageDetail(learnerPackageFilterDTO, instituteId,
                                        pageable, userId);
                } else if (StringUtils.hasText(learnerPackageFilterDTO.getType())
                                && learnerPackageFilterDTO.getType().equalsIgnoreCase("PAST")) {
                        learnerPackageDetail = packageRepository.getPastLearnerPackages(
                                        userId,
                                        instituteId,
                                        learnerPackageFilterDTO.getLevelIds(),
                                        List.of(LearnerOperationEnum.PERCENTAGE_PACKAGE_SESSION_COMPLETED.name()),
                                        pageable);
                } else {
                        learnerPackageDetail = getAllLearnerPackageDetail(learnerPackageFilterDTO, instituteId,
                                        pageable, userId);
                }

                // Get all instructor userIds (faculty first; fallback to createdByUserId when
                // no faculty mapped)
                List<String> instructorIds = learnerPackageDetail.getContent().stream()
                                .map(proj -> {
                                        List<String> ids = Optional.ofNullable(proj.getFacultyUserIds())
                                                        .orElse(List.of());
                                        if (!ids.isEmpty())
                                                return ids;
                                        return Optional.ofNullable(proj.getCreatedByUserId()).map(List::of)
                                                        .orElse(List.of());
                                })
                                .flatMap(List::stream)
                                .distinct()
                                .collect(Collectors.toList());

                // Fetch instructor details
                List<UserDTO> userDTOS = authService.getUsersFromAuthServiceByUserIds(instructorIds);
                Map<String, UserDTO> userMap = userDTOS.stream()
                                .filter(u -> u != null && u.getId() != null)
                                .collect(Collectors.toMap(UserDTO::getId, Function.identity(), (a, b) -> a));
                Map<String, Map<String, String>> roleLabels = courseRoleLabelService.labelsByPackage(
                                learnerPackageDetail.getContent().stream().map(p -> p.getId()).toList());

                // Map projections to DTOs (instructors = faculty list, or single creator as
                // fallback)
                List<PackageDetailDTO> dtos = learnerPackageDetail.getContent().stream().map(projection -> {
                        List<String> instructorIdList = Optional.ofNullable(projection.getFacultyUserIds())
                                        .orElse(List.of());
                        if (instructorIdList.isEmpty() && projection.getCreatedByUserId() != null) {
                                instructorIdList = List.of(projection.getCreatedByUserId());
                        }
                        List<UserDTO> instructors = courseRoleLabelService.withRoleLabels(instructorIdList.stream()
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
                                        null,
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
                        dto.setValidityInDays(projection.getValidityInDays());
                        return dto;
                }).toList();

                // Tag each card with the viewing learner's enrollment status for that
                // package_session, so the sidebar can show a "Course Inactive" pill
                // when the admin has deactivated this learner from a course they still
                // own a plan/access for.
                List<String> packageSessionIds = dtos.stream()
                                .map(PackageDetailDTO::getPackageSessionId)
                                .filter(Objects::nonNull)
                                .distinct()
                                .collect(Collectors.toList());
                if (!packageSessionIds.isEmpty()) {
                        List<StudentSessionInstituteGroupMapping> mappings =
                                        studentSessionInstituteGroupMappingRepository
                                                        .findAllByUserIdAndPackageSessionIdsAndStatus(
                                                                        userId,
                                                                        packageSessionIds,
                                                                        List.of(
                                                                                        LearnerSessionStatusEnum.ACTIVE.name(),
                                                                                        LearnerSessionStatusEnum.INACTIVE.name(),
                                                                                        LearnerSessionStatusEnum.TERMINATED.name(),
                                                                                        LearnerSessionStatusEnum.INVITED.name()));
                        // Latest-wins if a user has multiple mappings for the same
                        // package_session (rare): keep whichever the merge picks.
                        Map<String, StudentSessionInstituteGroupMapping> psIdToMapping = mappings.stream()
                                        .filter(m -> m.getPackageSession() != null
                                                        && m.getPackageSession().getId() != null)
                                        .collect(Collectors.toMap(
                                                        m -> m.getPackageSession().getId(),
                                                        Function.identity(),
                                                        (a, b) -> a));
                        dtos.forEach(dto -> {
                                if (dto.getPackageSessionId() == null) return;
                                StudentSessionInstituteGroupMapping m =
                                                psIdToMapping.get(dto.getPackageSessionId());
                                if (m == null) return;
                                dto.setEnrollmentStatus(m.getStatus());
                                dto.setEnrolledDate(m.getEnrolledDate());
                                dto.setExpiryDate(m.getExpiryDate());
                                dto.setEnrollmentStatusUpdatedAt(m.getUpdatedAt());
                        });
                }

                return new PageImpl<>(dtos, pageable, learnerPackageDetail.getTotalElements());
                } catch (RuntimeException e) {
                        log.error("getLearnerPackageDetail failed for institute={}, type={}, userId={}",
                                        instituteId,
                                        learnerPackageFilterDTO != null ? learnerPackageFilterDTO.getType() : null,
                                        userId, e);
                        throw e;
                }
        }

        private void normaliseListFilters(LearnerPackageFilterDTO dto) {
                if (dto == null) {
                        return;
                }
                if (dto.getPackageTypes() == null) {
                        dto.setPackageTypes(List.of());
                }
                if (dto.getLevelIds() == null) {
                        dto.setLevelIds(List.of());
                }
                if (dto.getSessionIds() == null) {
                        dto.setSessionIds(List.of());
                }
                if (dto.getFacultyIds() == null) {
                        dto.setFacultyIds(List.of());
                }
                if (dto.getTag() == null) {
                        dto.setTag(List.of());
                }
                if (dto.getStatus() == null) {
                        dto.setStatus(List.of());
                }
        }

        private Page<PackageDetailProjection> getCompletedLearnerPackageDetail(
                        LearnerPackageFilterDTO learnerPackageFilterDTO,
                        String instituteId,
                        Pageable pageable,
                        String userId) {
                Page<PackageDetailProjection> learnerPackageDetail;
                if (StringUtils.hasText(learnerPackageFilterDTO.getSearchByName())) {
                        learnerPackageDetail = packageRepository.getCompletedLearnerPackageDetail(
                                        userId,
                                        learnerPackageFilterDTO.getSearchByName(),
                                        instituteId,
                                        List.of(PackageStatusEnum.ACTIVE.name()),
                                        learnerPackageFilterDTO.getPackageTypes(),
                                        List.of(PackageSessionStatusEnum.ACTIVE.name(),
                                                        PackageSessionStatusEnum.HIDDEN.name()),
                                        List.of(LearnerOperationEnum.PERCENTAGE_PACKAGE_SESSION_COMPLETED.name()),
                                        List.of(StatusEnum.ACTIVE.name()),
                                        List.of(StatusEnum.ACTIVE.name()),
                                        List.of(QuestionStatusEnum.ACTIVE.name()),
                                        List.of(QuestionStatusEnum.ACTIVE.name()),
                                        List.of(SlideStatus.PUBLISHED.name(), SlideStatus.UNSYNC.name()),
                                        List.of(ChapterStatus.ACTIVE.name()),
                                        List.of(LearnerStatusEnum.ACTIVE.name()),
                                        pageable);
                } else {
                        learnerPackageDetail = packageRepository.getCompletedLearnerPackageDetail(
                                        userId,
                                        instituteId,
                                        learnerPackageFilterDTO.getLevelIds(),
                                        List.of(PackageStatusEnum.ACTIVE.name()),
                                        learnerPackageFilterDTO.getPackageTypes(),
                                        List.of(PackageSessionStatusEnum.ACTIVE.name(),
                                                        PackageSessionStatusEnum.HIDDEN.name()),
                                        List.of(LearnerOperationEnum.PERCENTAGE_PACKAGE_SESSION_COMPLETED.name()),
                                        learnerPackageFilterDTO.getFacultyIds(),
                                        List.of(StatusEnum.ACTIVE.name()),
                                        learnerPackageFilterDTO.getTag(),
                                        List.of(StatusEnum.ACTIVE.name()),
                                        List.of(QuestionStatusEnum.ACTIVE.name()),
                                        List.of(QuestionStatusEnum.ACTIVE.name()),
                                        List.of(SlideStatus.PUBLISHED.name(), SlideStatus.UNSYNC.name()),
                                        List.of(ChapterStatus.ACTIVE.name()),
                                        List.of(LearnerStatusEnum.ACTIVE.name()),
                                        pageable);
                }
                return learnerPackageDetail;
        }

        private Page<PackageDetailProjection> getAllLearnerPackageDetail(
                        LearnerPackageFilterDTO learnerPackageFilterDTO,
                        String instituteId,
                        Pageable pageable,
                        String userId) {
                Page<PackageDetailProjection> learnerPackageDetail;
                if (StringUtils.hasText(learnerPackageFilterDTO.getSearchByName())) {
                        learnerPackageDetail = packageRepository.getAllPackagesIrrespectiveOfLearnerOperation(
                                        userId,
                                        learnerPackageFilterDTO.getSearchByName(),
                                        instituteId,
                                        List.of(PackageStatusEnum.ACTIVE.name()),
                                        learnerPackageFilterDTO.getPackageTypes(),
                                        List.of(PackageSessionStatusEnum.ACTIVE.name(),
                                                        PackageSessionStatusEnum.HIDDEN.name()),
                                        List.of(LearnerOperationEnum.PERCENTAGE_PACKAGE_SESSION_COMPLETED.name()),
                                        List.of(StatusEnum.ACTIVE.name()),
                                        List.of(StatusEnum.ACTIVE.name()),
                                        List.of(QuestionStatusEnum.ACTIVE.name()),
                                        List.of(QuestionStatusEnum.ACTIVE.name()),
                                        List.of(SlideStatus.PUBLISHED.name(), SlideStatus.UNSYNC.name()),
                                        List.of(ChapterStatus.ACTIVE.name()),
                                        pageable);
                } else {
                        learnerPackageDetail = packageRepository.getAllLearnerPackagesIrrespectiveOfProgress(
                                        userId,
                                        instituteId,
                                        learnerPackageFilterDTO.getLevelIds(),
                                        learnerPackageFilterDTO.getSessionIds(),
                                        List.of(PackageStatusEnum.ACTIVE.name()),
                                        learnerPackageFilterDTO.getPackageTypes(),
                                        List.of(PackageSessionStatusEnum.ACTIVE.name(),
                                                        PackageSessionStatusEnum.HIDDEN.name()),
                                        List.of(LearnerOperationEnum.PERCENTAGE_PACKAGE_SESSION_COMPLETED.name()),
                                        learnerPackageFilterDTO.getFacultyIds(),
                                        List.of(StatusEnum.ACTIVE.name()),
                                        learnerPackageFilterDTO.getTag(),
                                        List.of(StatusEnum.ACTIVE.name()),
                                        List.of(QuestionStatusEnum.ACTIVE.name()),
                                        List.of(QuestionStatusEnum.ACTIVE.name()),
                                        List.of(SlideStatus.PUBLISHED.name(), SlideStatus.UNSYNC.name()),
                                        List.of(ChapterStatus.ACTIVE.name()),
                                        pageable);
                }
                return learnerPackageDetail;
        }

        private Page<PackageDetailProjection> getInProgressLearnerPackageDetail(
                        LearnerPackageFilterDTO learnerPackageFilterDTO,
                        String instituteId,
                        Pageable pageable,
                        String userId) {
                Page<PackageDetailProjection> learnerPackageDetail;
                if (StringUtils.hasText(learnerPackageFilterDTO.getSearchByName())) {
                        learnerPackageDetail = packageRepository.getStudentAssignedPackages(
                                        userId,
                                        learnerPackageFilterDTO.getSearchByName(),
                                        instituteId,
                                        List.of(PackageStatusEnum.ACTIVE.name()),
                                        learnerPackageFilterDTO.getPackageTypes(),
                                        List.of(PackageSessionStatusEnum.ACTIVE.name(),
                                                        PackageSessionStatusEnum.HIDDEN.name()),
                                        List.of(LearnerOperationEnum.PERCENTAGE_PACKAGE_SESSION_COMPLETED.name()),
                                        List.of(StatusEnum.ACTIVE.name()),
                                        List.of(StatusEnum.ACTIVE.name()),
                                        learnerPackageFilterDTO.getStatus() != null && !learnerPackageFilterDTO.getStatus().isEmpty()
                                                        ? learnerPackageFilterDTO.getStatus()
                                                        : List.of(LearnerStatusEnum.ACTIVE.name()),
                                        List.of(QuestionStatusEnum.ACTIVE.name()),
                                        List.of(QuestionStatusEnum.ACTIVE.name()),
                                        List.of(SlideStatus.DRAFT.name(), SlideStatus.PUBLISHED.name(),
                                                        SlideStatus.UNSYNC.name()),
                                        List.of(ChapterStatus.ACTIVE.name()),
                                        pageable);
                } else {
                        learnerPackageDetail = packageRepository.getIncompleteMappedPackages(
                                        userId,
                                        instituteId,
                                        learnerPackageFilterDTO.getLevelIds(),
                                        List.of(PackageStatusEnum.ACTIVE.name()),
                                        learnerPackageFilterDTO.getPackageTypes(),
                                        List.of(PackageSessionStatusEnum.ACTIVE.name(),
                                                        PackageSessionStatusEnum.HIDDEN.name()),
                                        List.of(LearnerOperationEnum.PERCENTAGE_PACKAGE_SESSION_COMPLETED.name()),
                                        learnerPackageFilterDTO.getFacultyIds(),
                                        List.of(StatusEnum.ACTIVE.name()),
                                        learnerPackageFilterDTO.getTag(),
                                        List.of(StatusEnum.ACTIVE.name()),
                                        learnerPackageFilterDTO.getStatus() != null && !learnerPackageFilterDTO.getStatus().isEmpty()
                                                        ? learnerPackageFilterDTO.getStatus()
                                                        : List.of(LearnerStatusEnum.ACTIVE.name()),
                                        List.of(QuestionStatusEnum.ACTIVE.name()),
                                        List.of(QuestionStatusEnum.ACTIVE.name()),
                                        List.of(SlideStatus.DRAFT.name(), SlideStatus.PUBLISHED.name(),
                                                        SlideStatus.UNSYNC.name()),
                                        List.of(ChapterStatus.ACTIVE.name()),
                                        pageable);
                }
                return learnerPackageDetail;
        }

        public PackageDetailDTO getPackageDetailById(
                        String packageId) {
                Optional<PackageDetailProjection> optionalProjection = packageRepository
                                .getPackageDetailByIdWithSessionAndFacultyStatus(packageId,
                                                List.of(PackageSessionStatusEnum.ACTIVE.name(),
                                                                PackageSessionStatusEnum.HIDDEN.name()),
                                                List.of(FacultyStatusEnum.ACTIVE.name()),
                                                List.of(StatusEnum.ACTIVE.name()));

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
                                null,
                                projection.getLevelId(),
                                projection.getLevelName(),
                                projection.getDripConditionJson(),
                                instructors,
                                projection.getLevelIds(),
                                getReadTimeInMinutes(packageId),
                                projection.getPackageType(),
                                projection.getSessionId(),
                                projection.getSessionName(),
                                projection.getEnrolledStudentCount());
                dto.setValidityInDays(projection.getValidityInDays());

                return dto;
        }

        private Long getReadTimeInMinutes(String packageId) {
                try {
                        return packageRepository.sumReadTimeInMinutesForPackage(
                                        packageId,
                                        List.of(PackageSessionStatusEnum.ACTIVE.name(),
                                                        PackageSessionStatusEnum.HIDDEN.name()),
                                        List.of(QuestionStatusEnum.ACTIVE.name()),
                                        List.of(QuestionStatusEnum.ACTIVE.name()),
                                        List.of(SlideStatus.DRAFT.name(), SlideStatus.PUBLISHED.name(),
                                                        SlideStatus.UNSYNC.name()),
                                        List.of(ChapterStatus.ACTIVE.name()));
                } catch (Exception e) {
                        return 0L;
                }
        }
}