package vacademy.io.media_service.service;

import com.amazonaws.HttpMethod;
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.model.CopyObjectRequest;
import com.amazonaws.services.s3.model.ObjectMetadata;
import com.amazonaws.services.s3.model.GeneratePresignedUrlRequest;
import com.amazonaws.services.s3.model.ListObjectsV2Result;
import com.amazonaws.services.s3.model.S3ObjectSummary;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;
import vacademy.io.common.exceptions.DatabaseException;
import vacademy.io.common.media.dto.FileDetailsDTO;
import vacademy.io.common.media.utils.MediaUtil;
import vacademy.io.media_service.dto.AcknowledgeRequest;
import vacademy.io.media_service.dto.PreSignedUrlResponse;
import vacademy.io.media_service.entity.FileMetadata;
import vacademy.io.media_service.entity.UserToFile;
import vacademy.io.media_service.enums.FileStatusEnum;
import vacademy.io.media_service.exceptions.FileDownloadException;
import vacademy.io.media_service.exceptions.FileUploadException;
import vacademy.io.media_service.repository.FileMetadataRepository;
import vacademy.io.media_service.repository.UserToFileRepository;

import java.io.File;
import java.io.IOException;
import java.net.URL;
import java.nio.file.Paths;
import java.util.*;

@Service
@Slf4j
@RequiredArgsConstructor
public class FileServiceImpl implements FileService {
    @Autowired
    private final AmazonS3 s3Client;
    private final UserToFileRepository userToFileRepository;
    private final CdnUrlService cdnUrlService;
    private final CloudFrontSignerService cloudFrontSignerService;

    @Value("${aws.bucket.name}")
    private String bucketName;

    @Value("${aws.s3.public-bucket}")
    private String publicBucket;

    /**
     * Cache-Control stamped on objects copied into the public bucket.
     * <p>
     * Every key from {@link #generateFileKey} embeds a fresh UUID, so a public
     * object's bytes never change once written — a re-upload is always a new key.
     * That makes these assets safely immutable, so browsers can reuse them without
     * revalidating rather than re-fetching on every page load.
     */
    private static final String PUBLIC_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

    @Autowired
    private FileMetadataRepository fileMetadataRepository;

    @Override
    public String uploadFile(MultipartFile multipartFile) throws IOException {

        String key = "SERVICE_UPLOAD/" + UUID.randomUUID() + "_" + multipartFile.getOriginalFilename();
        s3Client.putObject(publicBucket, key, multipartFile.getInputStream(), publicObjectMetadata(multipartFile));
        FileMetadata metadata = new FileMetadata(multipartFile.getName(),
                Objects.isNull(multipartFile.getContentType()) ? "unknown" : multipartFile.getContentType(), key,
                "SERVICE_UPLOAD", "SERVICE_UPLOAD");
        fileMetadataRepository.save(metadata);
        return cdnUrlService.publicUrl(key);
    }

    @Override
    public FileDetailsDTO uploadFileWithDetails(MultipartFile multipartFile) throws FileUploadException, IOException {
        String key = "SERVICE_UPLOAD/" + UUID.randomUUID() + "_" + multipartFile.getOriginalFilename();
        s3Client.putObject(publicBucket, key, multipartFile.getInputStream(), publicObjectMetadata(multipartFile));
        FileMetadata fileMetadata = new FileMetadata(multipartFile.getName(),
                Objects.isNull(multipartFile.getContentType()) ? "unknown" : multipartFile.getContentType(), key,
                "SERVICE_UPLOAD", "SERVICE_UPLOAD");
        fileMetadata = fileMetadataRepository.save(fileMetadata);
        String url = cdnUrlService.publicUrl(key);

        FileDetailsDTO.FileDetailsDTOBuilder builder = FileDetailsDTO.builder()
                .expiry(addTime(100))
                .fileName(fileMetadata.getFileName())
                .fileType(fileMetadata.getFileType())
                .id(fileMetadata.getId())
                .source(fileMetadata.getSource())
                .sourceId(fileMetadata.getSourceId())
                .url(url)
                .createdOn(fileMetadata.getCreatedOn())
                .updatedOn(fileMetadata.getUpdatedOn());

        return builder.build();
    }

    @Override
    public FileDetailsDTO uploadPrivateFileWithDetails(MultipartFile multipartFile)
            throws FileUploadException, IOException {
        String key = "PRIVATE_UPLOAD/" + UUID.randomUUID() + "_" + multipartFile.getOriginalFilename();
        ObjectMetadata metadata = new ObjectMetadata();
        metadata.setContentType(
                multipartFile.getContentType() != null ? multipartFile.getContentType() : "application/octet-stream");
        metadata.setContentLength(multipartFile.getSize());
        // Server-side encryption at rest (SSE-S3, AES-256) — sensitive audio (PII / minors).
        metadata.setSSEAlgorithm(ObjectMetadata.AES_256_SERVER_SIDE_ENCRYPTION);
        s3Client.putObject(bucketName, key, multipartFile.getInputStream(), metadata);

        FileMetadata fileMetadata = new FileMetadata(multipartFile.getName(),
                Objects.isNull(multipartFile.getContentType()) ? "unknown" : multipartFile.getContentType(), key,
                "PRIVATE_UPLOAD", "PRIVATE_UPLOAD");
        fileMetadata = fileMetadataRepository.save(fileMetadata);

        // A presigned PRIVATE-bucket URL is a convenience for direct callers; the id is
        // the contract (recordings are fetched later via getUrlWithExpiryAndId). Never
        // fail the upload if presigning hiccups.
        String url = null;
        try {
            url = getUrlWithExpiryAndId(fileMetadata.getId(), 1);
        } catch (Exception ignored) {
            // best-effort
        }

        return FileDetailsDTO.builder()
                .expiry(addTime(1))
                .fileName(fileMetadata.getFileName())
                .fileType(fileMetadata.getFileType())
                .id(fileMetadata.getId())
                .source(fileMetadata.getSource())
                .sourceId(fileMetadata.getSourceId())
                .url(url)
                .createdOn(fileMetadata.getCreatedOn())
                .updatedOn(fileMetadata.getUpdatedOn())
                .build();
    }

    @Override
    public FileDetailsDTO uploadFileToKey(MultipartFile multipartFile, String key)
            throws FileUploadException, IOException {
        s3Client.putObject(publicBucket, key, multipartFile.getInputStream(), publicObjectMetadata(multipartFile));
        FileMetadata fileMetadata = new FileMetadata(multipartFile.getName(),
                Objects.isNull(multipartFile.getContentType()) ? "unknown" : multipartFile.getContentType(), key,
                "SCORM_UPLOAD", "SCORM_UPLOAD");
        fileMetadata = fileMetadataRepository.save(fileMetadata);
        String url = cdnUrlService.publicUrl(key);

        FileDetailsDTO.FileDetailsDTOBuilder builder = FileDetailsDTO.builder()
                .expiry(addTime(100))
                .fileName(fileMetadata.getFileName())
                .fileType(fileMetadata.getFileType())
                .id(fileMetadata.getId())
                .source(fileMetadata.getSource())
                .sourceId(fileMetadata.getSourceId())
                .url(url)
                .createdOn(fileMetadata.getCreatedOn())
                .updatedOn(fileMetadata.getUpdatedOn());

        return builder.build();
    }

    @Override
    public Object downloadFile(String fileName) throws FileDownloadException, IOException {
        return null;
    }

    /**
     * Generates a pre-signed URL for uploading a file to S3.
     *
     * @param fileName The name of the file.
     * @param fileType The type of the file (e.g., image, document).
     * @param source   The source of the file (e.g., user, system).
     * @param sourceId The unique identifier of the source (e.g., user ID, system
     *                 ID).
     * @return A pre-signed PreSignedUrlResponse for uploading the file.
     */
    public PreSignedUrlResponse getPreSignedUrl(String fileName, String fileType, String source, String sourceId) {
        // Set the expiration time for the pre-signed URL (1 hour from now)
        Date expiration = new Date(System.currentTimeMillis() + 3600000);

        // Generate the S3 key for the file
        String key = generateFileKey(fileName, source, sourceId);

        // Create a request to generate the pre-signed URL
        GeneratePresignedUrlRequest generatePresignedUrlRequest = new GeneratePresignedUrlRequest(bucketName, key)
                .withMethod(HttpMethod.PUT)
                .withExpiration(expiration);

        // Generate the pre-signed URL
        URL url = s3Client.generatePresignedUrl(generatePresignedUrlRequest);

        // Save file metadata (e.g. name, type, key) to the repository
        FileMetadata metadata = new FileMetadata(fileName, fileType, key, source, sourceId);

        fileMetadataRepository.save(metadata);

        return new PreSignedUrlResponse(metadata.getId(), url.toString());
    }

    @Override
    public String getPublicUrlWithExpiry(String key, Integer days) {
        Date expiration = addTime(days);

        String signed = trySignedPrivateCdnUrl(key, expiration);
        if (signed != null) {
            return signed;
        }

        // Create a request to generate the pre-signed URL
        GeneratePresignedUrlRequest generatePresignedUrlRequest = new GeneratePresignedUrlRequest(bucketName, key)
                .withMethod(HttpMethod.GET)
                .withExpiration(expiration);

        // Generate the pre-signed URL
        URL url = s3Client.generatePresignedUrl(generatePresignedUrlRequest);
        return url.toString();
    }

    @Override
    public String getUrlWithExpiryAndId(String id, Integer days) throws FileDownloadException {
        Date expiryDate = addTime(days);
        try {
            Optional<FileMetadata> fileMetadata = fileMetadataRepository.findById(id);
            if (fileMetadata.isEmpty())
                throw new FileDownloadException("File Not Found");

            String signed = trySignedPrivateCdnUrl(fileMetadata.get().getKey(), expiryDate);
            if (signed != null) {
                return signed;
            }

            // Create a request to generate the pre-signed URL
            GeneratePresignedUrlRequest generatePresignedUrlRequest = new GeneratePresignedUrlRequest(bucketName,
                    fileMetadata.get().getKey())
                    .withMethod(HttpMethod.GET)
                    .withExpiration(expiryDate);

            // Generate the pre-signed URL
            URL url = s3Client.generatePresignedUrl(generatePresignedUrlRequest);
            return url.toString();
        } catch (Exception e) {
            log.warn("Could not build URL for file {}: {}", id, e.getMessage());
            return null;
        }
    }

    /**
     * Signed private-CDN URL when the private distribution is configured, else
     * null so the caller falls back to the S3 presign it always used. Never
     * throws — a signing problem must degrade to presign, not break playback.
     */
    private String trySignedPrivateCdnUrl(String objectKey, Date expiresAt) {
        if (!cloudFrontSignerService.isEnabled() || !StringUtils.hasText(objectKey)) {
            return null;
        }
        try {
            return cloudFrontSignerService.signedUrl(objectKey, expiresAt);
        } catch (Exception e) {
            log.warn("Private-CDN signing failed for key {} — falling back to S3 presign: {}",
                    objectKey, e.getMessage());
            return null;
        }
    }

    public Date addTime(Integer days) {
        // Set the expiration time for the pre-signed URL
        Calendar c = Calendar.getInstance();
        c.setTime(new Date()); // Using today's date
        c.add(Calendar.DATE, days);

        return c.getTime();
    }

    @Override
    public String getPublicUrlWithExpiryAndId(String id) throws FileDownloadException {

        Optional<FileMetadata> fileMetadata = fileMetadataRepository.findById(id);
        if (fileMetadata.isEmpty())
            throw new FileDownloadException("File Not Found");

        return cdnUrlService.publicUrl(fileMetadata.get().getKey());
    }

    @Override
    public Boolean acknowledgeClientUpload(AcknowledgeRequest request) {
        if (Objects.isNull(request.getFileId()) || Objects.isNull(request.getUserId())) {
            return false;
        }
        Optional<FileMetadata> metadata = fileMetadataRepository.findById(request.getFileId());
        // AI Evaluation API files (answer sheets, checked copies) are never linked to a user
        // or copied to the public bucket (acknowledge-get-details would publish them).
        if (metadata.isPresent() && EvalApiFileService.isReservedSource(metadata.get().getSource())) {
            return false;
        }
        if (metadata.isPresent()) {
            metadata.get().setFileSize(request.getFileSize());
            metadata.get().setHeight(request.getHeight());
            metadata.get().setWidth(request.getWidth());
            FileMetadata folderIcon = null;
            if (!Objects.isNull(request.getFolderIconId())) {
                folderIcon = fileMetadataRepository.findById(request.getFolderIconId()).orElse(null);
            }
            UserToFile userToFile = new UserToFile(metadata.get(), folderIcon, request.getFolderName(),
                    request.getUserId(), request.getSourceType(), request.getSourceId(), FileStatusEnum.ACTIVE.name());
            userToFileRepository.save(userToFile);
            return true;
        }
        return false;
    }

    @Override
    public boolean delete(String fileName) {
        File file = Paths.get(fileName).toFile();
        if (file.exists()) {
            file.delete();
            return true;
        }
        return false;
    }

    @Override
    public String getPublicUrlWithExpiryAndSource(String source, String sourceId, Integer expiryDays)
            throws FileDownloadException {
        Date expiration = addTime(expiryDays);

        Optional<FileMetadata> fileMetadata = fileMetadataRepository.findTopBySourceAndSourceId(source, sourceId);
        if (fileMetadata.isEmpty())
            throw new FileDownloadException("File Not Found");

        String signed = trySignedPrivateCdnUrl(fileMetadata.get().getKey(), expiration);
        if (signed != null) {
            return signed;
        }

        // Create a request to generate the pre-signed URL
        GeneratePresignedUrlRequest generatePresignedUrlRequest = new GeneratePresignedUrlRequest(bucketName,
                fileMetadata.get().getKey())
                .withMethod(HttpMethod.GET)
                .withExpiration(expiration);

        // Generate the pre-signed URL
        URL url = s3Client.generatePresignedUrl(generatePresignedUrlRequest);
        return url.toString();
    }

    @Override
    public List<Map<String, String>> getMultiplePublicUrlWithExpiryAndId(String fileIds) {
        List<String> dividedFileIds = MediaUtil.getFileIdsFromParam(fileIds);
        List<Map<String, String>> fileIdAndUrlList = new ArrayList<>();
        dividedFileIds.forEach((fileId) -> {
            try {
                fileIdAndUrlList.add(Map.of(fileId, getPublicUrlWithExpiryAndId(fileId)));
            } catch (FileDownloadException e) {
                throw new RuntimeException(e);
            }
        });
        return fileIdAndUrlList;
    }

    @Override
    public List<Map<String, String>> getMultipleUrlWithExpiryAndId(String fileIds, Integer expiryDays) {
        List<String> dividedFileIds = MediaUtil.getFileIdsFromParam(fileIds);
        List<Map<String, String>> fileIdAndUrlList = new ArrayList<>();
        dividedFileIds.forEach((fileId) -> {
            try {
                fileIdAndUrlList.add(Map.of(fileId, getUrlWithExpiryAndId(fileId, expiryDays)));
            } catch (FileDownloadException e) {
                throw new RuntimeException(e);
            }
        });
        return fileIdAndUrlList;
    }

    private boolean bucketIsEmpty() {
        ListObjectsV2Result result = s3Client.listObjectsV2(this.bucketName);
        if (result == null) {
            return false;
        }
        List<S3ObjectSummary> objects = result.getObjectSummaries();
        return objects.isEmpty();
    }

    private String generateFileKey(String fileName, String source, String sourceId) {
        return source + "/" + sourceId + "/" + UUID.randomUUID() + "-" + formatFileName(fileName);
    }

    public FileDetailsDTO getFileDetailsWithExpiryAndId(String id, Integer days) {

        Optional<FileMetadata> fileMetadata = fileMetadataRepository.findById(id);
        if (fileMetadata.isEmpty())
            throw new DatabaseException("File Not Found");

        try {
            FileDetailsDTO.FileDetailsDTOBuilder builder = FileDetailsDTO.builder()
                    .expiry(addTime(days))
                    .fileName(fileMetadata.get().getFileName())
                    .fileType(fileMetadata.get().getFileType())
                    .id(fileMetadata.get().getId())
                    .source(fileMetadata.get().getSource())
                    .sourceId(fileMetadata.get().getSourceId())
                    .url(getUrlWithExpiryAndId(id, days))
                    .createdOn(fileMetadata.get().getCreatedOn())
                    .updatedOn(fileMetadata.get().getUpdatedOn());

            if (fileMetadata.get().getWidth() != null) {
                builder.width(fileMetadata.get().getWidth());
            }
            if (fileMetadata.get().getHeight() != null) {
                builder.height(fileMetadata.get().getHeight());
            }

            return builder.build();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }

    }

    @Override
    public List<FileDetailsDTO> getMultipleFileDetailsWithExpiryAndId(String ids, Integer days)
            throws FileDownloadException {

        List<String> dividedFileIds = MediaUtil.getFileIdsFromParam(ids);
        List<FileDetailsDTO> fileDetailsDTOS = new ArrayList<>();
        for (String fileId : dividedFileIds) {
            try {
                fileDetailsDTOS.add(getFileDetailsWithExpiryAndId(fileId, days));
            } catch (Exception e) {
                throw new FileDownloadException(e.getMessage());
            }
        }
        return fileDetailsDTOS;
    }

    private String formatFileName(String fileName) {
        if (StringUtils.hasText(fileName)) {
            return fileName
                    .replace(" ", "_")
                    .replace(",", "_")
                    .replace(":", "_")
                    .replace("?", "_")
                    .replace("/", "_")
                    .replace("\\", "_")
                    .replace("<", "_")
                    .replace(">", "_")
                    .replace("|", "_")
                    .replace("%20", "_")
                    .replace("%", "_")
                    .replace("#", "_");
        }
        return fileName;

    }

    @Override
    public FileDetailsDTO acknowledgeClientUploadAndGetPublicUrl(AcknowledgeRequest acknowledgeRequest) {
        if (!acknowledgeClientUpload(acknowledgeRequest)) {
            return null;
        }
        FileMetadata fileMetadata = fileMetadataRepository.findById(acknowledgeRequest.getFileId())
                .orElseThrow(() -> new DatabaseException("File Not Found"));
        copyFileToPublicBucket(fileMetadata.getKey());
        // Just copied to the public bucket, so the public-bucket fallback is
        // correct here (matches the pre-CDN behavior of this endpoint).
        FileDetailsDTO.FileDetailsDTOBuilder builder = FileDetailsDTO.builder()
                .url(cdnUrlService.publicUrl(fileMetadata.getKey()))
                .sourceId(fileMetadata.getSourceId())
                .source(fileMetadata.getSource())
                .id(fileMetadata.getId())
                .fileName(fileMetadata.getFileName())
                .fileType(fileMetadata.getFileType());

        if (fileMetadata.getWidth() != null) {
            builder.width(fileMetadata.getWidth());
        }
        if (fileMetadata.getHeight() != null) {
            builder.height(fileMetadata.getHeight());
        }

        return builder.build();

    }

    @Override
    public String getPublicUrl(String id) {
        Optional<FileMetadata> fileMetadata = fileMetadataRepository.findById(id);
        // AI Evaluation API files get no permanent URL: the public CDN can fail over to the
        // main bucket, so such a link would be a permanent public copy of an answer sheet.
        if (fileMetadata.isEmpty() || EvalApiFileService.isReservedSource(fileMetadata.get().getSource()))
            throw new DatabaseException("File Not Found");

        // CDN-disabled fallback stays on the main bucket's host — the exact URL
        // this endpoint always emitted — because presign-uploaded objects are
        // only guaranteed to exist there until the acknowledge flow copies them
        // to the public bucket. With the CDN enabled, an origin-failover group
        // (public bucket -> main bucket) covers both locations.
        return cdnUrlService.publicUrl(fileMetadata.get().getKey(), bucketName);
    }

    public void copyFileToPublicBucket(String objectKey) {
        String key = objectKey.trim();

        // Supplying newObjectMetadata switches S3 to the REPLACE metadata directive,
        // which drops every header we do not re-set (Content-Type, SSE, …). So start
        // from the source object's own metadata and add Cache-Control on top of it —
        // never build a fresh ObjectMetadata here, or the copy would silently lose
        // the object's content type and encryption settings.
        ObjectMetadata metadata = s3Client.getObjectMetadata(bucketName, key);
        metadata.setCacheControl(PUBLIC_ASSET_CACHE_CONTROL);

        CopyObjectRequest copyRequest = new CopyObjectRequest(bucketName, key, publicBucket, key)
                .withNewObjectMetadata(metadata);
        s3Client.copyObject(copyRequest);
    }

    public PreSignedUrlResponse getPublicPreSignedUrl(String fileName, String fileType, String source,
            String sourceId) {
        // Set the expiration time for the pre-signed URL (1 hour from now)
        Date expiration = new Date(System.currentTimeMillis() + 3600000);

        // Generate the S3 key for the file
        String key = generateFileKey(fileName, source, sourceId);

        // Create a request to generate the pre-signed URL
        GeneratePresignedUrlRequest generatePresignedUrlRequest = new GeneratePresignedUrlRequest(bucketName, key)
                .withMethod(HttpMethod.PUT)
                .withExpiration(expiration);

        // Generate the pre-signed URL
        URL url = s3Client.generatePresignedUrl(generatePresignedUrlRequest);

        // Save file metadata (e.g. name, type, key) to the repository
        FileMetadata metadata = new FileMetadata(fileName, fileType, key, source, sourceId);

        fileMetadataRepository.save(metadata);

        return new PreSignedUrlResponse(metadata.getId(), url.toString());
    }

    @Override
    public String getPublicBucketUrl(String fileId, Integer expiryDays) throws FileDownloadException {
        Optional<FileMetadata> fileMetadata = fileMetadataRepository.findById(fileId);
        if (fileMetadata.isEmpty()) {
            throw new FileDownloadException("File Not Found");
        }
        String key = fileMetadata.get().getKey();

        // With CloudFront in front of the public bucket the permanent URL is the right
        // answer: the distribution reads the object through OAC, so no per-request
        // signature is needed and the edge cache actually gets used. expiryDays is
        // ignored on this path.
        if (cdnUrlService.isCdnEnabled()) {
            return cdnUrlService.publicUrl(key);
        }

        // No CDN (the vet deployment): the caller gets a raw S3 URL, and the "public"
        // bucket is only public by name — Block Public Access is on, so an unsigned GET
        // returns 403 AccessDenied. That is what broke invoice PDF links in the
        // manage-students payment-history side view. Fall back to the presigned GET this
        // endpoint emitted before the CDN layer landed; it is also what puts the bucket's
        // own region in the host (SigV4 signs against the regional endpoint), instead of
        // the region-less host the permanent-URL form builds.
        Date expiration = addTime(expiryDays == null || expiryDays <= 0 ? 1 : expiryDays);
        GeneratePresignedUrlRequest presignRequest = new GeneratePresignedUrlRequest(publicBucket, key)
                .withMethod(HttpMethod.GET)
                .withExpiration(expiration);
        return s3Client.generatePresignedUrl(presignRequest).toString();
    }

    /**
     * Metadata for direct-to-public-bucket uploads: preserves the browser's
     * Content-Type (instead of S3's octet-stream/form-urlencoded default) and
     * stamps the immutable Cache-Control (keys embed a fresh UUID, so bytes
     * never change under a key) so CloudFront/browsers cache aggressively.
     */
    private ObjectMetadata publicObjectMetadata(MultipartFile multipartFile) {
        ObjectMetadata metadata = new ObjectMetadata();
        metadata.setContentType(
                multipartFile.getContentType() != null ? multipartFile.getContentType() : "application/octet-stream");
        metadata.setContentLength(multipartFile.getSize());
        metadata.setCacheControl(PUBLIC_ASSET_CACHE_CONTROL);
        return metadata;
    }

    private static final String OFFLINE_CHECKSUM_TYPE_S3_ETAG = "S3_ETAG";

    @Override
    public List<vacademy.io.media_service.dto.OfflineAssetDetailsDTO> getOfflineAssetDetails(List<String> fileIds) {
        if (fileIds == null || fileIds.isEmpty()) {
            return List.of();
        }
        List<vacademy.io.media_service.dto.OfflineAssetDetailsDTO> result = new ArrayList<>();
        for (String fileId : fileIds) {
            fileMetadataRepository.findById(fileId).ifPresent(fm -> {
                lazilyFillOfflineMetadata(fm);
                result.add(new vacademy.io.media_service.dto.OfflineAssetDetailsDTO(
                        fm.getId(), fm.getFileSize(), fm.getFileType(), fm.getChecksum(), fm.getChecksumType()));
            });
        }
        return result;
    }

    /**
     * Fills the two offline-only columns the client needs before it can download
     * an asset: checksum and file_size. Both come from the same S3 HEAD, so this
     * fetches once when EITHER is missing.
     *
     * checksum is an opaque integrity/change token for offline asset diffing —
     * plaintext ETag is fine even though the client encrypts the file locally,
     * because the checksum is only ever compared against itself (never used to
     * verify the encrypted bytes).
     *
     * file_size matters just as much: rows uploaded before the offline feature
     * (or through paths that never recorded a size) carry file_size = NULL, and
     * the manifest then ships size_bytes = null. The client stores size 0, the
     * chunked downloader has no byte range to request, and the asset is wedged
     * at PENDING forever. Backfilling it here keeps those legacy rows usable
     * without a migration.
     *
     * Both are cached on the row from then on; a missing S3 object is logged and
     * left null rather than failing the whole offline-asset-details batch.
     */
    private void lazilyFillOfflineMetadata(FileMetadata fm) {
        boolean needsChecksum = !StringUtils.hasText(fm.getChecksum());
        boolean needsSize = fm.getFileSize() == null || fm.getFileSize() <= 0;
        if ((!needsChecksum && !needsSize) || !StringUtils.hasText(fm.getKey())) {
            return;
        }
        try {
            ObjectMetadata s3Metadata = s3Client.getObjectMetadata(bucketName, fm.getKey());
            boolean changed = false;
            if (needsChecksum) {
                String etag = s3Metadata.getETag();
                if (StringUtils.hasText(etag)) {
                    fm.setChecksum(etag);
                    fm.setChecksumType(OFFLINE_CHECKSUM_TYPE_S3_ETAG);
                    changed = true;
                }
            }
            if (needsSize) {
                long contentLength = s3Metadata.getContentLength();
                if (contentLength > 0) {
                    fm.setFileSize(contentLength);
                    changed = true;
                }
            }
            if (changed) {
                fileMetadataRepository.save(fm);
            }
        } catch (Exception e) {
            log.warn("offline-asset-details: could not fetch S3 metadata for fileId={} key={}: {}",
                    fm.getId(), fm.getKey(), e.getMessage());
        }
    }

}