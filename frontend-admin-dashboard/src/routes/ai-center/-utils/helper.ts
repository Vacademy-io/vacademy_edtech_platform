import type { TFunction } from 'i18next';
import { AIAssessmentCompleteQuestion } from '@/types/ai/generate-assessment/generate-complete-assessment';
import { MyQuestion } from '@/types/assessments/question-paper-form';
import { FilePdf } from '@phosphor-icons/react';
import { FileAudio, FileDoc } from '@phosphor-icons/react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { renderLatexDelimiters } from '@/lib/latex-delimiters';

// Namespace: aiCenterHelper. `t` is threaded through (rather than a fixed
// Record) so the strings baked into the returned question HTML/labels are
// resolved against the caller's active language — see the
// `buildSourceLabel`/`taskDisplayName` precedent in -utils/format.ts.
export const transformQuestionsToGenerateAssessmentAI = (
    data: AIAssessmentCompleteQuestion[] | undefined,
    t: TFunction
) => {
    return data?.map((item) => {
        const correctOptionIds =
            JSON.parse(item.auto_evaluation_json)?.data?.correct_option_ids || [];
        const validAnswers = JSON.parse(item.auto_evaluation_json)?.data?.valid_answers || [];
        let decimals;
        let numericType;
        let subjectiveAnswerText;
        if (item.options_json) {
            decimals = JSON.parse(item.options_json)?.decimals || 0;
            numericType = JSON.parse(item.options_json)?.numeric_type || '';
        }
        if (item.auto_evaluation_json) {
            if (item.question_type === 'ONE_WORD') {
                subjectiveAnswerText = JSON.parse(item.auto_evaluation_json)?.data?.answer;
            } else if (item.question_type === 'LONG_ANSWER') {
                subjectiveAnswerText = JSON.parse(item.auto_evaluation_json)?.data?.answer?.content;
            }
        }
        const baseQuestion: MyQuestion = {
            id: item.id || '',
            questionId: item.id || item.preview_id || undefined,
            questionName: convertSVGsToBase64(item.text?.content, t) || '',
            explanation: convertSVGsToBase64(item.explanation_text?.content, t) || '',
            questionType: item.question_type,
            // A digitised paper's own marks and negative marks (Vsmart Extract);
            // generated questions have none and keep the section's default.
            questionMark: item.marks != null && item.marks > 0 ? String(item.marks) : '0',
            questionPenalty:
                item.negative_marks != null && item.negative_marks > 0
                    ? String(item.negative_marks)
                    : '0',
            sectionName: item.section_name || undefined,
            tags: item.tags || [],
            level: item.level || '',
            questionDuration: {
                hrs: String(Math.floor((item.default_question_time_mins ?? 0) / 60)), // Extract hours
                min: String((item.default_question_time_mins ?? 0) % 60), // Extract remaining minutes
            },
            singleChoiceOptions: Array(4).fill({
                id: '',
                name: '',
                isSelected: false,
            }),
            multipleChoiceOptions: Array(4).fill({
                id: '',
                name: '',
                isSelected: false,
            }),
            csingleChoiceOptions: Array(4).fill({
                id: '',
                name: '',
                isSelected: false,
            }),
            cmultipleChoiceOptions: Array(4).fill({
                id: '',
                name: '',
                isSelected: false,
            }),
            trueFalseOptions: Array(2).fill({
                id: '',
                name: '',
                isSelected: false,
            }),
            validAnswers: [],
            decimals,
            numericType,
            parentRichTextContent: renderLatexDelimiters(item.parent_rich_text?.content) || null,
            subjectiveAnswerText:
                renderLatexDelimiters(subjectiveAnswerText) || subjectiveAnswerText,
        };

        if (item.question_type === 'MCQS') {
            baseQuestion.singleChoiceOptions = item.options.map((option) => ({
                name: convertSVGsToBase64(option.text?.content, t) || '',
                isSelected: correctOptionIds.includes(option.id || option.preview_id),
            }));
        } else if (item.question_type === 'MCQM') {
            baseQuestion.multipleChoiceOptions = item.options.map((option) => ({
                name: convertSVGsToBase64(option.text?.content, t) || '',
                isSelected: correctOptionIds.includes(option.id || option.preview_id),
            }));
        } else if (item.question_type === 'CMCQS') {
            baseQuestion.csingleChoiceOptions = item.options.map((option) => ({
                id: option.id ? option.id : '',
                name: convertSVGsToBase64(option.text?.content, t) || '',
                isSelected: correctOptionIds.includes(option.id || option.preview_id),
            }));
        } else if (item.question_type === 'CMCQM') {
            baseQuestion.cmultipleChoiceOptions = item.options.map((option) => ({
                id: option.id ? option.id : '',
                name: convertSVGsToBase64(option.text?.content, t) || '',
                isSelected: correctOptionIds.includes(option.id || option.preview_id),
            }));
        } else if (item.question_type === 'TRUE_FALSE') {
            baseQuestion.trueFalseOptions = item.options.map((option) => ({
                id: option.id ? option.id : '',
                name: convertSVGsToBase64(option.text?.content, t) || '',
                isSelected: correctOptionIds.includes(option.id || option.preview_id),
            }));
        } else if (item.question_type === 'NUMERIC') {
            baseQuestion.validAnswers = validAnswers;
        }
        return baseQuestion;
    });
};

export function convertSVGsToBase64(htmlString: string, t: TFunction) {
    if (!htmlString) return '';

    let processedString = htmlString;

    // 1. Replace known typo/bad chars variants
    processedString = processedString
        .replace(/‹/g, '<')
        .replace(/›/g, '>')
        .replace(/xmIns/g, 'xmlns');

    // 2. Un-escape content that arrived HTML-encoded (`&lt;p&gt;Hello&lt;/p&gt;`),
    // up to 3 levels.
    //
    // ONLY when the string carries no real markup of its own. This used to run on
    // anything containing an `&`, and routing already-marked-up content through a
    // <textarea> strips every element: `<p>Salt <b>A</b> &amp; base <i>B</i></p>`
    // came back as the bare text "Salt A & base B", losing all formatting (and any
    // maths markup with it). A string that already has tags needs no decoding —
    // the browser resolves its entities when it renders.
    const hasRealTags = /<[a-zA-Z][^>]*>/.test(processedString);
    const hasEscapedTags = /&lt;[a-zA-Z]/.test(processedString);
    if (!hasRealTags && hasEscapedTags) {
        const txt = document.createElement('textarea');
        let levels = 0;
        while (levels < 3) {
            const prev = processedString;
            if (!prev.includes('&')) break;
            txt.innerHTML = prev;
            processedString = txt.value;
            if (processedString === prev) break;
            levels++;
        }
    }

    // 2.5 Convert raw LaTeX delimiters to editor math nodes.
    // This used to be two hand-rolled `$…$` / `$$…$$` regexes, which missed the
    // `\(…\)` and `\[…\]` delimiters the question generator actually emits — so
    // topic-generated papers showed `\(\{(2,1),(2,2)\}\)` verbatim — and turned
    // prose like "$5 and $10" into maths. renderLatexDelimiters covers all four
    // delimiters, guards on whether the body looks like maths, balances stray
    // braces, and pre-renders KaTeX inside the node so consumers that just dump
    // the HTML (the question sidebar, the PDF export) show real maths too.
    processedString = renderLatexDelimiters(processedString);

    const parser = new DOMParser();
    const doc = parser.parseFromString(processedString, 'text/html');

    // 3. Re-render every math node from its `data-latex`.
    // Content that has been round-tripped through the editor can arrive with the
    // KaTeX markup escaped into visible text (`<span class="katex">…` shown
    // literally). `data-latex` is the source of truth, so anything carrying it is
    // rebuilt from scratch; a node with no latex is dropped rather than left as an
    // empty formula. Previously this wiped the markup and left the raw LaTeX as
    // text, which is why exported papers printed the delimiters instead of maths.
    doc.querySelectorAll('.math-inline, .math-block').forEach((el) => {
        const latex = el.getAttribute('data-latex') || '';
        if (!latex.trim()) {
            el.remove();
            return;
        }
        try {
            el.innerHTML = katex.renderToString(latex, {
                throwOnError: false,
                displayMode: el.classList.contains('math-block'),
            });
        } catch {
            el.textContent = latex;
        }
    });

    // 4. Convert SVGs to base64 images
    const svgElements = doc.querySelectorAll('svg');
    svgElements.forEach((svg) => {
        const svgClone = svg.cloneNode(true);
        const svgString = new XMLSerializer().serializeToString(svgClone);
        const base64 = btoa(unescape(encodeURIComponent(svgString)));
        const dataUrl = `data:image/svg+xml;base64,${base64}`;
        const img = document.createElement('img');
        img.src = dataUrl;
        img.alt = t('svgAlt');
        svg.replaceWith(img);
    });

    // 5. Gracefully handle placeholder / known-broken images.
    // The backend image-generation pipeline is supposed to swap `src="placeholder.png"`
    // with a real generated image URL. When that pipeline fails or doesn't run,
    // the placeholder makes it to the frontend and we get a broken image icon.
    // Replace those with a styled inline note so the teacher still sees the intent.
    const imgs = doc.querySelectorAll('img');
    imgs.forEach((img) => {
        const src = img.getAttribute('src') || '';
        const isPlaceholder =
            !src ||
            src === '' ||
            src.endsWith('placeholder.png') ||
            src.endsWith('placeholder.jpg') ||
            src === '#';
        if (!isPlaceholder) return;
        const alt = (img.getAttribute('alt') || '').trim();
        const promptHint = (img.getAttribute('data-img-prompt') || '').trim();
        const caption = alt || promptHint || t('diagramNotAvailable');
        const replacement = document.createElement('span');
        replacement.className = 'ai-missing-image';
        replacement.setAttribute('data-original-alt', alt);
        replacement.setAttribute(
            'style',
            'display:inline-flex;align-items:center;gap:6px;padding:6px 10px;margin:4px 0;border:1px dashed hsl(var(--border));border-radius:8px;background:hsl(var(--muted));color:hsl(var(--muted-foreground));font-size:12px;font-style:italic;'
        );
        replacement.textContent = `\u{1F4F7} ${caption}`;
        img.replaceWith(replacement);
    });

    return doc.body.innerHTML;
}

export function getPerformanceLabel(score: number): string {
    if (score < 40) return 'Needs Improvement';
    if (score >= 40 && score < 60) return 'Average';
    if (score >= 60 && score < 80) return 'Good';
    return 'Excellent'; // score >= 80
}

export function getPerformanceColor(score: number): string {
    if (score < 40) return 'text-destructive text-sm'; // or "text-danger-500" if using custom
    if (score >= 40 && score < 60) return 'text-warning-500 text-sm';
    if (score > 60 && score <= 80) return 'text-success-500 text-sm';
    return 'text-success-500 text-sm'; // for score > 80
}

export function getScoreFromString(input: string): number {
    const scores: Record<string, number> = {
        'Delivery & Presentation': 20,
        'Content Quality': 20,
        'Student Engagement': 15,
        'Assessment & Feedback': 10,
        'Inclusivity & Language': 10,
        'Classroom Management': 10,
        'Teaching Aids': 10,
        Professionalism: 5,
    };

    return scores[input.trim()] ?? 0;
}

export const AIFormatDate = (dateString: string, t: TFunction): string => {
    try {
        return new Date(dateString).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true, // Common preference, can be set to false
        });
    } catch (error) {
        console.error('Error formatting date:', dateString, error);
        return t('invalidDate');
    }
};

export function getAIIconByMimeType(mimeType: string) {
    const lowerMime = mimeType.toLowerCase();

    if (lowerMime.includes('pdf')) {
        return FilePdf;
    }

    if (
        lowerMime.includes('wav') || // audio/wav
        lowerMime.includes('flac') || // audio/flac
        lowerMime.includes('aac') || // audio/aac
        lowerMime.includes('m4a') || // audio/m4a
        lowerMime.includes('mpeg') || // audio/mpeg
        lowerMime.includes('mp3') || // audio/mp3 (non-standard but seen in some systems)
        lowerMime.includes('audio') || // generic audio/*
        lowerMime.includes('x-mpeg') || // audio/x-mpeg
        lowerMime.includes('x-mp3') || // audio/x-mp3
        lowerMime.includes('mpeg3') || // audio/mpeg3 (rare but used)
        lowerMime.includes('mpga') || // audio/mpga
        lowerMime.includes('x-mpg') || // audio/x-mpg
        lowerMime.includes('x-mpeg3') || // audio/x-mpeg3
        lowerMime.includes('mp3audio') || // custom or non-standard
        lowerMime.includes('x-mpegaudio') // audio/x-mpegaudio (non-standard)
    ) {
        return FileAudio;
    }
    // Default to document icon for other types
    return FileDoc;
}

export const getRandomTaskName = () => {
    const now = new Date();
    const formattedDate = now.toLocaleString().replace(', ', '_');
    return `Task_${formattedDate}`;
};
