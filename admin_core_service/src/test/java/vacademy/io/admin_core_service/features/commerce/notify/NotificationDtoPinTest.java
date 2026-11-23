package vacademy.io.admin_core_service.features.commerce.notify;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.notify.dto.NotificationSettingsDtos;
import vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationStore;
import vacademy.io.admin_core_service.features.commerce.order.dto.StaffOrderDtos;

import java.util.Date;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The JSON names of the buyer-message routes (contract §8.1), pinned. */
class NotificationDtoPinTest {

    private final ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();

    private Set<String> names(Object value) {
        JsonNode node = mapper.valueToTree(value);
        Set<String> out = new TreeSet<>();
        Iterator<String> it = node.fieldNames();
        while (it.hasNext()) {
            out.add(it.next());
        }
        return out;
    }

    private static Set<String> set(String... names) {
        return new TreeSet<>(List.of(names));
    }

    @Test
    void theSettingsAnswerHasTheContractNames() {
        NotificationSettingsDtos.SettingsView view = NotificationSettingsDtos.SettingsView.builder()
                .shop(NotificationSettingsDtos.ShopView.builder().build())
                .triggers(List.of(NotificationSettingsDtos.TriggerView.builder()
                        .whatsapp(NotificationSettingsDtos.WhatsAppView.builder().build())
                        .email(NotificationSettingsDtos.EmailView.builder().build()).build()))
                .build();
        JsonNode tree = mapper.valueToTree(view);
        assertEquals(set("shop", "triggers"), names(view));
        assertEquals(set("link_base_url", "link_base_candidates", "link_days", "shop_name", "shop_name_default",
                "base_locale", "link_secret_configured", "sending_enabled"), names(view.getShop()));
        assertTrue(tree.get("shop").has("link_base_url") && tree.get("shop").get("link_base_url").isNull(),
                "nulls are answered (link_base_url: null)");
        NotificationSettingsDtos.TriggerView trigger = view.getTriggers().get(0);
        assertEquals(set("trigger", "enabled", "email_enabled", "whatsapp_enabled", "handled_by_workflow", "version",
                "variables", "whatsapp", "email"), names(trigger));
        assertEquals(set("template_name", "default_template_name", "status", "text"), names(trigger.getWhatsapp()));
        assertEquals(set("subject", "body", "overridden"), names(trigger.getEmail()));
    }

    @Test
    void thePutBodiesReadTheContractNames() throws Exception {
        NotificationSettingsDtos.TriggerUpdate update = mapper.readValue("{\"version\":3,\"enabled\":true,"
                + "\"email_enabled\":false,\"whatsapp_enabled\":true,\"whatsapp_template_name\":\"t_1\","
                + "\"email\":{\"hi\":{\"subject\":\"s\",\"body\":\"b\"},\"en\":null}}",
                NotificationSettingsDtos.TriggerUpdate.class);
        assertEquals(3, update.getVersion());
        assertEquals(Boolean.FALSE, update.getEmailEnabled());
        assertEquals("t_1", update.getWhatsappTemplateName());
        assertEquals("s", update.getEmail().get("hi").getSubject());
        assertTrue(update.getEmail().containsKey("en"));
        NotificationSettingsDtos.ShopUpdate shop = mapper.readValue("{\"link_base_url\":\"https://shop.example.com\","
                + "\"link_days\":14,\"shop_name\":{\"hi\":\"a\",\"en\":\"b\"}}", NotificationSettingsDtos.ShopUpdate.class);
        assertEquals("https://shop.example.com", shop.getLinkBaseUrl());
        assertEquals(14, shop.getLinkDays());
        assertEquals(Map.of("hi", "a", "en", "b"), shop.getShopName());
    }

    @Test
    void theTestSendAndTemplateBodiesAndAnswersHaveTheContractNames() throws Exception {
        NotificationSettingsDtos.TestSendRequest request = mapper.readValue("{\"trigger\":\"ORDER_SHIPPED\","
                + "\"locale\":\"hi\",\"channels\":[\"EMAIL\",\"WHATSAPP\"]}", NotificationSettingsDtos.TestSendRequest.class);
        assertEquals(List.of("EMAIL", "WHATSAPP"), request.getChannels());
        NotificationSettingsDtos.TestSendAnswer answer = NotificationSettingsDtos.TestSendAnswer.builder()
                .results(List.of(NotificationSettingsDtos.TestSendResult.builder().build())).build();
        assertEquals(set("results"), names(answer));
        assertEquals(set("channel", "status", "code", "recipient_masked"), names(answer.getResults().get(0)));

        NotificationSettingsDtos.TemplateSubmitRequest submit = mapper.readValue("{\"triggers\":null,"
                + "\"locales\":[\"hi\",\"en\"]}", NotificationSettingsDtos.TemplateSubmitRequest.class);
        assertEquals(List.of("hi", "en"), submit.getLocales());
        NotificationSettingsDtos.TemplateSubmitAnswer items = NotificationSettingsDtos.TemplateSubmitAnswer.builder()
                .items(List.of(NotificationSettingsDtos.TemplateSubmitItem.builder().build())).build();
        assertEquals(set("items"), names(items));
        assertEquals(set("trigger", "locale", "template_name", "status", "code", "text", "variable_names"),
                names(items.getItems().get(0)));
    }

    @Test
    void theOrderMessagesHaveTheContractNamesAndNoAddress() {
        Date at = new Date(1_700_000_000_000L);
        NotificationSettingsDtos.DeliveryView view = NotificationSettingsDtos.DeliveryView.of(
                new CommerceNotificationStore.DeliveryView("ORDER_SHIPPED", "WHATSAPP", "SENT", null, "hi",
                        "••••••3210", at, at));
        assertEquals(set("trigger", "channel", "status", "code", "locale", "recipient_masked", "created_at",
                "sent_at"), names(view));
        assertEquals("2023-11-14T22:13:20Z", view.getCreatedAt());
        assertEquals(set("items"), names(NotificationSettingsDtos.DeliveryList.builder().items(List.of(view)).build()));

        StaffOrderDtos.StaffOrderDetail detail = StaffOrderDtos.StaffOrderDetail.builder()
                .notifications(List.of(view)).build();
        assertTrue(names(detail).contains("notifications"));
    }
}
