package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.audience.dto.AudienceDTO;
import vacademy.io.admin_core_service.features.audience.dto.CampaignRouteUpdateRequest;
import vacademy.io.admin_core_service.features.audience.dto.CampaignRouteUpdateResponse;
import vacademy.io.admin_core_service.features.audience.dto.MigrateLeadsRequestDTO;
import vacademy.io.admin_core_service.features.audience.dto.MigrateLeadsResponseDTO;
import vacademy.io.admin_core_service.features.audience.entity.AdCampaignRoute;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.FormWebhookConnector;
import vacademy.io.admin_core_service.features.audience.repository.AdCampaignRouteRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.FormWebhookConnectorRepository;
import vacademy.io.admin_core_service.features.audience.service.AdCampaignRouteService;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * One Google lead form runs in several campaigns; each campaign can feed its own
 * lead list. Unmapped campaigns keep feeding the connector's own list (catch-all).
 */
class AdCampaignRouteServiceTest {

    private static final String CAMPAIGN = "22173284076";
    private static final String MAIN = "aud-main";

    private AdCampaignRouteService service;
    private AdCampaignRouteRepository routes;
    private AudienceRepository audiences;
    private AudienceResponseRepository responses;
    private AudienceService audienceService;
    private final CustomUserDetails user = new CustomUserDetails();
    private final FormWebhookConnector connector = new FormWebhookConnector();

    @BeforeEach
    void setUp() {
        service = new AdCampaignRouteService();
        routes = mock(AdCampaignRouteRepository.class);
        audiences = mock(AudienceRepository.class);
        responses = mock(AudienceResponseRepository.class);
        audienceService = mock(AudienceService.class);
        ReflectionTestUtils.setField(service, "routeRepository", routes);
        ReflectionTestUtils.setField(service, "audienceRepository", audiences);
        ReflectionTestUtils.setField(service, "audienceResponseRepository", responses);
        ReflectionTestUtils.setField(service, "audienceService", audienceService);
        ReflectionTestUtils.setField(service, "connectorRepository", mock(FormWebhookConnectorRepository.class));
        when(routes.save(any())).thenAnswer(inv -> inv.getArgument(0));

        connector.setId("conn-1");
        connector.setVendor("GOOGLE_LEAD_ADS");
        connector.setInstituteId("inst-1");
        connector.setAudienceId(MAIN);
        list(MAIN, "inst-1", "ACTIVE");
        list("aud-pune", "inst-1", "ACTIVE");
        list("aud-closed", "inst-1", "INACTIVE");
        list("aud-foreign", "inst-OTHER", "ACTIVE");
    }

    private void list(String id, String institute, String status) {
        Audience a = new Audience();
        a.setId(id);
        a.setInstituteId(institute);
        a.setStatus(status);
        when(audiences.findById(id)).thenReturn(Optional.of(a));
    }

    private void routed(String audienceId, int leads) {
        when(routes.findByConnectorIdAndCampaignId("conn-1", CAMPAIGN)).thenReturn(Optional.of(
                AdCampaignRoute.builder().connectorId("conn-1").instituteId("inst-1")
                        .campaignId(CAMPAIGN).audienceId(audienceId).leadCount(leads).build()));
    }

    private static CampaignRouteUpdateRequest toList(String audienceId, boolean move) {
        CampaignRouteUpdateRequest r = new CampaignRouteUpdateRequest();
        r.setAudienceId(audienceId);
        r.setMoveExistingLeads(move);
        return r;
    }

    // ── Routing a lead ───────────────────────────────────────────────────────

    @Test
    void unmappedOrUnknownCampaignGoesToTheCatchAll() {
        when(routes.findByConnectorIdAndCampaignId(any(), any())).thenReturn(Optional.empty());
        assertNull(service.decide(connector, CAMPAIGN).audienceId());
        assertNull(service.decide(connector, null).audienceId());

        routed(null, 3);
        assertNull(service.decide(connector, CAMPAIGN).audienceId());
    }

    @Test
    void mappedCampaignGoesToItsList() {
        routed("aud-pune", 3);
        AdCampaignRouteService.RouteDecision d = service.decide(connector, CAMPAIGN);
        assertEquals("aud-pune", d.audienceId());
        assertNull(d.unusableAudienceId());
    }

    @Test
    void aMappingToAnInactiveListFallsBackToTheCatchAll() {
        routed("aud-closed", 3);
        AdCampaignRouteService.RouteDecision d = service.decide(connector, CAMPAIGN);
        assertNull(d.audienceId());
        assertEquals("aud-closed", d.unusableAudienceId());
    }

    // ── Mapping a campaign ───────────────────────────────────────────────────

    @Test
    void mapsToAnExistingListOfTheInstitute() {
        routed(null, 3);
        CampaignRouteUpdateResponse res = service.update(connector, CAMPAIGN, toList("aud-pune", false), user);
        assertEquals("aud-pune", res.getRoute().getAudienceId());
        verifyNoInteractions(audienceService);
    }

    @Test
    void refusesAnotherInstitutesOrAnInactiveList() {
        routed(null, 3);
        assertThrows(VacademyException.class,
                () -> service.update(connector, CAMPAIGN, toList("aud-foreign", false), user));
        assertThrows(VacademyException.class,
                () -> service.update(connector, CAMPAIGN, toList("aud-closed", false), user));
        verify(routes, never()).save(any());
    }

    @Test
    void aCampaignCanBeMappedBeforeItsFirstLead() {
        when(routes.findByConnectorIdAndCampaignId("conn-1", "22206499349")).thenReturn(Optional.empty());

        CampaignRouteUpdateResponse res = service.update(connector, " 22206499349 ", toList("aud-pune", false), user);

        ArgumentCaptor<AdCampaignRoute> saved = ArgumentCaptor.forClass(AdCampaignRoute.class);
        verify(routes).save(saved.capture());
        assertEquals("22206499349", saved.getValue().getCampaignId());
        assertTrue(saved.getValue().getAddedManually());
        assertEquals("inst-1", saved.getValue().getInstituteId());
        assertEquals("aud-pune", res.getRoute().getAudienceId());
    }

    @Test
    void campaignIdMustBeDigits() {
        assertThrows(VacademyException.class,
                () -> service.update(connector, "abc-123", toList("aud-pune", false), user));
    }

    @Test
    void newListIsCreatedLikeTheMainListAndMapped() {
        routed(null, 3);
        AudienceDTO main = AudienceDTO.builder().campaignType("GOOGLE_ADS").toNotify("admin@i2can.in")
                .sendRespondentEmail(false).instituteCustomFields(List.of()).build();
        when(audienceService.getCampaignById(MAIN, "inst-1")).thenReturn(main);
        when(audienceService.createCampaign(any())).thenReturn("aud-new");
        CampaignRouteUpdateRequest r = new CampaignRouteUpdateRequest();
        CampaignRouteUpdateRequest.NewList nl = new CampaignRouteUpdateRequest.NewList();
        nl.setName("  Pune MBBS 2027  ");
        r.setNewList(nl);

        CampaignRouteUpdateResponse res = service.update(connector, CAMPAIGN, r, user);

        ArgumentCaptor<AudienceDTO> created = ArgumentCaptor.forClass(AudienceDTO.class);
        verify(audienceService).createCampaign(created.capture());
        assertEquals("Pune MBBS 2027", created.getValue().getCampaignName());
        assertEquals("inst-1", created.getValue().getInstituteId());
        assertEquals("GOOGLE_ADS", created.getValue().getCampaignType());
        assertEquals("admin@i2can.in", created.getValue().getToNotify());
        assertSame(main.getInstituteCustomFields(), created.getValue().getInstituteCustomFields(),
                "the same lead form feeds both lists, so the new list gets the main list's fields");
        assertEquals("aud-new", res.getCreatedAudienceId());
        assertEquals("aud-new", res.getRoute().getAudienceId());
    }

    @Test
    void movesTheCampaignsExistingLeadsOutOfTheListTheyWereIn() {
        routed(null, 3);
        when(responses.findActiveIdsByAudienceAndSource(MAIN, "GOOGLE_LEAD_ADS", CAMPAIGN))
                .thenReturn(List.of("r1", "r2", "r3"));
        MigrateLeadsResponseDTO migrated = new MigrateLeadsResponseDTO();
        migrated.setMigrated(2);
        migrated.setSkipped(List.of(new MigrateLeadsResponseDTO.SkippedLead()));
        when(audienceService.migrateLeads(any(), eq(user))).thenReturn(migrated);

        CampaignRouteUpdateResponse res = service.update(connector, CAMPAIGN, toList("aud-pune", true), user);

        ArgumentCaptor<MigrateLeadsRequestDTO> req = ArgumentCaptor.forClass(MigrateLeadsRequestDTO.class);
        verify(audienceService).migrateLeads(req.capture(), eq(user));
        assertEquals(List.of("r1", "r2", "r3"), req.getValue().getResponseIds());
        assertEquals("aud-pune", req.getValue().getTargetAudienceId());
        assertFalse(req.getValue().getRunDestinationAutomations(), "moved leads aren't welcomed twice");
        assertEquals(2, res.getMovedLeads());
        assertEquals(1, res.getSkippedLeads());
    }

    @Test
    void movingIsSkippedWhenNotAskedOrNothingChanges() {
        routed("aud-pune", 3);
        service.update(connector, CAMPAIGN, toList("aud-pune", true), user);
        service.update(connector, CAMPAIGN, toList(MAIN, false), user);
        verify(audienceService, never()).migrateLeads(any(), any());
    }

    @Test
    void aCampaignThatSentLeadsCannotBeDeleted() {
        routed("aud-pune", 3);
        assertThrows(VacademyException.class, () -> service.delete(connector, CAMPAIGN));

        routed("aud-pune", 0);
        service.delete(connector, CAMPAIGN);
        verify(routes).delete(any());
    }

    // ── Automatic list per new campaign ──────────────────────────────────────

    private void autoListsOn(AdCampaignRoute lockedRow, String mainType) {
        connector.setAutoCreateCampaignLists(true);
        when(routes.lockByConnectorIdAndCampaignId("conn-1", CAMPAIGN)).thenReturn(Optional.ofNullable(lockedRow));
        when(audienceService.getCampaignById(MAIN, "inst-1")).thenReturn(AudienceDTO.builder()
                .campaignType(mainType).toNotify("admin@i2can.in").instituteCustomFields(List.of()).build());
        when(audiences.findByInstituteIdAndCampaignNameIgnoreCase(eq("inst-1"), any())).thenReturn(List.of());
        when(audienceService.createCampaign(any())).thenReturn("aud-new");
    }

    private static AdCampaignRoute unmappedRow(String name) {
        return AdCampaignRoute.builder().connectorId("conn-1").instituteId("inst-1")
                .campaignId(CAMPAIGN).campaignName(name).leadCount(0).build();
    }

    @Test
    void autoListsAreOffByDefaultSoNothingChanges() {
        service.ensureAutoList(connector, CAMPAIGN);
        assertFalse(service.autoCreatesLists(connector));
        verifyNoInteractions(routes, audienceService);
    }

    @Test
    void aNewCampaignGetsAListNamedAfterItWithTheMainListsFields() {
        AdCampaignRoute row = unmappedRow("Gujarat-ADCT");
        autoListsOn(row, "GoogleAds Leads form");

        service.ensureAutoList(connector, CAMPAIGN);

        ArgumentCaptor<AudienceDTO> created = ArgumentCaptor.forClass(AudienceDTO.class);
        verify(audienceService).createCampaign(created.capture());
        assertEquals("Gujarat-ADCT", created.getValue().getCampaignName());
        assertEquals("GoogleAds Leads form", created.getValue().getCampaignType());
        assertNotNull(created.getValue().getInstituteCustomFields());
        assertEquals("aud-new", row.getAudienceId());
        verify(routes).ensureRow(any(), eq("conn-1"), eq("inst-1"), eq(CAMPAIGN), any());
        verify(routes).save(row);
    }

    @Test
    void anUnnamedCampaignsListIsNamedByItsId() {
        autoListsOn(unmappedRow(null), "GoogleAds Leads form");
        service.ensureAutoList(connector, CAMPAIGN);
        ArgumentCaptor<AudienceDTO> created = ArgumentCaptor.forClass(AudienceDTO.class);
        verify(audienceService).createCampaign(created.capture());
        assertEquals("Google campaign " + CAMPAIGN, created.getValue().getCampaignName());
    }

    @Test
    void anActiveListOfTheSameTypeAndNameIsReusedNotDuplicated() {
        AdCampaignRoute row = unmappedRow("MP-CG-PGDCC");
        autoListsOn(row, "GoogleAds Leads form");
        Audience website = new Audience();
        website.setId("aud-web");
        website.setStatus("ACTIVE");
        website.setCampaignType("WEBSITE");
        Audience google = new Audience();
        google.setId("aud-mp");
        google.setStatus("ACTIVE");
        google.setCampaignType("GOOGLEADS LEADS FORM");
        when(audiences.findByInstituteIdAndCampaignNameIgnoreCase("inst-1", "MP-CG-PGDCC"))
                .thenReturn(List.of(website, google));

        service.ensureAutoList(connector, CAMPAIGN);

        assertEquals("aud-mp", row.getAudienceId());
        verify(audienceService, never()).createCampaign(any());
    }

    @Test
    void aCampaignTheAdminAlreadyRoutedIsLeftAlone() {
        AdCampaignRoute row = unmappedRow("Gujarat-ADCT");
        row.setAudienceId(MAIN);
        autoListsOn(row, "GoogleAds Leads form");

        service.ensureAutoList(connector, CAMPAIGN);

        assertEquals(MAIN, row.getAudienceId());
        verify(audienceService, never()).createCampaign(any());
        verify(routes, never()).save(any());
    }

    @Test
    void namingACampaignAloneKeepsItsRoutingAndRenamesItsPlaceholderList() {
        routed("aud-auto", 2);
        Audience auto = new Audience();
        auto.setId("aud-auto");
        auto.setCampaignName("Google campaign " + CAMPAIGN);
        when(audiences.findById("aud-auto")).thenReturn(Optional.of(auto));
        CampaignRouteUpdateRequest r = new CampaignRouteUpdateRequest();
        r.setCampaignName("  Gujarat-ADCT ");

        CampaignRouteUpdateResponse res = service.update(connector, CAMPAIGN, r, user);

        assertEquals("Gujarat-ADCT", res.getRoute().getCampaignName());
        assertEquals("aud-auto", res.getRoute().getAudienceId());
        assertEquals("Gujarat-ADCT", auto.getCampaignName());
        verify(audienceService, never()).createCampaign(any());
        verify(audienceService, never()).migrateLeads(any(), any());
    }

    @Test
    void aListTheAdminNamedThemselvesIsNotRenamed() {
        routed("aud-pune", 2);
        CampaignRouteUpdateRequest r = new CampaignRouteUpdateRequest();
        r.setCampaignName("Gujarat-ADCT");
        service.update(connector, CAMPAIGN, r, user);
        verify(audiences, never()).save(any());
    }

    @Test
    void anEmptyRequestStillAsksForAList() {
        routed(null, 3);
        assertThrows(VacademyException.class,
                () -> service.update(connector, CAMPAIGN, new CampaignRouteUpdateRequest(), user));
    }
}
