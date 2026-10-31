import { QuizQuestion } from '../../../../shared/types';
// contentParsers.ts is a module-scope, non-React parsing pipeline invoked from
// plain functions — there is no component/hook context to call useTranslation()
// from, so the i18next singleton is used directly at the point of use.
import i18n from '@/i18n';

/**
 * Process document content and convert mermaid diagrams to images
 */
export const processDocumentContent = (content: string): string => {
    if (!content) return '';

    let cleanedContent = content;

    // Remove markdown code block wrappers like ```html ... ``` or ``` ... ```
    cleanedContent = cleanedContent.replace(/^```(?:html|javascript|css|markdown|json|xml)?\s*\n?/gm, '');
    cleanedContent = cleanedContent.replace(/\n?```\s*$/gm, '');

    // Also handle cases where the content starts with ``` and ends with ```
    if (cleanedContent.startsWith('```') && cleanedContent.endsWith('```')) {
        cleanedContent = cleanedContent.slice(3, -3).trim();
        // Remove language specifier if present
        cleanedContent = cleanedContent.replace(/^html|javascript|css|markdown|json|xml\s+/, '');
    }

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = cleanedContent;

    // Find all mermaid code blocks (pre > code with mermaid class or content containing mermaid keywords)
    const codeBlocks = tempDiv.querySelectorAll('pre code, pre');
    codeBlocks.forEach((block) => {
        const codeText = block.textContent || '';
        const parentText = block.parentElement?.textContent || '';

        // Check if it's a mermaid diagram
        if (
            codeText.includes('graph') ||
            codeText.includes('flowchart') ||
            codeText.includes('sequenceDiagram') ||
            codeText.includes('classDiagram') ||
            codeText.includes('gantt') ||
            codeText.includes('pie') ||
            codeText.includes('erDiagram') ||
            codeText.includes('journey') ||
            parentText.toLowerCase().includes('mermaid') ||
            block.classList.contains('language-mermaid') ||
            block.classList.contains('mermaid')
        ) {
            try {
                // Create a container for the mermaid diagram
                const mermaidContainer = document.createElement('div');
                mermaidContainer.className = 'mermaid-diagram-container my-4';
                mermaidContainer.style.cssText = 'text-align: center; background: white; padding: 20px; border-radius: 8px;';

                // Create an image element that will be rendered by mermaid
                const mermaidDiv = document.createElement('div');
                mermaidDiv.className = 'mermaid';
                mermaidDiv.textContent = codeText.trim();
                mermaidContainer.appendChild(mermaidDiv);

                // Replace the code block with the mermaid container
                const preElement = block.tagName === 'PRE' ? block : block.closest('pre');
                if (preElement && preElement.parentNode) {
                    preElement.parentNode.replaceChild(mermaidContainer, preElement);
                }
            } catch (error) {
                console.error('Error processing mermaid diagram:', error);
            }
        }
    });

    return tempDiv.innerHTML;
};

/**
 * Parse code content from HTML
 */
export const parseCodeContent = (content: string): string => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = content;
    const codeBlock = tempDiv.querySelector('pre code, pre');
    if (codeBlock) {
        return codeBlock.textContent || '';
    }
    return content;
};

/**
 * Clean quiz content by removing HTML tags and comments
 */
export const cleanQuizContent = (content: string): string => {
    // Remove HTML comments/tags like <!-- DS_TAG_QUESTION_START --> and <!-- DS_TAG_QUESTION_END -->
    let cleaned = content.replace(/<!--\s*DS_TAG_QUESTION_(?:START|END)\s*-->/gi, '');
    // Remove any other HTML comments
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');
    // Trim whitespace
    cleaned = cleaned.trim();
    return cleaned;
};

/**
 * Parse video content to extract YouTube URL and script
 */
export const parseVideoContent = (content: string): { videoUrl?: string; script?: string } => {
    console.log('🔵 parseVideoContent called with content:', content);
    console.log('🔵 Content length:', content.length);

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = content;

    // Extract YouTube URL from content - try multiple patterns
    let videoUrl: string | undefined;

    console.log('🔵 Extracting YouTube URL from content...');

    // Pattern 1: Direct YouTube embed URL
    const embedMatch = content.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]+)/);
    if (embedMatch) {
        videoUrl = `https://www.youtube.com/embed/${embedMatch[1]}`;
        console.log('✅ Found embed URL:', videoUrl);
    }

    // Pattern 2: Full YouTube URL in text (watch?v= or youtu.be/)
    if (!videoUrl) {
        const youtubeMatch = content.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
        if (youtubeMatch) {
            videoUrl = `https://www.youtube.com/embed/${youtubeMatch[1]}`;
            console.log('✅ Found watch URL:', videoUrl);
        }
    }

    // Pattern 3: Extract from anchor tag href
    if (!videoUrl) {
        const anchorTags = tempDiv.querySelectorAll('a[href*="youtube.com"], a[href*="youtu.be"]');
        console.log('🔵 Found anchor tags:', anchorTags.length);

        for (const anchorTag of anchorTags) {
            const href = anchorTag.getAttribute('href');
            console.log('🔵 Checking anchor tag with href:', href);
            if (href) {
                // Try different patterns on the href
                const patterns = [
                    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/,
                    /youtube\.com\/embed\/([a-zA-Z0-9_-]+)/,
                    /youtu\.be\/([a-zA-Z0-9_-]+)/,
                    /youtube\.com\/v\/([a-zA-Z0-9_-]+)/
                ];

                for (const pattern of patterns) {
                    const urlMatch = href.match(pattern);
                    if (urlMatch) {
                        videoUrl = `https://www.youtube.com/embed/${urlMatch[1]}`;
                        console.log('✅ Found URL from anchor using pattern:', pattern, '->', videoUrl);
                        break;
                    }
                }
            }
        }
    }

    // Pattern 4: Look for any YouTube video ID in the content (11-character strings)
    if (!videoUrl) {
        // Look for 11-character alphanumeric strings that could be YouTube IDs
        const potentialIds = content.match(/([a-zA-Z0-9_-]{11})/g);
        if (potentialIds) {
            console.log('🔍 Found potential YouTube IDs:', potentialIds);
            for (const potentialId of potentialIds) {
                // Test if this looks like a valid YouTube ID (contains mix of letters, numbers, underscores, dashes)
                if (/^[a-zA-Z0-9_-]{11}$/.test(potentialId) && /[a-zA-Z]/.test(potentialId)) {
                    videoUrl = `https://www.youtube.com/embed/${potentialId}`;
                    console.log('✅ Using potential video ID:', videoUrl);
                    break;
                }
            }
        }
    }

    // Pattern 5: Check for any URL that contains youtube
    if (!videoUrl) {
        const anyYoutubeUrl = content.match(/(https?:\/\/[^\s]*youtube[^\s]*)/i);
        if (anyYoutubeUrl && anyYoutubeUrl[1]) {
            console.log('🔍 Found any YouTube URL:', anyYoutubeUrl[1]);
            // Try to extract video ID from various YouTube URL formats
            const url = anyYoutubeUrl[1];
            let videoId: string | undefined;

            // Try different extraction methods
            const patterns = [
                /[?&]v=([a-zA-Z0-9_-]{11})/,  // ?v=VIDEO_ID or &v=VIDEO_ID
                /youtu\.be\/([a-zA-Z0-9_-]{11})/,  // youtu.be/VIDEO_ID
                /embed\/([a-zA-Z0-9_-]{11})/,  // embed/VIDEO_ID
                /\/v\/([a-zA-Z0-9_-]{11})/  // /v/VIDEO_ID
            ];

            for (const pattern of patterns) {
                const match = url.match(pattern);
                if (match) {
                    videoId = match[1];
                    break;
                }
            }

            if (videoId) {
                videoUrl = `https://www.youtube.com/embed/${videoId}`;
                console.log('✅ Extracted video ID from URL:', videoUrl);
            }
        }
    }

    console.log('🎥 Final videoUrl result:', videoUrl ? videoUrl : '❌ NO VIDEO URL FOUND');

    // Remove code blocks and extract script
    const codeBlocks = tempDiv.querySelectorAll('pre code, pre');
    codeBlocks.forEach(block => block.remove());

    // Remove YouTube URL paragraph if it exists
    const youtubeParas = tempDiv.querySelectorAll('p');
    youtubeParas.forEach(p => {
        if (p.textContent?.includes('YouTube URL:') || p.textContent?.includes('Watch:')) {
            p.remove();
        }
    });

    const script = tempDiv.innerHTML.trim();

    console.log('🔵 Final script:', script);

    return { videoUrl, script: script || undefined };
};

/**
 * Parse quiz content from JSON format
 */
export const parseQuizContent = (content: string): QuizQuestion[] => {
    try {
        const quizData = JSON.parse(content);

        // Convert from assessment format to expected quiz format
        if (quizData.questions && Array.isArray(quizData.questions)) {
            return quizData.questions.map((q: any) => {
                const options = q.options || [];
                let correctAnswerIndex = 0;

                // Find the correct answer index
                if (q.correct_options && q.correct_options.length > 0) {
                    const correctOptionId = q.correct_options[0];
                    correctAnswerIndex = options.findIndex((opt: any) => opt.preview_id === correctOptionId);
                    if (correctAnswerIndex === -1) correctAnswerIndex = 0;
                }

                return {
                    question: cleanQuizContent(
                        q.question?.content || q.question || i18n.t('studyLibraryContentParsers:noQuestion')
                    ),
                    options: options.map((opt: any) => cleanQuizContent(opt.content || opt)),
                    correctAnswerIndex: Number(correctAnswerIndex),
                    explanation: q.exp ? cleanQuizContent(q.exp) : undefined
                };
            });
        }

        return [];
    } catch (e) {
        console.error('Failed to parse quiz content:', e);
        return [];
    }
};
