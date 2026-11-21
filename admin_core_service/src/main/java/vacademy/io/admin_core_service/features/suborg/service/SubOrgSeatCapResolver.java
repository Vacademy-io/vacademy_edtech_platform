package vacademy.io.admin_core_service.features.suborg.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollInviteSettingDTO;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;

import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/**
 * The single answer to "how many learner seats does this sub-org have?".
 *
 * <ol>
 *   <li>{@code SUB_ORG_SETTING.MEMBER_COUNT} on the org-level invite: the value the admin set
 *       for THIS sub-org.</li>
 *   <li>The admin's {@code PaymentPlan.memberCount}: for sub-orgs that never stored a setting
 *       (a dedicated plan is the only place they keep their cap).</li>
 * </ol>
 *
 * The setting has to win because a sub-org created on a picked institute option shares that
 * option's plan with the whole institute, so the plan's member_count says nothing about this
 * sub-org. Reading the plan first capped such a sub-org at the institute plan's value.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SubOrgSeatCapResolver {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private final EnrollInviteRepository enrollInviteRepository;

    /** @return the seat cap, or {@code null} when none is configured (unlimited). */
    public Integer resolve(String subOrgId, String parentInstituteId, PaymentPlan adminPlan) {
        if (!StringUtils.hasText(subOrgId) || !StringUtils.hasText(parentInstituteId)) {
            return planMemberCount(adminPlan);
        }
        return resolve(enrollInviteRepository.findBySubOrgIdAndInstituteId(subOrgId, parentInstituteId,
                List.of(StatusEnum.ACTIVE.name(), StatusEnum.INACTIVE.name(), StatusEnum.DELETED.name())), adminPlan);
    }

    /** For callers that already loaded the sub-org's invites. */
    public Integer resolve(List<EnrollInvite> invites, PaymentPlan adminPlan) {
        Integer fromSettings = readMemberCountSetting(invites);
        return fromSettings != null ? fromSettings : planMemberCount(adminPlan);
    }

    private Integer planMemberCount(PaymentPlan plan) {
        return plan != null ? plan.getMemberCount() : null;
    }

    /** ACTIVE invites first, oldest first: the same invite configuration updates write to. */
    private Integer readMemberCountSetting(List<EnrollInvite> invites) {
        if (invites == null) {
            return null;
        }
        return invites.stream()
                .filter(invite -> StringUtils.hasText(invite.getSettingJson()))
                .sorted(Comparator
                        .comparing((EnrollInvite invite) -> !StatusEnum.ACTIVE.name().equalsIgnoreCase(invite.getStatus()))
                        .thenComparing(EnrollInvite::getCreatedAt, Comparator.nullsLast(Comparator.naturalOrder())))
                .map(this::parseMemberCount)
                .flatMap(Optional::stream)
                .findFirst()
                .orElse(null);
    }

    private Optional<Integer> parseMemberCount(EnrollInvite invite) {
        try {
            return Optional.ofNullable(OBJECT_MAPPER.readValue(invite.getSettingJson(), EnrollInviteSettingDTO.class))
                    .map(EnrollInviteSettingDTO::getSetting)
                    .map(EnrollInviteSettingDTO.Settings::getSubOrgSetting)
                    .map(EnrollInviteSettingDTO.SubOrgSetting::getMemberCount);
        } catch (Exception e) {
            log.debug("Could not read MEMBER_COUNT from settingJson for invite {}: {}", invite.getId(), e.getMessage());
            return Optional.empty();
        }
    }
}
