from fastapi import APIRouter, Depends
from ..core.security import get_current_user
from ..schemas.utils import UrlScrapeRequest, UrlScrapeResponse
from ..services.scraper_service import ScraperService

router = APIRouter(prefix="/utils", tags=["utils"])
scraper_service = ScraperService()

@router.post("/scrape-url", response_model=UrlScrapeResponse, summary="Scrape and extract text from a URL")
async def scrape_url(request: UrlScrapeRequest, current_user=Depends(get_current_user)):
    """
    Accepts a URL, fetches its content, and returns the cleaned/filtered text data.
    Requires a signed-in user.
    """
    result = await scraper_service.scrape_url(str(request.url))
    return UrlScrapeResponse(**result)
