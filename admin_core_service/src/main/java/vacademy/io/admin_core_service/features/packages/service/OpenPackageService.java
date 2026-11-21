package vacademy.io.admin_core_service.features.packages.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.transaction.Transactional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.chapter.enums.ChapterStatus;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.enroll_invite.util.EnrollInviteAvailabilityUtil;
import vacademy.io.admin_core_service.features.faculty.enums.FacultyStatusEnum;
import vacademy.io.admin_core_service.features.faculty.service.CourseRoleLabelService;
import vacademy.io.admin_core_service.features.level.enums.LevelStatusEnum;
import vacademy.io.admin_core_service.features.packages.dto.*;
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
public class OpenPackageService {
        @Autowired
        private PackageRepository packageRepository;

        @Autowired
        private AuthService authService;

        @Autowired
        private CourseRoleLabelService courseRoleLabelService;

        @Autowired
        private ObjectMapper objectMapper;

        public List<String> getDistinctCatalogTags(String instituteId) {
                if (!StringUtils.hasText(instituteId)) {
                        return List.of();
                }
                return packageRepository.findAllDistinctTagsByInstituteId(instituteId);
        }

        @Transactional
        public Page<PackageDetailDTO> getLearnerPackageDetail(
                        LearnerPackageFilterDTO learnerPackageFilterDTO,
                        String instituteId,
                        int pageNo,
                        int pageSize) {

                Sort thisSort = ListService.createSortObject(learnerPackageFilterDTO.getSortColumns());
                Pageable pageable = PageRequest.of(pageNo, pageSize, thisSort);

                Page<PackageDetailProjection> learnerPackageDetail;

                if (Boolean.TRUE.equals(learnerPackageFilterDTO.getPackageView())) {
                        // Package-view mode: fetch ALL sessions, group by package, paginate in Java
                        Pageable unpaged = PageRequest.of(0, 10000, thisSort);
                        learnerPackageDetail = fetchOpenDetail(learnerPackageFilterDTO, instituteId, null, unpaged);

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
                        learnerPackageDetail = fetchOpenDetail(learnerPackageFilterDTO, instituteId, null, pageable);

                        List<PackageDetailDTO> dtos = mapProjectionsToDTOs(learnerPackageDetail.getContent());
                        return new PageImpl<>(dtos, pageable, learnerPackageDetail.getTotalElements());
                }
        }

        private Page<PackageDetailProjection> fetchOpenDetail(
                        LearnerPackageFilterDTO filterDTO,
                        String instituteId,
                        List<String> packageIds,
                        Pageable pageable) {
                if (StringUtils.hasText(filterDTO.getSearchByName())) {
                        return packageRepository.getCatalogPackageDetail(
                                        filterDTO.getSearchByName(),
                                        instituteId,
                                        List.of(PackageStatusEnum.ACTIVE.name()),
                                        filterDTO.getPackageTypes(),
                                        List.of(PackageSessionStatusEnum.ACTIVE.name(),
                                                        PackageSessionStatusEnum.HIDDEN.name()),
                                        List.of(LevelStatusEnum.ACTIVE.name()),
                                        List.of(StatusEnum.ACTIVE.name()),
                                        List.of(StatusEnum.ACTIVE.name()),
                                        List.of(QuestionStatusEnum.ACTIVE.name()),
                                        List.of(QuestionStatusEnum.ACTIVE.name()),
                                        List.of(SlideStatus.PUBLISHED.name(), SlideStatus.UNSYNC.name()),
                                        List.of(ChapterStatus.ACTIVE.name()),
                                        filterDTO.getCreatedByUserId(),
                                        filterDTO.getSessionIds(),
                                        packageIds,
                                        pageable);
                } else {
                        return packageRepository.getOpenCatalogPackageDetail(
                                        instituteId,
                                        filterDTO.getLevelIds(),
                                        List.of(PackageStatusEnum.ACTIVE.name()),
                                        filterDTO.getPackageTypes(),
                                        List.of(PackageSessionStatusEnum.ACTIVE.name(),
                                                        PackageSessionStatusEnum.HIDDEN.name()),
                                        filterDTO.getFacultyIds(),
                                        List.of(StatusEnum.ACTIVE.name()),
                                        filterDTO.getTag(),
                                        List.of(LevelStatusEnum.ACTIVE.name()),
                                        List.of(StatusEnum.ACTIVE.name()),
                                        List.of(QuestionStatusEnum.ACTIVE.name()),
                                        List.of(QuestionStatusEnum.ACTIVE.name()),
                                        List.of(SlideStatus.PUBLISHED.name(), SlideStatus.UNSYNC.name()),
                                        List.of(ChapterStatus.ACTIVE.name()),
                                        filterDTO.getCreatedByUserId(),
                                        filterDTO.getSessionIds(),
                                        packageIds,
                                        pageable);
                }
        }

        private List<PackageDetailDTO> mapProjectionsToDTOs(List<PackageDetailProjection> projections) {
                // Get all instructor userIds (faculty first; fallback to createdByUserId when no faculty mapped)
                List<String> instructorIds = projections.stream()
                                .map(proj -> {
                                        List<String> ids = Optional.ofNullable(proj.getFacultyUserIds()).orElse(List.of());
                                        if (!ids.isEmpty()) return ids;
                                        return Optional.ofNullable(proj.getCreatedByUserId()).map(List::of).orElse(List.of());
                                })
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
                        List<String> instructorIdList = Optional.ofNullable(projection.getFacultyUserIds()).orElse(List.of());
                        if (instructorIdList.isEmpty() && projection.getCreatedByUserId() != null) {
                                instructorIdList = List.of(projection.getCreatedByUserId());
                        }
                        List<UserDTO> instructors = courseRoleLabelService.withRoleLabels(instructorIdList.stream()
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
                }).toList();
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

                return dto;
        }

        @Transactional
        public Page<PackageDetailV2DTO> getLearnerPackageDetailV2(
                        LearnerPackageFilterDTO learnerPackageFilterDTO,
                        String instituteId,
                        int pageNo,
                        int pageSize) {
                // Outside the try: an oversized list is the caller's mistake (400), not a failure to log.
                List<String> packageIds = normalizePackageIdsFilter(
                                learnerPackageFilterDTO != null ? learnerPackageFilterDTO.getPackageIds() : null);
                try {

                Sort thisSort = ListService.createSortObject(learnerPackageFilterDTO.getSortColumns());
                Pageable pageable = PageRequest.of(pageNo, pageSize, thisSort);

                if (packageIds != null && packageIds.isEmpty()) {
                        // package_ids was sent but held no usable id: nothing can match, skip the query.
                        return new PageImpl<>(List.of(), pageable, 0);
                }

                Page<PackageDetailV2Projection> learnerPackageDetail;
                if (StringUtils.hasText(learnerPackageFilterDTO.getSearchByName())) {
                        learnerPackageDetail = packageRepository.getCatalogPackageDetailV2(
                                        learnerPackageFilterDTO.getSearchByName(),
                                        instituteId,
                                        learnerPackageFilterDTO.getFacultyIds(),
                                        List.of(StatusEnum.ACTIVE.name()), // facultyPackageSessionStatus
                                        learnerPackageFilterDTO.getTag(),
                                        List.of(PackageStatusEnum.ACTIVE.name()),
                                        learnerPackageFilterDTO.getPackageTypes(),
                                        List.of(PackageSessionStatusEnum.ACTIVE.name(),
                                                        PackageSessionStatusEnum.HIDDEN.name()),
                                        List.of(LevelStatusEnum.ACTIVE.name()),
                                        learnerPackageFilterDTO.getLevelIds(),
                                        learnerPackageFilterDTO.getSessionIds(),
                                        List.of(StatusEnum.ACTIVE.name()), // ratingStatuses
                                        List.of(SlideStatus.PUBLISHED.name(), SlideStatus.UNSYNC.name()),
                                        List.of(ChapterStatus.ACTIVE.name()),
                                        List.of(StatusEnum.ACTIVE.name()), // assignmentQuestionStatusList
                                        List.of(StatusEnum.ACTIVE.name()), // questionStatusList
                                        // incl INACTIVE so the catalogue can badge a deactivated default invite as closed
                                        List.of(StatusEnum.ACTIVE.name(), StatusEnum.INACTIVE.name()), // enrollInviteStatus
                                        List.of(StatusEnum.ACTIVE.name()), // psliStatus
                                        List.of(StatusEnum.ACTIVE.name()), // paymentOptionStatus
                                        List.of(StatusEnum.ACTIVE.name()), // paymentPlanStatus
                                        learnerPackageFilterDTO.getCreatedByUserId(),
                                        packageIds, // null = no package filter
                                        pageable);
                } else {
                        // Corrected getTag() to getTags() to match List<String> type
                        learnerPackageDetail = packageRepository.getOpenCatalogPackageDetailV2(
                                        instituteId,
                                        learnerPackageFilterDTO.getLevelIds(),
                                        learnerPackageFilterDTO.getSessionIds(),
                                        List.of(PackageStatusEnum.ACTIVE.name()),
                                        learnerPackageFilterDTO.getPackageTypes(),
                                        List.of(PackageSessionStatusEnum.ACTIVE.name(),
                                                        PackageSessionStatusEnum.HIDDEN.name()),
                                        learnerPackageFilterDTO.getFacultyIds(),
                                        List.of(StatusEnum.ACTIVE.name()), // facultyPackageSessionStatus
                                        learnerPackageFilterDTO.getTag(), // Corrected from getTag()
                                        List.of(LevelStatusEnum.ACTIVE.name()),
                                        List.of(StatusEnum.ACTIVE.name()), // ratingStatuses
                                        List.of(StatusEnum.ACTIVE.name()), // assignmentQuestionStatusList
                                        List.of(StatusEnum.ACTIVE.name()), // questionStatusList
                                        List.of(SlideStatus.PUBLISHED.name(), SlideStatus.UNSYNC.name()),
                                        List.of(ChapterStatus.ACTIVE.name()),
                                        // incl INACTIVE so the catalogue can badge a deactivated default invite as closed
                                        List.of(StatusEnum.ACTIVE.name(), StatusEnum.INACTIVE.name()), // enrollInviteStatus
                                        List.of(StatusEnum.ACTIVE.name()), // psliStatus
                                        List.of(StatusEnum.ACTIVE.name()), // paymentOptionStatus
                                        List.of(StatusEnum.ACTIVE.name()), // paymentPlanStatus
                                        learnerPackageFilterDTO.getCreatedByUserId(),
                                        packageIds, // null = no package filter
                                        pageable);
                }

                // Get all instructor userIds (faculty first; fallback to createdByUserId when no faculty mapped)
                List<String> instructorIds = learnerPackageDetail.getContent().stream()
                                .map(proj -> {
                                        List<String> ids = Optional.ofNullable(proj.getFacultyUserIds()).orElse(List.of());
                                        if (!ids.isEmpty()) return ids;
                                        return Optional.ofNullable(proj.getCreatedByUserId()).map(List::of).orElse(List.of());
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

                // Map projections to DTOs (instructors = faculty list, or single creator as fallback)
                List<PackageDetailV2DTO> dtos = learnerPackageDetail.getContent().stream().map(projection -> {
                        List<String> instructorIdList = Optional.ofNullable(projection.getFacultyUserIds()).orElse(List.of());
                        if (instructorIdList.isEmpty() && projection.getCreatedByUserId() != null) {
                                instructorIdList = List.of(projection.getCreatedByUserId());
                        }
                        List<UserDTO> instructors = courseRoleLabelService.withRoleLabels(instructorIdList.stream()
                                        .map(userMap::get)
                                        .filter(Objects::nonNull)
                                        .collect(Collectors.toList()),
                                roleLabels.get(projection.getId()));

                        return new PackageDetailV2DTO(
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
                                        null, // percentageCompleted (not in projection yet)
                                        projection.getRating(),
                                        projection.getPackageSessionId(),
                                        projection.getLevelId(),
                                        projection.getLevelName(),
                                        projection.getSessionId(),
                                        projection.getSessionName(),
                                        projection.getDripConditionJson(),
                                        instructors,
                                        projection.getReadTimeInMinutes(),
                                        projection.getPackageType(),
                                        projection.getEnrollInviteId(),
                                        projection.getPsliId(),
                                        projection.getPaymentOptionId(),
                                        projection.getPaymentOptionType(),
                                        projection.getPaymentOptionStatus(),
                                        projection.getPaymentPlanId(),
                                        projection.getMinPlanActualPrice(),
                                        projection.getMinPlanElevatedPrice(),
                                        projection.getCurrency(),
                                        projection.getAvailableSlots(),
                                        projection.getMaxSeats(),
                                        EnrollInviteAvailabilityUtil.compute(
                                                projection.getEnrollInviteStatus(),
                                                projection.getEnrollInviteStartDate(),
                                                projection.getEnrollInviteEndDate()),
                                        ComingSoonDTO.fromCourseSetting(
                                                projection.getComingSoonSettingJson(), objectMapper),
                                        // createdAt: MUST stay the last argument (last DTO field)
                                        projection.getCreatedAt());
                }).toList();

                return new PageImpl<>(dtos, pageable, learnerPackageDetail.getTotalElements());
                } catch (RuntimeException e) {
                        log.error("getLearnerPackageDetailV2 failed for institute={}, search={}",
                                        instituteId,
                                        learnerPackageFilterDTO != null ? learnerPackageFilterDTO.getSearchByName() : null,
                                        e);
                        throw e;
                }
        }

        /**
         * Most package ids one public v2 search may filter by. Real callers send one course (course
         * page) or a few dozen (a learning path, the cart, capped at 40); the cap keeps a public body
         * from building a giant IN list (PgJDBC fails past 32767 bind parameters anyway).
         */
        static final int MAX_PACKAGE_IDS_FILTER = 500;

        /**
         * The v2 {@code package_ids} filter, normalised:
         * <ul>
         *   <li>{@code null} = no filter. Returned for an absent or empty list, so every existing
         *       caller (none sends package_ids) gets exactly today's results.</li>
         *   <li>empty list = a filter was asked for but held no usable id (only blanks/nulls):
         *       nothing can match.</li>
         *   <li>otherwise the trimmed, de-duplicated ids in request order.</li>
         * </ul>
         * More than {@link #MAX_PACKAGE_IDS_FILTER} distinct ids is rejected with 400.
         */
        static List<String> normalizePackageIdsFilter(List<String> requested) {
                if (requested == null || requested.isEmpty()) {
                        return null;
                }
                LinkedHashSet<String> ids = new LinkedHashSet<>();
                for (String id : requested) {
                        if (StringUtils.hasText(id)) {
                                ids.add(id.trim());
                        }
                }
                if (ids.size() > MAX_PACKAGE_IDS_FILTER) {
                        throw new VacademyException(HttpStatus.BAD_REQUEST,
                                        "package_ids accepts at most " + MAX_PACKAGE_IDS_FILTER + " ids");
                }
                return List.copyOf(ids);
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
