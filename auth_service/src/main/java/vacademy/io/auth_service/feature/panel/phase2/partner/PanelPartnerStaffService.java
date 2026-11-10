package vacademy.io.auth_service.feature.panel.phase2.partner;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerCreateRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerLinkCreateRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerLinkResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerPatchRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.RoomPartnerPatchRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.StatusResponse;
import vacademy.io.auth_service.feature.panel.phase2.PanelPhase2Properties;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelInputs;
import vacademy.io.auth_service.feature.panel.phase2.partner.PanelPartnerRepository.LinkRow;
import vacademy.io.auth_service.feature.panel.phase2.partner.PanelPartnerRepository.PartnerRow;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository;
import vacademy.io.auth_service.feature.panel.service.PanelApiException;
import vacademy.io.auth_service.feature.panel.service.PanelTx;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Installer organisations for platform staff: create and suspend them, link one to a school
 * directly, revoke a link and fix a room's attribution. Callers have already passed
 * SuperAdminAuthUtil.requireSuperAdmin. 404 FEATURE_OFF while panel.partners.enabled is false.
 */
@Service
public class PanelPartnerStaffService {

    private static final Set<String> PARTNER_STATUSES = Set.of("ACTIVE", "SUSPENDED");
    private static final int MAX_NAME = 120;

    private final PanelPartnerRepository partners;
    private final PanelRepository panels;
    private final PanelPhase2Properties phase2;
    private final PanelTx tx;
    private final PanelPartnerNames names;
    private final int defaultInstallDays;

    @Autowired
    public PanelPartnerStaffService(PanelPartnerRepository partners, PanelRepository panels,
            PanelPhase2Properties phase2, PanelTx tx, PanelPartnerNames names,
            @Value("${panel.partners.default-install-days:30}") int defaultInstallDays) {
        this.partners = partners;
        this.panels = panels;
        this.phase2 = phase2;
        this.tx = tx;
        this.names = names;
        this.defaultInstallDays = Math.max(1, defaultInstallDays);
    }

    public List<PartnerResponse> list() {
        phase2.requirePartners();
        return partners.listPartners().stream().map(PanelPartnerStaffService::response).toList();
    }

    public PartnerResponse create(PartnerCreateRequest body, String actor) {
        phase2.requirePartners();
        if (body == null) {
            throw PanelApiException.badRequest("name and partner_institute_id are required");
        }
        String name = PanelInputs.text(body.name(), MAX_NAME, "name");
        String instituteId = PanelInputs.instituteId(body.partnerInstituteId());
        String id = UUID.randomUUID().toString();
        try {
            return tx.run(() -> {
                partners.insertPartner(id, name, instituteId, actor);
                return response(partners.findPartner(id).orElseThrow());
            });
        } catch (DuplicateKeyException e) {
            throw new PanelApiException(HttpStatus.CONFLICT, "ALREADY_EXISTS",
                    "This institute is already an installer organisation");
        }
    }

    /** SUSPENDED: its staff stop counting as installers at once. Links and panels stay. */
    public PartnerResponse patch(String partnerId, PartnerPatchRequest body) {
        phase2.requirePartners();
        PanelInputs.rowId(partnerId, "partner");
        String status = body == null || body.status() == null ? "" : body.status().trim().toUpperCase(Locale.ROOT);
        if (!PARTNER_STATUSES.contains(status)) {
            throw PanelApiException.badRequest("status must be ACTIVE or SUSPENDED");
        }
        return tx.run(() -> {
            if (partners.setPartnerStatus(partnerId, status) == 0) {
                throw PanelApiException.notFound("No such partner");
            }
            return response(partners.findPartner(partnerId).orElseThrow());
        });
    }

    /**
     * Links directly. install_until is set exactly when given; otherwise a new link gets the default
     * window and an existing one is extended by it.
     */
    public PartnerLinkResponse link(String partnerId, PartnerLinkCreateRequest body, String actor) {
        phase2.requirePartners();
        PanelInputs.rowId(partnerId, "partner");
        if (body == null) {
            throw PanelApiException.badRequest("institute_id is required");
        }
        String instituteId = PanelInputs.instituteId(body.instituteId());
        Instant until = body.installUntil() == null || body.installUntil().isBlank() ? null
                : PanelInputs.instant(body.installUntil(), "install_until");
        LinkRow link = tx.run(() -> {
            PartnerRow partner = partners.findPartner(partnerId)
                    .orElseThrow(() -> PanelApiException.notFound("No such partner"));
            panels.lockForTransaction("panel_partner_link:" + partner.id() + ":" + instituteId);
            Optional<LinkRow> existing = partners.findActiveLink(partner.id(), instituteId);
            String linkId;
            if (existing.isPresent()) {
                linkId = existing.get().id();
                if (until != null) {
                    partners.setLinkInstallUntil(linkId, Timestamp.from(until));
                } else {
                    partners.extendLinkByDays(linkId, defaultInstallDays);
                }
            } else {
                linkId = UUID.randomUUID().toString();
                if (partners.insertLink(linkId, partner.id(), instituteId, "SUPER_ADMIN",
                        until == null ? null : Timestamp.from(until), defaultInstallDays, actor) == 0) {
                    throw PanelApiException.tryAgain();
                }
            }
            return partners.findLink(linkId).orElseThrow();
        });
        if (link.instituteName() == null) {
            names.fillAsync(link.id(), link.instituteId());
        }
        return linkResponse(link);
    }

    public PartnerLinkResponse revokeLink(String linkId, String actor) {
        phase2.requirePartners();
        PanelInputs.rowId(linkId, "link");
        return tx.run(() -> {
            LinkRow link = partners.findLink(linkId).orElseThrow(() -> PanelApiException.notFound("No such link"));
            if (partners.revokeLink(linkId, actor) == 1) {
                partners.cancelPendingInvitesOfInstitute(link.instituteId());
            }
            return linkResponse(partners.findLink(linkId).orElseThrow());
        });
    }

    /** Fixes a room's attribution; a null partner_id clears it. */
    public StatusResponse setRoomPartner(String roomId, RoomPartnerPatchRequest body) {
        phase2.requirePartners();
        PanelInputs.rowId(roomId, "room");
        String partnerId = body == null || body.partnerId() == null || body.partnerId().isBlank() ? null
                : PanelInputs.rowId(body.partnerId(), "partner");
        return tx.run(() -> {
            panels.findRoom(roomId).orElseThrow(() -> PanelApiException.notFound("No such room"));
            if (partnerId != null && partners.findPartner(partnerId).isEmpty()) {
                throw PanelApiException.notFound("No such partner");
            }
            partners.setRoomPartner(roomId, partnerId);
            return new StatusResponse("UPDATED");
        });
    }

    private static PartnerResponse response(PartnerRow p) {
        return new PartnerResponse(p.id(), p.name(), p.partnerInstituteId(), p.status(), PanelInputs.iso(p.createdAt()));
    }

    private static PartnerLinkResponse linkResponse(LinkRow l) {
        return new PartnerLinkResponse(l.id(), l.partnerId(), l.instituteId(), l.instituteName(), l.status(),
                l.linkedVia(), PanelInputs.iso(l.installUntil()), PanelInputs.iso(l.createdAt()));
    }
}
