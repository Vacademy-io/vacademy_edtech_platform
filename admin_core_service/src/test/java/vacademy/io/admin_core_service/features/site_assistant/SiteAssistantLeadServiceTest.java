package vacademy.io.admin_core_service.features.site_assistant;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.audience.dto.CatalogueLeadRequestDTO;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiException;
import vacademy.io.admin_core_service.features.catalog_api.CatalogTestData;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.site_assistant.service.SiteAssistantLeadService;
import vacademy.io.admin_core_service.features.utm_attribution.service.UtmAttributionService;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class SiteAssistantLeadServiceTest {

    static final String RESP = "3f2b8c4e-1a2b-4c3d-9e8f-001122334455";

    AudienceService audience;
    AudienceResponseRepository responses;
    UtmAttributionService utm;
    InstituteRepository institutes;
    SiteAssistantLeadService service;

    @BeforeEach
    void setUp() {
        audience = mock(AudienceService.class);
        responses = mock(AudienceResponseRepository.class);
        utm = mock(UtmAttributionService.class);
        institutes = mock(InstituteRepository.class);
        when(institutes.existsById("inst-1")).thenReturn(true);
        service = new SiteAssistantLeadService(audience, responses, utm, institutes);
    }

    static JsonNode body(String json) {
        try {
            return CatalogTestData.MAPPER.readTree(json);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static String invalidParam(String json) {
        CatalogApiException e = assertThrows(CatalogApiException.class,
                () -> SiteAssistantLeadService.validate(body(json)), json);
        assertEquals("invalid_request", e.getCode());
        return e.getDetails() == null ? null : (String) e.getDetails().get("param");
    }

    @Test
    void validatesTheBody() {
        String ok = "\"institute_id\":\"inst-1\",\"kind\":\"SALES\",\"full_name\":\"Asha\"";
        assertNull(invalidParam("[]"));
        assertEquals("institute_id", invalidParam("{\"kind\":\"SALES\",\"full_name\":\"A\",\"phone\":\"9876543210\"}"));
        assertEquals("kind", invalidParam("{\"institute_id\":\"inst-1\",\"kind\":\"SPAM\",\"full_name\":\"A\",\"phone\":\"9876543210\"}"));
        assertEquals("full_name", invalidParam("{\"institute_id\":\"inst-1\",\"kind\":\"SALES\",\"phone\":\"9876543210\"}"));
        assertEquals("phone", invalidParam("{" + ok + "}"));
        assertEquals("email", invalidParam("{" + ok + ",\"email\":\"nope\"}"));
        assertEquals("phone", invalidParam("{" + ok + ",\"phone\":\"call me\"}"));
        assertEquals("course_ids", invalidParam("{" + ok + ",\"phone\":\"9876543210\",\"course_ids\":\"c1\"}"));
        assertEquals("course_ids", invalidParam("{" + ok + ",\"phone\":\"9876543210\",\"course_ids\":[\"a b\"]}"));
        assertEquals("summary", invalidParam("{" + ok + ",\"phone\":\"9876543210\",\"summary\":\"" + "s".repeat(2001) + "\"}"));
        assertEquals("custom_fields", invalidParam("{" + ok + ",\"phone\":\"9876543210\",\"custom_fields\":{\"email\":\"x@y.co\"}}"));
        assertEquals("custom_fields", invalidParam("{" + ok + ",\"phone\":\"9876543210\",\"custom_fields\":{\"conversation_id\":\"a/b\"}}"));

        SiteAssistantLeadService.Lead lead = SiteAssistantLeadService.validate(body("""
                {"institute_id":"inst-1","kind":"support","full_name":" Asha ","phone":"+91 98765 43210",
                 "course_ids":["c1","c1","c2"],"utm":{"utm_source":"google","gclid":"x","utm_medium":7},
                 "custom_fields":{"city":"Pune","conversation_id":"5b1e9f0a-0000-4000-8000-000000000001"}}
                """));
        assertEquals("SUPPORT", lead.kind());
        assertEquals("Asha", lead.fullName());
        assertNull(lead.email());
        assertEquals(List.of("c1", "c2"), lead.courseIds());
        assertEquals(Map.of("utm_source", "google", "utm_medium", "7"), lead.utm());
    }

    @Test
    void aPhoneOnlyLeadGoesThroughTheWebsiteLeadPipelineWithContextInCustomFields() {
        when(audience.submitCatalogueLead(any(), eq(true))).thenReturn(RESP);
        AudienceResponse saved = new AudienceResponse();
        saved.setAudienceId("aud-9");
        when(responses.findById(RESP)).thenReturn(Optional.of(saved));

        SiteAssistantLeadService.Outcome out = service.submit(SiteAssistantLeadService.validate(body("""
                {"institute_id":"inst-1","kind":"SALES","campaign_id":"aud-9","full_name":"Asha",
                 "email":null,"phone":"+91 98765 43210","course_ids":["c1","c2"],
                 "page_url":"https://learning.brahmvarchas.org/store/course-details?id=c1",
                 "utm":{"utm_source":"instagram","utm_campaign":"diwali"},
                 "summary":"Asked about Vedic Parenting in Hindi; wants a callback after 6 pm.",
                 "reason":"wants to talk to a counsellor",
                 "custom_fields":{"city":"Pune","conversation_id":"5b1e9f0a-0000-4000-8000-000000000001"}}
                """)));
        assertEquals("received", out.status());
        assertEquals(RESP, out.leadRef());

        ArgumentCaptor<CatalogueLeadRequestDTO> dto = ArgumentCaptor.forClass(CatalogueLeadRequestDTO.class);
        verify(audience).submitCatalogueLead(dto.capture(), eq(true));
        CatalogueLeadRequestDTO d = dto.getValue();
        assertEquals("inst-1", d.getInstituteId());
        assertEquals("aud-9", d.getAudienceId());
        assertEquals("SITE_ASSISTANT", d.getSourceType());
        assertEquals("5b1e9f0a-0000-4000-8000-000000000001", d.getSourceId());
        assertEquals("Asha", d.getFullName());
        assertNull(d.getEmail(), "never a made-up email");
        assertEquals("+91 98765 43210", d.getMobileNumber());
        Map<String, String> f = d.getCustomFieldValues();
        assertEquals("SALES", f.get("lead_kind"));
        assertEquals("Asked about Vedic Parenting in Hindi; wants a callback after 6 pm.", f.get("summary"));
        assertEquals("wants to talk to a counsellor", f.get("reason"));
        assertEquals("c1,c2", f.get("course_ids"));
        assertEquals("https://learning.brahmvarchas.org/store/course-details?id=c1", f.get("page_url"));
        assertEquals("Pune", f.get("city"));
        assertFalse(f.containsKey("email") || f.containsKey("phone") || f.containsKey("full_name"));

        verify(utm).record("inst-1", null, null, "+91 98765 43210", "AUDIENCE", "aud-9",
                Map.of("utm_source", "instagram", "utm_campaign", "diwali"));
    }

    @Test
    void campaignFieldsArriveKeyedByCustomFieldIdNeverByTheLongInstituteFieldKey() {
        // A BV-style campaign field: CustomFieldKeyGenerator appends "_inst_<instituteId>", so the
        // field_key is longer than the 64-character custom_fields key limit. ai_service sends the
        // custom field's id instead (36 chars), which saveCustomFieldValues resolves exactly.
        String inst = "8a4b5c6d-7e8f-4a1b-9c2d-3e4f5a6b7c8d";
        String fieldKey = "which_course_are_you_interested_in_inst_" + inst;
        assertTrue(fieldKey.length() > 64);
        String fieldId = "0f1e2d3c-4b5a-4968-8776-655443322110";
        when(institutes.existsById(inst)).thenReturn(true);
        when(audience.submitCatalogueLead(any(), eq(true))).thenReturn(RESP);

        assertEquals("custom_fields", invalidParam("{\"institute_id\":\"" + inst + "\",\"kind\":\"SALES\","
                + "\"full_name\":\"Asha\",\"phone\":\"9876543210\",\"custom_fields\":{\"" + fieldKey + "\":\"Garbh Sanskar\"}}"));

        service.submit(SiteAssistantLeadService.validate(body("{\"institute_id\":\"" + inst + "\",\"kind\":\"SALES\","
                + "\"campaign_id\":\"aud-9\",\"full_name\":\"Asha\",\"phone\":\"9876543210\","
                + "\"custom_fields\":{\"" + fieldId + "\":\"Garbh Sanskar\"}}")));
        ArgumentCaptor<CatalogueLeadRequestDTO> dto = ArgumentCaptor.forClass(CatalogueLeadRequestDTO.class);
        verify(audience).submitCatalogueLead(dto.capture(), eq(true));
        assertEquals("Garbh Sanskar", dto.getValue().getCustomFieldValues().get(fieldId));
    }

    @Test
    void aRepeatIsDuplicateWithoutARef() {
        when(audience.submitCatalogueLead(any(), eq(true))).thenReturn("You have already submitted your response for this campaign");
        SiteAssistantLeadService.Outcome out = service.submit(SiteAssistantLeadService.validate(body(
                "{\"institute_id\":\"inst-1\",\"kind\":\"SUPPORT\",\"full_name\":\"Asha\",\"email\":\"asha@example.com\"}")));
        assertEquals("duplicate", out.status());
        assertNull(out.leadRef());
        ArgumentCaptor<CatalogueLeadRequestDTO> dto = ArgumentCaptor.forClass(CatalogueLeadRequestDTO.class);
        verify(audience).submitCatalogueLead(dto.capture(), eq(true));
        assertEquals("site-assistant", dto.getValue().getSourceId());
        assertEquals("SUPPORT", dto.getValue().getCustomFieldValues().get("lead_kind"));
        verifyNoInteractions(utm);
    }

    @Test
    void anUnknownInstituteIsRefusedBeforeThePipelineCouldProvisionAList() {
        CatalogApiException e = assertThrows(CatalogApiException.class, () -> service.submit(
                SiteAssistantLeadService.validate(body(
                        "{\"institute_id\":\"ghost\",\"kind\":\"SALES\",\"full_name\":\"A\",\"phone\":\"9876543210\"}"))));
        assertEquals(HttpStatus.NOT_FOUND, e.getStatus());
        verifyNoInteractions(audience);
    }
}
