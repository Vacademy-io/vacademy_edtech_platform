package vacademy.io.admin_core_service.features.audience;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.web.reactive.function.client.WebClient;
import vacademy.io.admin_core_service.features.audience.dto.NormalizedLeadData;
import vacademy.io.admin_core_service.features.audience.entity.FormWebhookConnector;
import vacademy.io.admin_core_service.features.audience.strategy.MetaLeadAdsStrategy;

import java.lang.reflect.Method;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Guards the identity-field extraction in MetaLeadAdsStrategy.
 *
 * A Meta lead form's field names are chosen by whoever built the ad, so the
 * canonical "phone_number" is a convention and nothing more. Extraction used to
 * demand that exact key, so Shiksha Nation's NEET_2027 form — which asks "phone"
 * — produced leads whose user record had no mobile number at all, even though
 * the answer still reached custom_field_values via the connector mapping. The
 * visible symptom was an empty Contact column and a "Lead has no phone on file"
 * toast on a lead whose profile plainly showed the number.
 */
class MetaLeadAdsFieldExtractionTest {

    private final MetaLeadAdsStrategy strategy =
            new MetaLeadAdsStrategy(WebClient.builder(), new ObjectMapper(), null);
    private final ObjectMapper mapper = new ObjectMapper();

    /** Invoke the private extraction with a Graph-shaped lead node. */
    private NormalizedLeadData normalize(String fieldDataJson) throws Exception {
        JsonNode leadNode = mapper.readTree("{\"field_data\":" + fieldDataJson + "}");
        FormWebhookConnector connector = new FormWebhookConnector();
        connector.setAudienceId("aud-1");
        Method m = MetaLeadAdsStrategy.class.getDeclaredMethod(
                "buildNormalizedLead", String.class, JsonNode.class, FormWebhookConnector.class);
        m.setAccessible(true);
        return (NormalizedLeadData) m.invoke(strategy, "lead-1", leadNode, connector);
    }

    private static String field(String name, String value) {
        return "{\"name\":\"" + name + "\",\"values\":[\"" + value + "\"]}";
    }

    @Nested
    @DisplayName("phone extraction")
    class PhoneExtraction {

        /** The exact payload shape that broke: SURAIYA, NEET_2027_v2, 28 Aug 2026. */
        @Test
        void extractsPhoneFromABarePhoneKey() throws Exception {
            NormalizedLeadData lead = normalize("[" + field("full_name", "SURAIYA") + ","
                    + field("email", "suraiyasultana7478@gmail.com") + ","
                    + field("phone", "+918346062700") + ","
                    + field("city", "24 Paraganas South") + "]");

            assertEquals("918346062700", lead.getPhone());
            assertEquals("SURAIYA", lead.getFullName());
            assertEquals("suraiyasultana7478@gmail.com", lead.getEmail());
        }

        /** The canonical key must keep working exactly as before. */
        @Test
        void stillExtractsCanonicalPhoneNumberKey() throws Exception {
            NormalizedLeadData lead = normalize("[" + field("PHONE_NUMBER", "+919876543210") + "]");
            assertEquals("919876543210", lead.getPhone());
        }

        @Test
        void prependsCountryCodeToATenDigitNumber() throws Exception {
            NormalizedLeadData lead = normalize("[" + field("mobile", "9876543210") + "]");
            assertEquals("919876543210", lead.getPhone());
        }

        @Test
        void leavesAForeignNumberIntact() throws Exception {
            NormalizedLeadData lead = normalize("[" + field("phone", "+1 415 555 0123") + "]");
            assertEquals("14155550123", lead.getPhone());
        }

        /** An author-renamed question still resolves through the substring fallback. */
        @Test
        void resolvesARenamedPhoneQuestion() throws Exception {
            NormalizedLeadData lead = normalize("[" + field("your_phone_no", "+918346062700") + "]");
            assertEquals("918346062700", lead.getPhone());
        }

        /**
         * The substring fallback is the risky half — a yes/no question that merely
         * mentions WhatsApp must never be filed as the number. Shape guard, not luck.
         */
        @Test
        void doesNotTreatAYesNoWhatsappQuestionAsTheNumber() throws Exception {
            NormalizedLeadData lead = normalize("["
                    + field("do_you_have_a_whatsapp_number?", "Yes") + "]");
            assertNull(lead.getPhone());
        }

        /** A real number on the same question shape still resolves. */
        @Test
        void stillAcceptsARealNumberOnALooselyNamedQuestion() throws Exception {
            NormalizedLeadData lead = normalize("["
                    + field("do_you_have_a_whatsapp_number?", "+918346062700") + "]");
            assertEquals("918346062700", lead.getPhone());
        }

        /** An exact alias is trusted as-is — Meta's own junk keeps its old behaviour. */
        @Test
        void leavesMetaTestLeadJunkOnTheCanonicalKeyAlone() throws Exception {
            NormalizedLeadData lead = normalize("["
                    + field("phone_number", "<test lead: dummy data for phone>") + "]");
            assertEquals("", lead.getPhone());
        }

        /** The canonical key wins even when the form carries both. */
        @Test
        void prefersPhoneNumberOverPhoneWhenBothPresent() throws Exception {
            NormalizedLeadData lead = normalize("[" + field("phone", "+911111111111") + ","
                    + field("phone_number", "+912222222222") + "]");
            assertEquals("912222222222", lead.getPhone());
        }

        /** A blank answer must not shadow the question that was actually filled. */
        @Test
        void skipsABlankPhoneAnswer() throws Exception {
            NormalizedLeadData lead = normalize("[" + field("phone_number", "") + ","
                    + field("mobile", "+918346062700") + "]");
            assertEquals("918346062700", lead.getPhone());
        }

        @Test
        void returnsNullWhenTheFormAsksForNoPhoneAtAll() throws Exception {
            NormalizedLeadData lead = normalize("[" + field("email", "a@b.com") + "]");
            assertNull(lead.getPhone());
        }

        /**
         * The stored custom field value must carry the normalized number too —
         * a leftover "+91…" in custom_field_values is exactly the fingerprint
         * that proved extraction had been skipped on the live rows.
         */
        @Test
        void writesTheNormalizedNumberBackOntoTheMatchedKey() throws Exception {
            NormalizedLeadData lead = normalize("[" + field("phone", "+918346062700") + "]");
            assertEquals("918346062700", lead.getFields().get("phone"));
        }
    }

    @Nested
    @DisplayName("name extraction")
    class NameExtraction {

        @Test
        void resolvesARenamedNameQuestion() throws Exception {
            NormalizedLeadData lead = normalize("[" + field("your_name", "SURAIYA") + "]");
            assertEquals("SURAIYA", lead.getFullName());
        }

        /**
         * Live forms ask "name_of_school_/_organisation?" — a loose substring
         * match on "name" would file the school as the lead's own name, so name
         * resolution is alias-only by design.
         */
        @Test
        void doesNotMistakeASchoolNameQuestionForTheLeadName() throws Exception {
            NormalizedLeadData lead = normalize("["
                    + field("name_of_school_/_organisation?", "Delhi Public School") + ","
                    + field("phone", "+918346062700") + "]");
            assertNull(lead.getFullName());
        }

        /**
         * Deliberate boundary: first/last composition belongs to
         * LeadEnricher.composeFullName, which runs downstream on the mapped fields
         * and writes the composed value to every name alias. Composing it here too
         * would set formFields["fullName"] early and make composeFullName return
         * before writing "Full Name" / "parent name", so the strategy leaves it null.
         */
        @Test
        void leavesFirstLastCompositionToTheDownstreamEnricher() throws Exception {
            NormalizedLeadData lead = normalize("[" + field("first_name", "Vutukuri") + ","
                    + field("last_name", "Ganesh") + "]");
            assertNull(lead.getFullName());
        }
    }

    @Nested
    @DisplayName("email extraction")
    class EmailExtraction {

        @Test
        void extractsARenamedEmailQuestion() throws Exception {
            NormalizedLeadData lead = normalize("[" + field("email_address", "a@b.com") + "]");
            assertEquals("a@b.com", lead.getEmail());
        }

        /**
         * A synthesized placeholder address is created downstream when the email is
         * absent; a "Yes" filed as the email would defeat that and create an auth
         * account addressed "Yes".
         */
        @Test
        void doesNotTreatAYesNoEmailQuestionAsTheAddress() throws Exception {
            NormalizedLeadData lead = normalize("["
                    + field("can_we_email_you?", "Yes") + "]");
            assertNull(lead.getEmail());
        }
    }
}
