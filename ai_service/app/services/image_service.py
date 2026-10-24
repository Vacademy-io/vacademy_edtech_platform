"""
Image generation and S3 upload service for course images.

This service handles:
1. Generating course banner and preview images based on course metadata
2. Uploading images to S3
3. Returning S3 URLs for the generated images
"""

from typing import Optional, Tuple, Dict
import logging
import time
import re
import asyncio
from io import BytesIO
import httpx
import json
from .image_prompts import (
    generate_banner_prompt,
    generate_preview_prompt,
    generate_media_prompt
)

logger = logging.getLogger(__name__)

# All image generation goes through OpenRouter (billed account). The model is
# the platform setting `image.model` (super-admin portal); this constant is the
# last-resort fallback when the setting cannot be read. The direct Google
# Generative Language API was dropped — its free-tier key had a zero image
# quota and 429'd every call.
IMAGE_MODEL = "qwen/qwen-image-3"
# OpenRouter has TWO image APIs that do not share models: chat models that emit
# images (Gemini / GPT image models) answer on chat/completions with
# `modalities`, while dedicated image models (Qwen, Seedream, FLUX) answer only
# on /api/v1/images with {model, prompt, size|aspect_ratio} → data[0].b64_json.
# Calling the wrong one is a 404 that reads like "model missing".
_OPENROUTER_IMAGE_URL = "https://openrouter.ai/api/v1/chat/completions"
_OPENROUTER_IMAGES_API_URL = "https://openrouter.ai/api/v1/images"
_OPENROUTER_CHAT_MODELS_URL = "https://openrouter.ai/api/v1/models"
_CHAT_IMAGE_HINTS = ("gemini", "gpt-", "openai/")
_chat_model_ids: set = set()
_chat_model_ids_loaded_at: float = 0.0
_CHAT_MODEL_IDS_TTL = 3600.0


def resolve_image_model(override: Optional[str] = None) -> str:
    """The image model to use: an explicit override, else the platform
    setting `image.model`, else the built-in fallback."""
    if override:
        return override
    try:
        from .platform_settings_service import get_platform_setting
        val = get_platform_setting("image.model", default=IMAGE_MODEL)
        return str(val or IMAGE_MODEL)
    except Exception:  # noqa: BLE001
        return IMAGE_MODEL


async def _uses_chat_completions(client, model_id: str) -> bool:
    """Chat-completions image models are the ones OpenRouter lists in its
    default /models catalogue; dedicated image models are not. The list is
    fetched once an hour; when it cannot be fetched, the id's family decides."""
    global _chat_model_ids, _chat_model_ids_loaded_at
    now = time.time()
    if not _chat_model_ids or now - _chat_model_ids_loaded_at > _CHAT_MODEL_IDS_TTL:
        try:
            r = await client.get(_OPENROUTER_CHAT_MODELS_URL, timeout=20.0)
            if r.status_code == 200:
                ids = {m.get("id") for m in (r.json().get("data") or []) if isinstance(m, dict)}
                if ids:
                    _chat_model_ids, _chat_model_ids_loaded_at = ids, now
        except Exception:  # noqa: BLE001
            logger.debug("OpenRouter model list unavailable; using id heuristics", exc_info=True)
    if _chat_model_ids:
        return model_id in _chat_model_ids
    return any(h in model_id.lower() for h in _CHAT_IMAGE_HINTS)


def _aspect_ratio_for(width: int, height: int) -> str:
    """Map pixel dims to the nearest OpenRouter image_config aspect ratio."""
    if not width or not height:
        return "1:1"
    r = width / height
    if r >= 1.45:
        return "16:9"
    if r >= 1.2:
        return "4:3"
    if r >= 0.85:
        return "1:1"
    if r >= 0.7:
        return "3:4"
    return "9:16"


class ImageGenerationService:
    """
    Service for generating and uploading course images.
    
    Currently supports placeholder functionality.
    To enable actual image generation:
    1. Integrate with an image generation API (e.g., DALL-E, Stable Diffusion, or Canvas-based generation)
    2. Configure S3 credentials in config.py
    3. Implement actual upload logic
    """

    def __init__(self, s3_client=None, s3_bucket: Optional[str] = None, gemini_api_key: Optional[str] = None, openrouter_api_key: Optional[str] = None, llm_model: Optional[str] = None):
        """
        Initialize the image generation service.

        Args:
            s3_client: Optional boto3 S3 client for uploads
            s3_bucket: S3 bucket name for storing generated images
            gemini_api_key: Google Generative AI API key for image generation
            openrouter_api_key: OpenRouter API key for keyword generation
            llm_model: Optional explicit model for keyword generation — tried
                first; otherwise (and for failover) the 'image_keyword' use
                case chain (super-admin portal; GLM by default).
        """
        self._s3_client = s3_client
        self._s3_bucket = s3_bucket
        self._gemini_api_key = gemini_api_key
        self._openrouter_api_key = openrouter_api_key
        self._llm_model = (llm_model or "").strip() or None
        # Shared HTTP client for connection pooling (reuses DNS/TLS across image calls)
        self._http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(60.0),
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10)
        )

    async def generate_images(
        self,
        course_name: str,
        about_course: str,
        course_depth: int,
        image_style: str = "professional",
        gemini_key: Optional[str] = None
    ) -> Tuple[Optional[str], Optional[str], Optional[str], Dict[str, int]]:
        """
        Generate banner, preview, and media images for a course.
        
        Args:
            course_name: Name of the course
            about_course: Course description
            course_depth: Course hierarchy depth
            image_style: Style preference for images
            gemini_key: Optional Gemini API key (overrides instance default)
        
        Returns:
            Tuple of (banner_image_url, preview_image_url, media_image_url, total_usage_dict)
            Returns (None, None, None, empty_usage) if generation fails or S3 is not configured
            total_usage_dict contains aggregated token usage across all image generations
        """
        try:
            logger.info(f"Generating images for course: {course_name}")

            # If S3 is not configured, return None
            if not self._s3_client or not self._s3_bucket:
                logger.warning("S3 client or bucket not configured. Skipping image generation.")
                return None, None, None, {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
            
            total_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

            # Get optimal search keyword from LLM for image search
            try:
                base_search_query = await self._get_image_search_keyword(course_name, about_course)
            except Exception as e:
                logger.warning(f"Keyword generation failed: {str(e)}, using course name")
                base_search_query = course_name

            # Build all three prompts upfront
            banner_prompt = generate_banner_prompt(
                course_name=course_name,
                base_search_query=base_search_query,
                about_course=about_course,
                image_style=image_style
            )
            preview_prompt = generate_preview_prompt(
                course_name=course_name,
                base_search_query=base_search_query,
                about_course=about_course,
                image_style=image_style
            )
            media_prompt = generate_media_prompt(
                course_name=course_name,
                base_search_query=base_search_query,
                about_course=about_course,
                image_style=image_style
            )

            # Generate ALL three images in parallel (they are independent I/O calls)
            logger.info(f"Starting parallel image generation for course: {course_name}")
            results = await asyncio.gather(
                asyncio.wait_for(
                    self._generate_and_upload_banner(
                        course_name=course_name, prompt=banner_prompt, gemini_key=gemini_key
                    ),
                    timeout=60.0
                ),
                asyncio.wait_for(
                    self._generate_and_upload_preview(
                        course_name=course_name, prompt=preview_prompt, gemini_key=gemini_key
                    ),
                    timeout=60.0
                ),
                asyncio.wait_for(
                    self._generate_and_upload_media(
                        course_name=course_name, prompt=media_prompt, gemini_key=gemini_key
                    ),
                    timeout=60.0
                ),
                return_exceptions=True  # Don't fail all if one image fails
            )

            # Unpack results, handling individual failures gracefully
            empty_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
            image_labels = ["Banner", "Preview", "Media"]
            urls = []
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    if isinstance(result, asyncio.TimeoutError):
                        logger.warning(f"{image_labels[i]} generation timed out")
                    else:
                        logger.error(f"{image_labels[i]} generation failed: {str(result)}")
                    urls.append(None)
                else:
                    url, usage = result
                    urls.append(url)
                    total_usage["prompt_tokens"] += usage.get("prompt_tokens", 0)
                    total_usage["completion_tokens"] += usage.get("completion_tokens", 0)
                    total_usage["total_tokens"] += usage.get("total_tokens", 0)

            banner_url, preview_url, media_url = urls[0], urls[1], urls[2]

            logger.info(f"Successfully generated images (parallel). Banner: {banner_url}, Preview: {preview_url}, Media: {media_url}")
            logger.info(f"Total token usage for images: {total_usage}")
            return banner_url, preview_url, media_url, total_usage
            
        except Exception as e:
            logger.error(f"Failed to generate images: {str(e)}")
            return None, None, None, {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

    def _slugify(self, text: str) -> str:
        """Convert text to slug format (lowercase, dashes)"""
        return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')
    
    async def _generate_and_upload_banner(
        self,
        course_name: str,
        prompt: str,
        gemini_key: Optional[str] = None
    ) -> Tuple[Optional[str], Dict[str, int]]:
        """
        Generate banner image (16:9 aspect ratio) using Gemini and upload to S3.

        Args:
            course_name: Name of the course
            prompt: Image generation prompt
            gemini_key: Optional Gemini API key (overrides instance default)

        Returns:
            Tuple of (S3 URL, usage_dict) where usage_dict contains token usage
        """
        try:
            logger.debug(f"Generating banner for: {course_name}")

            # Generate image using Gemini
            image_data, usage_info = await self._call_image_generation_llm(prompt, 1200, 400, gemini_key=gemini_key)
            
            if not image_data:
                return None, usage_info

            # Upload to S3
            slugified = self._slugify(course_name)
            timestamp = int(time.time())
            filename = f"course-ai/course_banner_{slugified}_{timestamp}.jpg"

            self._s3_client.put_object(
                Bucket=self._s3_bucket,
                Key=filename,
                Body=image_data,
                ContentType='image/jpeg'
            )

            s3_url = f"https://{self._s3_bucket}.s3.amazonaws.com/{filename}"
            logger.info(f"Banner uploaded to S3: {s3_url}")

            return s3_url, usage_info
                
        except Exception as e:
            logger.error(f"Banner generation failed: {str(e)}")
            return None, {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

    async def _generate_and_upload_preview(
        self,
        course_name: str,
        prompt: str,
        gemini_key: Optional[str] = None
    ) -> Tuple[Optional[str], Dict[str, int]]:
        """
        Generate preview image (16:9 aspect ratio) using Gemini and upload to S3.

        Args:
            course_name: Name of the course
            prompt: Image generation prompt
            gemini_key: Optional Gemini API key (overrides instance default)

        Returns:
            Tuple of (S3 URL, usage_dict) where usage_dict contains token usage
        """
        try:
            logger.debug(f"Generating preview for: {course_name}")

            # Generate image using Gemini
            image_data, usage_info = await self._call_image_generation_llm(prompt, 400, 300, gemini_key=gemini_key)
            
            if not image_data:
                return None, usage_info

            # Upload to S3
            slugified = self._slugify(course_name)
            timestamp = int(time.time())
            filename = f"course-ai/course_preview_{slugified}_{timestamp}.jpg"

            self._s3_client.put_object(
                Bucket=self._s3_bucket,
                Key=filename,
                Body=image_data,
                ContentType='image/jpeg'
            )

            s3_url = f"https://{self._s3_bucket}.s3.amazonaws.com/{filename}"
            logger.info(f"Preview uploaded to S3: {s3_url}")

            return s3_url, usage_info
                
        except Exception as e:
            logger.error(f"Preview generation failed: {str(e)}")
            return None, {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

    async def _generate_and_upload_media(
        self,
        course_name: str,
        prompt: str,
        gemini_key: Optional[str] = None,
        model: Optional[str] = None,
    ) -> Tuple[Optional[str], Dict[str, int]]:
        """
        Generate media image (16:9 aspect ratio) using Gemini and upload to S3.

        Args:
            course_name: Name of the course
            prompt: Image generation prompt
            gemini_key: Optional Gemini API key (overrides instance default)

        Returns:
            Tuple of (S3 URL, usage_dict) where usage_dict contains token usage
        """
        try:
            logger.debug(f"Generating media image for: {course_name}")

            image_data, usage_info = await self._call_image_generation_llm(prompt, 800, 800, gemini_key=gemini_key, model=model)

            if not image_data:
                return None, usage_info

            # Upload to S3 with the format the model actually returned.
            is_png = image_data[:8] == b"\x89PNG\r\n\x1a\n"
            slugified = self._slugify(course_name)
            timestamp = int(time.time())
            filename = f"course-ai/course_media_{slugified}_{timestamp}.{'png' if is_png else 'jpg'}"

            self._s3_client.put_object(
                Bucket=self._s3_bucket,
                Key=filename,
                Body=image_data,
                ContentType='image/png' if is_png else 'image/jpeg'
            )

            s3_url = f"https://{self._s3_bucket}.s3.amazonaws.com/{filename}"
            logger.info(f"Media image uploaded to S3: {s3_url}")

            return s3_url, usage_info
                
        except Exception as e:
            logger.error(f"Media image generation failed: {str(e)}")
            return None, {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    
    async def _call_image_generation_llm(
        self,
        prompt: str,
        width: int,
        height: int,
        gemini_key: Optional[str] = None,
        model: Optional[str] = None,
    ) -> Tuple[Optional[bytes], Dict[str, int]]:
        """
        Generate an image via OpenRouter with `model` (default: the platform
        setting `image.model`), on whichever of OpenRouter's two image APIs
        serves that model.

        Args:
            prompt: Image generation prompt
            width/height: used to pick the aspect ratio
            gemini_key: kept for signature compatibility (unused)
            model: OpenRouter model id override

        Returns:
            Tuple of (image_bytes, usage_dict).
        """
        empty_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        try:
            from ..config import get_settings
            key = self._openrouter_api_key or get_settings().openrouter_api_key
            if not key:
                logger.warning("No OpenRouter API key configured for image generation")
                return None, empty_usage
            model_id = resolve_image_model(model)
            headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

            if not await _uses_chat_completions(self._http_client, model_id):
                return await self._call_images_api(model_id, prompt, width, height, headers)

            response = await self._http_client.post(
                _OPENROUTER_IMAGE_URL,
                headers=headers,
                json={
                    "model": model_id,
                    "messages": [{"role": "user", "content": prompt}],
                    "modalities": ["image"],
                    "image_config": {"aspect_ratio": _aspect_ratio_for(width, height)},
                },
                timeout=90.0,
            )

            if response.status_code != 200:
                logger.error(f"OpenRouter image API error {response.status_code}: {response.text[:300]}")
                return None, empty_usage

            data = response.json()
            usage_meta = data.get("usage", {}) or {}
            usage_info = {
                "prompt_tokens": usage_meta.get("prompt_tokens", 0),
                "completion_tokens": usage_meta.get("completion_tokens", 0),
                "total_tokens": usage_meta.get("total_tokens", 0),
            }

            import base64
            for choice in data.get("choices") or []:
                for image in (choice.get("message") or {}).get("images", []) or []:
                    url = (image.get("image_url") or {}).get("url", "")
                    if url:
                        b64 = url.split(",", 1)[1] if "," in url else url
                        try:
                            return base64.b64decode(b64), usage_info
                        except Exception as decode_err:
                            logger.error(f"Image base64 decode error: {decode_err}")
                            return None, usage_info

            logger.warning("OpenRouter image response contained no image")
            return None, usage_info

        except Exception as e:
            logger.error(f"OpenRouter image generation failed: {str(e)}")
            return None, empty_usage

    async def _call_images_api(
        self, model_id: str, prompt: str, width: int, height: int, headers: Dict[str, str]
    ) -> Tuple[Optional[bytes], Dict[str, int]]:
        """Dedicated image models (Qwen, Seedream, FLUX): POST /api/v1/images.
        Verified 2026-09-04 against qwen/qwen-image-3 from the ai-service pod:
        ~70 s, PNG in data[0].b64_json, usage.completion_tokens = image tokens."""
        empty_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        body = {
            "model": model_id,
            "prompt": prompt,
            "n": 1,
            "aspect_ratio": _aspect_ratio_for(width, height),
            "resolution": "1K",
        }
        response = await self._http_client.post(_OPENROUTER_IMAGES_API_URL, headers=headers, json=body, timeout=180.0)
        if response.status_code != 200:
            logger.error(f"OpenRouter images API error {response.status_code} for {model_id}: {response.text[:300]}")
            return None, empty_usage
        data = response.json()
        usage_meta = data.get("usage", {}) or {}
        usage_info = {
            "prompt_tokens": int(usage_meta.get("prompt_tokens", 0) or 0),
            "completion_tokens": int(usage_meta.get("completion_tokens", 0) or 0),
            "total_tokens": int(usage_meta.get("total_tokens", 0) or 0),
        }
        import base64
        for item in data.get("data") or []:
            b64 = (item or {}).get("b64_json")
            if b64:
                try:
                    return base64.b64decode(b64), usage_info
                except Exception as decode_err:  # noqa: BLE001
                    logger.error(f"Image base64 decode error: {decode_err}")
                    return None, usage_info
            url = (item or {}).get("url")
            if url:
                try:
                    r = await self._http_client.get(url, timeout=60.0)
                    if r.status_code == 200:
                        return r.content, usage_info
                except Exception:  # noqa: BLE001
                    logger.warning("Could not fetch generated image url", exc_info=True)
        logger.warning(f"OpenRouter images API response for {model_id} contained no image")
        return None, usage_info

    async def _get_image_search_keyword(self, course_name: str, about_course: str) -> str:
        """
        Ask LLM to provide an optimal keyword for image search.

        Args:
            course_name: Full course name
            about_course: Course description

        Returns:
            Search keyword suitable for Unsplash (e.g., "programming", "machine learning", "python")
        """
        try:
            if not self._openrouter_api_key:
                return course_name

            prompt = f"""
Given this course information:
Course Name: {course_name}
Course Description: {about_course}

Provide a single, concise keyword (1-3 words max) that would be optimal for searching images on Unsplash.
Choose a keyword that will find high-quality, relevant images. Avoid long titles.

Examples:
- "Python programming" -> "python"
- "Complete Machine Learning Course" -> "machine learning"
- "Web Development with JavaScript" -> "javascript"
- "Data Science Fundamentals" -> "data science"

Return ONLY the keyword, nothing else:
"""

            # Through the model router + the 'image_keyword' chain: GLM runs on
            # its gateway with reasoning effort low and a max_tokens allowance
            # (a bare max_tokens=10 left a reasoning model with no room to
            # answer), and a failed model falls over to the next one.
            from .llm_router import chat_with_chain
            from .use_case_chat import models_for

            result = await chat_with_chain(
                {
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.3,
                    "max_tokens": 20,
                },
                _KEYWORD_USE_CASE,
                models=models_for(_KEYWORD_USE_CASE, explicit=self._llm_model),
                api_key=self._openrouter_api_key,
                timeout=30.0,
            )
            keyword = _clean_keyword(result.content)
            if keyword:
                return keyword

        except Exception as e:
            logger.warning(f"Keyword generation failed: {str(e)}")

        # Fallback to course name
        return course_name


_KEYWORD_USE_CASE = "image_keyword"


def _clean_keyword(text: str) -> str:
    """First line of the reply, without quotes/fences — a 1-3 word query."""
    for line in (text or "").splitlines():
        line = line.strip().strip("`\"'*").strip()
        if line:
            return line[:80]
    return ""


__all__ = ["ImageGenerationService"]

