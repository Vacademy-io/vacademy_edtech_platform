package vacademy.io.admin_core_service.features.suborg.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.enroll_invite.enums.SubOrgRoles;
import vacademy.io.admin_core_service.features.institute.entity.InstituteSubOrg;
import vacademy.io.admin_core_service.features.institute.repository.InstituteSubOrgRepository;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionStatusEnum;
import vacademy.io.admin_core_service.features.learner.dto.SubOrgEnrollRequestDTO;
import vacademy.io.admin_core_service.features.learner.service.SubOrgLearnerService;
import vacademy.io.admin_core_service.features.packages.repository.PackageInstituteRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.suborg.dto.SubOrgBulkAddMembersRequestDTO;
import vacademy.io.admin_core_service.features.suborg.dto.SubOrgBulkMembersResponseDTO;
import vacademy.io.admin_core_service.features.suborg.dto.SubOrgMoveMembersRequestDTO;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

import static vacademy.io.admin_core_service.features.suborg.dto.SubOrgBulkMembersResponseDTO.*;

/**
 * Bulk add / move of learners into a sub-organization, run by parent-institute staff.
 *
 * <p>Every learner is processed on its own (each add or move commits by itself), so one bad
 * row never undoes the others, and the response says what happened to each learner.
 *
 * <p>Adding a learner who is already ACTIVE in the batch moves that enrollment rather than
 * creating a second one; everyone else goes through the same add-member path the sub-org
 * page and the learner portal use (seat limit, learner plan, enrollment workflow).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SubOrgBulkMemberService {

    /** Each add creates an account and runs the enrollment workflow; the UI sends chunks. */
    static final int MAX_ADD_PER_REQUEST = 100;
    static final int MAX_MOVE_PER_REQUEST = 500;

    private final SubOrgMemberMoveService moveService;
    private final SubOrgLearnerService subOrgLearnerService;
    private final AuthService authService;
    private final InstituteSubOrgRepository instituteSubOrgRepository;
    private final PackageSessionRepository packageSessionRepository;
    private final PackageInstituteRepository packageInstituteRepository;

    public SubOrgBulkMembersResponseDTO addMembers(SubOrgBulkAddMembersRequestDTO request, CustomUserDetails caller) {
        String instituteId = request.getInstituteId();
        String subOrgId = request.getSubOrgId();
        String packageSessionId = request.getPackageSessionId();
        if (!StringUtils.hasText(packageSessionId)) {
            throw new VacademyException("Pick the batch to add the learners to");
        }
        List<UserDTO> learners = request.getLearners() == null ? List.of() : request.getLearners();
        if (learners.isEmpty()) {
            throw new VacademyException("Add at least one learner");
        }
        if (learners.size() > MAX_ADD_PER_REQUEST) {
            throw new VacademyException("At most " + MAX_ADD_PER_REQUEST + " learners can be added per request");
        }
        assertSubOrgOfInstitute(subOrgId, instituteId);
        assertBatchOfInstitute(packageSessionId, instituteId);

        Map<String, UserDTO> knownById = fetchUsers(learners.stream()
                .map(UserDTO::getId).filter(StringUtils::hasText).distinct().toList());

        List<Item> results = new ArrayList<>();
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (UserDTO learner : learners) {
            Item.ItemBuilder item = Item.builder()
                    .userId(learner.getId())
                    .name(learner.getFullName())
                    .email(learner.getEmail())
                    .packageSessionId(packageSessionId);
            String key = dedupeKey(learner);
            if (key == null) {
                results.add(item.status(FAILED).message("An email or mobile number is required").build());
                continue;
            }
            if (!seen.add(key)) {
                results.add(item.status(FAILED).message("Listed more than once; added only once").build());
                continue;
            }
            try {
                UserDTO existing = StringUtils.hasText(learner.getId())
                        ? knownById.get(learner.getId())
                        : findExistingUser(learner);
                if (StringUtils.hasText(learner.getId()) && existing == null) {
                    results.add(item.status(FAILED).message("Learner account not found").build());
                    continue;
                }
                if (existing != null) {
                    item.userId(existing.getId())
                            .name(StringUtils.hasText(existing.getFullName()) ? existing.getFullName() : learner.getFullName())
                            .email(StringUtils.hasText(existing.getEmail()) ? existing.getEmail() : learner.getEmail());
                }
                if (existing != null && moveService.hasActiveEnrollment(existing.getId(), packageSessionId, instituteId)) {
                    SubOrgMemberMoveService.Outcome outcome = moveService.moveActiveEnrollment(
                            existing.getId(), packageSessionId, instituteId, subOrgId, caller);
                    results.add(outcome == SubOrgMemberMoveService.Outcome.MOVED
                            ? item.status(MOVED).message("Already enrolled in this batch; moved into the sub-org").build()
                            : item.status(ALREADY_MEMBER).message("Already in this sub-org").build());
                    continue;
                }
                UserDTO user = existing != null ? enrollableCopy(existing) : enrollableCopy(learner);
                user.setId(existing != null ? existing.getId() : null);
                var response = subOrgLearnerService.enrollLearnerToSubOrg(SubOrgEnrollRequestDTO.builder()
                        .user(user)
                        .packageSessionId(packageSessionId)
                        .subOrgId(subOrgId)
                        .instituteId(instituteId)
                        .status(LearnerSessionStatusEnum.ACTIVE.name())
                        .commaSeparatedOrgRoles(SubOrgRoles.LEARNER.name())
                        .build(), caller);
                if (response != null && response.getUser() != null) {
                    item.userId(response.getUser().getId());
                }
                results.add(item.status(ADDED).message(null).build());
            } catch (VacademyException e) {
                results.add(item.status(FAILED).message(e.getMessage()).build());
            } catch (Exception e) {
                log.error("Bulk sub-org add failed for {} into sub-org {}: {}", key, subOrgId, e.getMessage(), e);
                results.add(item.status(FAILED).message("Could not add this learner. Please try again.").build());
            }
        }
        return summarize(results);
    }

    public SubOrgBulkMembersResponseDTO moveMembers(SubOrgMoveMembersRequestDTO request, CustomUserDetails caller) {
        String instituteId = request.getInstituteId();
        String subOrgId = request.getSubOrgId();
        List<SubOrgMoveMembersRequestDTO.Member> members = request.getMembers() == null ? List.of() : request.getMembers();
        if (members.isEmpty()) {
            throw new VacademyException("Select at least one learner to move");
        }
        if (members.size() > MAX_MOVE_PER_REQUEST) {
            throw new VacademyException("At most " + MAX_MOVE_PER_REQUEST + " learners can be moved per request");
        }
        assertSubOrgOfInstitute(subOrgId, instituteId);

        // One move per enrollment, even when the same row arrives twice.
        Map<String, SubOrgMoveMembersRequestDTO.Member> unique = new LinkedHashMap<>();
        for (SubOrgMoveMembersRequestDTO.Member m : members) {
            if (m != null && StringUtils.hasText(m.getUserId()) && StringUtils.hasText(m.getPackageSessionId())) {
                unique.putIfAbsent(m.getUserId() + "|" + m.getPackageSessionId(), m);
            }
        }
        Map<String, UserDTO> users = fetchUsersQuietly(unique.values().stream()
                .map(SubOrgMoveMembersRequestDTO.Member::getUserId).distinct().toList());

        List<Item> results = new ArrayList<>();
        int skippedBlank = members.size() - (int) members.stream()
                .filter(m -> m != null && StringUtils.hasText(m.getUserId()) && StringUtils.hasText(m.getPackageSessionId()))
                .count();
        for (int i = 0; i < skippedBlank; i++) {
            results.add(Item.builder().status(FAILED).message("Not enrolled in a batch").build());
        }
        for (SubOrgMoveMembersRequestDTO.Member member : unique.values()) {
            UserDTO user = users.get(member.getUserId());
            Item.ItemBuilder item = Item.builder()
                    .userId(member.getUserId())
                    .name(user != null ? user.getFullName() : null)
                    .email(user != null ? user.getEmail() : null)
                    .packageSessionId(member.getPackageSessionId());
            try {
                SubOrgMemberMoveService.Outcome outcome = moveService.moveActiveEnrollment(
                        member.getUserId(), member.getPackageSessionId(), instituteId, subOrgId, caller);
                results.add(outcome == SubOrgMemberMoveService.Outcome.MOVED
                        ? item.status(MOVED).build()
                        : item.status(ALREADY_MEMBER).message("Already in this sub-org").build());
            } catch (VacademyException e) {
                results.add(item.status(FAILED).message(e.getMessage()).build());
            } catch (Exception e) {
                log.error("Sub-org move failed for user {} batch {} into {}: {}", member.getUserId(),
                        member.getPackageSessionId(), subOrgId, e.getMessage(), e);
                results.add(item.status(FAILED).message("Could not move this learner. Please try again.").build());
            }
        }
        return summarize(results);
    }

    /** The sub-org must be one of this institute's, or staff of one institute could stamp another's. */
    private void assertSubOrgOfInstitute(String subOrgId, String instituteId) {
        boolean linked = instituteSubOrgRepository.findBySuborgId(subOrgId).stream()
                .map(InstituteSubOrg::getInstituteId)
                .anyMatch(instituteId::equals);
        if (!linked) {
            throw new VacademyException("This sub-organization does not belong to the institute");
        }
    }

    /** The batch must be the institute's own: enrolling into another institute's batch is never right. */
    private void assertBatchOfInstitute(String packageSessionId, String instituteId) {
        String packageId = packageSessionRepository.findById(packageSessionId)
                .map(ps -> ps.getPackageEntity() != null ? ps.getPackageEntity().getId() : null)
                .orElseThrow(() -> new VacademyException("Batch not found"));
        if (packageId == null || !packageInstituteRepository.existsLink(packageId, instituteId)) {
            throw new VacademyException("This batch does not belong to the institute");
        }
    }

    /**
     * The account this row would land on: by email, or by mobile when the row has no email.
     * A failed lookup fails the row rather than risking a duplicate enrollment.
     */
    private UserDTO findExistingUser(UserDTO learner) {
        if (StringUtils.hasText(learner.getEmail())) {
            return authService.findUserByEmailStrict(learner.getEmail()).orElse(null);
        }
        if (StringUtils.hasText(learner.getMobileNumber())) {
            return authService.getUserByMobile(learner.getMobileNumber()).orElse(null);
        }
        return null;
    }

    private static String dedupeKey(UserDTO learner) {
        if (StringUtils.hasText(learner.getId())) return "id:" + learner.getId();
        if (StringUtils.hasText(learner.getEmail())) return "email:" + learner.getEmail().trim().toLowerCase(Locale.ROOT);
        if (StringUtils.hasText(learner.getMobileNumber())) return "mobile:" + learner.getMobileNumber().trim();
        return null;
    }

    /** Only the identity fields add-member needs; never another account's password or roles. */
    private static UserDTO enrollableCopy(UserDTO source) {
        UserDTO user = new UserDTO();
        user.setEmail(StringUtils.hasText(source.getEmail()) ? source.getEmail().trim().toLowerCase(Locale.ROOT) : null);
        user.setFullName(source.getFullName() != null ? source.getFullName().trim() : null);
        user.setMobileNumber(source.getMobileNumber());
        user.setUsername(source.getUsername());
        user.setRoles(List.of("STUDENT"));
        return user;
    }

    private Map<String, UserDTO> fetchUsers(List<String> userIds) {
        if (userIds.isEmpty()) return Map.of();
        return authService.getUsersFromAuthServiceByUserIds(userIds).stream()
                .filter(u -> u != null && StringUtils.hasText(u.getId()))
                .collect(Collectors.toMap(UserDTO::getId, Function.identity(), (a, b) -> a));
    }

    /** Names and emails for the result list only; the move itself does not need them. */
    private Map<String, UserDTO> fetchUsersQuietly(List<String> userIds) {
        try {
            return fetchUsers(userIds);
        } catch (Exception e) {
            log.warn("Could not load learner names for the sub-org move result: {}", e.getMessage());
            return Map.of();
        }
    }

    private static SubOrgBulkMembersResponseDTO summarize(List<Item> results) {
        Map<String, Long> byStatus = results.stream()
                .collect(Collectors.groupingBy(Item::getStatus, Collectors.counting()));
        return SubOrgBulkMembersResponseDTO.builder()
                .total(results.size())
                .added(Optional.ofNullable(byStatus.get(ADDED)).orElse(0L).intValue())
                .moved(Optional.ofNullable(byStatus.get(MOVED)).orElse(0L).intValue())
                .alreadyMember(Optional.ofNullable(byStatus.get(ALREADY_MEMBER)).orElse(0L).intValue())
                .failed(Optional.ofNullable(byStatus.get(FAILED)).orElse(0L).intValue())
                .results(results)
                .build();
    }
}
