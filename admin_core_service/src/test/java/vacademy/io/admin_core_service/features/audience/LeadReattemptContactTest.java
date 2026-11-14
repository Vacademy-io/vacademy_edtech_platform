package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.admin_core_service.features.audience.dto.LeadEnquiryContactsDTO;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.service.LeadDeduplicationService;
import vacademy.io.admin_core_service.features.audience.service.PlaceholderEmailService;
import vacademy.io.admin_core_service.features.timeline.enums.LeadJourneyActionType;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;
import vacademy.io.common.exceptions.ForbiddenException;

import java.lang.reflect.Field;
import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The Reattempt journey entry names the new phone / email a repeat brought, and the lead's
 * "Other contact details" lists each different phone and real email the person enquired with.
 */
class LeadReattemptContactTest {

    private LeadDeduplicationService service;
    private AudienceResponseRepository responses;
    private TimelineEventService timeline;
    private PlaceholderEmailService placeholders;

    @BeforeEach
    void setUp() throws Exception {
        service = new LeadDeduplicationService();
        for (Field f : LeadDeduplicationService.class.getDeclaredFields()) {
            if (f.isAnnotationPresent(Autowired.class)) {
                f.setAccessible(true);
                f.set(service, mock(f.getType()));
            }
        }
        responses = (AudienceResponseRepository) get("audienceResponseRepository");
        timeline = (TimelineEventService) get("timelineEventService");
        placeholders = (PlaceholderEmailService) get("placeholderEmailService");
        when(placeholders.isPlaceholder(anyString()))
                .thenAnswer(inv -> ((String) inv.getArgument(0)).endsWith("@vacademy.com"));
    }

    private Object get(String field) throws Exception {
        Field f = LeadDeduplicationService.class.getDeclaredField(field);
        f.setAccessible(true);
        return f.get(service);
    }

    private static AudienceResponseRepository.PrimaryLeadRow primary() {
        AudienceResponseRepository.PrimaryLeadRow row = mock(AudienceResponseRepository.PrimaryLeadRow.class);
        when(row.getResponseId()).thenReturn("resp-old");
        when(row.getUserId()).thenReturn("user-1");
        return row;
    }

    private static AudienceResponse repeat(String phone) {
        return repeat(phone, null);
    }

    private static AudienceResponse repeat(String phone, String email) {
        AudienceResponse r = new AudienceResponse();
        r.setId("resp-new");
        r.setSourceType("GOOGLE_LEAD_ADS");
        r.setParentMobile(phone);
        r.setParentEmail(email);
        return r;
    }

    private void primaryPhone(String phone) {
        primary(phone, null);
    }

    private void primary(String phone, String email) {
        AudienceResponseRepository.ResponseContactRow old = mock(AudienceResponseRepository.ResponseContactRow.class);
        when(old.getPhone()).thenReturn(phone);
        when(old.getEmail()).thenReturn(email);
        when(responses.findContactOfResponse("resp-old")).thenReturn(List.of(old));
    }

    @SuppressWarnings("unchecked")
    private String[] logged() {
        ArgumentCaptor<String> description = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object> metadata = ArgumentCaptor.forClass(Object.class);
        verify(timeline).logJourneyEvent(eq("AUDIENCE_RESPONSE"), eq("resp-old"), eq(LeadJourneyActionType.REATTEMPT),
                eq("SYSTEM"), isNull(), eq("System"), eq("Reattempt"), description.capture(), metadata.capture(),
                eq("user-1"));
        Map<String, String> meta = (Map<String, String>) metadata.getValue();
        return new String[] { description.getValue(), meta.get("phone"), meta.get("email") };
    }

    @Test
    void aDifferentPhoneIsNamedAsTheNewNumber() {
        primaryPhone("+918347649467");
        service.logReattempt(primary(), repeat(" +919023884961 "), "Google Ads", "Gujarat-ADCT");
        String[] entry = logged();
        assertEquals("Enquired again via Google Ads · Gujarat-ADCT · new number +919023884961", entry[0]);
        assertEquals("+919023884961", entry[1]);
    }

    @Test
    void theSamePhoneLeavesTheEntryAsBefore() {
        primaryPhone("918347649467");
        service.logReattempt(primary(), repeat("+91 83476-49467"), "Google Ads", "Gujarat-ADCT");
        String[] entry = logged();
        assertEquals("Enquired again via Google Ads · Gujarat-ADCT", entry[0]);
        assertNull(entry[1]);
    }

    @Test
    void noPhoneOrAFailedLookupLeavesTheEntryAsBefore() {
        service.logReattempt(primary(), repeat(null), "Google Ads", "Gujarat-ADCT");
        assertEquals("Enquired again via Google Ads · Gujarat-ADCT", logged()[0]);
        verify(responses, never()).findContactOfResponse(any());

        reset(timeline);
        when(responses.findContactOfResponse("resp-old")).thenThrow(new RuntimeException("db down"));
        service.logReattempt(primary(), repeat("+919023884961"), "Google Ads", null);
        assertEquals("Enquired again via Google Ads", logged()[0]);
    }

    @Test
    void aLeadWithoutItsOwnPhoneGetsANeutralNumberNote() {
        primaryPhone(null);
        service.logReattempt(primary(), repeat("+919023884961"), "Google Ads", "Gujarat-ADCT");
        assertEquals("Enquired again via Google Ads · Gujarat-ADCT · number +919023884961", logged()[0]);
    }

    @Test
    void theLeadIsNeverLoadedAsAnEntity() {
        primary("+918347649467", "old@gmail.com");
        service.logReattempt(primary(), repeat("+919023884961", "new@gmail.com"), "Google Ads", null);
        verify(responses, never()).findById(any());
    }

    @Test
    void aDifferentRealEmailIsNamedAsTheNewEmail() {
        primary("+918347649467", "old@gmail.com");
        service.logReattempt(primary(), repeat("+918347649467", " New@Gmail.com "), "Meta Lead Ads", "PGDCC");
        String[] entry = logged();
        assertEquals("Enquired again via Meta Lead Ads · PGDCC · new email New@Gmail.com", entry[0]);
        assertNull(entry[1]);
        assertEquals("New@Gmail.com", entry[2]);
    }

    @Test
    void sameEmailIgnoringCaseAddsNothing() {
        primary("+918347649467", "Old@gmail.com");
        service.logReattempt(primary(), repeat("+918347649467", "old@GMAIL.com"), "Meta Lead Ads", null);
        assertEquals("Enquired again via Meta Lead Ads", logged()[0]);
    }

    @Test
    void bothNewNumberAndNewEmailAreNamed() {
        primary("+918347649467", "old@gmail.com");
        service.logReattempt(primary(), repeat("+919023884961", "new@gmail.com"), "Google Ads", "Gujarat-ADCT");
        assertEquals("Enquired again via Google Ads · Gujarat-ADCT · new number +919023884961 · new email new@gmail.com",
                logged()[0]);
    }

    @Test
    void placeholderEmailsAreNeverNamed() {
        primary("+918347649467", "old@gmail.com");
        service.logReattempt(primary(), repeat("+918347649467", "raj918347649467@vacademy.com"), "Meta Lead Ads", null);
        assertEquals("Enquired again via Meta Lead Ads", logged()[0]);

        reset(timeline);
        service.logReattempt(primary(), repeat("+918347649467", "8347649467@emailid.no"), "Meta Lead Ads", null);
        assertEquals("Enquired again via Meta Lead Ads", logged()[0]);
    }

    @Test
    void aRealEmailReplacingAPlaceholderIsNew() {
        primary("+918347649467", "8347649467@emailid.no");
        service.logReattempt(primary(), repeat("+918347649467", "real@gmail.com"), "Meta Lead Ads", null);
        assertEquals("Enquired again via Meta Lead Ads · new email real@gmail.com", logged()[0]);
    }

    private static AudienceResponseRepository.EnquiryContactRow row(String id, String phone, String email,
            String list) {
        AudienceResponseRepository.EnquiryContactRow r = mock(AudienceResponseRepository.EnquiryContactRow.class);
        when(r.getResponseId()).thenReturn(id);
        when(r.getPhone()).thenReturn(phone);
        when(r.getEmail()).thenReturn(email);
        when(r.getSourceType()).thenReturn("GOOGLE_LEAD_ADS");
        when(r.getCampaignName()).thenReturn(list);
        when(r.getCreatedAt()).thenReturn(new Timestamp(0));
        when(r.getInstituteId()).thenReturn("inst-1");
        return r;
    }

    @Test
    void enquiryContactsAreDistinctOldestFirstWithoutPlaceholders() {
        List<AudienceResponseRepository.EnquiryContactRow> rows = List.of(
                row("r1", "+918347649467", "8347649467@emailid.no", "Re-marketing"),
                row("r2", " +919023884961 ", "Payal@gmail.com", "Gujarat-ADCT"),
                row("r3", "918347649467", "payal@GMAIL.com", "Walk-in"),
                row("r4", null, "x918347649467@vacademy.com", "Empty"),
                row("r5", " ", "other@yahoo.com", "Website"));
        when(responses.findEnquiryContactsOfLeadPerson("resp-old")).thenReturn(rows);
        List<String> checked = new java.util.ArrayList<>();

        LeadEnquiryContactsDTO contacts = service.findEnquiryContacts("resp-old", checked::add);

        assertEquals(List.of("inst-1"), checked);
        assertEquals(List.of("+918347649467", "+919023884961"),
                contacts.getPhones().stream().map(LeadEnquiryContactsDTO.Contact::getValue).toList());
        assertEquals("r1", contacts.getPhones().get(0).getResponseId());
        assertEquals(List.of("Payal@gmail.com", "other@yahoo.com"),
                contacts.getEmails().stream().map(LeadEnquiryContactsDTO.Contact::getValue).toList());
        assertEquals("Gujarat-ADCT", contacts.getEmails().get(0).getCampaignName());
    }

    @Test
    void enquiryContactsAreRefusedWithoutAccessAndEmptyForAnUnknownLead() {
        List<AudienceResponseRepository.EnquiryContactRow> one = List.of(row("r1", "+918347649467", null, "x"));
        when(responses.findEnquiryContactsOfLeadPerson("resp-old")).thenReturn(one);
        assertThrows(ForbiddenException.class, () -> service.findEnquiryContacts("resp-old", id -> {
            throw new ForbiddenException("no");
        }));

        when(responses.findEnquiryContactsOfLeadPerson("missing")).thenReturn(List.of());
        LeadEnquiryContactsDTO none = service.findEnquiryContacts("missing", id -> fail("no access check without a lead"));
        assertEquals(List.of(), none.getPhones());
        assertEquals(List.of(), none.getEmails());
        assertEquals(List.of(), service.findEnquiryContacts(null, id -> fail("no lookup")).getEmails());
    }
}
