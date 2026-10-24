"""
S3 Service for uploading AI-generated video files to AWS S3.
Uses the same configuration as media-service.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional, List
from uuid import uuid4

import boto3
from botocore.exceptions import ClientError

from ..config import get_settings
from .s3_url_utils import extract_s3_key, public_base_url


class S3Service:
    """Service for uploading files to AWS S3 public bucket."""
    
    def __init__(self):
        """Initialize S3 client with credentials from settings.
        
        Uses the same configuration as ImageGenerationService:
        - Credentials: s3_aws_access_key, s3_aws_access_secret, s3_aws_region
        - Bucket: aws_bucket_name (same as used for course images)
        """
        settings = get_settings()
        
        # Use s3_* prefixed settings (same as image service)
        access_key = settings.s3_aws_access_key
        secret_key = settings.s3_aws_access_secret
        region = settings.s3_aws_region
        
        # Use aws_bucket_name (same as image service uses)
        # Fallback to aws_s3_public_bucket if needed
        self.public_bucket = settings.aws_bucket_name or settings.aws_s3_public_bucket

        # CloudFront base fronting this bucket; None = emit raw S3 URLs
        self.cdn_base_url = settings.cdn_public_base_url
        
        if not access_key or not secret_key:
            raise ValueError(
                "AWS S3 credentials not configured. Please set S3_AWS_ACCESS_KEY and S3_AWS_ACCESS_SECRET in environment. "
                "These are the same credentials used for course image generation."
            )
        
        if not region:
            region = "ap-south-1"  # Default region
        
        if not self.public_bucket:
            raise ValueError(
                "AWS S3 bucket name not configured. Please set AWS_BUCKET_NAME in environment. "
                "This is the same bucket used for course image generation."
            )
        
        self.s3_client = boto3.client(
            's3',
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region
        )
    
    def upload_file(
        self,
        file_path: Path,
        s3_key: Optional[str] = None,
        content_type: Optional[str] = None
    ) -> str:
        """
        Upload a file to S3 public bucket.
        
        Args:
            file_path: Local path to file
            s3_key: S3 object key (path in bucket). If None, generates one.
            content_type: MIME type of file. If None, infers from extension.
            
        Returns:
            Public S3 URL of uploaded file
            
        Raises:
            FileNotFoundError: If file doesn't exist
            ClientError: If S3 upload fails
        """
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        
        # Generate S3 key if not provided
        if not s3_key:
            s3_key = f"ai-videos/{uuid4()}/{file_path.name}"
        
        # Infer content type if not provided
        if not content_type:
            content_type = self._get_content_type(file_path)
        
        # Validate bucket is set and is a string
        if not self.public_bucket:
            raise ValueError("S3 bucket name not configured. Cannot upload file.")
        
        if not isinstance(self.public_bucket, str):
            raise ValueError(f"S3 bucket name must be a string, got {type(self.public_bucket)}")
        
        # Upload to S3
        try:
            extra_args = {}
            if content_type:
                extra_args['ContentType'] = content_type
            
            # Ensure file_path is a string (not Path object) to avoid any encoding issues
            file_path_str = str(file_path).replace('\\', '/') if os.name == 'nt' else str(file_path)
            
            self.s3_client.upload_file(
                file_path_str,
                str(self.public_bucket),  # Ensure bucket is string
                s3_key,
                ExtraArgs=extra_args
            )

            # Return public URL (CDN when configured)
            return f"{public_base_url(self.public_bucket, self.cdn_base_url)}/{s3_key}"

        except ClientError as e:
            raise RuntimeError(f"Failed to upload to S3: {e}") from e

    def upload_file_content(
        self,
        content: bytes,
        filename: str,
        s3_key: Optional[str] = None,
        content_type: Optional[str] = None
    ) -> str:
        """
        Upload file content (bytes) directly to S3.
        
        Args:
            content: File content as bytes
            filename: Original filename (for extension detection)
            s3_key: S3 object key. If None, generates one.
            content_type: MIME type. If None, infers from filename.
            
        Returns:
            Public S3 URL of uploaded file
        """
        # Generate S3 key if not provided
        if not s3_key:
            s3_key = f"ai-videos/{uuid4()}/{filename}"
        
        # Infer content type if not provided
        if not content_type:
            content_type = self._get_content_type(Path(filename))
        
        # Validate bucket is set and is a string
        if not self.public_bucket:
            raise ValueError("S3 bucket name not configured. Cannot upload file.")
        
        if not isinstance(self.public_bucket, str):
            raise ValueError(f"S3 bucket name must be a string, got {type(self.public_bucket)}")
        
        # Upload to S3
        try:
            extra_args = {}
            if content_type:
                extra_args['ContentType'] = content_type
            
            self.s3_client.put_object(
                Bucket=str(self.public_bucket),  # Ensure bucket is string
                Key=s3_key,
                Body=content,
                **extra_args
            )

            # Return public URL (CDN when configured)
            return f"{public_base_url(self.public_bucket, self.cdn_base_url)}/{s3_key}"
        
        except ClientError as e:
            raise RuntimeError(f"Failed to upload to S3: {e}") from e
    
    def upload_video_file(
        self,
        file_path: Path,
        video_id: str,
        stage: str
    ) -> str:
        """
        Upload a video generation file with organized S3 key structure.
        
        Args:
            file_path: Local path to file
            video_id: Video identifier
            stage: Generation stage (script, audio, timeline, etc.)
            
        Returns:
            Public S3 URL
        """
        # Organize files by video_id and stage
        s3_key = f"ai-videos/{video_id}/{stage}/{file_path.name}"
        return self.upload_file(file_path, s3_key=s3_key)
    
    def upload_video_directory(
        self,
        directory_path: Path,
        video_id: str,
        stage: str
    ) -> List[str]:
        """
        Upload all files in a directory recursively to S3.
        Preserves directory structure in S3.
        
        Args:
            directory_path: Local path to directory
            video_id: Video identifier
            stage: Generation stage (e.g., "generated_images")
            
        Returns:
            List of public S3 URLs for all uploaded files
        """
        if not directory_path.exists() or not directory_path.is_dir():
            raise ValueError(f"Directory does not exist or is not a directory: {directory_path}")
        
        uploaded_urls = []
        
        # Recursively find all files in directory
        for file_path in directory_path.rglob("*"):
            # Skip hidden files — incl. the pipeline's atomic-write temps
            # (.<name>.<uuid>.tmp) that a concurrent writer may leave behind.
            if file_path.is_file() and not file_path.name.startswith("."):
                # Preserve relative path structure
                relative_path = file_path.relative_to(directory_path)
                # Create S3 key with directory structure
                s3_key = f"ai-videos/{video_id}/{stage}/{relative_path.as_posix()}"
                
                try:
                    s3_url = self.upload_file(file_path, s3_key=s3_key)
                    uploaded_urls.append(s3_url)
                except Exception as e:
                    # Log error but continue with other files
                    import logging
                    logger = logging.getLogger(__name__)
                    logger.error(f"Failed to upload {file_path} to S3: {e}")
                    continue
        
        return uploaded_urls
    
    def download_file(self, s3_url: str, local_path: Path, expected_missing: bool = False) -> bool:
        """
        Download a file from S3 to a local path.

        Args:
            s3_url: Public S3 URL
            local_path: Local path where file should be saved
            expected_missing: when True, a 404 (the file simply not existing) is
                logged at DEBUG instead of ERROR. Use for resume/probe downloads
                of optional artifacts so a normal "not there" doesn't masquerade
                as a failure in the logs.

        Returns:
            True if downloaded successfully
        """
        if not self.public_bucket:
            return False
        
        try:
            # Extract key from URL — tolerant of raw S3 (global/regional/
            # accelerate), path-style, and CloudFront hosts
            s3_key = extract_s3_key(s3_url, str(self.public_bucket), self.cdn_base_url)
            if not s3_key:
                return False

            # Ensure parent directory exists
            local_path.parent.mkdir(parents=True, exist_ok=True)
            
            # Download file
            self.s3_client.download_file(
                str(self.public_bucket),
                s3_key,
                str(local_path)
            )
            return True
        
        except (ClientError, ValueError, Exception) as e:
            import logging
            logger = logging.getLogger(__name__)
            _code = ""
            if isinstance(e, ClientError):
                _code = str(e.response.get("Error", {}).get("Code", ""))
            if expected_missing and _code in ("404", "NoSuchKey", "NotFound"):
                # Optional artifact simply not in S3 (resume/probe path) — normal.
                logger.debug(f"Expected-missing file not in S3 ({_code}): {s3_url}")
            else:
                logger.error(f"Failed to download {s3_url} to {local_path}: {e}")
            return False
    
    def delete_file(self, s3_url: str) -> bool:
        """
        Delete a file from S3 using its public URL.
        
        Args:
            s3_url: Public S3 URL
            
        Returns:
            True if deleted successfully
        """
        if not self.public_bucket:
            return False
        
        try:
            # Extract key from URL — tolerant of raw S3 (global/regional/
            # accelerate), path-style, and CloudFront hosts
            s3_key = extract_s3_key(s3_url, str(self.public_bucket), self.cdn_base_url)
            if not s3_key:
                return False

            self.s3_client.delete_object(
                Bucket=str(self.public_bucket),  # Ensure bucket is string
                Key=s3_key
            )
            return True
        
        except (ClientError, ValueError):
            return False
    
    @staticmethod
    def _get_content_type(file_path: Path) -> str:
        """Infer MIME type from file extension."""
        extension = file_path.suffix.lower()
        
        content_types = {
            '.mp4': 'video/mp4',
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.txt': 'text/plain',
            '.json': 'application/json',
            '.html': 'text/html',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.csv': 'text/csv',
        }
        
        return content_types.get(extension, 'application/octet-stream')

