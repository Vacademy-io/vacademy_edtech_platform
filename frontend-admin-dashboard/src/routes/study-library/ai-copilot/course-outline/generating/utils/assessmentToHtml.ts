/**
 * Convert assessment JSON content to HTML format for TipTapEditor
 * This matches the format expected by the existing quiz display logic
 */
import i18n from '@/i18n';

// This module builds HTML strings outside any React render tree (called from
// plain conversion functions, not a component/hook), so useTranslation() isn't
// available. Use the shared i18next singleton directly with a fixed namespace
// — same pattern as studyLibraryScheduleSchema (see -schema/schema.ts).
const NAMESPACE = 'studyLibraryAssessmentToHtml';
const t = (key: string, options?: Record<string, unknown>) =>
    i18n.t(key, { ns: NAMESPACE, ...options });

export interface AssessmentQuestion {
    question_number: string;
    question: { type: 'HTML'; content: string };
    options: Array<{ type: 'HTML'; preview_id: string; content: string }>;
    correct_options: string[];
    ans: string;
    exp: string;
    question_type: 'MCQS' | 'MCQM' | 'ONE_WORD' | 'LONG_ANSWER';
    tags: string[];
    level: 'easy' | 'medium' | 'hard';
}

export interface AssessmentContentData {
    questions: AssessmentQuestion[];
    title: string;
    tags: string[];
    difficulty: 'easy' | 'medium' | 'hard';
    is_process_completed: boolean;
    subjects: string[];
    classes: string[];
}

/**
 * Convert assessment content data to HTML format
 * This HTML will be displayed in TipTapEditor for quiz slides
 */
export function convertAssessmentToHTML(assessmentData: AssessmentContentData): string {
    if (!assessmentData.questions || assessmentData.questions.length === 0) {
        return `<p>${t('noQuestionsAvailable')}</p>`;
    }

    let html = '';

    assessmentData.questions.forEach((q, index) => {
        const questionNum = q.question_number || t('questionFallback', { number: index + 1 });
        html += `<h3>${questionNum}</h3>`;

        // Add question content - ensure it's properly formatted HTML
        const questionContent = q.question?.content || '';
        // Remove any existing paragraph tags and wrap in a single paragraph
        const cleanQuestion = questionContent.replace(/<\/?p>/g, '').trim();
        if (cleanQuestion) {
            html += `<p>${cleanQuestion}</p>`;
        }

        // Add options as ordered list
        if (q.options && q.options.length > 0) {
            html += '<ol>';
            q.options.forEach((option) => {
                const optionContent = option.content || '';
                // Clean option content - remove nested paragraphs and HTML tags, keep only text
                const cleanOption = optionContent
                    .replace(/<\/?p>/g, '') // Remove paragraph tags
                    .replace(/<[^>]+>/g, '') // Remove all other HTML tags
                    .trim();
                if (cleanOption) {
                    // Yoopta expects plain text in list items, not nested paragraphs
                    html += `<li>${cleanOption}</li>`;
                }
            });
            html += '</ol>';
        }

        // Show correct answer(s)
        if (q.correct_options && q.correct_options.length > 0) {
            const correctAnswers = q.correct_options
                .map((optId) => {
                    const option = q.options?.find((opt) => opt.preview_id === optId);
                    return option?.content || optId;
                })
                .filter(Boolean)
                .map((ans) => ans.replace(/<\/?p>/g, '').trim()); // Clean answer text

            if (correctAnswers.length > 0) {
                html += `<p><strong style="color: #10b981;">${t('correctAnswer', {
                    count: correctAnswers.length,
                    answers: correctAnswers.join(', '),
                })}</strong></p>`;
            }
        } else if (q.ans) {
            // Fallback to ans field if correct_options is not available
            const cleanAns = String(q.ans)
                .replace(/<\/?p>/g, '')
                .trim();
            html += `<p><strong style="color: #10b981;">${t('correctAnswer', {
                count: 1,
                answers: cleanAns,
            })}</strong></p>`;
        }

        // Add explanation if available
        if (q.exp) {
            const cleanExp = String(q.exp)
                .replace(/<\/?p>/g, '')
                .trim();
            if (cleanExp) {
                html += `<p><em>${t('explanation', { text: cleanExp })}</em></p>`;
            }
        }

        // Add separator between questions (except for last one)
        if (index < assessmentData.questions.length - 1) {
            html += '<hr style="margin: 20px 0;" />';
        }
    });

    return html;
}

/**
 * Convert assessment content data to JSON format for storage
 * This is the format that will be stored in slide.content
 */
export function convertAssessmentToJSON(assessmentData: AssessmentContentData): string {
    try {
        // Validate the assessment data structure
        if (!assessmentData || typeof assessmentData !== 'object') {
            throw new Error('Invalid assessment data: not an object');
        }

        if (!Array.isArray(assessmentData.questions)) {
            throw new Error('Invalid assessment data: questions is not an array');
        }

        // Limit the number of questions to prevent huge payloads
        if (assessmentData.questions.length > 50) {
            console.warn('Assessment has many questions, limiting to 50');
            assessmentData.questions = assessmentData.questions.slice(0, 50);
        }

        // Validate, sanitize, and flatten questions
        // We cast to any here because we are flattening the structure from objects to strings
        assessmentData.questions = assessmentData.questions.map((q, index) => {
            try {
                const sanitizedQ = { ...q } as any;

                // Ensure question structure is valid
                if (!sanitizedQ.question) {
                    console.warn(`Question ${index} has missing question, sanitizing`);
                    sanitizedQ.question = { type: 'HTML', content: t('invalidQuestion') };
                }

                // Ensure options is an array
                if (!Array.isArray(sanitizedQ.options)) {
                    console.warn(`Question ${index} has invalid options structure, sanitizing`);
                    sanitizedQ.options = [];
                }

                // Limit options to reasonable number
                if (sanitizedQ.options.length > 10) {
                    console.warn(`Question ${index} has too many options, limiting to 10`);
                    sanitizedQ.options = sanitizedQ.options.slice(0, 10);
                }

                // 1. Flatten Question Content
                let questionContent = '';
                if (typeof sanitizedQ.question === 'object' && sanitizedQ.question) {
                    const qObj = sanitizedQ.question;
                    questionContent = qObj.content || qObj.text || '';
                } else {
                    questionContent = String(sanitizedQ.question || '');
                }

                // 2. Resolve Correct Answer Index (before flattening options)
                let correctIndex = 0;
                if (!Array.isArray(sanitizedQ.correct_options)) {
                    sanitizedQ.correct_options = [];
                }

                // Limit correct options
                if (sanitizedQ.correct_options.length > sanitizedQ.options.length) {
                    sanitizedQ.correct_options = sanitizedQ.correct_options.slice(
                        0,
                        sanitizedQ.options.length
                    );
                }

                if (sanitizedQ.correct_options && sanitizedQ.correct_options.length > 0) {
                    const correctId = sanitizedQ.correct_options[0];
                    const foundIndex = sanitizedQ.options.findIndex((opt: any) => {
                        if (typeof opt === 'object' && opt) {
                            return opt.preview_id === correctId || opt.id === correctId;
                        }
                        return opt === correctId;
                    });

                    if (foundIndex !== -1) {
                        correctIndex = foundIndex;
                    }
                }

                // 3. Flatten Options
                const flattenedOptions = sanitizedQ.options.map((opt: any) => {
                    if (typeof opt === 'object' && opt) {
                        return opt.content || opt.text || '';
                    }
                    return String(opt || '');
                });

                // Flatten explanation
                let explanationText = '';
                // Check both exp and explanation fields
                const expObj = sanitizedQ.exp || sanitizedQ.explanation;
                if (typeof expObj === 'object' && expObj) {
                    explanationText = expObj.content || expObj.text || '';
                } else {
                    explanationText = String(expObj || '');
                }

                return {
                    ...sanitizedQ,
                    question: questionContent,
                    options: flattenedOptions,
                    correctAnswerIndex: correctIndex,
                    question_type: sanitizedQ.question_type || 'MCQS',
                    tags: sanitizedQ.tags || [],
                    level: sanitizedQ.level || 'easy',
                    explanation: explanationText,
                    exp: explanationText,
                };
            } catch (error) {
                console.error(`Failed to sanitize question ${index}:`, error);
                // Return a minimal valid question
                return {
                    question_number: `Q${index + 1}`,
                    question: t('questionParsingFailed'),
                    options: [t('optionA')],
                    correctAnswerIndex: 0,
                    ans: t('optionA'),
                    exp: t('questionCouldNotBeParsed'),
                    question_type: 'MCQS',
                    tags: [],
                    level: 'easy',
                };
            }
        }) as any;

        // Remove any potentially problematic fields that might cause issues
        const cleanAssessmentData = {
            ...assessmentData,
            // Ensure only essential fields are included
            questions: assessmentData.questions,
            title: assessmentData.title || t('defaultTitle'),
            tags: Array.isArray(assessmentData.tags) ? assessmentData.tags : [],
            difficulty: assessmentData.difficulty || 'medium',
            subjects: Array.isArray(assessmentData.subjects) ? assessmentData.subjects : [],
            classes: Array.isArray(assessmentData.classes) ? assessmentData.classes : [],
            is_process_completed: assessmentData.is_process_completed || false,
        };

        const jsonString = JSON.stringify(cleanAssessmentData, null, 2);

        // Check size - assessments shouldn't be too large
        const maxSize = 500 * 1024; // 500KB limit
        if (jsonString.length > maxSize) {
            console.warn('Assessment JSON is very large:', jsonString.length, 'bytes, truncating');

            // Try to reduce size by limiting questions
            const originalLength = cleanAssessmentData.questions.length;
            while (jsonString.length > maxSize && cleanAssessmentData.questions.length > 5) {
                cleanAssessmentData.questions.pop();
            }

            if (cleanAssessmentData.questions.length < originalLength) {
                console.warn(
                    `Reduced questions from ${originalLength} to ${cleanAssessmentData.questions.length} to fit size limit`
                );
            }

            return JSON.stringify(cleanAssessmentData, null, 2);
        }

        return jsonString;
    } catch (error) {
        console.error('Failed to convert assessment to JSON:', error);
        // Return a minimal fallback
        return JSON.stringify(
            {
                questions: [],
                title: 'Assessment',
                error: 'Failed to parse assessment data',
                originalError: error instanceof Error ? error.message : 'Unknown error',
            },
            null,
            2
        );
    }
}
