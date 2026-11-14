package vacademy.io.assessment_service.features.open_evaluation.controller;

/** Test access to the forward target of {@link OpenApiDocsController}. */
public final class OpenApiDocsControllerAccess {

    private OpenApiDocsControllerAccess() {
    }

    public static String target(String apiDocsPath) {
        return new OpenApiDocsController(apiDocsPath).openApiJson();
    }
}
