package vacademy.io.admin_core_service.features.media_service.constants;

public class MediaServiceConstants {
    public static final String GET_FILE_URL_BY_ID_ROUTE = "/media-service/internal/get-url/id";
    public static final String GET_FILE_PUBLIC_URL_BY_ID_ROUTE = "/media-service/internal/public-url";
    public static final String GET_FILE_UPLOAD_ENDPOINT = "/media-service/internal/upload-file";
    public static final String GET_FILE_UPLOAD_ENDPOINT_V2 = "/media-service/internal/upload-file-v2";
    /** Private bucket + SSE-S3 upload (sensitive media, e.g. Vacademy Voice recordings). */
    public static final String GET_FILE_UPLOAD_ENDPOINT_PRIVATE = "/media-service/internal/upload-file-private";
    public static final String GET_MULTIPLE_FILES_BY_ID_ROUTE = "/media-service/internal/get-details/ids";
    public static final String GET_MULTIPLE_FILE_URLS_BY_ID_ROUTE = "/media-service/internal/get-url/id/many";
    /** Permanent public (CDN) URLs for a batch of files; fails as a whole if ANY id is unknown. */
    public static final String GET_MULTIPLE_PUBLIC_URLS_BY_ID_ROUTE = "/media-service/internal/get-public-url/id/many";
    /** Learner offline downloads: size/type/checksum for a batch of files (no URL, no raw S3 key). */
    public static final String GET_OFFLINE_ASSET_DETAILS_ROUTE = "/media-service/internal/offline-asset-details";
}
