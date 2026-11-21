package vacademy.io.media_service.controller;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.media_service.service.ShortLinkService;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/s")
public class PublicShortLinkController {

    @Autowired
    private ShortLinkService shortLinkService;

    /**
     * Redirects to the destination URL (HTTP 302 redirect)
     * Usage: GET /s/{shortCode}
     * Example: GET /s/AbCd12 -> redirects to destination URL
     */
    @GetMapping("/{shortCode}")
    public void redirectShortLink(@PathVariable String shortCode, HttpServletResponse response) throws IOException {
        String destinationUrl;
        try {
            destinationUrl = shortLinkService.getDestinationUrlAndLogAccess(shortCode);
        } catch (VacademyException e) {
            // Unknown or deactivated code. This URL is opened by people in a browser (from WhatsApp,
            // email, a QR code), so answer with a readable page, not the API's JSON error.
            response.setStatus(HttpServletResponse.SC_NOT_FOUND);
            response.setContentType("text/html;charset=UTF-8");
            response.getWriter().write(LINK_NOT_FOUND_PAGE);
            return;
        }
        response.sendRedirect(destinationUrl);
    }

    private static final String LINK_NOT_FOUND_PAGE = """
            <!doctype html>
            <html lang="en">
            <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <meta name="robots" content="noindex">
            <title>Link not found</title>
            <style>
              body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
                font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f7f7f8;color:#1f2937}
              main{max-width:420px;margin:24px;padding:32px 28px;background:#fff;border:1px solid #e5e7eb;
                border-radius:12px;text-align:center}
              h1{font-size:20px;margin:0 0 8px}
              p{font-size:15px;line-height:1.5;margin:0;color:#4b5563}
            </style>
            </head>
            <body>
            <main>
              <h1>This link isn't working</h1>
              <p>It may be mistyped, or it has expired. Please check the link, or ask whoever shared it to send a new one.</p>
            </main>
            </body>
            </html>
            """;

    /**
     * Returns the destination URL as JSON without redirecting
     * Usage: GET /s/{shortCode}/info
     * Example: GET /s/AbCd12/info -> {"shortCode": "AbCd12", "destinationUrl":
     * "https://..."}
     */
    @GetMapping("/{shortCode}/info")
    public ResponseEntity<Map<String, String>> getShortLinkInfo(@PathVariable String shortCode) {
        String destinationUrl = shortLinkService.getDestinationUrlAndLogAccess(shortCode);

        Map<String, String> response = new HashMap<>();
        response.put("shortCode", shortCode);
        response.put("destinationUrl", destinationUrl);

        return ResponseEntity.ok(response);
    }
}
