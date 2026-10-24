package vacademy.io.auth_service.feature.vimotion.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.auth_service.feature.vimotion.dto.AdminInviteCodeDTO;
import vacademy.io.auth_service.feature.vimotion.dto.AdminStatsResponse;
import vacademy.io.auth_service.feature.vimotion.dto.AdminWaitlistEntryDTO;
import vacademy.io.auth_service.feature.vimotion.dto.CreateInviteCodeRequest;
import vacademy.io.auth_service.feature.vimotion.dto.InviteWaitlistRequest;
import vacademy.io.auth_service.feature.vimotion.dto.InviteWaitlistResponse;
import vacademy.io.auth_service.feature.vimotion.dto.PagedResponse;
import vacademy.io.auth_service.feature.vimotion.dto.RedemptionDTO;
import vacademy.io.auth_service.feature.vimotion.dto.WaitlistStatusResponse;
import vacademy.io.auth_service.feature.vimotion.entity.InviteCode;
import vacademy.io.auth_service.feature.vimotion.entity.WaitlistEntry;
import vacademy.io.auth_service.feature.vimotion.service.InviteCodeService;
import vacademy.io.auth_service.feature.vimotion.service.WaitlistService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

/**
 * Admin surface for the Vimotion launch tooling — consumed by
 * vacademy-health-check. JWT-authenticated (paths are not in ALLOWED_PATHS)
 * and platform staff only: every handler calls
 * {@link SuperAdminAuthUtil#requireSuperAdmin}.
 */
@RestController
@RequestMapping("/auth-service/v1/vimotion/admin")
public class VimotionAdminController {

    @Autowired
    private WaitlistService waitlistService;

    @Autowired
    private InviteCodeService inviteCodeService;

    /* ============================================================
     * Waitlist
     * ============================================================ */

    @GetMapping("/waitlist")
    public PagedResponse<AdminWaitlistEntryDTO> listWaitlist(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(value = "status", required = false) String status,
            @RequestParam(value = "search", required = false) String search,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "25") int size) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        Pageable pageable = PageRequest.of(Math.max(0, page), Math.min(Math.max(1, size), 200));
        Page<WaitlistEntry> result = waitlistService.list(status, search, pageable);
        return PagedResponse.from(result, this::toAdminWaitlist);
    }

    @PostMapping("/waitlist/{id}/invite")
    public InviteWaitlistResponse inviteWaitlist(@RequestAttribute("user") CustomUserDetails user,
                                                 @PathVariable("id") String id,
                                                 @RequestBody InviteWaitlistRequest request) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        WaitlistService.InviteResult result = waitlistService.invite(
                id,
                request != null && request.isSendEmail(),
                request == null ? null : request.getNote(),
                "vimotion-admin");
        return InviteWaitlistResponse.builder()
                .code(toAdminInviteCode(result.code()))
                .emailSent(result.emailSent())
                .build();
    }

    @PostMapping("/waitlist/{id}/reject")
    public AdminWaitlistEntryDTO rejectWaitlist(@RequestAttribute("user") CustomUserDetails user,
                                                @PathVariable("id") String id) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return toAdminWaitlist(waitlistService.reject(id));
    }

    /* ============================================================
     * Invite codes
     * ============================================================ */

    @GetMapping("/invite-codes")
    public PagedResponse<AdminInviteCodeDTO> listInviteCodes(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(value = "kind", required = false) String kind,
            @RequestParam(value = "status", required = false) String status,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "25") int size) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        Pageable pageable = PageRequest.of(Math.max(0, page), Math.min(Math.max(1, size), 200));
        Page<InviteCode> result = inviteCodeService.list(kind, status, pageable);
        return PagedResponse.from(result, this::toAdminInviteCode);
    }

    @PostMapping("/invite-codes")
    public AdminInviteCodeDTO createInviteCode(@RequestAttribute("user") CustomUserDetails user,
                                               @RequestBody CreateInviteCodeRequest request) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        if (request == null || request.getKind() == null) {
            throw new VacademyException("kind is required ('open' or 'locked')");
        }
        InviteCode code;
        if (InviteCode.KIND_OPEN.equalsIgnoreCase(request.getKind())) {
            code = inviteCodeService.createOpen(
                    request.getMaxUses(),
                    request.getExpiresAt(),
                    request.getNote(),
                    "vimotion-admin");
        } else if (InviteCode.KIND_LOCKED.equalsIgnoreCase(request.getKind())) {
            code = inviteCodeService.createLocked(
                    request.getLockedEmail(),
                    request.getLockedPhoneNumber(),
                    null,
                    request.getExpiresAt(),
                    request.getNote(),
                    "vimotion-admin");
        } else {
            throw new VacademyException("kind must be 'open' or 'locked'");
        }
        return toAdminInviteCode(code);
    }

    @PostMapping("/invite-codes/{id}/revoke")
    public AdminInviteCodeDTO revokeInviteCode(@RequestAttribute("user") CustomUserDetails user,
                                               @PathVariable("id") String id) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return toAdminInviteCode(inviteCodeService.revoke(id));
    }

    @GetMapping("/invite-codes/{id}/redemptions")
    public List<RedemptionDTO> listRedemptions(@RequestAttribute("user") CustomUserDetails user,
                                               @PathVariable("id") String id) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return inviteCodeService.listRedemptions(id).stream()
                .map(r -> RedemptionDTO.builder()
                        .id(r.getId())
                        .inviteCodeId(r.getInviteCodeId())
                        .email(r.getEmail())
                        .phoneNumber(r.getPhoneNumber())
                        .userId(r.getUserId())
                        .instituteId(r.getInstituteId())
                        .redeemedAt(r.getRedeemedAt())
                        .build())
                .toList();
    }

    /* ============================================================
     * Stats
     * ============================================================ */

    @GetMapping("/stats")
    public AdminStatsResponse stats(@RequestAttribute("user") CustomUserDetails user) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        long pending = waitlistService.countByStatus(WaitlistEntry.STATUS_PENDING);
        long invited = waitlistService.countByStatus(WaitlistEntry.STATUS_INVITED);
        long converted = waitlistService.countByStatus(WaitlistEntry.STATUS_CONVERTED);
        long rejected = waitlistService.countByStatus(WaitlistEntry.STATUS_REJECTED);
        long total = pending + invited + converted + rejected;
        double conversionRate = total == 0 ? 0d : (double) converted / total;

        List<AdminStatsResponse.TopReferrer> top = waitlistService.topReferrers(10).stream()
                .map(w -> AdminStatsResponse.TopReferrer.builder()
                        .id(w.getId())
                        .fullName(w.getFullName())
                        .referralCode(w.getReferralCode())
                        .referralCount(w.getReferralCount())
                        .build())
                .toList();

        return AdminStatsResponse.builder()
                .waitlistTotal(total)
                .waitlistPending(pending)
                .waitlistInvited(invited)
                .waitlistConverted(converted)
                .waitlistRejected(rejected)
                .invitesActive(inviteCodeService.list(null, InviteCode.STATUS_ACTIVE,
                        PageRequest.of(0, 1)).getTotalElements())
                .invitesExhausted(inviteCodeService.list(null, InviteCode.STATUS_EXHAUSTED,
                        PageRequest.of(0, 1)).getTotalElements())
                .invitesRevoked(inviteCodeService.list(null, InviteCode.STATUS_REVOKED,
                        PageRequest.of(0, 1)).getTotalElements())
                .conversionRate(conversionRate)
                .topReferrers(top)
                .build();
    }

    /* ============================================================
     * Mappers
     * ============================================================ */

    private AdminWaitlistEntryDTO toAdminWaitlist(WaitlistEntry entry) {
        WaitlistStatusResponse status = waitlistService.toStatusResponse(entry);
        return AdminWaitlistEntryDTO.builder()
                .id(entry.getId())
                .fullName(entry.getFullName())
                .email(entry.getEmail())
                .phoneNumber(entry.getPhoneNumber())
                .status(entry.getStatus())
                .referrerId(entry.getReferrerId())
                .referralCode(entry.getReferralCode())
                .referralCount(entry.getReferralCount())
                .position(entry.getPosition())
                .effectivePosition(status.getEffectivePosition())
                .source(entry.getSource())
                .createdAt(entry.getCreatedAt())
                .updatedAt(entry.getUpdatedAt())
                .build();
    }

    private AdminInviteCodeDTO toAdminInviteCode(InviteCode code) {
        return AdminInviteCodeDTO.builder()
                .id(code.getId())
                .code(code.getCode())
                .kind(code.getKind())
                .status(code.getStatus())
                .lockedEmail(code.getLockedEmail())
                .lockedPhoneNumber(code.getLockedPhoneNumber())
                .waitlistId(code.getWaitlistId())
                .maxUses(code.getMaxUses())
                .usedCount(code.getUsedCount())
                .expiresAt(code.getExpiresAt())
                .note(code.getNote())
                .createdBy(code.getCreatedBy())
                .createdAt(code.getCreatedAt())
                .build();
    }
}
