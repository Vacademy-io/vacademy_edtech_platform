package vacademy.io.media_service.service;

import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;

@Service
public class DocConverterService {

    private static final String API_URL = "https://api.docconverter.pro/api/converter/convertdoc";


    private final DocumentConverterTokenService tokenService;

    public DocConverterService(DocumentConverterTokenService tokenService) {
        this.tokenService = tokenService;
    }

    public String convertDocument(MultipartFile file) throws IOException {
        // Get fresh token from TokenService
        String token = tokenService.getDocumentConverterToken();

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.MULTIPART_FORM_DATA);
        headers.set("Authorization", "Bearer " + token);

        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        body.add("template", "pdfhtml");
        body.add("returnHtml", "true");
        body.add("returnData", "true");

        // Prepare file part with proper filename
        ByteArrayResource fileResource = new ByteArrayResource(file.getBytes()) {
            @Override
            public String getFilename() {
                return file.getOriginalFilename();
            }
        };

        HttpHeaders filePartHeaders = new HttpHeaders();
        filePartHeaders.setContentType(MediaType.APPLICATION_OCTET_STREAM);
        body.add("file_name", new HttpEntity<>(fileResource, filePartHeaders));

        HttpEntity<MultiValueMap<String, Object>> requestEntity =
                new HttpEntity<>(body, headers);

        return new RestTemplate()
                .postForObject(API_URL, requestEntity, String.class);
    }
}