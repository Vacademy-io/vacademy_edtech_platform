# AI Video Generation Documentation

## Overview
AI video generation system integrated into the `ai_service` API. Generates educational videos through multiple stages: script → TTS → audio alignment → HTML timeline → rendering.  

## Architecture
### Database
- **Table**: `ai_gen_video` (in `admin-core-service` database)
- **Purpose**: Tracks video generation progress, file IDs, and S3 URLs
- **Key Fields**:
  - `video_id`: Unique identifier
  - `current_stage`: Current generation stage (SCRIPT, TTS, WORDS, HTML, RENDER)
  - `status`: PENDING, IN_PROGRESS, COMPLETED, FAILED
  - `file_ids`: JSONB mapping file types to file IDs
  - `s3_urls`: JSONB mapping file types to S3 URLs
  - `language`: Video language (default: "English")
  - `metadata`: Additional configuration (captions, HTML quality)

### Generation Stages
1. **SCRIPT**: Generate narration script using LLM
2. **TTS**: Convert script to audio (MP3)
3. **WORDS**: Align words with timestamps
4. **HTML**: Generate visual timeline with HTML/CSS overlays
5. **RENDER**: Final video rendering (optional)

### Configuration Parameters
- **language**: Video language (e.g., "English", "Spanish", "French")
- **captions_enabled**: Enable/disable captions (default: `true`)
- **html_quality**: HTML generation mode
  - `"classic"`: Only frames and animations (no math, code, diagrams, images)
  - `"advanced"`: All features (math, code, diagrams, images, animations)

## Integration with Course Outline

### Flow
1. **Course Outline Generation**: LLM analyzes user prompt
2. **AI_VIDEO Todo Creation**: If prompt indicates need for AI video, creates `AI_VIDEO` type todo
3. **Content Generation**: Calls video generation API
4. **Progress Streaming**: SSE events streamed via `SLIDE_CONTENT_UPDATE` events
5. **Completion**: Returns script, audio, words, and timeline URLs for frontend player

### Course Outline → Generation
```
POST /ai-service/course/ai/v1/generate
  ↓
Course Outline Service (creates AI_VIDEO todos)
  ↓
Content Generation Service
  ↓
Video Generation Service (stops at HTML stage)
  ↓
SSE Events: SLIDE_CONTENT_UPDATE with video progress
```

### Default Parameters (Course Outline)
- `language`: "English"
- `captions_enabled`: `true`
- `html_quality`: "advanced"
- `target_stage`: "HTML" (rendering skipped)

## Standalone APIs

### Base Path
`/ai-service/video`

### Endpoints

#### 1. Generate Till Script
```
POST /generate/till-script
Body: {
  "prompt": "Explain quantum physics",
  "language": "English",
  "captions_enabled": true,
  "html_quality": "advanced",
  "video_id": "optional-uuid"
}
Response: SSE stream
```

#### 2. Generate Till MP3
```
POST /generate/till-mp3
Body: { same as above }
Response: SSE stream
Output: script.txt, narration.mp3
```

#### 3. Generate Till HTML
```
POST /generate/till-html
Body: { same as above }
Response: SSE stream
Output: script.txt, narration.mp3, narration.words.json, time_based_frame.json
```

#### 4. Generate Till Render
```
POST /generate/till-render
Body: { same as above }
Response: SSE stream
Output: All files + output.mp4
```

#### 5. Resume After Script
```
POST /resume/after-script?target_stage=HTML
Body: { "video_id": "existing-video-id" }
Response: SSE stream
```

#### 6. Resume After MP3
```
POST /resume/after-mp3?target_stage=HTML
Body: { "video_id": "existing-video-id" }
Response: SSE stream
```

#### 7. Resume After HTML
```
POST /resume/after-html
Body: { "video_id": "existing-video-id" }
Response: SSE stream
Output: output.mp4 (rendering only)
```

#### 8. Get Status
```
GET /status/{video_id}
Response: {
  "video_id": "...",
  "current_stage": "HTML",
  "status": "COMPLETED",
  "file_ids": {...},
  "s3_urls": {...}
}
```

## SSE Event Format

### Progress Events
```json
{
  "type": "progress",
  "stage": "TTS",
  "message": "Generating audio...",
  "percentage": 40,
  "video_id": "..."
}
```

### Completion Events
```json
{
  "type": "complete",
  "stage": "HTML",
  "video_id": "...",
  "files": {
    "script": "https://s3.../script.txt",
    "audio": "https://s3.../narration.mp3",
    "words": "https://s3.../narration.words.json",
    "timeline": "https://s3.../time_based_frame.json"
  }
}
```

### Course Outline Events (Nested)
```json
{
  "type": "SLIDE_CONTENT_UPDATE",
  "path": "C1.CH1.SL3",
  "slideType": "AI_VIDEO",
  "contentData": {
    "videoId": "...",
    "status": "GENERATING",
    "currentStage": "TTS",
    "progress": 40
  }
}
```

## File Structure (S3)

```
s3://bucket/ai-videos/{video_id}/
  ├── script/
  │   └── script.txt
  ├── audio/
  │   └── narration.mp3
  ├── words/
  │   └── narration.words.json
  ├── timeline/
  │   └── time_based_frame.json
  └── video/
      └── output.mp4 (if rendered)
```

## Frontend Player Requirements

For course outline generation (HTML stage only):
- **script.txt**: Full narration text
- **narration.mp3**: Audio file
- **narration.words.json**: Word-level timestamps
- **time_based_frame.json**: HTML timeline with visual overlays

The frontend player should:
1. Play audio from `narration.mp3`
2. Sync HTML overlays from `time_based_frame.json` with audio
3. Display captions using `narration.words.json` (if enabled)
4. Render HTML/CSS overlays at specified timestamps

## Error Handling

- **Database Errors**: Video status marked as `FAILED`, error message stored
- **Pipeline Errors**: Partial files uploaded to S3, can resume from last successful stage
- **S3 Errors**: Retry logic in S3Service, errors logged

## Dependencies

- `boto3`: AWS S3 integration
- `edge-tts` / `google-cloud-texttospeech`: Text-to-speech
- `moviepy` / `playwright`: Video rendering
- `g2p_en`: Phoneme generation (optional)
- `nltk`: Natural language processing
- `SQLAlchemy`: Database ORM

## Environment Variables

- `OPENROUTER_API_KEY`: LLM API key
- `S3_AWS_ACCESS_KEY`: AWS access key
- `S3_AWS_ACCESS_SECRET`: AWS secret key
- `S3_AWS_REGION`: AWS region
- `AWS_BUCKET_NAME`: S3 bucket name
- `ADMIN_CORE_DB_URL`: Database connection string

