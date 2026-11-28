package vacademy.io.auth_service.feature.sso.controller;

import vacademy.io.auth_service.feature.sso.service.SsoLoginService;

/** Plain pages for the few moments the browser is on our backend. */
final class SsoPages {

    private SsoPages() {
    }

    static String page(String title, String message) {
        return SsoLoginService.plainPage(title, message);
    }
}
