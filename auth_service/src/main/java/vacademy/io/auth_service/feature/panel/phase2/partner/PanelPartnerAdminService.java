package vacademy.io.auth_service.feature.panel.phase2.partner;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import vacademy.io.auth_service.feature.institute_oauth.service.InstituteOAuthClientAccessGuard;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.DeviceCurrentSession;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.DeviceRowResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerInviteRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerInviteResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerLinkRow;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerOpenInviteRow;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.RoomRef;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.StatusResponse;
import vacademy.io.auth_service.feature.panel.phase2.PanelLicenceGate.InstituteLicenceView;
import vacademy.io.auth_service.feature.panel.phase2.PanelPhase2Errors;
import vacademy.io.auth_service.feature.panel.phase2.PanelPhase2Properties;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelInputs;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceService;
import vacademy.io.auth_service.feature.panel.phase2.partner.PanelPartnerRepository.InviteRow;
import vacademy.io.auth_service.feature.panel.phase2.partner.PanelPartnerRepository.LinkRow;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.DeviceListRow;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.DeviceRow;
import vacademy.io.auth_service.feature.panel.service.PanelApiException;
import vacademy.io.auth_service.feature.panel.service.PanelDevices;
import vacademy.io.auth_service.feature.panel.service.PanelRateLimiter;
import vacademy.io.auth_service.feature.panel.service.PanelSecrets;
import vacademy.io.auth_service.feature.panel.service.PanelTimers;
import vacademy.io.auth_service.feature.panel.service.PanelTx;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.UUID;

/**
 * The school's side of installers: linking an installer organisation with a one-time code, seeing
 * and revoking links, and approving or rejecting panels an installer set up. Each call needs an
 * ACTIVE ADMIN role at the row's own institute, so an admin of one school cannot reach another's
 * invite, link or panel by its id. 404 FEATURE_OFF while panel.partners.enabled is false, except
 * approve and reject: they only ever act on panels already waiting, so a school can always settle
 * those, whatever the switch.
 *
 * <pre>
 *   panel.partners.invite-valid-days      7   how long a school's code can be redeemed
 *   panel.partners.default-install-days  30   install window when a request names none
 * </pre>
 */
@Service
public class PanelPartnerAdminService {

    public static final int INVITES_PER_USER_PER_HOUR = 10;
    public static final int MAX_INSTALL_DAYS = 90;
    static final int MAX_OPEN_INVITES = 200;
    private static final int INSERT_ATTEMPTS = 3;

    private final PanelPartnerRepository partners;
    private final PanelRepository panels;
    private final PanelPhase2Properties phase2;
    private final PanelRateLimiter rateLimiter;
    private final PanelTx tx;
    private final InstituteOAuthClientAccessGuard accessGuard;
    private final PanelDevices devices;
    private final PanelLicenceService licence;
    private final int inviteValidDays;
    private final int defaultInstallDays;

    @Autowired
    public PanelPartnerAdminService(PanelPartnerRepository partners, PanelRepository panels,
            PanelPhase2Properties phase2, PanelRateLimiter rateLimiter, PanelTx tx,
            InstituteOAuthClientAccessGuard accessGuard, PanelDevices devices, PanelLicenceService licence,
            @Value("${panel.partners.invite-valid-days:7}") int inviteValidDays,
            @Value("${panel.partners.default-install-days:30}") int defaultInstallDays) {
        this.partners = partners;
        this.panels = panels;
        this.phase2 = phase2;
        this.rateLimiter = rateLimiter;
        this.tx = tx;
        this.accessGuard = accessGuard;
        this.devices = devices;
        this.licence = licence;
        this.inviteValidDays = Math.max(1, inviteValidDays);
        this.defaultInstallDays = Math.min(MAX_INSTALL_DAYS, Math.max(1, defaultInstallDays));
    }

    // --------------------------------------------------------------- links ---

    public List<PartnerLinkRow> links(CustomUserDetails user, String instituteId) {
        phase2.requirePartners();
        PanelInputs.instituteId(instituteId);
        return tx.run(() -> {
            accessGuard.requireInstituteAdmin(user, instituteId);
            return partners.listActiveLinksOfInstitute(instituteId).stream()
                    .map(link -> new PartnerLinkRow(link.id(), link.partnerName(), link.linkedVia(),
                            PanelInputs.iso(link.installUntil()), PanelInputs.iso(link.createdAt()), link.installs()))
                    .toList();
        });
    }

    /** The code is returned once and stored only as its SHA-256. */
    public PartnerInviteResponse createInvite(CustomUserDetails user, PartnerInviteRequest body) {
        phase2.requirePartners();
        if (body == null) {
            throw PanelApiException.badRequest("institute_id is required");
        }
        String instituteId = PanelInputs.instituteId(body.instituteId());
        int installDays = body.installDays() == null ? defaultInstallDays
                : PanelInputs.range(body.installDays(), 1, MAX_INSTALL_DAYS, "install_days");
        rateLimiter.check("partner_invite", user.getUserId(), INVITES_PER_USER_PER_HOUR, PanelRateLimiter.HOUR_MS);
        return tx.run(() -> {
            accessGuard.requireInstituteAdmin(user, instituteId);
            for (int attempt = 0; attempt < INSERT_ATTEMPTS; attempt++) {
                String code = PanelSecrets.code();
                String id = UUID.randomUUID().toString();
                if (partners.insertInvite(id, instituteId, PanelSecrets.sha256Hex(code), installDays, inviteValidDays,
                        user.getUserId()) == 1) {
                    InviteRow invite = partners.findInvite(id).orElseThrow();
                    return new PartnerInviteResponse(id, code, PanelInputs.iso(invite.expiresAt()));
                }
            }
            throw PanelApiException.tryAgain();
        });
    }

    /** Cancelling twice answers the same. A used or expired code cannot be cancelled. */
    public StatusResponse cancelInvite(CustomUserDetails user, String inviteId) {
        phase2.requirePartners();
        PanelInputs.rowId(inviteId, "code");
        return tx.run(() -> {
            InviteRow invite = partners.findInvite(inviteId)
                    .orElseThrow(() -> PanelApiException.notFound("No such code"));
            accessGuard.requireInstituteAdmin(user, invite.instituteId());
            if (partners.cancelInvite(inviteId) == 0 && !"CANCELLED".equals(invite.state())) {
                throw PanelPhase2Errors.inviteInvalid();
            }
            return new StatusResponse("CANCELLED");
        });
    }

    /** Open codes of the school, newest first: never the code itself. */
    public List<PartnerOpenInviteRow> openInvites(CustomUserDetails user, String instituteId) {
        phase2.requirePartners();
        PanelInputs.instituteId(instituteId);
        return tx.run(() -> {
            accessGuard.requireInstituteAdmin(user, instituteId);
            return partners.listOpenInvites(instituteId, MAX_OPEN_INVITES).stream()
                    .map(invite -> new PartnerOpenInviteRow(invite.id(), PanelInputs.iso(invite.createdAt()),
                            PanelInputs.iso(invite.expiresAt()), invite.installDays(), invite.createdBy()))
                    .toList();
        });
    }

    /**
     * Panels the organisation already set up stay as they are, pending ones included, for the school
     * to decide. The school's open codes are cancelled with it, whichever organisation they were for.
     */
    public StatusResponse revokeLink(CustomUserDetails user, String linkId) {
        phase2.requirePartners();
        PanelInputs.rowId(linkId, "link");
        return tx.run(() -> {
            LinkRow link = partners.findLink(linkId).orElseThrow(() -> PanelApiException.notFound("No such link"));
            accessGuard.requireInstituteAdmin(user, link.instituteId());
            if (partners.revokeLink(linkId, user.getUserId()) == 1) {
                partners.cancelPendingInvitesOfInstitute(link.instituteId());
            }
            return new StatusResponse("REVOKED");
        });
    }

    // ----------------------------------------------------------- approvals ---

    /**
     * PENDING to APPROVED, then a seat if one is free (the panel's room keeps any seat it holds).
     * Approving an approved panel answers it as it is. The device row is written before the seat
     * lock is taken, the same order as the pairing confirm. Not behind panel.partners.enabled.
     */
    public DeviceRowResponse approve(CustomUserDetails user, String deviceId) {
        PanelInputs.rowId(deviceId, "panel");
        return tx.run(() -> {
            DeviceRow device = panels.findDevice(deviceId).orElseThrow(() -> PanelApiException.notFound("No such panel"));
            accessGuard.requireInstituteAdmin(user, device.instituteId());
            if ("REVOKED".equals(device.status())) {
                throw PanelApiException.deviceNotActive();
            }
            String state = device.approvalState() == null ? "APPROVED" : device.approvalState();
            if ("PENDING".equals(state)) {
                if (partners.approveDevice(deviceId, user.getUserId()) == 1) {
                    licence.onApproved(deviceId, device.instituteId(), user.getUserId());
                }
            } else if (!"APPROVED".equals(state)) {
                throw PanelApiException.badRequest("This panel is not waiting for approval");
            }
            return deviceResponse(panels.listDevices(device.instituteId(), deviceId).get(0),
                    licence.view(device.instituteId()));
        });
    }

    /**
     * Removes the panel from its room, as revoke does, and records the rejection. Not behind
     * panel.partners.enabled.
     */
    public StatusResponse reject(CustomUserDetails user, String deviceId) {
        PanelInputs.rowId(deviceId, "panel");
        return tx.run(() -> {
            DeviceRow device = panels.findDevice(deviceId).orElseThrow(() -> PanelApiException.notFound("No such panel"));
            accessGuard.requireInstituteAdmin(user, device.instituteId());
            String state = device.approvalState() == null ? "APPROVED" : device.approvalState();
            if ("REJECTED".equals(state)) {
                return new StatusResponse("REVOKED");
            }
            if (!"PENDING".equals(state)) {
                throw PanelApiException.badRequest("This panel is not waiting for approval");
            }
            devices.revokeInTx(deviceId, user.getUserId());
            partners.markRejected(deviceId, user.getUserId());
            return new StatusResponse("REVOKED");
        });
    }

    /** The same row the panel list shows. */
    static DeviceRowResponse deviceResponse(DeviceListRow row, InstituteLicenceView seats) {
        DeviceRow d = row.device();
        boolean online = d.lastSeenAt() != null
                && d.dbNow().getTime() - d.lastSeenAt().getTime() < PanelTimers.DEVICE_ONLINE_MS;
        DeviceCurrentSession current = null;
        if (row.sessionId() != null) {
            current = new DeviceCurrentSession(row.sessionId(), row.sessionUserId(), row.sessionUserName(),
                    row.sessionStartedVia(), row.sessionCreatedAt().toInstant().toString(),
                    Math.max(0, (row.sessionExpiresAt().getTime() - d.dbNow().getTime()) / 1000), row.approvedIp());
        }
        return new DeviceRowResponse(d.id(), new RoomRef(d.roomId(), d.roomName()), d.status(), online,
                PanelInputs.iso(d.lastSeenAt()), d.lastIp(), d.model(), d.manufacturer(), d.sdkInt(), d.webviewMajor(),
                d.appVersionCode(), d.passwordLoginAllowed(), d.claimedByName(), PanelInputs.iso(d.claimedAt()),
                current, d.approvalState() == null ? "APPROVED" : d.approvalState(), d.appChannel(),
                d.installedByName(), seats == null ? null : seats.roomState(d.roomId()));
    }
}
