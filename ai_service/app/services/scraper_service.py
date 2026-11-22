import httpx
from bs4 import BeautifulSoup
from fastapi import HTTPException
import logging
import socket
from urllib.parse import urlparse

from .safe_http import WEB_PORTS, SafeFetchError, host_is_blocked_name, is_public_address, safe_fetch

logger = logging.getLogger(__name__)

# Pages larger than this are not read (the extracted text is capped at 20k chars anyway).
MAX_PAGE_BYTES = 5_000_000


class ScraperService:
    async def scrape_url(self, url: str) -> dict:
        # Fetch through safe_fetch: public addresses only, connection pinned to
        # the resolved address, every redirect hop re-checked, body size capped.
        try:
            result = await safe_fetch(
                url,
                max_bytes=MAX_PAGE_BYTES,
                timeout=10.0,
                total_timeout=20.0,
                max_redirects=5,
                allow_http=True,
                allowed_ports=WEB_PORTS,
                headers={"User-Agent": "Mozilla/5.0 (compatible; VacademyFetch/1.0)"},
            )
        except SafeFetchError as e:
            logger.warning(f"Fetch refused or failed for URL {url}: {e.code}")
            if e.code in ("blocked_host", "blocked_address"):
                raise HTTPException(status_code=400, detail="Public access only. Access to internal/private resources is forbidden.")
            if e.code == "dns_failed":
                raise HTTPException(status_code=400, detail="Invalid hostname or DNS resolution failed.")
            if e.code == "bad_url":
                raise HTTPException(status_code=400, detail="Invalid URL format.")
            if e.code == "too_large":
                raise HTTPException(status_code=400, detail="The page is too large to read.")
            raise HTTPException(status_code=400, detail="Failed to reach the URL or timeout.")
        except Exception as e:
            logger.error(f"Unexpected error fetching URL {url}: {e}")
            raise HTTPException(status_code=400, detail="Failed to fetch user provided URL.")

        status = result.status_code
        if status == 403:
            raise HTTPException(status_code=403, detail="Access denied to the target URL.")
        if status == 404:
            raise HTTPException(status_code=404, detail="Target URL not found.")
        if status >= 400:
            raise HTTPException(status_code=status, detail=f"Error fetching URL: HTTP {status}")

        # Decode the body the same way httpx does (charset header, then detection).
        # Only the content type is passed on: the body is already decompressed.
        content_type = result.headers.get("content-type")
        html_content = httpx.Response(
            status, headers={"content-type": content_type} if content_type else None, content=result.content
        ).text
        return self._extract_content(html_content)

    def _validate_url(self, url: str):
        """Pre-check used by knowledge-base URL ingestion: the host must resolve only to public
        addresses. The fetch itself (scrape_url) re-checks every hop through safe_fetch."""
        try:
            parsed = urlparse(url)
            hostname = parsed.hostname
            if not hostname:
                raise HTTPException(status_code=400, detail="Invalid URL: Missing hostname")
            if host_is_blocked_name(hostname):
                raise HTTPException(status_code=400, detail="Public access only. Access to internal/private resources is forbidden.")
            infos = socket.getaddrinfo(hostname, parsed.port or 443, type=socket.SOCK_STREAM)
            addresses = {info[4][0] for info in infos}
            if not addresses or not all(is_public_address(a) for a in addresses):
                raise HTTPException(status_code=400, detail="Public access only. Access to internal/private resources is forbidden.")
        except socket.gaierror:
            raise HTTPException(status_code=400, detail="Invalid hostname or DNS resolution failed.")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid URL format.")
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"SSRF validation error for {url}: {e}")
            raise HTTPException(status_code=400, detail="URL validation failed.")

    def _extract_content(self, html: str) -> dict:
        try:
            soup = BeautifulSoup(html, 'html.parser')
            
            # Remove noise
            for tag in soup(['script', 'style', 'nav', 'header', 'footer', 'iframe']):
                tag.decompose()
                
            # Extract title
            title = soup.title.string.strip() if soup.title else None
            
            # Extract main content
            # We want to preserve basic structure (h1-h6, p). 
            # A simple strategy is to get text with newlines.
            body = soup.body if soup.body else soup
            
            # get_text with separator handles paragraphs reasonably well if they are block elements
            text = body.get_text(separator='\n\n', strip=True)
            
            # Limit to 20,000 characters
            if len(text) > 20000:
                text = text[:20000] + "..."
                
            return {"content": text, "title": title}
        except Exception as e:
            logger.error(f"Error parsing HTML content: {e}")
            raise HTTPException(status_code=500, detail="Failed to process content from the URL.")
