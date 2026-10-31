import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getInstituteId } from '@/constants/helper';
import { SlideGeneration } from '../../../shared/types';
import { generateCourseOutline, CourseOutlineRequest } from '../services/courseApiService';
import { transformApiResponseToSlides } from '../utils/transformApiResponse';
import { buildApiPayload } from '../utils/buildApiPayload';

export function useCourseGeneration() {
    const { t } = useTranslation('studyLibraryAiCopilotUseCourseGeneration');
    const [slides, setSlides] = useState<SlideGeneration[]>([]);
    const [isGenerating, setIsGenerating] = useState(true);
    const [generationProgress, setGenerationProgress] = useState<string>(t('initializing'));
    const [courseMetadata, setCourseMetadata] = useState<any>(null);
    const [error, setError] = useState<Error | null>(null);

    const generate = useCallback(async (courseConfig: any) => {
        try {
            setIsGenerating(true);
            setGenerationProgress(t('initializing'));
            setError(null);

            const instituteId = getInstituteId();
            if (!instituteId) {
                throw new Error(t('instituteIdNotFound'));
            }

            // Build API payload
            const payload = buildApiPayload(courseConfig);
            
            // Generate course outline
            const response = await generateCourseOutline(
                payload as CourseOutlineRequest,
                instituteId,
                (message) => setGenerationProgress(message)
            );

            // Store course metadata (with fallback for missing fields)
            const metadata = {
                ...response.courseMetadata,
                // Fallback for mediaImageUrl if not provided by API
                mediaImageUrl: response.courseMetadata?.mediaImageUrl || 
                              response.courseMetadata?.bannerImageUrl || 
                              response.courseMetadata?.previewImageUrl
            };
            setCourseMetadata(metadata);
            console.log('Course Metadata Set:', metadata);

            // Transform API response to slides format
            const generatedSlides = transformApiResponseToSlides(response, courseConfig);
            console.log('Generated Slides Count:', generatedSlides.length);
            
            if (generatedSlides.length === 0) {
                console.warn('No slides generated from API response');
            }
            
            setSlides(generatedSlides);
            setIsGenerating(false);
            setGenerationProgress(t('complete'));
        } catch (err) {
            console.error('=== Error Generating Course Outline ===');
            console.error('Error:', err);
            if (err instanceof Error) {
                console.error('Error Message:', err.message);
                console.error('Error Stack:', err.stack);
            }
            setSlides([]);
            setIsGenerating(false);
            setError(err instanceof Error ? err : new Error(t('unknownError')));
            throw err;
        }
    }, [t]);

    return {
        slides,
        setSlides,
        isGenerating,
        generationProgress,
        courseMetadata,
        setCourseMetadata,
        error,
        generate,
    };
}
