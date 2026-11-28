package vacademy.io.admin_core_service.features.audience.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.audience.dto.SubmitLeadRequestDTO;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * bulkSubmitLead runs groups in parallel and the rows of one group in file order. Rows that
 * could be the same person must share a group, or two workers would race to create them.
 */
class BulkLeadRowGroupingTest {

    private static SubmitLeadRequestDTO row(String name, String email, String phone) {
        SubmitLeadRequestDTO dto = new SubmitLeadRequestDTO();
        dto.setUserDTO(UserDTO.builder().fullName(name).email(email).mobileNumber(phone).build());
        return dto;
    }

    private static List<List<Integer>> group(List<SubmitLeadRequestDTO> rows) {
        List<Integer> all = IntStream.range(0, rows.size()).boxed().collect(Collectors.toList());
        return AudienceService.groupBulkRowsBySamePerson(rows, all);
    }

    @Test
    void distinctPeopleGetTheirOwnGroups() {
        List<SubmitLeadRequestDTO> rows = List.of(
                row("A", "a@x.com", "9000000001"),
                row("B", "b@x.com", "9000000002"),
                row("C", "c@x.com", "9000000003"));
        assertEquals(List.of(List.of(0), List.of(1), List.of(2)), group(rows));
    }

    @Test
    void sameEmailIgnoringCaseAndSpacesSharesAGroup() {
        List<SubmitLeadRequestDTO> rows = List.of(
                row("A", "a@x.com", null),
                row("B", "b@x.com", null),
                row("A2", "  A@X.com ", null));
        assertEquals(List.of(List.of(0, 2), List.of(1)), group(rows));
    }

    @Test
    void samePhoneLast10DigitsSharesAGroupEvenWithDifferentEmails() {
        List<SubmitLeadRequestDTO> rows = List.of(
                row("A", "a@x.com", "+91 98765-43210"),
                row("B", "b@x.com", "9000000002"),
                row("A", "other@x.com", "9876543210"));
        assertEquals(List.of(List.of(0, 2), List.of(1)), group(rows));
    }

    @Test
    void linksChainAcrossEmailAndPhone() {
        // 0 and 1 share a phone, 1 and 2 share an email: all three are one person.
        List<SubmitLeadRequestDTO> rows = List.of(
                row("A", "a@x.com", "9000000001"),
                row("A", "b@x.com", "9000000001"),
                row("A", "b@x.com", "9000000009"),
                row("Z", "z@x.com", "9000000099"));
        assertEquals(List.of(List.of(0, 1, 2), List.of(3)), group(rows));
    }

    @Test
    void rowsWithNoEmailOrPhoneGroupByName() {
        List<SubmitLeadRequestDTO> rows = List.of(
                row("Ravi Kumar", null, null),
                row("Someone Else", null, null),
                row("ravi kumar", "", ""));
        assertEquals(List.of(List.of(0, 2), List.of(1)), group(rows));
    }

    @Test
    void onlySubmittedIndexesAreGroupedAndFileOrderIsKept() {
        List<SubmitLeadRequestDTO> rows = new ArrayList<>();
        rows.add(row("A", "a@x.com", null));
        rows.add(row("A", "a@x.com", null)); // dropped by pass 1 in the real flow
        rows.add(row("B", "b@x.com", null));
        rows.add(row("A", "a@x.com", null));
        List<List<Integer>> groups = AudienceService.groupBulkRowsBySamePerson(rows, List.of(0, 2, 3));
        assertEquals(List.of(List.of(0, 3), List.of(2)), groups);
    }
}
