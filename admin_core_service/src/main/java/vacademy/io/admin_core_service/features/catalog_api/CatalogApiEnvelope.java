package vacademy.io.admin_core_service.features.catalog_api;

/**
 * Marker for a controller outside this package whose routes belong to the public Catalogue API
 * family (publishable key, origin lock, the API error envelope). {@link CatalogApiErrorAdvice}
 * applies to every controller that implements it, so those routes answer errors as
 * {"error":{"code","message","request_id","details"?}} like the routes of
 * {@link PublicCatalogApiController}.
 */
public interface CatalogApiEnvelope {
}
