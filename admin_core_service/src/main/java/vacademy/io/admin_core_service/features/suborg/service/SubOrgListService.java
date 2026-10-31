package vacademy.io.admin_core_service.features.suborg.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollInviteSettingDTO;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.institute.entity.InstituteSubOrg;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteSubOrgRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.suborg.dto.SubOrgListItemDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.institute.entity.Institute;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * Builds the enriched Manage-VLEs (sub-org) list: each sub-org record joined with its
 * root-admin contact (email/phone/name), plan status, seat usage and org-level invite.
 * Everything is resolved in bulk — one root-admin query, one auth-service round-trip for
 * all admins, one seat-count query — so the list needn't fan out per row.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SubOrgListService {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private final InstituteSubOrgRepository instituteSubOrgRepository;
    private final InstituteRepository instituteRepository;
    private final StudentSessionInstituteGroupMappingRepository ssigmRepository;
    private final AuthService authService;
    private final UserPlanRepository userPlanRepository;
    private final EnrollInviteRepository enrollInviteRepository;

    @Transactional(readOnly = true)
    public Page<SubOrgListItemDTO> getSubOrgsWithDetails(String parentInstituteId, Pageable pageable) {
        return getSubOrgsWithDetails(parentInstituteId, pageable, null);
    }

    /**
     * Assignment-scoped listing.
     *
     * @param allowedSubOrgIds {@code null} = unrestricted (root / true institute admin:
     *        every sub-org under the institute). Otherwise only these sub-orgs are
     *        returned — an EMPTY list yields an empty page, so a caller with no channel
     *        partners assigned sees nothing. Scoping happens in the DB query, so search,
     *        filters, pagination and total counts all operate on the assigned set only.
     */
    @Transactional(readOnly = true)
    public Page<SubOrgListItemDTO> getSubOrgsWithDetails(
            String parentInstituteId, Pageable pageable, List<String> allowedSubOrgIds) {
        if (allowedSubOrgIds != null && allowedSubOrgIds.isEmpty()) {
            return new PageImpl<>(List.of(), pageable, 0);
        }
        Page<InstituteSubOrg> subOrgPage = allowedSubOrgIds == null
                ? instituteSubOrgRepository.findByInstituteId(parentInstituteId, pageable)
                : instituteSubOrgRepository.findByInstituteIdAndSuborgIdIn(
                        parentInstituteId, allowedSubOrgIds, pageable);
        List<InstituteSubOrg> subOrgs = subOrgPage.getContent();
        if (subOrgs.isEmpty()) {
            return new PageImpl<>(List.of(), pageable, subOrgPage.getTotalElements());
        }

        List<String> subOrgIds = subOrgs.stream()
                .map(InstituteSubOrg::getSuborgId)
                .filter(StringUtils::hasText)
                .distinct()
                .collect(Collectors.toList());

        // 1. Root-admin (userId + userPlanId) per sub-org, in one query.
        Map<String, String[]> adminBySubOrg = new HashMap<>();
        if (!subOrgIds.isEmpty()) {
            for (Object[] row : ssigmRepository.findRootAdminBySubOrgIds(subOrgIds)) {
                if (row[0] == null) {
                    continue;
                }
                String soId = String.valueOf(row[0]);
                adminBySubOrg.putIfAbsent(soId, new String[] {
                        row[1] != null ? String.valueOf(row[1]) : null,
                        row[2] != null ? String.valueOf(row[2]) : null
                });
            }
        }

        // 2. Batch-resolve admin users (email/phone/name) in one auth-service round-trip.
        List<String> adminUserIds = adminBySubOrg.values().stream()
                .map(a -> a[0]).filter(Objects::nonNull).distinct().collect(Collectors.toList());
        Map<String, UserDTO> userMap = fetchUsers(adminUserIds);

        // 3. Batch-load admin user plans (plan status + seat cap).
        List<String> planIds = adminBySubOrg.values().stream()
                .map(a -> a[1]).filter(Objects::nonNull).distinct().collect(Collectors.toList());
        Map<String, UserPlan> planMap = new HashMap<>();
        if (!planIds.isEmpty()) {
            userPlanRepository.findAllById(planIds).forEach(p -> planMap.put(p.getId(), p));
        }

        // 4. Active learner-seat count per sub-org, in one query.
        Map<String, Long> usedBySubOrg = new HashMap<>();
        for (Object[] row : ssigmRepository.countActiveLearnersBySubOrgIds(subOrgIds)) {
            if (row[0] != null) {
                usedBySubOrg.put(String.valueOf(row[0]), ((Number) row[1]).longValue());
            }
        }

        // 5. The spawned institutes themselves, in one query — carry the address the
        // registration stamped on them (street line + city/state/pincode; null when never
        // collected).
        Map<String, Institute> instituteBySubOrg = new HashMap<>();
        if (!subOrgIds.isEmpty()) {
            instituteRepository.findAllById(subOrgIds)
                    .forEach(inst -> instituteBySubOrg.put(inst.getId(), inst));
        }

        List<SubOrgListItemDTO> result = new ArrayList<>(subOrgs.size());
        for (InstituteSubOrg so : subOrgs) {
            String soId = so.getSuborgId();
            String[] admin = StringUtils.hasText(soId) ? adminBySubOrg.get(soId) : null;
            UserDTO user = (admin != null && admin[0] != null) ? userMap.get(admin[0]) : null;
            UserPlan plan = (admin != null && admin[1] != null) ? planMap.get(admin[1]) : null;

            String planStatus = null;
            Integer totalSeats = null;
            if (plan != null) {
                planStatus = plan.getStatus();
                try {
                    if (plan.getPaymentPlan() != null) {
                        totalSeats = plan.getPaymentPlan().getMemberCount();
                    }
                } catch (Exception ignored) {
                    // Lazy payment-plan not resolvable — leave the cap null.
                }
            }

            String inviteCode = null;
            String shortUrl = null;
            if (StringUtils.hasText(soId)) {
                List<EnrollInvite> invites = enrollInviteRepository.findBySubOrgIdAndInstituteId(
                        soId, parentInstituteId,
                        List.of(StatusEnum.ACTIVE.name(), StatusEnum.INACTIVE.name(),
                                StatusEnum.DELETED.name()));
                for (EnrollInvite inv : invites) {
                    if (StatusEnum.ACTIVE.name().equalsIgnoreCase(inv.getStatus())) {
                        inviteCode = inv.getInviteCode();
                        shortUrl = inv.getShortUrl();
                        break;
                    }
                }
                // The seat cap for CPO / spawned sub-orgs lives on the org-invite settings, not
                // the admin's PaymentPlan — fall back to it so "occupied / total" always has a total.
                if (totalSeats == null) {
                    totalSeats = readMemberCountFromInvites(invites);
                }
            }

            Institute spawned = StringUtils.hasText(soId) ? instituteBySubOrg.get(soId) : null;

            result.add(SubOrgListItemDTO.builder()
                    .suborgId(soId)
                    .name(so.getName())
                    .status(so.getStatus())
                    // Set from the mapping row, not the auth lookup, so the action stays
                    // available even when auth-service enrichment failed for this page.
                    .adminUserId(admin != null ? admin[0] : null)
                    .adminName(user != null ? user.getFullName() : null)
                    .adminEmail(user != null ? user.getEmail() : null)
                    .adminPhone(user != null ? user.getMobileNumber() : null)
                    .addressLine(spawned != null ? spawned.getAddress() : null)
                    .city(spawned != null ? spawned.getCity() : null)
                    .state(spawned != null ? spawned.getState() : null)
                    .pincode(spawned != null ? spawned.getPinCode() : null)
                    .planStatus(planStatus)
                    .usedSeats(StringUtils.hasText(soId) ? usedBySubOrg.getOrDefault(soId, 0L) : null)
                    .totalSeats(totalSeats)
                    // Same population as usedSeats (distinct ACTIVE non-admin members), exposed
                    // as its own field so the list can show a learner count even when the
                    // sub-org has no seat cap and "occupied / total" would render blank.
                    .learnerCount(StringUtils.hasText(soId) ? usedBySubOrg.getOrDefault(soId, 0L) : 0L)
                    .inviteCode(inviteCode)
                    .shortUrl(shortUrl)
                    .createdAt(so.getCreatedAt())
                    .build());
        }
        // Preserve the page's paging metadata (total count / number / size) while returning
        // the enriched rows for just this page.
        return new PageImpl<>(result, pageable, subOrgPage.getTotalElements());
    }

    /** Read the sub-org's seat cap (MEMBER_COUNT) off the org-level invite's settingJson. */
    private Integer readMemberCountFromInvites(List<EnrollInvite> invites) {
        for (EnrollInvite invite : invites) {
            if (!StringUtils.hasText(invite.getSettingJson())) {
                continue;
            }
            try {
                EnrollInviteSettingDTO dto = OBJECT_MAPPER.readValue(
                        invite.getSettingJson(), EnrollInviteSettingDTO.class);
                Integer mc = Optional.ofNullable(dto)
                        .map(EnrollInviteSettingDTO::getSetting)
                        .map(EnrollInviteSettingDTO.Settings::getSubOrgSetting)
                        .map(EnrollInviteSettingDTO.SubOrgSetting::getMemberCount)
                        .orElse(null);
                if (mc != null) {
                    return mc;
                }
            } catch (Exception ignored) {
                // Malformed settings — try the next invite.
            }
        }
        return null;
    }

    private Map<String, UserDTO> fetchUsers(List<String> userIds) {
        if (userIds.isEmpty()) {
            return Map.of();
        }
        try {
            Map<String, UserDTO> map = new HashMap<>();
            for (UserDTO u : authService.getUsersFromAuthServiceByUserIds(userIds)) {
                if (u != null && u.getId() != null) {
                    map.put(u.getId(), u);
                }
            }
            return map;
        } catch (Exception e) {
            log.warn("Failed to resolve sub-org admin users for VLE list: {}", e.getMessage());
            return Map.of();
        }
    }
}
