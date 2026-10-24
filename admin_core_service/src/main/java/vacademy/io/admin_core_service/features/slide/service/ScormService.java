package vacademy.io.admin_core_service.features.slide.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.admin_core_service.features.slide.entity.ScormSlide;
import vacademy.io.admin_core_service.features.slide.repository.ScormSlideRepository;
import vacademy.io.common.media.dto.FileDetailsDTO;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@Service
@RequiredArgsConstructor
@Slf4j
public class ScormService {

    // New name rather than an overwrite: the media bucket serves objects as
    // immutable for a year, so a changed file at the old key would never reach
    // CloudFront or browsers that already cached it.
    private static final String PLAYER_FILE_NAME = "vacademy_player_v2.html";
    private static final String LEGACY_PLAYER_FILE_NAME = "vacademy_player.html";

    private final ScormSlideRepository scormSlideRepository;
    private final MediaService mediaService;

    public ScormSlide uploadScormPackage(MultipartFile file) {
        File tempDir = null;
        try {
            // 1. Create temp directory
            tempDir = Files.createTempDirectory("scorm_pkg_" + System.currentTimeMillis()).toFile();

            // 2. Unzip file
            unzip(file.getInputStream(), tempDir);

            // 3. Parse manifest to find launch path
            String launchPath = parseLaunchPath(tempDir);
            String scormVersion = detectScormVersion(tempDir);

            // 4. Generate the SCORM player wrapper HTML
            File wrapperFile = generatePlayerWrapper(tempDir, launchPath, scormVersion);

            // 5. Upload all files (including wrapper) to Media Service
            String rootFolder = "scorm/" + UUID.randomUUID().toString();
            Map<String, String> uploadedFileIds = new HashMap<>();
            uploadDirectory(tempDir, rootFolder, uploadedFileIds);

            // 6. Find the public URL of the wrapper and launch file
            String wrapperKey = rootFolder + "/" + wrapperFile.getName();
            String wrapperPublicUrl = uploadedFileIds.get(wrapperKey);
            log.info("Wrapper URL: {}", wrapperPublicUrl);

            String launchFileKey = rootFolder + "/" + launchPath;
            String launchFilePublicUrl = uploadedFileIds.get(launchFileKey);
            log.info("Original launch URL: {}", launchFilePublicUrl);

            // Use the wrapper URL as the launch URL (it embeds the actual SCORM content)
            String finalLaunchUrl = wrapperPublicUrl != null ? wrapperPublicUrl : launchFilePublicUrl;
            if (finalLaunchUrl == null) {
                log.warn("Could not find public URL for wrapper or launch file. Available keys: {}",
                        uploadedFileIds.keySet());
            }

            // 7. Create ScormSlide entity
            ScormSlide slide = new ScormSlide();
            slide.setId(UUID.randomUUID().toString());
            slide.setOriginalFileId(rootFolder);
            slide.setLaunchPath(launchPath);
            slide.setScormVersion(scormVersion);
            slide.setLaunchUrl(finalLaunchUrl);

            slide = scormSlideRepository.save(slide);

            return slide;

        } catch (Exception e) {
            log.error("Failed to process SCORM package", e);
            throw new RuntimeException("Failed to process SCORM package: " + e.getMessage());
        } finally {
            if (tempDir != null) {
                deleteDirectory(tempDir);
            }
        }
    }

    /**
     * Moves SCORM slides still launched through the legacy player onto the
     * current one: uploads {@link #PLAYER_FILE_NAME} next to the package and
     * repoints launch_url at it. The legacy file is left in place, so reverting
     * a slide is just restoring its old launch_url. Idempotent — an upgraded
     * slide no longer matches the legacy suffix.
     *
     * Course knowledge: deliberately not wired to ContentIndexMarker. Only the
     * player wrapper is replaced; the lesson text is unchanged.
     */
    public Map<String, Object> upgradeLegacyPlayers(boolean dryRun, int limit) {
        List<ScormSlide> legacy = scormSlideRepository.findByLaunchUrlEndingWith("/" + LEGACY_PLAYER_FILE_NAME);
        List<ScormSlide> batch = legacy.subList(0, Math.min(Math.max(limit, 0), legacy.size()));

        List<String> upgraded = new ArrayList<>();
        List<String> failed = new ArrayList<>();
        for (ScormSlide slide : batch) {
            if (isBlank(slide.getOriginalFileId()) || isBlank(slide.getLaunchPath())) {
                failed.add(slide.getId() + " (missing original_file_id or launch_path)");
                continue;
            }
            if (dryRun) {
                upgraded.add(slide.getId());
                continue;
            }
            File tempDir = null;
            try {
                tempDir = Files.createTempDirectory("scorm_player_" + slide.getId()).toFile();
                File player = generatePlayerWrapper(tempDir, slide.getLaunchPath(), slide.getScormVersion());
                String key = slide.getOriginalFileId() + "/" + PLAYER_FILE_NAME;
                FileDetailsDTO result = mediaService.uploadFileToKey(new CustomMultipartFile(player), key);
                if (result == null || result.getUrl() == null || !result.getUrl().endsWith("/" + PLAYER_FILE_NAME)) {
                    failed.add(slide.getId() + " (upload returned no usable url)");
                    continue;
                }
                slide.setLaunchUrl(result.getUrl());
                scormSlideRepository.save(slide);
                upgraded.add(slide.getId());
            } catch (Exception e) {
                log.error("[SCORM] Player upgrade failed for scorm_slide {}", slide.getId(), e);
                failed.add(slide.getId() + " (" + e.getMessage() + ")");
            } finally {
                if (tempDir != null) {
                    deleteDirectory(tempDir);
                }
            }
        }

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("dryRun", dryRun);
        summary.put("legacyRemainingBefore", legacy.size());
        summary.put("processed", batch.size());
        summary.put(dryRun ? "wouldUpgrade" : "upgraded", upgraded.size());
        summary.put("failed", failed);
        summary.put("slideIds", upgraded);
        return summary;
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    /**
     * Generates a wrapper HTML page that provides the SCORM API (both 1.2 and 2004)
     * and loads the actual SCORM content in an iframe. Since both files live on the
     * same S3 origin, the SCORM content can discover the API via window.parent.API.
     *
     * The wrapper also uses postMessage to bridge SCORM API calls back to the
     * parent
     * React app for learner tracking.
     *
     * The content iframe is only pointed at the package once the parent app has
     * sent the learner's data (vacademy_scorm_init). Packages read
     * cmi.learner_id / cmi.suspend_data the moment they initialise; when those
     * come back empty, packages that keep their own browser-storage copy fall
     * back to it, and one learner's progress lands in the next account opened
     * in the same browser.
     */
    private File generatePlayerWrapper(File tempDir, String launchPath, String scormVersion) throws IOException {
        String wrapperHtml = """
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>SCORM Player</title>
                    <style>
                        * { margin: 0; padding: 0; box-sizing: border-box; }
                        html, body { width: 100%%; height: 100%%; overflow: hidden; background: #f0f0f0; }
                        iframe { width: 100%%; height: 100%%; border: none; }
                    </style>
                </head>
                <body>
                    <iframe id="scormContent" data-src="%s" allowfullscreen></iframe>
                    <script>
                        // ===== SCORM Data Store =====
                        var cmiData = {};
                        var lastError = '0';
                        var initialized = false;

                        // Notify parent app (React) of SCORM API calls for tracking
                        function notifyParent(action, key, value) {
                            try {
                                if (window.parent && window.parent !== window) {
                                    window.parent.postMessage({
                                        type: 'vacademy_scorm',
                                        action: action,
                                        key: key || '',
                                        value: value || ''
                                    }, '*');
                                }
                            } catch(e) { /* cross-origin, ignore */ }
                        }

                        // Content waits for the learner's data; see generatePlayerWrapper
                        var contentStarted = false;
                        function startContent() {
                            if (contentStarted) return;
                            contentStarted = true;
                            var frame = document.getElementById('scormContent');
                            frame.src = frame.getAttribute('data-src');
                        }

                        // Listen for initialization data from parent app
                        window.addEventListener('message', function(event) {
                            if (event.data && event.data.type === 'vacademy_scorm_init') {
                                if (contentStarted) return;
                                if (event.data.cmiData) {
                                    cmiData = event.data.cmiData;
                                }
                                startContent();
                            }
                        });

                        // ===== SCORM 1.2 API =====
                        var API = {
                            LMSInitialize: function(param) {
                                initialized = true;
                                notifyParent('LMSInitialize');
                                return 'true';
                            },
                            LMSGetValue: function(key) {
                                var value = cmiData[key] || '';
                                notifyParent('LMSGetValue', key, value);
                                return value;
                            },
                            LMSSetValue: function(key, value) {
                                cmiData[key] = value;
                                notifyParent('LMSSetValue', key, value);
                                return 'true';
                            },
                            LMSCommit: function(param) {
                                notifyParent('LMSCommit');
                                return 'true';
                            },
                            LMSFinish: function(param) {
                                notifyParent('LMSFinish');
                                return 'true';
                            },
                            LMSGetLastError: function() { return lastError; },
                            LMSGetErrorString: function(code) { return 'No error'; },
                            LMSGetDiagnostic: function(code) { return 'No error'; }
                        };

                        // ===== SCORM 2004 API =====
                        var API_1484_11 = {
                            Initialize: function(param) {
                                initialized = true;
                                notifyParent('Initialize');
                                return 'true';
                            },
                            GetValue: function(key) {
                                var value = cmiData[key] || '';
                                notifyParent('GetValue', key, value);
                                return value;
                            },
                            SetValue: function(key, value) {
                                cmiData[key] = value;
                                notifyParent('SetValue', key, value);
                                return 'true';
                            },
                            Commit: function(param) {
                                notifyParent('Commit');
                                return 'true';
                            },
                            Terminate: function(param) {
                                notifyParent('Terminate');
                                return 'true';
                            },
                            GetLastError: function() { return lastError; },
                            GetErrorString: function(code) { return 'No error'; },
                            GetDiagnostic: function(code) { return 'No error'; }
                        };

                        // Opened directly, or embedded by a host that never sends
                        // init: start anyway rather than sit on a blank page.
                        if (window.parent === window) {
                            startContent();
                        } else {
                            setTimeout(startContent, 3000);
                        }
                    </script>
                </body>
                </html>
                """.formatted(launchPath);

        File wrapperFile = new File(tempDir, PLAYER_FILE_NAME);
        Files.writeString(wrapperFile.toPath(), wrapperHtml, StandardCharsets.UTF_8);
        log.info("Generated SCORM player wrapper at: {}", wrapperFile.getAbsolutePath());
        return wrapperFile;
    }

    private void unzip(InputStream inputStream, File targetDir) throws IOException {
        try (ZipInputStream zis = new ZipInputStream(inputStream)) {
            ZipEntry zipEntry = zis.getNextEntry();
            while (zipEntry != null) {
                File newFile = newFile(targetDir, zipEntry);
                if (zipEntry.isDirectory()) {
                    if (!newFile.isDirectory() && !newFile.mkdirs()) {
                        throw new IOException("Failed to create directory " + newFile);
                    }
                } else {
                    File parent = newFile.getParentFile();
                    if (!parent.isDirectory() && !parent.mkdirs()) {
                        throw new IOException("Failed to create directory " + parent);
                    }
                    try (FileOutputStream fos = new FileOutputStream(newFile)) {
                        byte[] buffer = new byte[1024];
                        int len;
                        while ((len = zis.read(buffer)) > 0) {
                            fos.write(buffer, 0, len);
                        }
                    }
                }
                zipEntry = zis.getNextEntry();
            }
        }
    }

    private File newFile(File destinationDir, ZipEntry zipEntry) throws IOException {
        File destFile = new File(destinationDir, zipEntry.getName());
        String destDirPath = destinationDir.getCanonicalPath();
        String destFilePath = destFile.getCanonicalPath();
        if (!destFilePath.startsWith(destDirPath + File.separator)) {
            throw new IOException("Entry is outside of the target dir: " + zipEntry.getName());
        }
        return destFile;
    }

    private String parseLaunchPath(File dir) throws Exception {
        File manifest = new File(dir, "imsmanifest.xml");
        if (!manifest.exists()) {
            if (new File(dir, "index.html").exists())
                return "index.html";
            if (new File(dir, "story.html").exists())
                return "story.html";
            throw new FileNotFoundException("imsmanifest.xml not found and no common launch file detected");
        }

        DocumentBuilderFactory dbFactory = DocumentBuilderFactory.newInstance();
        DocumentBuilder dBuilder = dbFactory.newDocumentBuilder();
        Document doc = dBuilder.parse(manifest);
        doc.getDocumentElement().normalize();

        NodeList resources = doc.getElementsByTagName("resource");
        for (int i = 0; i < resources.getLength(); i++) {
            Element resource = (Element) resources.item(i);
            if ("sco".equalsIgnoreCase(resource.getAttribute("adlcp:scormType")) ||
                    "webcontent".equalsIgnoreCase(resource.getAttribute("type"))) {
                return resource.getAttribute("href");
            }
        }

        if (resources.getLength() > 0) {
            return ((Element) resources.item(0)).getAttribute("href");
        }

        throw new RuntimeException("Could not determine launch path from manifest");
    }

    private String detectScormVersion(File dir) {
        File manifest = new File(dir, "imsmanifest.xml");
        if (manifest.exists()) {
            try {
                String content = Files.readString(manifest.toPath());
                if (content.contains("CAM-1.3") || content.contains("2004"))
                    return "2004";
                if (content.contains("1.2"))
                    return "1.2";
            } catch (IOException e) {
                log.warn("Failed to read manifest for version detection", e);
            }
        }
        return "1.2";
    }

    private void uploadDirectory(File dir, String rootKey, Map<String, String> uploadedFileIds) throws IOException {
        if (dir.isDirectory()) {
            File[] files = dir.listFiles();
            if (files != null) {
                for (File file : files) {
                    if (file.isDirectory()) {
                        uploadDirectory(file, rootKey + "/" + file.getName(), uploadedFileIds);
                    } else {
                        String relativePath = rootKey + "/" + file.getName();
                        log.info("Uploading {} to {}", file.getName(), relativePath);
                        MultipartFile multipartFile = new CustomMultipartFile(file);
                        vacademy.io.common.media.dto.FileDetailsDTO result = mediaService.uploadFileToKey(multipartFile,
                                relativePath);
                        if (result != null && result.getUrl() != null) {
                            uploadedFileIds.put(relativePath, result.getUrl());
                        }
                    }
                }
            }
        }
    }

    private void deleteDirectory(File dir) {
        File[] files = dir.listFiles();
        if (files != null) {
            for (File file : files) {
                if (file.isDirectory()) {
                    deleteDirectory(file);
                } else {
                    file.delete();
                }
            }
        }
        dir.delete();
    }

}
