import type { TFunction } from 'i18next';
import { SlideGeneration, SessionProgress } from '../../../shared/types';

/**
 * Calculate session progress based on slide statuses
 */
export function getSessionProgress(sessionSlides: SlideGeneration[]): number {
    // Filter out placeholder slides
    const actualSlides = sessionSlides.filter(s => s.slideTitle !== '_placeholder_');
    if (actualSlides.length === 0) return 100; // Empty chapters are considered complete
    
    const completedCount = actualSlides.filter((s) => s.status === 'completed').length;
    const generatingSlide = actualSlides.find((s) => s.status === 'generating');
    
    let totalProgress = completedCount * 100;
    if (generatingSlide) {
        totalProgress += generatingSlide.progress;
    }
    
    return Math.round(totalProgress / actualSlides.length);
}

/**
 * Group slides by session and calculate progress for each session
 */
export function getSessionsWithProgress(
    slides: SlideGeneration[],
    t: TFunction
): SessionProgress[] {
    // Group slides by sessionId
    const slidesBySession = new Map<string, SlideGeneration[]>();
    
    slides.forEach((slide) => {
        // Filter out placeholder slides from grouping
        if (slide.slideTitle === '_placeholder_') {
            return;
        }
        
        if (!slidesBySession.has(slide.sessionId)) {
            slidesBySession.set(slide.sessionId, []);
        }
        slidesBySession.get(slide.sessionId)!.push(slide);
    });

    // Create session progress objects
    const sessions: SessionProgress[] = [];
    
    slidesBySession.forEach((sessionSlides, sessionId) => {
        // Get session title from first slide
        const sessionTitle = sessionSlides[0]?.sessionTitle || t('sessionUtils.untitledSession');
        
        // Calculate progress
        const progress = getSessionProgress(sessionSlides);
        
        sessions.push({
            sessionId,
            sessionTitle,
            slides: sessionSlides,
            progress,
        });
    });

    // Sort sessions by sessionId to maintain order
    sessions.sort((a, b) => {
        const aNum = parseInt(a.sessionId.replace('session-', ''));
        const bNum = parseInt(b.sessionId.replace('session-', ''));
        return aNum - bNum;
    });

    return sessions;
}
