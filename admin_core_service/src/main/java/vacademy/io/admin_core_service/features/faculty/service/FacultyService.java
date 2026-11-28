package vacademy.io.admin_core_service.features.faculty.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.course.dto.AddFacultyToCourseDTO;
import vacademy.io.admin_core_service.features.faculty.dto.*;
import vacademy.io.admin_core_service.features.faculty.entity.FacultySubjectPackageSessionMapping;
import vacademy.io.admin_core_service.features.faculty.enums.FacultyStatusEnum;
import vacademy.io.admin_core_service.features.faculty.repository.FacultySubjectPackageSessionMappingRepository;
import vacademy.io.admin_core_service.features.packages.enums.PackageSessionStatusEnum;
import vacademy.io.admin_core_service.features.subject.enums.SubjectStatusEnum;
import vacademy.io.admin_core_service.features.subject.service.SubjectService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.core.standard_classes.ListService;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.dto.SubjectTopLevelDto;
import vacademy.io.common.institute.entity.student.Subject;

import java.util.*;
import java.util.stream.Collectors;

@Service
@Slf4j
@RequiredArgsConstructor
public class FacultyService {
    private final FacultySubjectPackageSessionMappingRepository facultyRepository;
    private final AuthService authService;
    private final SubjectService subjectService;
    private final InstituteAccessValidator instituteAccessValidator;

    public String addFacultyToSubjectsAndBatches(AddFacultyToSubjectAndBatchDTO addFacultyToSubjectAndBatch,
            String instituteId, CustomUserDetails userDetails) {
        UserDTO userDTO = addFacultyToSubjectAndBatch.getUser();
        if (addFacultyToSubjectAndBatch.isNewUser()) {
            // The invite creates the user with the roles in the request. Only an ADMIN of
            // this institute may create another ADMIN (no root bypass: learners are root users).
            if (userDTO != null && userDTO.getRoles() != null
                    && userDTO.getRoles().stream().anyMatch("ADMIN"::equalsIgnoreCase)) {
                instituteAccessValidator.requireInstituteAdmin(userDetails, instituteId);
            }
            userDTO = inviteUser(userDTO, instituteId);
        }
        List<FacultySubjectPackageSessionMapping> mappings = new ArrayList<>();
        for (AddFacultyToSubjectAndBatchDTO.BatchSubjectMapping batchSubjectMapping : addFacultyToSubjectAndBatch
                .getBatchSubjectMappings()) {
            for (String subjectId : batchSubjectMapping.getSubjectIds()) {
                FacultySubjectPackageSessionMapping mapping = new FacultySubjectPackageSessionMapping(userDTO.getId(),
                        batchSubjectMapping.getBatchId(), subjectId,
                        addFacultyToSubjectAndBatch.getUser().getFullName(), FacultyStatusEnum.ACTIVE.name());
                mappings.add(mapping);
            }
        }
        facultyRepository.saveAll(mappings);
        return userDTO.getId();
    }

    @Transactional
    public String updateFacultyAssignmentsToSubjects(
            FacultyBatchSubjectDTO updateRequest,
            CustomUserDetails userDetails) {
        List<FacultySubjectPackageSessionMapping> updatedMappings = new ArrayList<>();

        for (FacultyBatchSubjectDTO.BatchSubjectAssignment batchAssignment : updateRequest
                .getBatchSubjectAssignments()) {
            String batchId = batchAssignment.getBatchId();

            for (FacultyBatchSubjectDTO.SubjectAssignment subjectAssignment : batchAssignment.getSubjectAssignments()) {
                String subjectId = subjectAssignment.getSubjectId();

                if (subjectAssignment.isNewAssignment()) {
                    FacultySubjectPackageSessionMapping newMapping = new FacultySubjectPackageSessionMapping(
                            updateRequest.getFacultyId(),
                            batchId,
                            subjectId,
                            userDetails.getFullName(),
                            FacultyStatusEnum.ACTIVE.name());
                    updatedMappings.add(newMapping);
                } else if (subjectId == null) {
                    // Removing the batch-level (subject-less) instructor row. A plain
                    // `subject_id = NULL` lookup never matches, so retire every active
                    // NULL-subject row explicitly. Nothing to retire is fine: the caller
                    // sends this entry unconditionally on "remove from batch".
                    for (FacultySubjectPackageSessionMapping batchLevelMapping : facultyRepository
                            .findAllByUserIdAndPackageSessionIdAndSubjectIdIsNullAndStatusIn(
                                    updateRequest.getFacultyId(),
                                    batchId,
                                    List.of(FacultyStatusEnum.ACTIVE.name()))) {
                        batchLevelMapping.setStatus(FacultyStatusEnum.DELETED.name());
                        updatedMappings.add(batchLevelMapping);
                    }
                } else {
                    FacultySubjectPackageSessionMapping existingMapping = facultyRepository
                            .findByUserIdAndPackageSessionIdAndSubjectIdAndStatusIn(
                                    updateRequest.getFacultyId(),
                                    batchId,
                                    subjectId,
                                    List.of(FacultyStatusEnum.ACTIVE.name()))
                            .orElseThrow(() -> new VacademyException("Faculty mapping not found"));

                    existingMapping.setStatus(FacultyStatusEnum.DELETED.name());
                    updatedMappings.add(existingMapping);
                }
            }
        }

        facultyRepository.saveAll(updatedMappings);
        return "success";
    }

    public UserDTO inviteUser(UserDTO userDTO, String instituteId) {
        return authService.inviteUser(userDTO, instituteId);
    }

    public ResponseEntity<FacultyAllResponse> getAllFaculty(CustomUserDetails userDetails, String instituteId,
            FacultyRequestFilter filter, int pageNo, int pageSize) {
        Sort sortColumns = ListService.createSortObject(filter.getSortColumns());
        Pageable pageable = PageRequest.of(pageNo, pageSize, sortColumns);

        boolean hasSubjects = filter.getSubjects() != null && !filter.getSubjects().isEmpty();
        boolean hasBatches = filter.getBatches() != null && !filter.getBatches().isEmpty();
        boolean hasStatus = filter.getStatus() != null && !filter.getStatus().isEmpty();

        // Sub-org scope: when the caller has SUB_ORG-linked FSPSSM access (i.e. they are a
        // sub-org admin, not a real institute admin), restrict the faculty list to teachers
        // who are linked to one of THEIR sub-orgs for this PS. Real admins (no SUB_ORG
        // linkages) keep the original unrestricted view.
        List<String> callerSubOrgs = userDetails != null
                ? facultyRepository.findDistinctSubOrgIdsByUserAndLinkage(userDetails.getUserId(), List.of("ACTIVE"))
                : new ArrayList<>();

        Page<FacultySubjectPackageSessionMapping> paginatedResponse;
        if (callerSubOrgs != null && !callerSubOrgs.isEmpty()) {
            paginatedResponse = facultyRepository.findByFiltersScopedToSubOrgs(
                    instituteId,
                    filter.getName(),
                    filter.getSubjects() == null ? new ArrayList<>() : filter.getSubjects(),
                    filter.getBatches() == null ? new ArrayList<>() : filter.getBatches(),
                    filter.getStatus() == null ? new ArrayList<>() : filter.getStatus(),
                    callerSubOrgs,
                    hasSubjects,
                    hasBatches,
                    hasStatus,
                    pageable);
        } else {
            paginatedResponse = facultyRepository.findByFilters(
                    instituteId,
                    filter.getName(),
                    filter.getSubjects() == null ? new ArrayList<>() : filter.getSubjects(),
                    filter.getBatches() == null ? new ArrayList<>() : filter.getBatches(),
                    filter.getStatus() == null ? new ArrayList<>() : filter.getStatus(),
                    hasSubjects,
                    hasBatches,
                    hasStatus,
                    pageable);
        }

        return ResponseEntity.ok(createAllFacultyResponse(paginatedResponse));
    }

    private FacultyAllResponse createAllFacultyResponse(Page<FacultySubjectPackageSessionMapping> paginatedData) {
        if (Objects.isNull(paginatedData)) {
            return FacultyAllResponse.builder()
                    .content(new ArrayList<>())
                    .totalPages(0)
                    .last(true)
                    .pageSize(0)
                    .pageNo(0)
                    .totalElements(0)
                    .build();
        }

        List<FacultySubjectPackageSessionMapping> facultyList = paginatedData.getContent();
        return FacultyAllResponse.builder()
                .content(createFacultyTopLevelResponseFromList(facultyList))
                .pageNo(paginatedData.getNumber())
                .pageSize(paginatedData.getSize())
                .last(paginatedData.isLast())
                .totalPages(paginatedData.getTotalPages())
                .totalElements(paginatedData.getTotalElements()).build();
    }

    private List<FacultyTopLevelResponse> createFacultyTopLevelResponseFromList(
            List<FacultySubjectPackageSessionMapping> facultyList) {
        List<FacultyTopLevelResponse> response = new ArrayList<>();
        facultyList.forEach(faculty -> {
            response.add(FacultyTopLevelResponse.builder()
                    .id(faculty.getId())
                    .userId(faculty.getUserId())
                    .subjects(createSubjectTopLevelFromSubjects(subjectService
                            .getAllSubjectsForFaculty(faculty.getUserId(), faculty.getPackageSessionId())))
                    .name(faculty.getName()).build());
        });
        return response;
    }

    private List<SubjectTopLevelDto> createSubjectTopLevelFromSubjects(List<Subject> allSubjectsForFaculty) {
        List<SubjectTopLevelDto> dtos = new ArrayList<>();
        allSubjectsForFaculty.forEach(subject -> {
            dtos.add(subject.getSubjectTopLevelDto());
        });

        return dtos;
    }

    public FacultyBatchSubjectDTO getAllFacultyBatchSubject(String userId, CustomUserDetails userDetails) {
        List<FacultyBatchSubjectFlatRow> facultyBatchSubjectFlatRows = facultyRepository
                .findFacultyBatchSubjectsFiltered(
                        userId,
                        List.of(FacultyStatusEnum.ACTIVE.name()),
                        List.of(PackageSessionStatusEnum.ACTIVE.name(), PackageSessionStatusEnum.HIDDEN.name()),
                        List.of(SubjectStatusEnum.ACTIVE.name()));

        return mapToNestedDTO(facultyBatchSubjectFlatRows);
    }

    private FacultyBatchSubjectDTO mapToNestedDTO(List<FacultyBatchSubjectFlatRow> rows) {
        FacultyBatchSubjectDTO dto = new FacultyBatchSubjectDTO();
        dto.setFacultyId(rows.isEmpty() ? null : rows.get(0).getFacultyId());

        Map<String, List<FacultyBatchSubjectFlatRow>> byBatch = rows.stream()
                .collect(Collectors.groupingBy(FacultyBatchSubjectFlatRow::getBatchId));

        List<FacultyBatchSubjectDTO.BatchSubjectAssignment> assignments = byBatch.entrySet().stream()
                .map(entry -> {
                    FacultyBatchSubjectDTO.BatchSubjectAssignment bsa = new FacultyBatchSubjectDTO.BatchSubjectAssignment();
                    bsa.setBatchId(entry.getKey());
                    List<FacultyBatchSubjectDTO.SubjectAssignment> subjects = entry.getValue().stream()
                            .map(row -> {
                                FacultyBatchSubjectDTO.SubjectAssignment sa = new FacultyBatchSubjectDTO.SubjectAssignment();
                                sa.setSubjectId(row.getSubjectId());
                                sa.setNewAssignment(row.getIsNewAssignment());
                                return sa;
                            })
                            .collect(Collectors.toList());
                    bsa.setSubjectAssignments(subjects);
                    return bsa;
                }).collect(Collectors.toList());

        dto.setBatchSubjectAssignments(assignments);
        return dto;

    }

    public void addFacultyToBatch(List<AddFacultyToCourseDTO> addFacultyToCourseDTOS, String batchId,
            String instituteId) {
        if (addFacultyToCourseDTOS == null || addFacultyToCourseDTOS.isEmpty()) {
            return;
        }
        List<FacultySubjectPackageSessionMapping> mappings = new ArrayList<>();
        for (AddFacultyToCourseDTO addFacultyToCourseDTO : addFacultyToCourseDTOS) {
            UserDTO teacher = addFacultyToCourseDTO.getUser();
            if (addFacultyToCourseDTO.isNewUser()) {

                teacher = inviteUser(teacher, instituteId);
            } else {
                syncAuthorMetadata(teacher);
            }
            FacultySubjectPackageSessionMapping mapping = new FacultySubjectPackageSessionMapping(
                    teacher.getId(),
                    batchId,
                    null,
                    addFacultyToCourseDTO.getUser().getFullName(),
                    !StringUtils.hasText(addFacultyToCourseDTO.getStatus()) ? FacultyStatusEnum.ACTIVE.name()
                            : addFacultyToCourseDTO.getStatus());
            mapping.setRoleLabel(CourseRoleLabelService.normalize(addFacultyToCourseDTO.getRoleLabel()));
            mappings.add(mapping);
        }
        facultyRepository.saveAll(mappings);
    }

    public void updateFacultyToSubjectPackageSession(List<AddFacultyToCourseDTO> facultyDTOs, String batchId,
            String instituteId) {
        if (facultyDTOs == null || facultyDTOs.isEmpty()) {
            return;
        }

        List<FacultySubjectPackageSessionMapping> mappings = new ArrayList<>();
        for (AddFacultyToCourseDTO dto : facultyDTOs) {
            UserDTO teacher = resolveUser(dto, instituteId);
            FacultySubjectPackageSessionMapping mapping = resolveMapping(dto, teacher, batchId);
            mappings.add(mapping);
            if (dto.getRoleLabel() != null && mapping.getId() != null) {
                mappings.addAll(relabelDuplicateRows(mapping, dto.getRoleLabel()));
            }
        }

        facultyRepository.saveAll(mappings);
    }

    private UserDTO resolveUser(AddFacultyToCourseDTO dto, String instituteId) {
        if (dto.isNewUser()) {
            return inviteUser(dto.getUser(), instituteId);
        }
        syncAuthorMetadata(dto.getUser());
        return dto.getUser();
    }

    /**
     * Push author metadata (subtitle / description / photo) from the Add Course -> Add Authors
     * flow onto the EXISTING user record in auth_service. Best-effort: a transient
     * auth-service failure is logged and swallowed so it never fails course
     * creation/update, and the faculty mapping itself is unaffected.
     * A blank photo never clears an existing one; an unchanged photo alone skips the update.
     */
    private void syncAuthorMetadata(UserDTO teacher) {
        if (teacher == null || teacher.getId() == null) {
            return;
        }
        boolean hasMeta = teacher.getAuthorSubtitle() != null || teacher.getAuthorDescription() != null;
        boolean hasPhoto = StringUtils.hasText(teacher.getProfilePicFileId());
        if (!hasMeta && !hasPhoto) {
            return;
        }
        try {
            UserDTO persistedUser = authService.getUsersFromAuthServiceByUserIds(List.of(teacher.getId()))
                    .stream()
                    .findFirst()
                    .orElseThrow(() -> new IllegalStateException("Author user not found"));
            boolean photoChanged = hasPhoto
                    && !teacher.getProfilePicFileId().equals(persistedUser.getProfilePicFileId());
            if (!hasMeta && !photoChanged) {
                return;
            }
            if (hasMeta) {
                persistedUser.setAuthorSubtitle(teacher.getAuthorSubtitle());
                persistedUser.setAuthorDescription(teacher.getAuthorDescription());
            }
            if (photoChanged) {
                persistedUser.setProfilePicFileId(teacher.getProfilePicFileId());
            }
            authService.updateUser(persistedUser, persistedUser.getId());
        } catch (Exception e) {
            log.warn("Failed to sync author metadata for user {}: {}", teacher.getId(), e.getMessage());
        }
    }

    private FacultySubjectPackageSessionMapping resolveMapping(AddFacultyToCourseDTO dto, UserDTO teacher,
            String batchId) {
        return facultyRepository.findMappingsByUserIdAndPackageSessionIdAndStatusesWithNoSubject(
                teacher.getId(),
                batchId,
                List.of(FacultyStatusEnum.ACTIVE.name()))
                .map(mapping -> {
                    mapping.setStatus(determineStatus(dto));
                    if (dto.getRoleLabel() != null) {
                        mapping.setRoleLabel(CourseRoleLabelService.normalize(dto.getRoleLabel()));
                    }
                    return mapping;
                })
                .orElseGet(() -> {
                    FacultySubjectPackageSessionMapping mapping = new FacultySubjectPackageSessionMapping(
                            teacher.getId(),
                            batchId,
                            null,
                            teacher.getFullName(),
                            determineStatus(dto));
                    mapping.setRoleLabel(CourseRoleLabelService.normalize(dto.getRoleLabel()));
                    return mapping;
                });
    }

    /**
     * addFacultyToBatch never de-duplicates, so a user can hold several ACTIVE course-level
     * rows on one batch. The page reads one role per user per course, so every one of those
     * rows gets the new role, not only the row resolveMapping picked.
     */
    private List<FacultySubjectPackageSessionMapping> relabelDuplicateRows(
            FacultySubjectPackageSessionMapping updated, String roleLabel) {
        String normalized = CourseRoleLabelService.normalize(roleLabel);
        List<FacultySubjectPackageSessionMapping> siblings = new ArrayList<>();
        for (FacultySubjectPackageSessionMapping row : facultyRepository
                .findAllByUserIdAndPackageSessionIdAndSubjectIdIsNullAndStatusIn(
                        updated.getUserId(), updated.getPackageSessionId(),
                        List.of(FacultyStatusEnum.ACTIVE.name()))) {
            if (!updated.getId().equals(row.getId()) && !Objects.equals(normalized, row.getRoleLabel())) {
                row.setRoleLabel(normalized);
                siblings.add(row);
            }
        }
        return siblings;
    }

    private String determineStatus(AddFacultyToCourseDTO dto) {
        return StringUtils.hasText(dto.getStatus()) ? dto.getStatus() : FacultyStatusEnum.ACTIVE.name();
    }

    public List<UserDTO> findFacultyByFilters(String instituteId) {
        Set<String> userIds = facultyRepository.findUserIdsByFilters(instituteId, List.of(StatusEnum.ACTIVE.name()));
        return authService.getUsersFromAuthServiceByUserIds(userIds.stream().toList());
    }

    public UserAccessDetailsDTO getUserAccessDetails(String userId, String instituteId) {
        List<FacultySubjectPackageSessionMapping> mappings = facultyRepository.findByUserId(userId);

        List<UserAccessDetailsDTO.FacultyAccessMappingDTO> accessMappings = mappings.stream()
                .map(m -> UserAccessDetailsDTO.FacultyAccessMappingDTO.builder()
                        .id(m.getId())
                        .userType(m.getUserType())
                        .typeId(m.getTypeId())
                        .accessType(m.getAccessType())
                        .accessId(m.getAccessId())
                        .accessPermission(m.getAccessPermission())
                        .linkageType(m.getLinkageType())
                        .suborgId(m.getSuborgId())
                        .packageSessionId(m.getPackageSessionId())
                        .subjectId(m.getSubjectId())
                        .status(m.getStatus())
                        .name(m.getName())
                        .build())
                .collect(Collectors.toList());

        return UserAccessDetailsDTO.builder()
                .userId(userId)
                .instituteId(instituteId)
                .accessMappings(accessMappings)
                .build();
    }

    public FacultySubjectPackageSessionMapping grantUserAccess(AddUserAccessDTO dto) {
        if (!StringUtils.hasText(dto.getUserId())) {
            throw new VacademyException("User ID is required");
        }

        FacultySubjectPackageSessionMapping mapping = new FacultySubjectPackageSessionMapping();
        mapping.setUserId(dto.getUserId());
        mapping.setPackageSessionId(dto.getPackageSessionId());
        mapping.setSubjectId(dto.getSubjectId());
        mapping.setStatus(StringUtils.hasText(dto.getStatus()) ? dto.getStatus() : FacultyStatusEnum.ACTIVE.name());
        mapping.setName(dto.getName());

        // New fields
        mapping.setUserType(dto.getUserType());
        mapping.setTypeId(dto.getTypeId());
        mapping.setAccessType(dto.getAccessType());
        mapping.setAccessId(dto.getAccessId());
        mapping.setAccessPermission(dto.getAccessPermission());
        mapping.setLinkageType(dto.getLinkageType());
        mapping.setSuborgId(dto.getSuborgId());

        return facultyRepository.save(mapping);
    }
}
