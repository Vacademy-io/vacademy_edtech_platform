import type { TFunction } from 'i18next';
import { BASE_URL, AI_SERVICE_BASE_URL } from '@/constants/urls';
import { SlideGeneration, SlideType } from '../../../shared/types';

// This is a plain service function (not a component/hook), so it cannot call
// useTranslation() itself — per the guide, the caller's `t` is threaded in as
// a parameter. `t` is optional here (defaulting to fallbackT below) so
// callers not yet wired for i18n keep exactly the same English copy. Keys
// live under the `studyLibraryGenerating` namespace's `courseOutline.*`
// block, matching the convention already used by contentGenerationService.ts
// and courseCreationService.ts in this same directory.
const fallbackT: TFunction = ((
    _key: string,
    defaultValue?: unknown,
    options?: unknown
) => {
    if (typeof defaultValue !== 'string') return String(_key);
    if (!options || typeof options !== 'object') return defaultValue;
    return defaultValue.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, name) => {
        const value = (options as Record<string, unknown>)[name];
        return value === undefined ? match : String(value);
    });
}) as unknown as TFunction;

export interface CourseOutlineRequest {
    user_prompt: string;
    course_tree: any;
    course_depth: number;
    generation_options: {
        generate_images: boolean;
        image_style: string;
        num_chapters?: number;
        num_slides?: number;
        course_timing?: number;
    };
}

export interface CourseOutlineResponse {
    tree: any[];
    todos: any[];
    courseMetadata?: any;
    explanation?: string;
}

/**
 * Generate course outline using AI service
 */
export async function generateCourseOutline(
    payload: CourseOutlineRequest,
    instituteId: string,
    onProgress: (message: string) => void,
    t: TFunction = fallbackT
): Promise<CourseOutlineResponse> {
    const apiUrl = `${AI_SERVICE_BASE_URL}/course/ai/v1/generate?institute_id=${instituteId}`;

    console.log('=== API Request ===');
    console.log('URL:', apiUrl);
    console.log('Payload:', JSON.stringify(payload, null, 2));

    onProgress(t('courseOutline.connecting', 'Connecting to AI service...'));

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    console.log('Response Status:', response.status, response.statusText);

    if (!response.ok) {
        const errorText = await response.text();
        console.error('=== API Error ===');
        console.error('Status:', response.status);
        console.error('Status Text:', response.statusText);
        console.error('Error Body:', errorText);

        if (response.status === 402) {
            let detail = '';
            try {
                detail = JSON.parse(errorText)?.detail || '';
            } catch {
                /* non-JSON body */
            }
            throw new Error(
                detail ||
                    t(
                        'courseOutline.errors.insufficientCredits',
                        "Your institute's AI credits are insufficient. Please top up credits to continue."
                    )
            );
        }

        throw new Error(
            t('courseOutline.errors.httpError', 'HTTP {{status}}: {{statusText}}. {{errorText}}', {
                status: response.status,
                statusText: response.statusText,
                errorText,
            })
        );
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
        throw new Error(t('courseOutline.errors.noResponseBody', 'No response body'));
    }

    onProgress(t('courseOutline.generating', 'Generating course outline...'));

    // Read SSE stream
    let buffer = '';
    let finalResponse: CourseOutlineResponse | null = null;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        buffer += chunk;
        const lines = buffer.split('\n');

        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
            // Handle both "data: " and "data:" formats
            let data = '';
            if (line.startsWith('data: ')) {
                data = line.slice(6);
            } else if (line.startsWith('data:')) {
                data = line.slice(5);
            } else {
                continue;
            }
            data = data.trim();

            // Check if it's a progress message. NOTE: "[Generating...]" is a
            // wire-protocol marker emitted verbatim by the SSE backend (not
            // user-visible UI copy) — it must not be translated, or stream
            // parsing breaks under a non-English locale.
            if (data.startsWith('[Generating...]')) {
                const progressMsg = data.replace('[Generating...]', '').trim();
                onProgress(progressMsg);
            }
            // Check if it's JSON (final response or error)
            else if (data.startsWith('{')) {
                try {
                    const jsonData = JSON.parse(data);

                    // Check for error events from SSE stream
                    if (jsonData.type === 'ERROR') {
                        throw new Error(
                            jsonData.message ||
                                t('courseOutline.errors.serverErrorWithCode', 'Server error (code: {{code}})', {
                                    code: jsonData.code || t('courseOutline.errors.unknownCode', 'unknown'),
                                })
                        );
                    }

                    console.log('=== API Response Received ===');
                    console.log('Full Response:', jsonData);
                    console.log('Course Metadata:', jsonData.courseMetadata);
                    console.log('Tree:', jsonData.tree);

                    // Validate response structure
                    if (!jsonData.tree || !Array.isArray(jsonData.tree)) {
                        console.error('Invalid API response structure:', jsonData);
                        throw new Error(
                            t(
                                'courseOutline.errors.invalidResponseStructure',
                                'Invalid response structure: missing or invalid tree'
                            )
                        );
                    }

                    finalResponse = jsonData as CourseOutlineResponse;
                } catch (e) {
                    console.error('=== Error Processing Response ===');
                    console.error('Error:', e);
                    console.error('Raw data:', data);
                    throw new Error(
                        `${e instanceof Error ? e.message : t('courseOutline.errors.unknownError', 'Unknown error')}`
                    );
                }
            }
        }
    }

    if (!finalResponse) {
        throw new Error(t('courseOutline.errors.noResponseData', 'No response data received from API'));
    }

    return finalResponse;
}
