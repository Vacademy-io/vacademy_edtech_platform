package vacademy.io.admin_core_service.features.catalog_api.service;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.audience.dto.CatalogueLeadRequestDTO;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiException;
import vacademy.io.admin_core_service.features.catalog_api.CatalogTestData;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class CatalogLeadServiceTest {

    private static JsonNode body(String json) {
        try {
            return CatalogTestData.MAPPER.readTree(json);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static String invalidParam(String json) {
        CatalogApiException e = assertThrows(CatalogApiException.class, () -> CatalogLeadService.validate(body(json)), json);
        assertEquals("invalid_request", e.getCode());
        return e.getDetails() == null ? null : (String) e.getDetails().get("param");
    }

    @Test
    void validatesTheBody() {
        assertNull(invalidParam("[]"));
        assertEquals("full_name", invalidParam("{\"email\":\"a@b.co\"}"));
        assertEquals("full_name", invalidParam("{\"full_name\":\"" + "x".repeat(201) + "\",\"email\":\"a@b.co\"}"));
        assertEquals("email", invalidParam("{\"full_name\":\"A\"}"));
        assertEquals("email", invalidParam("{\"full_name\":\"A\",\"email\":\"not-an-email\"}"));
        assertEquals("email", invalidParam("{\"full_name\":\"A\",\"email\":42}"));
        assertEquals("phone", invalidParam("{\"full_name\":\"A\",\"email\":\"a@b.co\",\"phone\":\"call me\"}"));
        assertEquals("message", invalidParam("{\"full_name\":\"A\",\"email\":\"a@b.co\",\"message\":\"" + "m".repeat(2001) + "\"}"));
        assertEquals("custom_fields", invalidParam("{\"full_name\":\"A\",\"email\":\"a@b.co\",\"custom_fields\":[1]}"));
        assertEquals("custom_fields", invalidParam("{\"full_name\":\"A\",\"email\":\"a@b.co\",\"custom_fields\":{\"x\":{\"y\":1}}}"));

        CatalogLeadService.Lead lead = CatalogLeadService.validate(body("""
                {"full_name":" Asha Rao ","email":"asha@example.com","phone":"+91 98765 43210",
                 "message":"Hindi version?","custom_fields":{"city":"Pune","age":34,"blank":" "}}
                """));
        assertEquals("Asha Rao", lead.fullName());
        assertEquals("+91 98765 43210", lead.phone());
        assertEquals("Pune", lead.customFields().get("city"));
        assertEquals("34", lead.customFields().get("age"));
        assertFalse(lead.customFields().containsKey("blank"));
    }

    @Test
    void submitsIntoTheCatalogueLeadPipelineAndReportsDuplicates() {
        AudienceService audience = mock(AudienceService.class);
        CatalogApiService catalog = mock(CatalogApiService.class);
        when(catalog.isCatalogueCourse("inst", "course-1")).thenReturn(true);
        when(audience.submitCatalogueLead(any())).thenReturn("0b6a8f0e-2f6c-4c35-9a53-8d1b8f0b2c11");
        CatalogLeadService service = new CatalogLeadService(audience, catalog);

        CatalogLeadService.Outcome ok = service.submit("inst", CatalogLeadService.validate(body("""
                {"full_name":"Asha","email":"asha@example.com","message":"Hi","course_id":"course-1",
                 "campaign_id":"aud-9","source":"homepage-hero"}
                """)));
        assertTrue(ok.created());
        ArgumentCaptor<CatalogueLeadRequestDTO> sent = ArgumentCaptor.forClass(CatalogueLeadRequestDTO.class);
        verify(audience).submitCatalogueLead(sent.capture());
        CatalogueLeadRequestDTO dto = sent.getValue();
        assertEquals("inst", dto.getInstituteId());
        assertEquals("aud-9", dto.getAudienceId());
        assertEquals("CATALOG_API", dto.getSourceType());
        assertEquals("course-1", dto.getSourceId());
        assertEquals("Hi", dto.getCustomFieldValues().get("message"));
        assertEquals("homepage-hero", dto.getCustomFieldValues().get("source"));

        when(audience.submitCatalogueLead(any())).thenReturn("You have already submitted your response for this campaign");
        CatalogLeadService.Outcome dup = service.submit("inst",
                CatalogLeadService.validate(body("{\"full_name\":\"Asha\",\"email\":\"asha@example.com\"}")));
        assertEquals("duplicate", dup.status());
        assertFalse(dup.created());
        verify(audience, times(2)).submitCatalogueLead(sent.capture());
        assertEquals("catalog-api", sent.getValue().getSourceId());
        assertNull(sent.getValue().getAudienceId());
    }

    @Test
    void anUnknownCourseIsRefusedBeforeAnythingIsSaved() {
        AudienceService audience = mock(AudienceService.class);
        CatalogLeadService service = new CatalogLeadService(audience, mock(CatalogApiService.class));
        CatalogApiException e = assertThrows(CatalogApiException.class, () -> service.submit("inst",
                CatalogLeadService.validate(body("{\"full_name\":\"A\",\"email\":\"a@b.co\",\"course_id\":\"nope\"}"))));
        assertEquals("course_id", e.getDetails().get("param"));
        verifyNoInteractions(audience);
    }

    @Test
    void customFieldsCannotShadowTheLeadsOwnFields() {
        for (String key : List.of("email", "Full_Name", "course_id", "source")) {
            assertEquals("custom_fields", invalidParam(
                    "{\"full_name\":\"A\",\"email\":\"a@b.co\",\"custom_fields\":{\"" + key + "\":\"x\"}}"), key);
        }
    }
}
