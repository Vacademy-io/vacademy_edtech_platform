package vacademy.io.admin_core_service.features.suborg.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.institute.entity.InstituteSubOrg;
import vacademy.io.admin_core_service.features.institute.repository.InstituteSubOrgRepository;
import vacademy.io.admin_core_service.features.suborg.dto.SubOrgBulkMembersResponseDTO;
import vacademy.io.admin_core_service.features.suborg.dto.SubOrgMoveMembersRequestDTO;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

import static vacademy.io.admin_core_service.features.suborg.dto.SubOrgBulkMembersResponseDTO.*;

/**
 * Bulk move of learners into a sub-organization, run by parent-institute staff.
 *
 * <p>Every learner is processed on its own (each move commits by itself), so one bad row
 * never undoes the others, and the response says what happened to each learner.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SubOrgBulkMemberService {

    static final int MAX_MOVE_PER_REQUEST = 500;

    private final SubOrgMemberMoveService moveService;
    private final AuthService authService;
    private final InstituteSubOrgRepository instituteSubOrgRepository;

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
