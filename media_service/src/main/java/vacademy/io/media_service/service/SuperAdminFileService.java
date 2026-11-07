package vacademy.io.media_service.service;

import com.amazonaws.HttpMethod;
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.model.GeneratePresignedUrlRequest;
import com.amazonaws.services.s3.model.ObjectMetadata;
import jakarta.persistence.criteria.Predicate;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.media.dto.FileDetailsDTO;
import vacademy.io.media_service.dto.SuperAdminFileItemDTO;
import vacademy.io.media_service.dto.SuperAdminPageResponse;
import vacademy.io.media_service.entity.FileMetadata;
import vacademy.io.media_service.repository.FileMetadataRepository;
import vacademy.io.media_service.repository.UserToFileRepository;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

@Service
@Slf4j
public class SuperAdminFileService {

    public static final String SOURCE_ADMIN_PRIVATE_UPLOAD = "ADMIN_UPLOAD";
    public static final String SOURCE_ADMIN_PUBLIC_UPLOAD = "ADMIN_PUBLIC_UPLOAD";

    // Sources whose objects live in the public bucket; everything else was
    // presigned against the private bucket (see FileServiceImpl upload paths).
    private static final Set<String> PUBLIC_BUCKET_SOURCES = Set.of("SERVICE_UPLOAD", "SCORM_UPLOAD",
            SOURCE_ADMIN_PUBLIC_UPLOAD);

    private static final Map<String, String> SORTABLE_FIELDS = Map.of(
            "created_on", "createdOn",
            "file_name", "fileName",
            "file_size", "fileSize",
            "file_type", "fileType",
            "source", "source");

    @Autowired
    private FileMetadataRepository fileMetadataRepository;

    @Autowired
    private UserToFileRepository userToFileRepository;

    @Autowired
    private AmazonS3 s3Client;

    @Autowired
    private CdnUrlService cdnUrlService;

    @Autowired
    private CloudFrontSignerService cloudFrontSignerService;

    @Value("${aws.bucket.name}")
    private String bucketName;

    @Value("${aws.s3.public-bucket}")
    private String publicBucket;

    public SuperAdminPageResponse<SuperAdminFileItemDTO> searchFiles(int page, int size, String search,
            String fileType, String source, String sourceId, Date startDate, Date endDate,
            String sortBy, String sortDirection, Integer expiryDays) {

        Specification<FileMetadata> spec = (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (StringUtils.hasText(search)) {
                String like = "%" + search.trim().toLowerCase() + "%";
                predicates.add(cb.or(
                        cb.like(cb.lower(root.get("fileName")), like),
                        cb.like(cb.lower(root.get("key")), like),
                        cb.equal(root.get("id"), search.trim())));
            }
            if (StringUtils.hasText(fileType)) {
                predicates.add(cb.like(cb.lower(root.get("fileType")), fileType.trim().toLowerCase() + "%"));
            }
            if (StringUtils.hasText(source)) {
                predicates.add(cb.equal(root.get("source"), source.trim()));
            }
            if (StringUtils.hasText(sourceId)) {
                predicates.add(cb.equal(root.get("sourceId"), sourceId.trim()));
            }
            if (startDate != null) {
                predicates.add(cb.greaterThanOrEqualTo(root.get("createdOn"), startDate));
            }
            if (endDate != null) {
                predicates.add(cb.lessThanOrEqualTo(root.get("createdOn"), endDate));
            }
            return cb.and(predicates.toArray(new Predicate[0]));
        };

        // Map.of-backed maps reject null keys even on lookup
        String sortField = sortBy == null ? "createdOn" : SORTABLE_FIELDS.getOrDefault(sortBy, "createdOn");
        Sort.Direction direction = "ASC".equalsIgnoreCase(sortDirection) ? Sort.Direction.ASC : Sort.Direction.DESC;
        PageRequest pageRequest = PageRequest.of(page, size, Sort.by(direction, sortField));

        Page<FileMetadata> result = fileMetadataRepository.findAll(spec, pageRequest);
        int days = expiryDays == null ? 7 : expiryDays;

        List<SuperAdminFileItemDTO> content = result.getContent().stream()
                .map(file -> toItemDTO(file, days))
                .toList();

        return SuperAdminPageResponse.<SuperAdminFileItemDTO>builder()
                .content(content)
                .page(result.getNumber())
                .size(result.getSize())
                .totalElements(result.getTotalElements())
                .totalPages(result.getTotalPages())
                .build();
    }

    public String getFileUrl(String fileId, Integer expiryDays) {
        FileMetadata file = fileMetadataRepository.findById(fileId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "File not found: " + fileId));
        String url = buildUrl(file, expiryDays == null ? 7 : expiryDays);
        if (url == null) {
            throw new VacademyException(HttpStatus.INTERNAL_SERVER_ERROR, "Could not generate URL for file");
        }
        return url;
    }

    public FileDetailsDTO uploadFile(MultipartFile multipartFile, boolean isPublic, String uploadedBy) {
        boolean hasName = StringUtils.hasText(multipartFile.getOriginalFilename());
        String fileName = hasName ? multipartFile.getOriginalFilename() : "unnamed";
        String contentType = Objects.isNull(multipartFile.getContentType()) ? "application/octet-stream"
                : multipartFile.getContentType();
        String source = isPublic ? SOURCE_ADMIN_PUBLIC_UPLOAD : SOURCE_ADMIN_PRIVATE_UPLOAD;
        String sourceId = StringUtils.hasText(uploadedBy) ? uploadedBy : "SUPER_ADMIN";
        String bucket = isPublic ? publicBucket : bucketName;
        String key = source + "/" + UUID.randomUUID() + "-" + sanitizeFileName(fileName);

        try {
            ObjectMetadata objectMetadata = new ObjectMetadata();
            objectMetadata.setContentType(contentType);
            objectMetadata.setContentLength(multipartFile.getSize());
            s3Client.putObject(bucket, key, multipartFile.getInputStream(), objectMetadata);
        } catch (Exception e) {
            log.error("Super admin upload failed: {}", e.getMessage(), e);
            throw new VacademyException(HttpStatus.INTERNAL_SERVER_ERROR, "Upload failed: " + e.getMessage());
        }

        FileMetadata metadata = new FileMetadata(fileName, contentType, key, source, sourceId);
        metadata.setFileSize(multipartFile.getSize());
        metadata = fileMetadataRepository.save(metadata);

        return FileDetailsDTO.builder()
                .id(metadata.getId())
                .url(buildUrl(metadata, 7))
                .fileName(metadata.getFileName())
                .fileType(metadata.getFileType())
                .source(metadata.getSource())
                .sourceId(metadata.getSourceId())
                .expiry(isPublic ? null : addDays(7))
                .build();
    }

    @Transactional
    public void deleteFile(String fileId) {
        FileMetadata file = fileMetadataRepository.findById(fileId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "File not found: " + fileId));

        String key = file.getKey() == null ? null : file.getKey().trim();
        if (StringUtils.hasText(key)) {
            deleteQuietly(bucketName, key);
            deleteQuietly(publicBucket, key);
        }

        try {
            userToFileRepository.deleteAll(userToFileRepository.findByFileId(fileId));
            fileMetadataRepository.delete(file);
            fileMetadataRepository.flush();
        } catch (DataIntegrityViolationException e) {
            throw new VacademyException(HttpStatus.CONFLICT,
                    "File metadata is still referenced by other records and cannot be deleted");
        }
    }

    private void deleteQuietly(String bucket, String key) {
        try {
            s3Client.deleteObject(bucket, key);
        } catch (Exception e) {
            log.warn("Could not delete s3://{}/{}: {}", bucket, key, e.getMessage());
        }
    }

    private SuperAdminFileItemDTO toItemDTO(FileMetadata file, int expiryDays) {
        return SuperAdminFileItemDTO.builder()
                .id(file.getId())
                .fileName(file.getFileName())
                .fileType(file.getFileType())
                .fileSize(file.getFileSize())
                .source(file.getSource())
                .sourceId(file.getSourceId())
                .width(file.getWidth())
                .height(file.getHeight())
                .key(file.getKey())
                .url(buildUrl(file, expiryDays))
                .createdOn(file.getCreatedOn())
                .updatedOn(file.getUpdatedOn())
                .build();
    }

    private String buildUrl(FileMetadata file, int expiryDays) {
        if (!StringUtils.hasText(file.getKey())) {
            return null;
        }
        try {
            // Public-bucket objects get the permanent public/CDN URL (a presign
            // added nothing but an expiry); private objects get a signed
            // private-CDN URL when configured, else S3 presigning as always.
            if (file.getSource() != null && PUBLIC_BUCKET_SOURCES.contains(file.getSource())) {
                return cdnUrlService.publicUrl(file.getKey());
            }
            if (cloudFrontSignerService.canSign(file.getKey())) {
                try {
                    return cloudFrontSignerService.signedUrl(file.getKey(), addDays(expiryDays));
                } catch (Exception e) {
                    log.warn("Private-CDN signing failed for file {} — falling back to presign: {}",
                            file.getId(), e.getMessage());
                }
            }
            GeneratePresignedUrlRequest request = new GeneratePresignedUrlRequest(bucketName, file.getKey().trim())
                    .withMethod(HttpMethod.GET)
                    .withExpiration(addDays(Math.min(expiryDays, 7))); // SigV4 presign maximum
            return s3Client.generatePresignedUrl(request).toString();
        } catch (Exception e) {
            log.warn("Could not presign URL for file {}: {}", file.getId(), e.getMessage());
            return null;
        }
    }

    private Date addDays(int days) {
        Calendar calendar = Calendar.getInstance();
        calendar.add(Calendar.DATE, days);
        return calendar.getTime();
    }

    private String sanitizeFileName(String fileName) {
        return fileName.replaceAll("[^a-zA-Z0-9._-]", "_");
    }
}
