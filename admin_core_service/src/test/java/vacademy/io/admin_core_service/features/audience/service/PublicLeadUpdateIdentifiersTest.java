package vacademy.io.admin_core_service.features.audience.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.audience.dto.UpdateLeadWithEnquiryRequestDTO;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Public lead update (PUT /open/v1/audience/lead/update-with-enquiry/{id}): profile fields of
 * the lead's account follow the request, while the account's sign-in identifiers (e-mail,
 * mobile number) keep their stored values. A typed e-mail or mobile is kept on the lead row.
 */
class PublicLeadUpdateIdentifiersTest {

    private static UserDTO stored() {
        return UserDTO.builder()
                .id("acc-1")
                .username("asha")
                .email("asha@example.com")
                .mobileNumber(null)
                .fullName("Asha")
                .city("Delhi")
                .build();
    }

    @Test
    void accountEmailAndMobileKeepStoredValues() {
        UserDTO typed = UserDTO.builder()
                .email("other@example.com")
                .mobileNumber("9000000001")
                .fullName("Asha Rao")
                .city("Pune")
                .build();

        UserDTO merged = AudienceService.mergeProfileKeepingSignInIdentifiers(stored(), typed);

        assertEquals("acc-1", merged.getId());
        assertEquals("asha", merged.getUsername());
        assertEquals("asha@example.com", merged.getEmail());
        assertNull(merged.getMobileNumber());
        assertEquals("Asha Rao", merged.getFullName());
        assertEquals("Pune", merged.getCity());
    }

    @Test
    void storedMobileIsNotReplaced() {
        UserDTO account = stored();
        account.setMobileNumber("9111111111");
        UserDTO typed = UserDTO.builder().mobileNumber("9000000001").build();

        UserDTO merged = AudienceService.mergeProfileKeepingSignInIdentifiers(account, typed);

        assertEquals("9111111111", merged.getMobileNumber());
        assertEquals("Delhi", merged.getCity());
    }

    @Test
    void typedContactGoesOnTheLeadRow() {
        AudienceResponse lead = new AudienceResponse();
        UpdateLeadWithEnquiryRequestDTO req = new UpdateLeadWithEnquiryRequestDTO();
        req.setParentUserDTO(UserDTO.builder().email("other@example.com").mobileNumber("9000000001").build());

        List<String> changed = AudienceService.keepTypedContactOnLead(lead, req);

        assertEquals(List.of("parent_email", "parent_mobile"), changed);
        assertEquals("other@example.com", lead.getParentEmail());
        assertEquals("9000000001", lead.getParentMobile());
    }

    @Test
    void explicitLeadColumnsInTheRequestWin() {
        AudienceResponse lead = new AudienceResponse();
        lead.setParentEmail("explicit@example.com");
        UpdateLeadWithEnquiryRequestDTO req = new UpdateLeadWithEnquiryRequestDTO();
        req.setParentEmail("explicit@example.com");
        req.setParentMobile("9222222222");
        req.setParentUserDTO(UserDTO.builder().email("other@example.com").mobileNumber("9000000001").build());

        List<String> changed = AudienceService.keepTypedContactOnLead(lead, req);

        assertTrue(changed.isEmpty());
        assertEquals("explicit@example.com", lead.getParentEmail());
    }
}
