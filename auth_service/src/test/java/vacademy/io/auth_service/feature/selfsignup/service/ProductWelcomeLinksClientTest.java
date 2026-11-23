package vacademy.io.auth_service.feature.selfsignup.service;

import org.junit.jupiter.api.Test;
import vacademy.io.auth_service.feature.notification.service.ProductWelcomeEmailBody;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class ProductWelcomeLinksClientTest {

    private final ProductWelcomeLinksClient client = new ProductWelcomeLinksClient();

    @Test
    void readsTheWelcomeLinksOfTheProductSettings() throws Exception {
        List<ProductWelcomeEmailBody.Link> links = client.parse("""
                {"display_name":"Gradewise","welcome_links":[
                  {"title":" Start to finish ","url":"https://gradewise.example/tutorials/","subtitle":"2:04"},
                  {"title":"Create a test","url":"https://gradewise.example/tutorials/#create","subtitle":" "},
                  {"title":"Plain http","url":"http://gradewise.example"},
                  {"title":"","url":"https://gradewise.example/x"},
                  {"url":"https://gradewise.example/y"}
                ]}""");
        assertEquals(List.of(
                new ProductWelcomeEmailBody.Link("Start to finish", "https://gradewise.example/tutorials/", "2:04"),
                new ProductWelcomeEmailBody.Link("Create a test", "https://gradewise.example/tutorials/#create", null)), links);
    }

    @Test
    void noLinksOrNoBodyMeansAnEmptyList() throws Exception {
        assertEquals(List.of(), client.parse("{\"display_name\":\"Gradewise\"}"));
        assertEquals(List.of(), client.parse("{\"welcome_links\":null}"));
        assertEquals(List.of(), client.parse(""));
        assertEquals(List.of(), client.parse(null));
    }

    @Test
    void anOddProductKeyIsNotLookedUp() {
        assertEquals(List.of(), client.get("../x"));
        assertEquals(List.of(), client.get(null));
    }

    @Test
    void atMostTwelveLinks() throws Exception {
        StringBuilder json = new StringBuilder("{\"welcome_links\":[");
        for (int i = 0; i < 20; i++) {
            json.append(i == 0 ? "" : ",").append("{\"title\":\"T").append(i).append("\",\"url\":\"https://a.example/").append(i).append("\"}");
        }
        assertEquals(12, client.parse(json.append("]}").toString()).size());
    }
}
