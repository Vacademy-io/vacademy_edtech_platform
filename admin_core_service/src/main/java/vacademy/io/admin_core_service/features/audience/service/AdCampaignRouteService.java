package vacademy.io.admin_core_service.features.audience.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.audience.dto.AudienceDTO;
import vacademy.io.admin_core_service.features.audience.dto.CampaignRouteDTO;
import vacademy.io.admin_core_service.features.audience.dto.CampaignRouteUpdateRequest;
import vacademy.io.admin_core_service.features.audience.dto.CampaignRouteUpdateResponse;
import vacademy.io.admin_core_service.features.audience.dto.CampaignRoutesResponse;
import vacademy.io.admin_core_service.features.audience.dto.MigrateLeadsRequestDTO;
import vacademy.io.admin_core_service.features.audience.dto.MigrateLeadsResponseDTO;
import vacademy.io.admin_core_service.features.audience.entity.AdCampaignRoute;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.FormWebhookConnector;
import vacademy.io.admin_core_service.features.audience.repository.AdCampaignRouteRepository;
import vacademy.io.admin_core_service.features.audience.repository.FormWebhookConnectorRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Per-campaign lead routing for ad-platform connectors (Google Lead Forms).
 *
 * One lead form usually runs in several Google campaigns; each campaign can be
 * routed to its own lead list, so its leads get that list's workflows, counsellor
 * pool and reports. A campaign that isn't mapped yet keeps feeding the
 * connector's own audience — the catch-all — so a new campaign never loses a lead.
 */
@Service
@Slf4j
public class AdCampaignRouteService {

    /** Google campaign ids are numeric (8-byte integers). */
    private static final Pattern CAMPAIGN_ID = Pattern.compile("^[0-9]{1,64}$");
    private static final int MAX_LIST_NAME = 255;

    @Autowired
    private AdCampaignRouteRepository routeRepository;

    @Autowired
    private AudienceRepository audienceRepository;

    @Autowired
    private AudienceResponseRepository audienceResponseRepository;

    @Autowired
    private AudienceService audienceService;

    @Autowired
    private FormWebhookConnectorRepository connectorRepository;

    /** Name of an auto-created list until the admin names its campaign. */
    static String defaultListName(String campaignId) {
        return "Google campaign " + campaignId;
    }

    /**
     * Where one lead goes. {@code audienceId} is the mapped list, or null for the
     * catch-all. {@code unusableAudienceId} is set when the campaign IS mapped but the
     * list is gone or no longer active: the lead then goes to the catch-all (never
     * lost) and the admin is told to fix the mapping.
     */
    public record RouteDecision(String audienceId, String unusableAudienceId) {
        static RouteDecision catchAll() { return new RouteDecision(null, null); }
    }

    public RouteDecision decide(FormWebhookConnector connector, String campaignId) {
        if (!StringUtils.hasText(campaignId)) return RouteDecision.catchAll();
        String mapped = routeRepository.findByConnectorIdAndCampaignId(connector.getId(), campaignId)
                .map(AdCampaignRoute::getAudienceId)
                .orElse(null);
        if (mapped == null || mapped.equals(connector.getAudienceId())) return RouteDecision.catchAll();
        boolean usable = audienceRepository.findById(mapped)
                .map(a -> connector.getInstituteId().equals(a.getInstituteId()) && "ACTIVE".equals(a.getStatus()))
                .orElse(false);
        return usable ? new RouteDecision(mapped, null) : new RouteDecision(null, mapped);
    }

    /** Count a delivered lead for its campaign (creating the row on its first lead). Best effort. */
    public void recordLead(FormWebhookConnector connector, String campaignId) {
        if (!StringUtils.hasText(campaignId) || !CAMPAIGN_ID.matcher(campaignId).matches()) return;
        try {
            routeRepository.recordLead(UUID.randomUUID().toString(), connector.getId(),
                    connector.getInstituteId(), campaignId, LocalDateTime.now());
        } catch (Exception e) {
            log.warn("Could not count lead for campaign {} on connector {}: {}",
                    campaignId, connector.getId(), e.getMessage());
        }
    }

    public boolean autoCreatesLists(FormWebhookConnector connector) {
        return Boolean.TRUE.equals(connector.getAutoCreateCampaignLists());
    }

    /**
     * With auto lists on: give a campaign that has no list yet its own list, so this
     * lead and the campaign's later ones go there. Named after the admin-entered
     * campaign name, else "Google campaign <id>"; an active list of the main list's
     * type with exactly that name is reused rather than duplicated. A campaign the
     * admin routed anywhere (main list included) is left alone. The row is locked,
     * so two leads of a brand-new campaign create one list, not two.
     */
    @Transactional
    public void ensureAutoList(FormWebhookConnector connector, String campaignId) {
        if (!autoCreatesLists(connector)
                || !StringUtils.hasText(campaignId) || !CAMPAIGN_ID.matcher(campaignId).matches()) {
            return;
        }
        routeRepository.ensureRow(UUID.randomUUID().toString(), connector.getId(),
                connector.getInstituteId(), campaignId, LocalDateTime.now());
        AdCampaignRoute route = routeRepository.lockByConnectorIdAndCampaignId(connector.getId(), campaignId)
                .orElse(null);
        if (route == null || route.getAudienceId() != null) return;

        String name = StringUtils.hasText(route.getCampaignName())
                ? route.getCampaignName().trim()
                : defaultListName(campaignId);
        AudienceDTO main = readMainList(connector);
        String listId = findSameTypeListByName(connector, main, name)
                .orElseGet(() -> createListLikeMain(connector, main, name, null, null));
        route.setAudienceId(listId);
        routeRepository.save(route);
        log.info("Campaign {} on connector {} got its own list {} ({})",
                campaignId, connector.getId(), listId, name);
    }

    /** Turn automatic per-campaign lists on or off for one connector. */
    @Transactional
    public CampaignRoutesResponse setAutoCreateLists(FormWebhookConnector connector, boolean enabled) {
        connector.setAutoCreateCampaignLists(enabled);
        connectorRepository.save(connector);
        return list(connector);
    }

    public CampaignRoutesResponse list(FormWebhookConnector connector) {
        return CampaignRoutesResponse.builder()
                .mainAudienceId(connector.getAudienceId())
                .autoCreateLists(autoCreatesLists(connector))
                .routes(routeRepository.findForConnector(connector.getId()).stream()
                        .map(CampaignRouteDTO::from)
                        .toList())
                .build();
    }

    /**
     * Route {@code campaignId} to an existing list or to a new one created here, and
     * optionally move the campaign's existing leads out of the list it fed until now.
     * One transaction: a move refused for a non-admin also undoes the new list and
     * the mapping, so the admin never ends up with half of what they asked for.
     */
    @Transactional
    public CampaignRouteUpdateResponse update(FormWebhookConnector connector, String campaignId,
            CampaignRouteUpdateRequest request, CustomUserDetails user) {
        String campaign = requireCampaignId(campaignId);
        if (request == null) throw new VacademyException("Choose a list for this campaign");

        boolean newList = request.getNewList() != null && StringUtils.hasText(request.getNewList().getName());
        boolean existingList = !newList && StringUtils.hasText(request.getAudienceId());
        if (!newList && !existingList && request.getCampaignName() == null) {
            throw new VacademyException("Choose a list for this campaign");
        }

        AdCampaignRoute route = routeRepository.findByConnectorIdAndCampaignId(connector.getId(), campaign)
                .orElseGet(() -> AdCampaignRoute.builder()
                        .connectorId(connector.getId())
                        .instituteId(connector.getInstituteId())
                        .campaignId(campaign)
                        .addedManually(true)
                        .build());
        if (request.getCampaignName() != null) {
            renameCampaign(route, request.getCampaignName());
        }
        if (!newList && !existingList) {
            // Only naming the campaign; where its leads go is unchanged.
            return CampaignRouteUpdateResponse.builder()
                    .route(CampaignRouteDTO.from(routeRepository.save(route)))
                    .build();
        }

        String createdAudienceId = null;
        String target;
        if (newList) {
            createdAudienceId = createListLikeMain(connector, readMainList(connector),
                    request.getNewList().getName(), request.getNewList().getCampaignType(), user);
            target = createdAudienceId;
        } else {
            target = request.getAudienceId();
            requireActiveListOfInstitute(target, connector.getInstituteId());
        }

        String previous = route.getAudienceId() != null ? route.getAudienceId() : connector.getAudienceId();
        route.setAudienceId(target);
        AdCampaignRoute saved = routeRepository.save(route);

        int moved = 0;
        int skipped = 0;
        if (request.isMoveExistingLeads() && !target.equals(previous)) {
            List<String> ids = audienceResponseRepository.findActiveIdsByAudienceAndSource(
                    previous, connector.getVendor(), campaign);
            if (!ids.isEmpty()) {
                // PRESERVE + no destination automations: these people already got the
                // follow-up of the list they were in; don't welcome them twice.
                MigrateLeadsResponseDTO result = audienceService.migrateLeads(MigrateLeadsRequestDTO.builder()
                        .responseIds(ids)
                        .targetAudienceId(target)
                        .instituteId(connector.getInstituteId())
                        .scope("RESPONSE")
                        .workflowAnchor("PRESERVE")
                        .runDestinationAutomations(false)
                        .build(), user);
                moved = result.getMigrated();
                skipped = result.getSkipped() != null ? result.getSkipped().size() : 0;
            }
        }
        log.info("Campaign {} on connector {} routed to {} (was {}); moved {} existing lead(s), skipped {}",
                campaign, connector.getId(), target, previous, moved, skipped);

        return CampaignRouteUpdateResponse.builder()
                .route(CampaignRouteDTO.from(saved))
                .createdAudienceId(createdAudienceId)
                .movedLeads(moved)
                .skippedLeads(skipped)
                .build();
    }

    /** Remove a campaign row added by mistake. One that has sent leads is re-routed instead. */
    @Transactional
    public void delete(FormWebhookConnector connector, String campaignId) {
        String campaign = requireCampaignId(campaignId);
        AdCampaignRoute route = routeRepository.findByConnectorIdAndCampaignId(connector.getId(), campaign)
                .orElseThrow(() -> new VacademyException("Campaign not found on this connector"));
        if (route.getLeadCount() != null && route.getLeadCount() > 0) {
            throw new VacademyException("This campaign has sent leads, so it can't be removed. "
                    + "Route it to the main list instead.");
        }
        routeRepository.delete(route);
    }

    /**
     * Save the admin's name for a campaign (blank clears it). A list this service
     * auto-created under the placeholder name takes the campaign's name too.
     */
    private void renameCampaign(AdCampaignRoute route, String rawName) {
        String name = rawName.trim();
        if (name.length() > MAX_LIST_NAME) name = name.substring(0, MAX_LIST_NAME);
        route.setCampaignName(name.isEmpty() ? null : name);
        if (name.isEmpty() || route.getAudienceId() == null) return;
        String placeholder = defaultListName(route.getCampaignId());
        String newName = name;
        audienceRepository.findById(route.getAudienceId())
                .filter(a -> placeholder.equals(a.getCampaignName()))
                .ifPresent(a -> {
                    a.setCampaignName(newName);
                    audienceRepository.save(a);
                });
    }

    private AudienceDTO readMainList(FormWebhookConnector connector) {
        try {
            return audienceService.getCampaignById(connector.getAudienceId(), connector.getInstituteId());
        } catch (Exception e) {
            log.warn("Main list {} of connector {} not readable; creating a bare list: {}",
                    connector.getAudienceId(), connector.getId(), e.getMessage());
            return null;
        }
    }

    /** An active list of the institute, of the main list's type, with exactly this name. */
    private Optional<String> findSameTypeListByName(FormWebhookConnector connector, AudienceDTO main, String name) {
        String type = main != null ? normalizeType(main.getCampaignType()) : "";
        return audienceRepository.findByInstituteIdAndCampaignNameIgnoreCase(connector.getInstituteId(), name)
                .stream()
                .filter(a -> "ACTIVE".equals(a.getStatus()))
                .filter(a -> normalizeType(a.getCampaignType()).equals(type))
                .map(Audience::getId)
                .findFirst();
    }

    private static String normalizeType(String type) {
        return type == null ? "" : type.trim().toUpperCase(Locale.ROOT);
    }

    /**
     * A new list for one campaign, set up like the connector's main list: same list
     * type, admin notification emails and — crucially — the same form fields, since
     * the same Google lead form feeds both. Without the fields, the campaign's form
     * answers would have nowhere to be saved.
     */
    private String createListLikeMain(FormWebhookConnector connector, AudienceDTO main, String rawName,
            String campaignType, CustomUserDetails user) {
        String name = rawName.trim();
        if (name.length() > MAX_LIST_NAME) name = name.substring(0, MAX_LIST_NAME);
        AudienceDTO dto = AudienceDTO.builder()
                .instituteId(connector.getInstituteId())
                .campaignName(name)
                .campaignType(StringUtils.hasText(campaignType) ? campaignType
                        : main != null ? main.getCampaignType() : null)
                .status("ACTIVE")
                .toNotify(main != null ? main.getToNotify() : null)
                .sendRespondentEmail(main != null ? main.getSendRespondentEmail() : null)
                .instituteCustomFields(main != null ? main.getInstituteCustomFields() : null)
                .createdByUserId(user != null ? user.getUserId() : null)
                .build();
        return audienceService.createCampaign(dto);
    }

    private void requireActiveListOfInstitute(String audienceId, String instituteId) {
        boolean ok = audienceRepository.findById(audienceId)
                .map(a -> instituteId.equals(a.getInstituteId()) && "ACTIVE".equals(a.getStatus()))
                .orElse(false);
        if (!ok) throw new VacademyException("That list does not exist, is not active, or belongs to another institute");
    }

    private static String requireCampaignId(String campaignId) {
        String trimmed = campaignId == null ? "" : campaignId.trim();
        if (!CAMPAIGN_ID.matcher(trimmed).matches()) {
            throw new VacademyException("A Google campaign ID is digits only, e.g. 22173284076");
        }
        return trimmed;
    }
}
