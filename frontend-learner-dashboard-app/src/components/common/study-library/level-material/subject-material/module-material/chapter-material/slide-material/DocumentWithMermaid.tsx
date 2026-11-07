import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MermaidDiagram } from './MermaidDiagram';
import { EnhancedCodeBlock } from './EnhancedCodeBlock';
import SimplePDFViewer from '@/components/common/simple-pdf-viewer';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useContentStore } from '@/stores/study-library/chapter-sidebar-store';
import { getSlideInteractions, saveSlideInteraction } from '@/services/study-library/tracking-api/slide-interaction';

// Pattern: {blank:answer}
const BLANK_REGEX = /\{blank:([^}]+)\}/g;

// Decode a quiz/tabs data-* payload. New slides store base64 (immune to the
// admin's HTML sanitizers, which used to truncate the JSON when it contained an
// S3 image URL); older slides stored raw/escaped JSON (starts with { or [).
function decodeBlockData<T>(raw: string | null | undefined, fallback: T): T {
    if (raw == null) return fallback;
    const s = String(raw).trim();
    if (!s) return fallback;
    if (s[0] === '{' || s[0] === '[') {
        try { return JSON.parse(s) as T; } catch { return fallback; }
    }
    try { return JSON.parse(decodeURIComponent(escape(atob(s)))) as T; }
    catch {
        try { return JSON.parse(s) as T; } catch { return fallback; }
    }
}

// Flashcard image aspect-ratio classes — mirror the admin editor so a card's
// chosen ratio (Original / 1:1 / 4:3 / 16:9) renders the same for learners. The
// image is contained inside the ratio box (never cropped or stretched).
const FC_RATIO_CLASS: Record<string, string> = {
    '1:1': 'fc-ar-1-1',
    '4:3': 'fc-ar-4-3',
    '16:9': 'fc-ar-16-9',
};
function ensureFcRatioStyles() {
    if (typeof document === 'undefined') return;
    const css =
        '.fc-card-img img { max-width: 100%; max-height: 300px; height: auto; object-fit: contain; display: block; margin: 4px auto; }\n' +
        '.fc-ar-1-1 img { aspect-ratio: 1 / 1; width: 100%; }\n' +
        '.fc-ar-4-3 img { aspect-ratio: 4 / 3; width: 100%; }\n' +
        '.fc-ar-16-9 img { aspect-ratio: 16 / 9; width: 100%; }';
    let style = document.getElementById('fc-ratio-styles') as HTMLStyleElement | null;
    if (!style) {
        style = document.createElement('style');
        style.id = 'fc-ratio-styles';
        document.head.appendChild(style);
    }
    if (style.textContent !== css) style.textContent = css;
}

/** Interactive quiz component for learner side */
function InlineQuiz({ quizJson, slideId, elementIndex }: { quizJson: string; slideId?: string; elementIndex?: number }) {
    const { t } = useTranslation('libraryCommonA');
    const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
    const [showResult, setShowResult] = useState(false);
    const optionLabels = ['A', 'B', 'C', 'D', 'E', 'F'];

    const quizData: { question: string; options: { text: string; isCorrect: boolean }[]; explanation?: string } =
        decodeBlockData(quizJson, { question: '', options: [], explanation: '' });

    // Question/option content is rich-text HTML from the admin editor. Treat
    // blank / "<p><br></p>" / nbsp-only as empty, but never embedded media.
    const htmlEmpty = (h?: string) => {
        if (!h) return true;
        if (/<(img|iframe|video|audio)\b/i.test(h)) return false;
        return (
            h.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').trim() === ''
        );
    };
    // Plain text (entities decoded, list items separated) for activity analytics.
    const stripTags = (h?: string) => {
        if (!h) return '';
        if (typeof document === 'undefined') return h.replace(/<[^>]+>/g, '').trim();
        const d = document.createElement('div');
        d.innerHTML = h;
        return (d.textContent || '').replace(/\s+/g, ' ').trim();
    };
    const options = Array.isArray(quizData.options) ? quizData.options : [];
    if (htmlEmpty(quizData.question) && options.length === 0) return null;

    // Reveal the result and (when rendered for a learner slide) record the
    // learner's choice so the admin activity log can show it.
    const handleCheck = () => {
        setShowResult(true);
        if (slideId && elementIndex != null && selectedAnswer != null) {
            const opt = options[selectedAnswer];
            saveSlideInteraction(slideId, `mcq-${elementIndex}`, 'MCQ', {
                question: stripTags(quizData.question),
                options: options.map((o) => stripTags(o.text)),
                selected: selectedAnswer,
                selectedText: opt ? stripTags(opt.text) : null,
                correct: !!opt?.isCorrect,
                correctIndex: options.findIndex((o) => o.isCorrect),
            });
        }
    };

    return (
        <div className="inline-quiz" style={{ border: '1px solid #e0e0e0', borderRadius: '8px', padding: '16px', margin: '8px 0', background: '#fafafa' }}> {/* design-lint-ignore: dynamic quiz UI state — style prop */}
            <div style={{ padding: '4px 8px', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '4px', display: 'inline-block', fontSize: '12px', fontWeight: 600, color: '#4338ca', marginBottom: '12px' }}> {/* design-lint-ignore: dynamic quiz UI state — style prop */}
                {t('documentViewer.quiz.badge')}
            </div>
            {!htmlEmpty(quizData.question) && (
                <div style={{ fontSize: '16px', fontWeight: 400, color: '#333', marginBottom: '12px' }}> {/* design-lint-ignore: dynamic quiz UI state — style prop */}
                    <div dangerouslySetInnerHTML={{ __html: quizData.question }} />
                </div>
            )}
            {options.map((opt, i) => {
                let bgColor = '#fff'; // design-lint-ignore: dynamic quiz option state
                let borderColor = '#ddd'; // design-lint-ignore: dynamic quiz option state
                let textColor = '#333'; // design-lint-ignore: dynamic quiz option state
                if (selectedAnswer === i) { borderColor = '#4338ca'; bgColor = '#eef2ff'; } // design-lint-ignore: dynamic quiz option state
                if (showResult) {
                    if (opt.isCorrect) { bgColor = '#d4edda'; borderColor = '#28a745'; textColor = '#155724'; } // design-lint-ignore: dynamic quiz result state
                    else if (selectedAnswer === i) { bgColor = '#f8d7da'; borderColor = '#dc3545'; textColor = '#721c24'; } // design-lint-ignore: dynamic quiz result state
                }
                return (
                    <div key={i} onClick={() => { if (!showResult) setSelectedAnswer(i); }}
                        style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px', border: `2px solid ${borderColor}`, borderRadius: '6px', marginBottom: '6px', cursor: showResult ? 'default' : 'pointer', backgroundColor: bgColor, color: textColor, transition: 'all 0.2s' }}>
                        <span style={{ width: '24px', height: '24px', marginTop: '2px', borderRadius: '50%', border: `2px solid ${borderColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 600, flexShrink: 0, backgroundColor: selectedAnswer === i ? borderColor : 'transparent', color: selectedAnswer === i ? 'white' : textColor }}>
                            {showResult && opt.isCorrect ? '\u2713' : optionLabels[i]}
                        </span>
                        <div
                            style={{ fontSize: '14px', flex: 1, minWidth: 0 }}
                            dangerouslySetInnerHTML={{ __html: htmlEmpty(opt.text) ? t('documentViewer.quiz.optionFallback', { letter: optionLabels[i] }) : opt.text }}
                        />
                    </div>
                );
            })}
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                {!showResult ? (
                    <button onClick={handleCheck} disabled={selectedAnswer === null}
                        style={{ padding: '6px 16px', fontSize: '13px', border: 'none', borderRadius: '4px', backgroundColor: selectedAnswer !== null ? '#4338ca' : '#ccc', color: 'white', cursor: selectedAnswer !== null ? 'pointer' : 'default' }}> {/* design-lint-ignore: dynamic quiz button state — style prop */}
                        {t('documentViewer.quiz.checkAnswer')}
                    </button>
                ) : (
                    <button onClick={() => { setSelectedAnswer(null); setShowResult(false); }}
                        style={{ padding: '6px 16px', fontSize: '13px', border: '1px solid #ccc', borderRadius: '4px', backgroundColor: '#fff', color: '#666', cursor: 'pointer' }}> {/* design-lint-ignore: dynamic quiz UI state — style prop */}
                        {t('common.tryAgain')}
                    </button>
                )}
            </div>
            {showResult && !htmlEmpty(quizData.explanation) && (
                <div style={{ marginTop: '12px', padding: '10px 12px', backgroundColor: '#fff3cd', border: '1px solid #ffc107', borderRadius: '6px', fontSize: '13px', color: '#856404' }}> {/* design-lint-ignore: dynamic quiz explanation state — style prop */}
                    <strong>{t('documentViewer.quiz.explanationLabel')}</strong>{' '}
                    <span dangerouslySetInnerHTML={{ __html: quizData.explanation || '' }} />
                </div>
            )}
        </div>
    );
}

/** Interactive flashcard component for learner side. Front/back are rich HTML
 * (text and/or images) authored in the admin editor. */
function InteractiveFlashcard({ front, back, aspectRatio, slideId, elementIndex }: { front: string; back: string; aspectRatio?: string; slideId?: string; elementIndex?: number }) {
    const { t } = useTranslation('libraryCommonA');
    const [isFlipped, setIsFlipped] = useState(false);
    const flipCountRef = useRef(0);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        ensureFcRatioStyles();
    }, []);
    const ratioClass = FC_RATIO_CLASS[aspectRatio || 'original'] || '';
    // Always bound flashcard images (fc-card-img); add the chosen ratio on top.
    // `fc-face` is the hook for the face-content reset below.
    const imgWrapClass = `fc-face fc-card-img ${ratioClass}`.trim();
    // Legacy flashcards store plain text and lean on pre-wrap to keep their
    // line breaks. Rich content brings its own block spacing, and there pre-wrap
    // would *also* render the newlines sitting between `</p>` and `<p>` as blank
    // lines inside the card — so choose the mode per face.
    const faceWhiteSpace = (h: string) =>
        /<(p|div|ul|ol|h[1-6]|table|blockquote)\b/i.test(h || '') ? 'normal' : 'pre-wrap';

    // Plain text (entities decoded) for activity analytics — the stored HTML
    // would otherwise pollute the admin activity log.
    const stripTags = (h?: string) => {
        if (!h) return '';
        if (typeof document === 'undefined') return h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const d = document.createElement('div');
        d.innerHTML = h;
        return (d.textContent || '').replace(/\s+/g, ' ').trim();
    };

    // Flip and (on a learner slide) record engagement — that the learner flipped
    // to reveal the back, and how many times. Debounced + best-effort.
    const handleFlip = () => {
        const next = !isFlipped;
        setIsFlipped(next);
        flipCountRef.current += 1;
        if (slideId && elementIndex != null) {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            saveTimerRef.current = setTimeout(
                () =>
                    saveSlideInteraction(slideId, `flashcard-${elementIndex}`, 'FLASHCARD', {
                        front: stripTags(front),
                        back: stripTags(back),
                        viewed: true,
                        flipCount: flipCountRef.current,
                    }),
                600
            );
        }
    };

    return (
        <div
            style={{ perspective: '1000px', cursor: 'pointer', margin: '8px auto', maxWidth: '420px' }}
            onClick={handleFlip}
        >
            {/* Both faces share grid-area 1/1 so the card grows to the taller of the
                two (text OR image content) — no fixed height, no spacer. */}
            <div
                style={{
                    display: 'grid',
                    transition: 'transform 0.6s',
                    transformStyle: 'preserve-3d',
                    transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                }}
            >
                {/* Front */}
                <div
                    style={{
                        gridArea: '1 / 1',
                        position: 'relative',
                        minHeight: '150px',
                        backfaceVisibility: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '28px 24px',
                        backgroundColor: '#fff', // design-lint-ignore: flashcard UI state — style prop
                        borderRadius: '8px',
                        border: '2px solid #007acc', // design-lint-ignore: flashcard UI state — style prop
                        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                    }}
                >
                    <div style={{ fontSize: '10px', color: '#007acc', fontWeight: 600, textTransform: 'uppercase', position: 'absolute', top: '8px', left: '12px' }}>{t('documentViewer.flashcard.front')}</div> {/* design-lint-ignore: flashcard UI state — style prop */}
                    <div className={imgWrapClass} style={{ fontSize: '16px', color: '#333', textAlign: 'center', maxWidth: '100%', whiteSpace: faceWhiteSpace(front) }} dangerouslySetInnerHTML={{ __html: front || '' }} /> {/* design-lint-ignore: flashcard UI state — style prop */}
                    <div style={{ fontSize: '11px', color: '#999', position: 'absolute', bottom: '8px' }}>{t('documentViewer.flashcard.clickToFlip')}</div> {/* design-lint-ignore: flashcard UI state — style prop */}
                </div>
                {/* Back */}
                <div
                    style={{
                        gridArea: '1 / 1',
                        position: 'relative',
                        minHeight: '150px',
                        backfaceVisibility: 'hidden',
                        transform: 'rotateY(180deg)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '28px 24px',
                        backgroundColor: '#007acc', // design-lint-ignore: flashcard UI state — style prop
                        borderRadius: '8px',
                        border: '2px solid #007acc', // design-lint-ignore: flashcard UI state — style prop
                        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                    }}
                >
                    <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.7)', fontWeight: 600, textTransform: 'uppercase', position: 'absolute', top: '8px', left: '12px' }}>{t('documentViewer.flashcard.back')}</div>
                    <div className={imgWrapClass} style={{ fontSize: '16px', color: '#fff', textAlign: 'center', maxWidth: '100%', whiteSpace: faceWhiteSpace(back) }} dangerouslySetInnerHTML={{ __html: back || '' }} /> {/* design-lint-ignore: flashcard UI state — style prop */}
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', position: 'absolute', bottom: '8px' }}>{t('documentViewer.flashcard.clickToFlipBack')}</div>
                </div>
            </div>
        </div>
    );
}

/** Interactive fill-in-the-blanks component for learner side */
function InteractiveFillBlanks({ sentence, slideId, elementIndex }: { sentence: string; slideId?: string; elementIndex?: number }) {
    const { t } = useTranslation('libraryCommonA');
    const [answers, setAnswers] = useState<Record<number, string>>({});
    const [showResults, setShowResults] = useState(false);

    const parts = useMemo(() => {
        const result: Array<{ type: 'text' | 'blank'; value: string }> = [];
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        const regex = new RegExp(BLANK_REGEX.source, 'g');
        while ((match = regex.exec(sentence)) !== null) {
            if (match.index > lastIndex) {
                result.push({ type: 'text', value: sentence.slice(lastIndex, match.index) });
            }
            result.push({ type: 'blank', value: match[1]! });
            lastIndex = regex.lastIndex;
        }
        if (lastIndex < sentence.length) {
            result.push({ type: 'text', value: sentence.slice(lastIndex) });
        }
        return result;
    }, [sentence]);

    const blanks = useMemo(() => parts.filter((p) => p.type === 'blank'), [parts]);

    let blankIndex = 0;

    // Reveal results and (when rendered for a learner slide) record the learner's
    // per-blank answers + correctness so the admin activity log can show them.
    const handleCheck = () => {
        setShowResults(true);
        if (slideId && elementIndex != null) {
            saveSlideInteraction(slideId, `fill-${elementIndex}`, 'FILL_BLANKS', {
                statement: sentence,
                answers: blanks.map((b, i) => ({
                    expected: b.value,
                    value: answers[i] || '',
                    correct: (answers[i] || '').trim().toLowerCase() === b.value.trim().toLowerCase(),
                })),
            });
        }
    };

    return (
        <div style={{ border: '1px solid #e0e0e0', borderRadius: '8px', padding: '16px', margin: '8px 0', background: '#fafafa' }}> {/* design-lint-ignore: dynamic fill-blanks UI state — style prop */}
            <div style={{ padding: '4px 8px', background: '#e8f4fd', border: '1px solid #90caf9', borderRadius: '4px', display: 'inline-block', fontSize: '12px', fontWeight: 600, color: '#1565c0', marginBottom: '12px' }}> {/* design-lint-ignore: dynamic fill-blanks UI state — style prop */}
                {t('documentViewer.fillBlanks.badge')}
            </div>
            {/* whiteSpace: pre-wrap mirrors the admin editor (Slate's editable container is pre-wrap),
                so newlines between statements stay as line breaks instead of collapsing into one paragraph. */}
            <div style={{ fontSize: '16px', lineHeight: 2.2, color: '#333', padding: '8px', whiteSpace: 'pre-wrap' }}> {/* design-lint-ignore: dynamic fill-blanks UI state — style prop */}
                {parts.map((part, i) => {
                    if (part.type === 'text') return <span key={i}>{part.value}</span>;
                    const idx = blankIndex++;
                    const userAnswer = answers[idx] || '';
                    const isCorrect = userAnswer.trim().toLowerCase() === part.value.trim().toLowerCase();
                    return (
                        <span key={i} style={{ display: 'inline-block', margin: '0 4px' }}>
                            <input
                                type="text"
                                value={userAnswer}
                                onChange={(e) => { setAnswers((prev) => ({ ...prev, [idx]: e.target.value })); setShowResults(false); }}
                                placeholder={t('documentViewer.fillBlanks.blankPlaceholder', { number: idx + 1 })}
                                style={{
                                    width: `${Math.max(part.value.length * 10, 80)}px`,
                                    padding: '4px 8px',
                                    fontSize: '15px',
                                    border: 'none',
                                    borderBottom: showResults ? `2px solid ${isCorrect ? '#22c55e' : '#ef4444'}` : '2px solid #007acc', // design-lint-ignore: dynamic fill-blanks answer state
                                    backgroundColor: showResults ? (isCorrect ? '#f0fdf4' : '#fef2f2') : '#f8f9fa', // design-lint-ignore: dynamic fill-blanks answer state
                                    outline: 'none',
                                    textAlign: 'center',
                                    borderRadius: '2px 2px 0 0',
                                }}
                            />
                            {showResults && !isCorrect && (
                                <div style={{ fontSize: '11px', color: '#ef4444', textAlign: 'center' }}>{part.value}</div> // design-lint-ignore: dynamic fill-blanks answer state
                            )}
                        </span>
                    );
                })}
            </div>
            {blanks.length > 0 && (
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'center' }}>
                    <button onClick={handleCheck}
                        style={{ padding: '6px 16px', fontSize: '13px', border: 'none', borderRadius: '4px', backgroundColor: '#007acc', color: 'white', cursor: 'pointer' }}> {/* design-lint-ignore: dynamic fill-blanks UI state — style prop */}
                        {t('documentViewer.fillBlanks.checkAnswers')}
                    </button>
                    <button onClick={() => { setAnswers({}); setShowResults(false); }}
                        style={{ padding: '6px 16px', fontSize: '13px', border: '1px solid #ccc', borderRadius: '4px', backgroundColor: 'white', color: '#666', cursor: 'pointer' }}> {/* design-lint-ignore: dynamic fill-blanks UI state — style prop */}
                        {t('documentViewer.fillBlanks.reset')}
                    </button>
                    {showResults && (
                        <span style={{ display: 'flex', alignItems: 'center', fontSize: '13px', fontWeight: 600, color: blanks.every((b, i) => (answers[i] || '').trim().toLowerCase() === b.value.trim().toLowerCase()) ? '#22c55e' : '#666' }}> {/* design-lint-ignore: dynamic fill-blanks score state */}
                            {t('documentViewer.fillBlanks.scoreLabel', { count: blanks.filter((b, i) => (answers[i] || '').trim().toLowerCase() === b.value.trim().toLowerCase()).length, total: blanks.length })}
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}

/** Interactive tabs component for learner side */
function InteractiveTabs({ tabsJson }: { tabsJson: string }) {
    const [activeTab, setActiveTab] = useState(0);

    const tabs: Array<{ label: string; content: string; color?: string }> = decodeBlockData(tabsJson, []);

    if (!Array.isArray(tabs) || tabs.length === 0) return null;

    // Per-tab colour-coding (falls back to the default accent when unset).
    const tabColor = (t?: { color?: string }) => (t && t.color) || '#007acc'; // design-lint-ignore: dynamic tab colour-coding
    const activeColor = tabColor(tabs[activeTab]);

    return (
        <div style={{ border: '1px solid #e0e0e0', borderRadius: '8px', margin: '8px 0', overflow: 'hidden', background: '#fafafa' }}> {/* design-lint-ignore: dynamic tabs UI state — style prop */}
            <div style={{ display: 'flex', borderBottom: '1px solid #e0e0e0', background: '#fff', overflowX: 'auto' }}> {/* design-lint-ignore: dynamic tabs UI state — style prop */}
                {tabs.map((tab, i) => {
                    const tc = tabColor(tab);
                    return (
                        <div
                            key={i}
                            onClick={() => setActiveTab(i)}
                            style={{
                                padding: '10px 20px',
                                fontSize: '14px',
                                fontWeight: activeTab === i ? 600 : 400,
                                color: activeTab === i ? tc : '#666', // design-lint-ignore: dynamic tab active state
                                // Colour-code: every tab shows its colour as a top bar.
                                borderTop: `3px solid ${tc}`, // design-lint-ignore: dynamic tab colour-coding
                                backgroundColor: activeTab === i ? '#fff' : 'transparent', // design-lint-ignore: dynamic tab active state
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                                transition: 'color 0.15s, border-color 0.15s',
                            }}
                        >
                            {tab.label}
                        </div>
                    );
                })}
            </div>
            {/* Tab content is rich-text HTML from the admin editor. The
                "inline-quiz" class reuses the same list/paragraph/image resets so
                authored bullets/numbers render past the document's list reset. Top
                border echoes the active tab's colour-code. */}
            <div className="inline-quiz" style={{ padding: '16px', borderTop: `3px solid ${activeColor}`, fontSize: '14px', lineHeight: 1.6, color: '#333' }}> {/* design-lint-ignore: dynamic tabs UI state — style prop */}
                <div dangerouslySetInnerHTML={{ __html: tabs[activeTab]?.content || '' }} />
            </div>
        </div>
    );
}

/** Live, interactive Table of Contents for the learner side. The admin
 *  serializer can only emit a static placeholder (it can't read the document at
 *  serialize time), so we rebuild the outline here from the document's headings.
 *  Interactions: click to smooth-scroll to a section, plus a scroll-spy that
 *  highlights the section currently on screen. Colours follow the institute
 *  theme (--primary-* scale). */
function InteractiveToc({
    headings,
    onNavigate,
    containerRef,
}: {
    headings: Array<{ level: 1 | 2 | 3; text: string; anchor: number }>;
    onNavigate: (anchor: number) => void;
    containerRef: React.RefObject<HTMLDivElement>;
}) {
    const { t } = useTranslation('libraryCommonA');
    const [activeAnchor, setActiveAnchor] = useState<number | null>(
        headings.length > 0 ? headings[0]!.anchor : null
    );

    // Scroll-spy: highlight the heading the learner is currently reading — the
    // lowest one whose top has scrolled above a small offset line near the top
    // of the viewport. Recomputed on scroll (capture:true also catches nested
    // scroll containers) and nudged by an IntersectionObserver.
    useEffect(() => {
        const root = containerRef.current;
        if (!root || headings.length === 0) return;
        const OFFSET = 120;
        const els = headings
            .map((h) => root.querySelector(`[data-toc-anchor="${h.anchor}"]`) as HTMLElement | null)
            .filter((el): el is HTMLElement => el !== null);
        if (els.length === 0) return;

        const recompute = () => {
            let active = Number(els[0]!.getAttribute('data-toc-anchor'));
            for (const el of els) {
                if (el.getBoundingClientRect().top - OFFSET <= 0) {
                    active = Number(el.getAttribute('data-toc-anchor'));
                } else {
                    break; // els are in document order → first one below the line stops us
                }
            }
            setActiveAnchor(active);
        };

        const observer = new IntersectionObserver(recompute, {
            rootMargin: '-120px 0px -70% 0px',
            threshold: 0,
        });
        els.forEach((el) => observer.observe(el));
        window.addEventListener('scroll', recompute, { passive: true, capture: true });
        recompute();

        return () => {
            observer.disconnect();
            window.removeEventListener('scroll', recompute, true);
        };
    }, [headings, containerRef]);

    return (
        <div style={{ border: '1px solid hsl(var(--primary-100))', borderRadius: '0.75rem', margin: '1.25rem 0', background: 'white', overflow: 'hidden' }}>
            <div style={{ padding: '0.75rem 1rem', background: 'hsl(var(--primary-50))', borderBottom: '1px solid hsl(var(--primary-100))' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--primary-500))" strokeWidth="2" strokeLinecap="round">
                        <line x1="3" y1="6" x2="21" y2="6" />
                        <line x1="7" y1="12" x2="21" y2="12" />
                        <line x1="7" y1="18" x2="21" y2="18" />
                        <circle cx="3" cy="12" r="1" fill="hsl(var(--primary-500))" />
                        <circle cx="3" cy="18" r="1" fill="hsl(var(--primary-500))" />
                    </svg>
                    <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'hsl(var(--primary-500))' }}>{t('documentViewer.toc.title')}</span>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'hsl(var(--primary-500) / 0.7)', marginTop: '2px', marginLeft: '24px' }}>
                    {t('documentViewer.toc.hint')}
                </div>
            </div>
            <div style={{ padding: '0.4rem' }}>
                {headings.length === 0 ? (
                    <div style={{ padding: '12px', textAlign: 'center', color: 'hsl(var(--primary-500) / 0.55)', fontSize: '0.9rem' }}>
                        {t('documentViewer.toc.empty')}
                    </div>
                ) : (
                    headings.map((h) => {
                        const isActive = h.anchor === activeAnchor;
                        return (
                            <button
                                key={h.anchor}
                                onClick={() => {
                                    setActiveAnchor(h.anchor);
                                    onNavigate(h.anchor);
                                }}
                                style={{
                                    display: 'block',
                                    width: '100%',
                                    textAlign: 'left',
                                    border: 'none',
                                    borderLeft: isActive
                                        ? '3px solid hsl(var(--primary-500))'
                                        : '3px solid transparent',
                                    background: isActive ? 'hsl(var(--primary-50))' : 'transparent',
                                    cursor: 'pointer',
                                    padding: `0.34rem 0.75rem 0.34rem ${0.55 + (h.level - 1) * 1.05}rem`,
                                    fontSize: h.level === 1 ? '1rem' : h.level === 2 ? '0.95rem' : '0.9rem',
                                    fontWeight: isActive || h.level === 1 ? 600 : 400,
                                    color: 'hsl(var(--primary-500))',
                                    borderRadius: '0 0.375rem 0.375rem 0',
                                    lineHeight: 1.7,
                                    transition: 'background 0.15s ease, border-color 0.15s ease',
                                }}
                                onMouseEnter={(e) => {
                                    if (!isActive)
                                        (e.currentTarget as HTMLElement).style.background =
                                            'hsl(var(--primary-50) / 0.5)';
                                }}
                                onMouseLeave={(e) => {
                                    if (!isActive)
                                        (e.currentTarget as HTMLElement).style.background = 'transparent';
                                }}
                            >
                                {h.text}
                            </button>
                        );
                    })
                )}
            </div>
        </div>
    );
}

interface DocumentWithMermaidProps {
    htmlContent: string;
    className?: string;
}

export const DocumentWithMermaid: React.FC<DocumentWithMermaidProps> = ({
    htmlContent,
    className = '',
}) => {
    const { t } = useTranslation('libraryCommonA');
    const [sections, setSections] = useState<Array<{ type: 'html' | 'mermaid' | 'code' | 'math' | 'quiz' | 'flashcard' | 'fillBlanks' | 'tabs' | 'pdfViewer' | 'toc'; content: string; meta?: Record<string, string> }>>([]);
    // Current slide id (for persisting the learner's checkbox/checklist ticks)
    // and a ref over the rendered output so we can wire up todo-item clicks.
    const slideId = useContentStore((s) => s.activeItem?.id);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!htmlContent) {
            setSections([]);
            return;
        }

        try {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = htmlContent;

            // Preserve soft line breaks inside list items / paragraphs. The
            // admin editor (Yoopta) stores pressed-Enter-without-new-block
            // as a literal \n inside the text node. Default HTML rendering
            // collapses whitespace, so "Hello\n1.1 Hello\n1.2 HAAE" shows
            // as a single line on the learner side. Convert \n to <br>
            // inside text nodes so the browser paints real line breaks.
            // Skip <pre>/<code>/script/style and any Yoopta custom block
            // whose semantics live in data-* attributes (text inside the
            // wrapper isn't load-bearing, but shouldn't be mutated either).
            const convertNewlinesToBr = (node: Node) => {
                const children = Array.from(node.childNodes);
                for (const child of children) {
                    if (child.nodeType === 3) {
                        const raw = (child.textContent || '').replace(/\r\n?/g, '\n');
                        if (!raw.includes('\n')) continue;
                        // Skip pure-whitespace text nodes (formatting
                        // indentation between tags) — they'd inject stray
                        // <br>s where there's no real content.
                        if (raw.trim() === '') continue;
                        const parent = child.parentNode;
                        if (!parent) continue;
                        const tag = (parent as Element).tagName;
                        if (tag === 'PRE' || tag === 'CODE' || tag === 'SCRIPT' || tag === 'STYLE') continue;
                        // Mermaid (<div class="mermaid">) and Yoopta custom blocks
                        // (math latex, etc.) carry load-bearing multi-line code as
                        // text content, read back via textContent — converting \n
                        // to <br> here collapses it to one line and breaks the
                        // diagram / formula on the learner. Skip them.
                        if ((parent as Element).closest?.('pre, .mermaid, [data-yoopta-type]')) continue;
                        const parts = raw.split('\n');
                        const frag = document.createDocumentFragment();
                        parts.forEach((part, i) => {
                            if (i > 0) frag.appendChild(document.createElement('br'));
                            if (part) frag.appendChild(document.createTextNode(part));
                        });
                        parent.replaceChild(frag, child);
                    } else if (child.nodeType === 1) {
                        const tag = (child as Element).tagName;
                        if (tag === 'PRE' || tag === 'SCRIPT' || tag === 'STYLE') continue;
                        convertNewlinesToBr(child);
                    }
                }
            };
            convertNewlinesToBr(tempDiv);

            // Merge consecutive sibling <ol>/<ul> so numbering is continuous.
            // Why: authored HTML wraps each <li> in its own <ol>, which resets the
            // CSS counter on every list and renders 1, 1, 1, 1 instead of 1, 2, 3, 4.
            // Admin uses Yoopta which coalesces these during deserialization; we
            // replicate that by merging in the DOM before rendering.
            const mergeConsecutiveLists = (node: Element) => {
                for (const child of Array.from(node.children)) {
                    mergeConsecutiveLists(child);
                }
                let cur = node.firstElementChild;
                while (cur) {
                    const next = cur.nextElementSibling;
                    if (
                        next &&
                        (cur.tagName === 'OL' || cur.tagName === 'UL') &&
                        cur.tagName === next.tagName
                    ) {
                        while (next.firstChild) cur.appendChild(next.firstChild);
                        next.remove();
                    } else {
                        cur = next;
                    }
                }
            };
            mergeConsecutiveLists(tempDiv);

            // Carry ordered-list numbering ACROSS interrupting blocks that hold
            // no text (an illustrative image, or an empty spacer paragraph).
            // mergeConsecutiveLists only joins lists that are DIRECT siblings, so
            // an <img> between steps leaves the list after it a fresh <ol> that
            // restarts at 1 (…, 4, [image], 1). The displayed number comes from a
            // CSS counter (`.document-with-mermaid ol { counter-reset: item }` +
            // `li { counter-increment: item }`), NOT native <ol> numbering — so a
            // `start` attribute is ignored. Instead, seed each continuing <ol>'s
            // counter inline (`counter-reset: item N`, which the first <li> then
            // increments to N+1) so steps keep counting (…, 4, [image], 5, 6 …).
            // Walk recursively (Yoopta wraps the body in one <div>, so the real
            // blocks are GRANDchildren). Only a block that actually contains TEXT
            // (a paragraph, heading, another list) resets the count, so genuinely
            // separate numbered lists still start at 1.
            const continueOrderedNumbering = (root: Element) => {
                let running = 0;
                for (const child of Array.from(root.children)) {
                    if (child.tagName === 'OL') {
                        const liCount = Array.from(child.children).filter(
                            (c) => c.tagName === 'LI'
                        ).length;
                        if (running > 0)
                            (child as HTMLElement).style.setProperty(
                                'counter-reset',
                                `item ${running}`
                            );
                        running += liCount;
                    } else if ((child.textContent || '').trim() !== '') {
                        running = 0;
                    }
                    // Each recursive call keeps its own running count, so nested
                    // lists number independently of the outer sequence.
                    continueOrderedNumbering(child);
                }
            };
            continueOrderedNumbering(tempDiv);

            // A checkbox/todo item reaches us in one of two serialized shapes,
            // depending on which admin editor authored the slide:
            //  - Yoopta (legacy): `<li>[ ] text</li>` / `[x] text` — a literal
            //    bracket marker, no checkbox markup at all.
            //  - Lexical (the "New editor"): `<ul __lexicallisttype="check">` with
            //    `<li role="checkbox" aria-checked="true|false" class="… lex-check-item">`
            //    — real state, but the box itself is drawn by CSS that only exists
            //    inside the admin editor shell.
            // Rendered as raw HTML both collapse to a plain bullet (plus a literal
            // "[ ]" for the Yoopta shape). Normalise both onto `todo-item` so the
            // scoped CSS below draws a real checkbox like admin, and the effect
            // below can make it tickable.
            const convertTodoListsToCheckboxes = (root: Element) => {
                const TODO_RE = /^\s*\[([ xX])\]\s?/;
                let todoIndex = 0;
                const markTodoItem = (li: Element, checked: boolean) => {
                    li.classList.add('todo-item');
                    if (checked) li.classList.add('todo-item--checked');
                    // Stable document-order index so the learner's saved tick state
                    // (persisted per slide) can be mapped back onto each item.
                    li.setAttribute('data-todo-index', String(todoIndex));
                    todoIndex++;
                };
                // querySelectorAll walks in document order, so the two shapes share
                // one index sequence even in a document that mixes them.
                root.querySelectorAll('ul > li').forEach((li) => {
                    // Lexical check list. Lexical only puts role/aria-checked on
                    // LEAF items, so an <li> that merely wraps a nested list is
                    // skipped here — which is what we want.
                    const ariaChecked = li.getAttribute('aria-checked');
                    if (
                        li.getAttribute('role') === 'checkbox' ||
                        ariaChecked !== null ||
                        li.classList.contains('lex-check-item')
                    ) {
                        markTodoItem(
                            li,
                            ariaChecked === 'true' ||
                                li.classList.contains('lex-check-item--checked')
                        );
                        return;
                    }

                    // Yoopta bracket marker.
                    const m = (li.textContent || '').match(TODO_RE);
                    if (!m) return;
                    const checked = m[1]!.toLowerCase() === 'x';
                    // Strip the marker from the first non-empty text node so any
                    // inline formatting inside the item is preserved.
                    const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
                    let node = walker.nextNode();
                    while (node && !(node.nodeValue || '').trim()) node = walker.nextNode();
                    if (node && node.nodeValue) {
                        node.nodeValue = node.nodeValue.replace(TODO_RE, '');
                    }
                    markTodoItem(li, checked);
                });
            };
            convertTodoListsToCheckboxes(tempDiv);

            // Accordion bodies are serialized by the admin as
            // `<div style="padding: 4px 0;">`. That inline shorthand outranks the
            // scoped `details > *:not(summary)` rule below, collapsing the
            // horizontal padding to 0 — so body text hugged the theme accent bar
            // while the summary above it stayed inset. Drop just the padding
            // declaration (any other inline styles survive) and let the
            // stylesheet own accordion spacing.
            const relaxAccordionBodyPadding = (root: Element) => {
                root.querySelectorAll('details > div[style*="padding"]').forEach((el) => {
                    const body = el as HTMLElement;
                    body.style.removeProperty('padding');
                    if (!body.getAttribute('style')) body.removeAttribute('style');
                });
            };
            relaxAccordionBodyPadding(tempDiv);

            // Build a live outline for any Table of Contents block. The admin TOC
            // can't read the document at serialize time, so it ships a static
            // placeholder; here we scan the rendered headings, tag each with a
            // scroll anchor, and (below) swap the placeholder for a real clickable
            // outline. Only runs when a TOC block is actually present.
            const tocHeadings: Array<{ level: 1 | 2 | 3; text: string; anchor: number }> = [];
            if (tempDiv.querySelector('div[data-yoopta-type="tableOfContents"]')) {
                tempDiv.querySelectorAll('h1, h2, h3').forEach((h) => {
                    const text = (h.textContent || '').trim();
                    if (!text) return;
                    const level = h.tagName === 'H1' ? 1 : h.tagName === 'H2' ? 2 : 3;
                    const anchor = tocHeadings.length;
                    h.setAttribute('data-toc-anchor', String(anchor));
                    tocHeadings.push({ level: level as 1 | 2 | 3, text, anchor });
                });
            }

            // First, check for div.mermaid elements (most common pattern for mermaid)
            const mermaidDivs = tempDiv.querySelectorAll('div.mermaid');

            // Also check for code blocks
            const codeBlocks = tempDiv.querySelectorAll('pre code, pre, code');

            // Also check raw HTML string for mermaid patterns
            const hasMermaidInHtml = /graph\s+TD|flowchart|sequenceDiagram|classDiagram|gantt|pie|erDiagram|journey/i.test(htmlContent);

            type SectionType = 'html' | 'mermaid' | 'code' | 'math' | 'quiz' | 'flashcard' | 'fillBlanks' | 'tabs' | 'pdfViewer' | 'toc';
            const newSections: Array<{ type: SectionType; content: string; meta?: Record<string, string> }> = [];

            // Mark special blocks in DOM
            const specialBlocks: Array<{ element: Element; code: string; type: SectionType; meta?: Record<string, string> }> = [];

            // Process audio blocks — mark them so they're not broken apart
            const audioDivs = tempDiv.querySelectorAll('div[data-yoopta-type="audioPlayer"]');
            audioDivs.forEach((div) => {
                specialBlocks.push({
                    element: div,
                    code: div.outerHTML,
                    type: 'html', // render as raw HTML — <audio> tag works natively
                });
            });

            // Process PDF viewer blocks — render via PDF.js (SimplePDFViewer)
            // because direct <iframe src=pdf> breaks on S3 header edge cases
            // and docs.google.com/gview now blocks embedding.
            const pdfDivs = tempDiv.querySelectorAll('div[data-yoopta-type="pdfViewer"]');
            pdfDivs.forEach((div) => {
                const pdfUrl = div.getAttribute('data-pdf-url') || '';
                const title = div.getAttribute('data-title') || '';
                specialBlocks.push({
                    element: div,
                    code: pdfUrl,
                    type: 'pdfViewer' as SectionType,
                    meta: { title },
                });
            });

            // Process interactive code editor blocks (MultiLangCodePlugin from admin)
            const codeEditorDivs = tempDiv.querySelectorAll('div[data-yoopta-type="codeBlock"]');
            codeEditorDivs.forEach((div) => {
                const language = div.getAttribute('data-language') || 'python';
                const codeEl = (div.querySelector('pre code') ?? div.querySelector('pre')) as HTMLElement | null;
                const code = (codeEl?.innerText || codeEl?.textContent || '').trim();
                const output = div.getAttribute('data-output') || '';
                specialBlocks.push({
                    element: div,
                    code,
                    type: 'code',
                    meta: { language, ...(output ? { output } : {}) },
                });
            });

            // Process quiz blocks — interactive on learner side
            const quizDivs = tempDiv.querySelectorAll('div[data-yoopta-type="quizBlock"]');
            quizDivs.forEach((div) => {
                const quizJson = div.getAttribute('data-quiz') || '';
                specialBlocks.push({
                    element: div,
                    code: quizJson,
                    type: 'quiz',
                });
            });

            // Process timeline blocks — render as HTML (visual fallback is sufficient)
            const timelineDivs = tempDiv.querySelectorAll('div[data-yoopta-type="timeline"]');
            timelineDivs.forEach((div) => {
                specialBlocks.push({
                    element: div,
                    code: div.outerHTML,
                    type: 'html',
                });
            });

            // Process flashcard blocks — interactive on learner side. Prefer the
            // base64 data-flashcard payload (rich HTML incl. images, immune to the
            // admin's HTML sanitizers); fall back to legacy plain-text data-front/
            // data-back for flashcards created before image support.
            const flashcardDivs = tempDiv.querySelectorAll('div[data-yoopta-type="flashcard"]');
            flashcardDivs.forEach((div) => {
                const encoded = div.getAttribute('data-flashcard');
                let front = '';
                let back = '';
                let aspectRatio = 'original';
                if (encoded) {
                    const d = decodeBlockData<{ front: string; back: string; aspectRatio?: string }>(encoded, { front: '', back: '' });
                    front = d.front || '';
                    back = d.back || '';
                    aspectRatio = d.aspectRatio || 'original';
                } else {
                    front = div.getAttribute('data-front') || '';
                    back = div.getAttribute('data-back') || '';
                    aspectRatio = div.getAttribute('data-aspect-ratio') || 'original';
                }
                specialBlocks.push({
                    element: div,
                    code: JSON.stringify({ front, back, aspectRatio }),
                    type: 'flashcard' as SectionType,
                });
            });

            // Process fill-in-the-blanks blocks — interactive on learner side
            const fillBlanksDivs = tempDiv.querySelectorAll('div[data-yoopta-type="fillBlanks"]');
            fillBlanksDivs.forEach((div) => {
                const sentence = div.getAttribute('data-sentence') || '';
                specialBlocks.push({
                    element: div,
                    code: sentence,
                    type: 'fillBlanks' as SectionType,
                });
            });

            // Process tabbed content blocks — interactive on learner side
            const tabsDivs = tempDiv.querySelectorAll('div[data-yoopta-type="tabbedContent"]');
            tabsDivs.forEach((div) => {
                const tabsJson = div.getAttribute('data-tabs') || '[]';
                specialBlocks.push({
                    element: div,
                    code: tabsJson,
                    type: 'tabs' as SectionType,
                });
            });

            // Process Table of Contents blocks — render a live, clickable outline
            // from the headings tagged above (replaces the static placeholder).
            const tocDivs = tempDiv.querySelectorAll('div[data-yoopta-type="tableOfContents"]');
            tocDivs.forEach((div) => {
                specialBlocks.push({
                    element: div,
                    code: JSON.stringify(tocHeadings),
                    type: 'toc' as SectionType,
                });
            });

            // Process math blocks (div[data-yoopta-type="mathBlock"])
            const mathDivs = tempDiv.querySelectorAll('div[data-yoopta-type="mathBlock"]');
            mathDivs.forEach((div) => {
                const htmlDiv = div as HTMLElement;
                let latex = htmlDiv.textContent?.trim() || '';
                // Strip $$ or $ delimiters
                if (latex.startsWith('$$') && latex.endsWith('$$')) {
                    latex = latex.slice(2, -2).trim();
                } else if (latex.startsWith('$') && latex.endsWith('$')) {
                    latex = latex.slice(1, -1).trim();
                }
                const displayMode = div.getAttribute('data-display-mode') !== 'false';
                specialBlocks.push({
                    element: div,
                    code: latex,
                    type: 'math',
                    meta: { displayMode: String(displayMode) },
                });
            });

            // Process div.mermaid elements first (highest priority)
            mermaidDivs.forEach((div) => {
                const htmlDiv = div as HTMLElement;
                const codeText = htmlDiv.innerText || htmlDiv.textContent || '';
                specialBlocks.push({
                    element: div,
                    code: codeText.trim(),
                    type: 'mermaid'
                });
            });

            // Process code blocks
            codeBlocks.forEach((block) => {
                const htmlBlock = block as HTMLElement;
                // Skip if this block is already part of a detected mermaid div
                if (block.closest('div.mermaid')) return;
                // Skip code inside an interactive codeBlock div (handled above as a unit)
                if (block.closest('div[data-yoopta-type="codeBlock"]')) return;

                // Get text content - prefer innerText to preserve line breaks from block elements
                let codeText = '';
                if (block.tagName === 'CODE' && block.parentElement?.tagName === 'PRE') {
                    // If it's a code inside pre, get the code text
                    const parent = block.parentElement as HTMLElement;
                    codeText = htmlBlock.innerText || htmlBlock.textContent || '';
                    // If code element has strange formatting, maybe fallback to parent text?
                    // But usually code element contains the text.
                } else if (block.tagName === 'PRE') {
                    // If it's just a pre, get text from it or from code inside
                    const codeElement = block.querySelector('code') as HTMLElement | null;
                    if (codeElement) {
                        codeText = codeElement.innerText || codeElement.textContent || '';
                    } else {
                        codeText = htmlBlock.innerText || htmlBlock.textContent || '';
                    }
                } else {
                    // Inline code or other
                    // check if it is part of pre
                    if (block.closest('pre')) return; // handled by parent pre
                    codeText = htmlBlock.innerText || htmlBlock.textContent || '';
                }

                // Only treat as block if it's a PRE tag or inside PRE tag
                // content inside simple <code> tags inline should be left as HTML
                const isBlock = block.tagName === 'PRE' || block.parentElement?.tagName === 'PRE';

                const containerEl = (block.tagName === 'CODE' && block.parentElement?.tagName === 'PRE'
                    ? block.parentElement
                    : block) as HTMLElement;
                // data-code / data-language IS the code-block contract from the
                // AI generator — such a block is never a mermaid diagram, even
                // if the code mentions "graph"/"pie" (e.g. graph = {...}).
                const isContractedCodeBlock =
                    !!containerEl.getAttribute('data-code') || !!containerEl.getAttribute('data-language');

                // A real Mermaid header sits ALONE on the first line (graph TD,
                // sequenceDiagram, pie title X). Substring matching used to
                // hijack ordinary code/text containing "graph"/"pie"/"journey"
                // and the failed mermaid render deleted the block entirely.
                const firstLine = (codeText.trim().split('\n')[0] || '').trim();
                const isMermaid =
                    !isContractedCodeBlock &&
                    /^(graph|flowchart)\s+(TD|TB|BT|RL|LR)\s*$|^(sequenceDiagram|classDiagram|stateDiagram-v2|stateDiagram|erDiagram|gantt|journey|gitGraph|mindmap|requirementDiagram|c4Context)\s*$|^pie(\s+showData)?(\s+title\s+.+)?\s*$/i.test(
                        firstLine
                    );

                if (isMermaid) {
                    // Avoid duplicates if we already caught this via div.mermaid
                    // But here we are processing code blocks
                    specialBlocks.push({
                        element: block.tagName === 'CODE' && block.parentElement?.tagName === 'PRE' ? block.parentElement : block,
                        code: codeText, // Keep original casing
                        type: 'mermaid'
                    });
                } else if (isBlock) {
                    const preEl = (block.tagName === 'CODE' && block.parentElement?.tagName === 'PRE'
                        ? block.parentElement
                        : block) as HTMLElement;
                    const language = preEl.getAttribute('data-language') || '';
                    // Prefer base64-encoded data-code attribute which preserves newlines exactly
                    const encodedCode = preEl.getAttribute('data-code') || '';
                    let actualCode = codeText;
                    if (encodedCode) {
                        try {
                            actualCode = decodeURIComponent(escape(atob(encodedCode)));
                        } catch { /* fall back to textContent */ }
                    }
                    specialBlocks.push({
                        element: preEl,
                        code: actualCode,
                        type: 'code',
                        meta: { language },
                    });
                }
            });

            // Deduplicate blocks (in case pre and code both got picked up)
            const uniqueBlocks: typeof specialBlocks = [];
            const processedElements = new Set<Element>();

            specialBlocks.forEach(block => {
                if (!processedElements.has(block.element)) {
                    processedElements.add(block.element);
                    uniqueBlocks.push(block);
                }
            });

            // If no special blocks found but text pattern exists
            if (uniqueBlocks.length === 0 && hasMermaidInHtml) {
                // Try to find mermaid code in the HTML using regex (fallback loops)
                // ... (same regex logic as before) ...
                // Re-implementing simplified regex fallback if needed, but existing block logic is usually sufficient for 'pre code'
            }

            if (uniqueBlocks.length > 0) {
                // Use tempDiv.innerHTML instead of htmlContent to ensure outerHTML matches occur
                let processedHtml = tempDiv.innerHTML;
                const markers: Array<{ marker: string; code: string; type: SectionType; position: number; meta?: Record<string, string> }> = [];

                uniqueBlocks.forEach((block, idx) => {
                    const marker = `__SPECIAL_BLOCK_${idx}__`;

                    // Helper to find block in HTML
                    let blockHtml = block.element.outerHTML;

                    // Naive approach: find outerHTML
                    let position = processedHtml.indexOf(blockHtml);

                    // If not found, try to construct likely HTML patterns
                    if (position === -1) {
                        const codeContent = block.code;
                        // Try identifying by unique content if possible, or patterns
                        // This is tricky.
                        // Fallback: if we can't find the exact HTML, we might skip replacement or try looser match
                        // For now, let's try strict match.
                    }

                    if (position !== -1) {
                        processedHtml = processedHtml.substring(0, position) +
                            marker +
                            processedHtml.substring(position + blockHtml.length);
                        markers.push({ marker, code: block.code, type: block.type, position, meta: block.meta });
                    } else {
                        // Fallback for when outerHTML doesn't match exactly (e.g. attributes order)
                        // Try finding by text content if it's unique? Risky.
                        // Let's try finding the Pre block by partial match?
                        // For now, let's proceed with what we found.
                    }
                });

                markers.sort((a, b) => {
                    const posA = processedHtml.indexOf(a.marker);
                    const posB = processedHtml.indexOf(b.marker);
                    return posA - posB;
                });

                let lastPos = 0;
                markers.forEach((markerInfo) => {
                    const markerPos = processedHtml.indexOf(markerInfo.marker, lastPos);

                    if (markerPos > lastPos) {
                        const htmlBefore = processedHtml.substring(lastPos, markerPos);
                        if (htmlBefore.trim()) {
                            newSections.push({ type: 'html', content: htmlBefore });
                        }
                    }

                    newSections.push({ type: markerInfo.type, content: markerInfo.code, meta: markerInfo.meta });

                    lastPos = markerPos + markerInfo.marker.length;
                });

                if (lastPos < processedHtml.length) {
                    const remainingHtml = processedHtml.substring(lastPos);
                    if (remainingHtml.trim()) {
                        newSections.push({ type: 'html', content: remainingHtml });
                    }
                }
                setSections(newSections);

            } else {
                // Fallback to regex detection for mermaid if strictly no blocks found
                // (Reuse previous regex logic or just render HTML)
                // Copy of regex logic from previous implementation
                const mermaidPatterns = [
                    /(graph\s+TD[\s\S]*?)(?=<|$)/i,
                    /(flowchart[\s\S]*?)(?=<|$)/i,
                    /(sequenceDiagram[\s\S]*?)(?=<|$)/i,
                    /(classDiagram[\s\S]*?)(?=<|$)/i,
                ];

                let foundMermaid = false;
                let processedHtml = tempDiv.innerHTML;
                const regexSections: typeof newSections = [];

                mermaidPatterns.forEach((pattern) => {
                    const match = processedHtml.match(pattern);
                    if (match && match.index !== undefined) {
                        foundMermaid = true;
                        const mermaidCode = match[1].trim();
                        const beforeHtml = processedHtml.substring(0, match.index);
                        const afterHtml = processedHtml.substring(match.index + match[0].length);

                        if (beforeHtml.trim()) {
                            regexSections.push({ type: 'html', content: beforeHtml });
                        }
                        regexSections.push({ type: 'mermaid', content: mermaidCode });
                        processedHtml = afterHtml;
                    }
                });

                if (foundMermaid) {
                    if (processedHtml.trim()) regexSections.push({ type: 'html', content: processedHtml });
                    setSections(regexSections);
                } else {
                    setSections([{ type: 'html', content: tempDiv.innerHTML }]);
                }
            }
        } catch (error) {
            console.error('[DocumentWithMermaid] Error processing content:', error);
            setSections([{ type: 'html', content: htmlContent }]);
        }
    }, [htmlContent]);

    // Make checklist/todo items interactive: load the learner's saved ticks,
    // apply them, and toggle + persist (debounced) on click. State is per
    // (learner, slide) and survives reloads/devices. Best-effort — any network
    // failure leaves the items as the author-rendered default, never blocks.
    useEffect(() => {
        const container = containerRef.current;
        if (!container || !slideId) return;
        const items = Array.from(
            container.querySelectorAll<HTMLElement>('li.todo-item[data-todo-index]')
        );
        if (items.length === 0) return;

        const indexOf = (li: HTMLElement) => Number(li.getAttribute('data-todo-index'));
        // Lexical-authored items carry role="checkbox", so aria-checked has to
        // track the learner's tick, not the state the author saved.
        const applyChecked = (li: HTMLElement, checked: boolean) => {
            li.classList.toggle('todo-item--checked', checked);
            if (li.getAttribute('role') === 'checkbox') {
                li.setAttribute('aria-checked', checked ? 'true' : 'false');
            }
        };
        items.forEach((li) => {
            li.style.cursor = 'pointer';
        });
        // Item labels in index order — saved alongside the ticks so the admin
        // activity view can show real text instead of bare indices.
        const labels = items
            .slice()
            .sort((a, b) => indexOf(a) - indexOf(b))
            .map((li) => (li.textContent || '').trim());

        // Seed from the author-rendered defaults; overridden once saved state loads.
        const checkedSet = new Set<number>(
            items.filter((li) => li.classList.contains('todo-item--checked')).map(indexOf)
        );
        const persist = () =>
            saveSlideInteraction(slideId, 'checklist', 'CHECKLIST', {
                checked: Array.from(checkedSet).sort((a, b) => a - b),
                items: labels,
            });

        let cancelled = false;
        getSlideInteractions(slideId).then((map) => {
            const saved = map.get('checklist')?.state as { checked?: number[] } | undefined;
            if (cancelled || !saved || !Array.isArray(saved.checked)) return; // no saved state → keep defaults
            checkedSet.clear();
            saved.checked.forEach((i) => checkedSet.add(i));
            items.forEach((li) => {
                applyChecked(li, checkedSet.has(indexOf(li)));
            });
        });

        let saveTimer: ReturnType<typeof setTimeout> | null = null;
        const onClick = (e: Event) => {
            const target = e.target as HTMLElement;
            const li = target.closest('li.todo-item[data-todo-index]') as HTMLElement | null;
            if (!li || !container.contains(li)) return;
            const idx = indexOf(li);
            const nowChecked = !li.classList.contains('todo-item--checked');
            applyChecked(li, nowChecked);
            if (nowChecked) checkedSet.add(idx);
            else checkedSet.delete(idx);
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(persist, 500);
        };
        container.addEventListener('click', onClick);

        return () => {
            cancelled = true;
            if (saveTimer) clearTimeout(saveTimer);
            container.removeEventListener('click', onClick);
        };
    }, [sections, slideId]);

    return (
        <div ref={containerRef} className={`document-with-mermaid ${className}`}>
            <style>{`
                .document-with-mermaid {
                    font-family: 'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
                    color: #374151; /* design-lint-ignore: CSS-in-JS document theme */
                    line-height: 1.7;
                }

                .document-with-mermaid h1 {
                    font-size: 1.875rem;
                    line-height: 1.25;
                    font-weight: 700;
                    margin-bottom: 1.5rem;
                    color: #111827; /* design-lint-ignore: CSS-in-JS document theme */
                    border-bottom: 2px solid transparent;
                    border-image: linear-gradient(to right, #3b82f6, #4f46e5) 1; /* design-lint-ignore: CSS-in-JS document theme */
                    padding-bottom: 0.75rem;
                }

                .document-with-mermaid h2 {
                    font-size: 1.5rem;
                    line-height: 1.3;
                    font-weight: 600;
                    margin-top: 2rem;
                    margin-bottom: 1rem;
                    color: #111827; /* design-lint-ignore: CSS-in-JS document theme */
                }

                .document-with-mermaid h3 {
                    font-size: 1.25rem;
                    font-weight: 600;
                    margin-top: 1.5rem;
                    margin-bottom: 0.75rem;
                    color: #111827; /* design-lint-ignore: CSS-in-JS document theme */
                }

                .document-with-mermaid p {
                    margin-bottom: 1.5rem;
                    font-size: 1.125rem;
                    color: #374151; /* design-lint-ignore: CSS-in-JS document theme */
                    line-height: 1.8;
                }

                .document-with-mermaid ul, .document-with-mermaid ol {
                    margin-bottom: 1.5rem;
                    padding-left: 0;
                    list-style: none;
                }

                .document-with-mermaid ul > li, .document-with-mermaid ol > li {
                    position: relative;
                    padding-left: 2rem;
                    margin-bottom: 0.75rem;
                    font-size: 1.125rem;
                    color: #374151; /* design-lint-ignore: CSS-in-JS document theme */
                }

                .document-with-mermaid ul > li::before {
                    content: '';
                    position: absolute;
                    left: 0.5rem;
                    top: 0.75rem;
                    width: 0.5rem;
                    height: 0.5rem;
                    background-color: #4f46e5; /* design-lint-ignore: CSS-in-JS document theme */
                    border-radius: 50%;
                }

                /* Checkbox/todo items (see convertTodoListsToCheckboxes): render a
                   square checkbox in place of the bullet dot, matching the admin. */
                .document-with-mermaid ul > li.todo-item::before {
                    left: 0.15rem;
                    top: 0.4rem;
                    width: 1.05rem;
                    height: 1.05rem;
                    background-color: transparent;
                    border: 2px solid #94a3b8; /* design-lint-ignore: CSS-in-JS document theme */
                    border-radius: 0.25rem;
                }
                .document-with-mermaid ul > li.todo-item--checked::before {
                    background-color: #4f46e5; /* design-lint-ignore: CSS-in-JS document theme */
                    border-color: #4f46e5; /* design-lint-ignore: CSS-in-JS document theme */
                }
                .document-with-mermaid ul > li.todo-item--checked::after {
                    content: '';
                    position: absolute;
                    left: 0.57rem;
                    top: 0.5rem;
                    width: 0.3rem;
                    height: 0.6rem;
                    border: solid #fff; /* design-lint-ignore: CSS-in-JS document theme */
                    border-width: 0 2px 2px 0;
                    transform: rotate(45deg);
                }
                .document-with-mermaid ul > li.todo-item--checked {
                    text-decoration: line-through;
                    color: #6b7280; /* design-lint-ignore: CSS-in-JS document theme */
                }

                .document-with-mermaid ol {
                    counter-reset: item;
                }

                .document-with-mermaid ol > li {
                    counter-increment: item;
                }

                .document-with-mermaid ol > li::before {
                    content: counter(item);
                    position: absolute;
                    left: 0;
                    top: 0.15rem;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 1.5rem;
                    height: 1.5rem;
                    background-color: #e0e7ff; /* design-lint-ignore: CSS-in-JS document theme */
                    color: #4338ca; /* design-lint-ignore: CSS-in-JS document theme */
                    font-size: 0.875rem;
                    font-weight: 600;
                    border-radius: 50%;
                }

                .document-with-mermaid img {
                    width: auto;
                    height: auto;
                    max-width: 100%;
                    /* Centralised: centre every document image (all blocks — tabs,
                       accordion, columns, flashcard, quiz), for existing and new
                       images alike. New images also carry an inline centred style. */
                    display: block;
                    margin-left: auto;
                    margin-right: auto;
                }

                .document-with-mermaid blockquote {
                    position: relative;
                    padding: 1rem 1.5rem;
                    margin: 2rem 0;
                    border-left: 4px solid #60a5fa; /* design-lint-ignore: CSS-in-JS document theme */
                    background: linear-gradient(to right, #eff6ff, #eef2ff); /* design-lint-ignore: CSS-in-JS document theme */
                    border-radius: 0 0.5rem 0.5rem 0;
                    font-style: italic;
                    color: #1f2937; /* design-lint-ignore: CSS-in-JS document theme */
                }

                /* Tables: the editor renders bordered cells, but the read-only HTML
                   here has no table styling, so cells lost their grid. Restore borders
                   so document tables read as a structured grid like the admin. */
                .document-with-mermaid table {
                    width: 100%;
                    border-collapse: collapse;
                    margin: 1rem 0;
                }
                .document-with-mermaid th,
                .document-with-mermaid td {
                    border: 1px solid #e5e7eb; /* design-lint-ignore: CSS-in-JS document theme */
                    padding: 0.5rem 0.75rem;
                    text-align: left;
                    vertical-align: top;
                }
                .document-with-mermaid th {
                    background: #f9fafb; /* design-lint-ignore: CSS-in-JS document theme */
                    font-weight: 600;
                }
                /* Cells in the document use the ul>li::before bullet pattern; make sure
                   table cells don't inherit list padding/markers. */
                .document-with-mermaid td > ul,
                .document-with-mermaid td > ol {
                    margin: 0.25rem 0;
                }

                /* Accordion: Yoopta serializes each item as <details><summary>…</summary>.
                   Rendered raw, the browser shows only a tiny ▶ disclosure triangle, so
                   learners can't tell it's an expandable panel. Style it on-brand using the
                   institute theme color (the --primary-* HSL scale set by ThemeProvider, so
                   it follows each institute's theme code instead of a fixed hue): a card
                   with a primary accent bar, hover lift, and a circular toggle button whose
                   chevron flips + fills with the theme color when open. */
                .document-with-mermaid details {
                    position: relative;
                    border: 1px solid hsl(var(--primary-100));
                    border-radius: 0.75rem;
                    margin: 1.25rem 0;
                    background: #ffffff; /* design-lint-ignore: CSS-in-JS document theme */
                    overflow: hidden;
                    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); /* design-lint-ignore: CSS-in-JS document theme */
                    transition: box-shadow 0.2s ease, border-color 0.2s ease;
                }
                .document-with-mermaid details:hover {
                    border-color: hsl(var(--primary-200));
                    box-shadow: 0 6px 16px hsl(var(--primary-500) / 0.10);
                }
                /* Theme-colored accent bar down the left edge. */
                .document-with-mermaid details::before {
                    content: '';
                    position: absolute;
                    left: 0;
                    top: 0;
                    bottom: 0;
                    width: 0.25rem;
                    background: linear-gradient(to bottom, hsl(var(--primary-400)), hsl(var(--primary-500)));
                }
                .document-with-mermaid details summary {
                    list-style: none;
                    cursor: pointer;
                    position: relative;
                    padding: 1rem 3.5rem 1rem 1.5rem;
                    font-weight: 600;
                    font-size: 1.0625rem;
                    line-height: 1.5;
                    color: #1e293b; /* design-lint-ignore: CSS-in-JS document theme */
                    background: #ffffff; /* design-lint-ignore: CSS-in-JS document theme */
                    user-select: none;
                    transition: background 0.15s ease, color 0.15s ease;
                }
                .document-with-mermaid details summary::-webkit-details-marker {
                    display: none;
                }
                .document-with-mermaid details summary:hover {
                    background: hsl(var(--primary-50) / 0.5);
                }
                .document-with-mermaid details[open] summary {
                    color: hsl(var(--primary-500));
                    background: hsl(var(--primary-50));
                    border-bottom: 1px solid hsl(var(--primary-100));
                }
                /* Circular toggle button background on the right. */
                .document-with-mermaid details summary::before {
                    content: '';
                    position: absolute;
                    right: 1rem;
                    top: 50%;
                    width: 1.85rem;
                    height: 1.85rem;
                    transform: translateY(-50%);
                    border-radius: 9999px;
                    background: hsl(var(--primary-50));
                    transition: background 0.2s ease;
                }
                .document-with-mermaid details[open] summary::before {
                    background: hsl(var(--primary-500));
                }
                /* Crisp SVG chevron centered in the toggle button; recolored via the mask
                   + background-color so it flips from the theme color → its foreground
                   (auto-contrast) when the circle fills on open. */
                .document-with-mermaid details summary::after {
                    content: '';
                    position: absolute;
                    right: 1.3rem;
                    top: 50%;
                    width: 1.25rem;
                    height: 1.25rem;
                    transform: translateY(-50%);
                    background-color: hsl(var(--primary-500));
                    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E") center / 0.8rem no-repeat;
                    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E") center / 0.8rem no-repeat;
                    transition: transform 0.25s ease, background-color 0.2s ease;
                }
                .document-with-mermaid details[open] summary::after {
                    transform: translateY(-50%) rotate(180deg);
                    background-color: hsl(var(--primary-foreground));
                }
                /* Accordion body — content paragraph(s), with a gentle reveal. */
                .document-with-mermaid details > *:not(summary) {
                    margin: 0;
                    padding: 1.125rem 1.5rem 1.25rem;
                    font-size: 1.0625rem;
                    color: #374151; /* design-lint-ignore: CSS-in-JS document theme */
                }
                @keyframes accordionReveal {
                    from { opacity: 0; transform: translateY(-4px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .document-with-mermaid details[open] > *:not(summary) {
                    animation: accordionReveal 0.25s ease;
                }

                /* Inline quiz rich-text (Quill HTML): neutralise the heavy document
                   paragraph/list styling so authored questions/options render
                   compactly and native list markers show. */
                .document-with-mermaid .inline-quiz p {
                    margin: 0 0 0.35rem;
                    font-size: inherit;
                    color: inherit;
                    line-height: 1.5;
                }
                .document-with-mermaid .inline-quiz p:last-child {
                    margin-bottom: 0;
                }

                /* Flashcard faces: same problem as .inline-quiz. Authored rich text
                   arrives wrapped in <p>, which would otherwise take the document's
                   paragraph colour — dark grey on the blue BACK face reads at about
                   2.3:1 — plus 1.5rem of dead space inside a card that has none to
                   spare. Inherit the face's own colour/size instead. */
                .document-with-mermaid .fc-face p,
                .document-with-mermaid .fc-face li {
                    margin: 0 0 0.35rem;
                    font-size: inherit;
                    color: inherit;
                    line-height: 1.5;
                }
                .document-with-mermaid .fc-face p:last-child,
                .document-with-mermaid .fc-face li:last-child {
                    margin-bottom: 0;
                }
                /* An empty trailing <p> (common in pasted content) would still take
                   up a line box. */
                .document-with-mermaid .fc-face p:empty {
                    display: none;
                }
                .document-with-mermaid .fc-face ul,
                .document-with-mermaid .fc-face ol {
                    margin: 0.25rem 0;
                    padding-left: 1.4rem;
                    text-align: left;
                }
                .document-with-mermaid .fc-face ul { list-style: disc outside; }
                .document-with-mermaid .fc-face ol { list-style: decimal outside; }
                .document-with-mermaid .inline-quiz ul {
                    list-style: disc outside;
                    margin: 0.25rem 0;
                    padding-left: 1.4rem;
                }
                .document-with-mermaid .inline-quiz ol {
                    list-style: decimal outside;
                    margin: 0.25rem 0;
                    padding-left: 1.4rem;
                }
                .document-with-mermaid .inline-quiz li {
                    display: list-item;
                    margin: 0.1rem 0;
                    padding-left: 0;
                    font-size: inherit;
                }
                .document-with-mermaid .inline-quiz li::before {
                    content: none;
                }
                .document-with-mermaid .inline-quiz img {
                    max-width: 100%;
                    height: auto;
                }

                /* Mobile responsiveness */
                @media (min-width: 640px) {
                    .document-with-mermaid h1 { font-size: 2.25rem; padding-bottom: 1rem; }
                    .document-with-mermaid h2 { font-size: 1.875rem; }
                    .document-with-mermaid h3 { font-size: 1.5rem; }
                }
            `}</style>

            {sections.map((section, index) => {
                if (section.type === 'mermaid') {
                    return (
                        <MermaidDiagram
                            key={`mermaid-${index}-${section.content.substring(0, 20)}`}
                            code={section.content}
                            className="my-4"
                        />
                    );
                } else if (section.type === 'math') {
                    const displayMode = section.meta?.displayMode !== 'false';
                    let mathHtml = '';
                    try {
                        mathHtml = katex.renderToString(section.content, {
                            displayMode,
                            throwOnError: false,
                            output: 'html',
                        });
                    } catch {
                        mathHtml = section.content;
                    }
                    return (
                        <div
                            key={`math-${index}`}
                            className="my-4"
                            style={{ textAlign: displayMode ? 'center' : 'left', padding: '16px 0' }}
                            dangerouslySetInnerHTML={{ __html: mathHtml }}
                        />
                    );
                } else if (section.type === 'quiz') {
                    return (
                        <InlineQuiz
                            key={`quiz-${index}`}
                            quizJson={section.content}
                            slideId={slideId}
                            elementIndex={index}
                        />
                    );
                } else if (section.type === 'flashcard') {
                    let data: { front: string; back: string; aspectRatio?: string } = { front: '', back: '', aspectRatio: 'original' };
                    try { data = JSON.parse(section.content); } catch { /* use empty */ }
                    return (
                        <InteractiveFlashcard
                            key={`flashcard-${index}`}
                            front={data.front}
                            back={data.back}
                            aspectRatio={data.aspectRatio}
                            slideId={slideId}
                            elementIndex={index}
                        />
                    );
                } else if (section.type === 'fillBlanks') {
                    return (
                        <InteractiveFillBlanks
                            key={`fillblanks-${index}`}
                            sentence={section.content}
                            slideId={slideId}
                            elementIndex={index}
                        />
                    );
                } else if (section.type === 'tabs') {
                    return (
                        <InteractiveTabs
                            key={`tabs-${index}`}
                            tabsJson={section.content}
                        />
                    );
                } else if (section.type === 'toc') {
                    let tocHeadingsParsed: Array<{ level: 1 | 2 | 3; text: string; anchor: number }> = [];
                    try { tocHeadingsParsed = JSON.parse(section.content); } catch { /* empty */ }
                    return (
                        <InteractiveToc
                            key={`toc-${index}`}
                            headings={tocHeadingsParsed}
                            containerRef={containerRef}
                            onNavigate={(anchor) => {
                                const el = containerRef.current?.querySelector(
                                    `[data-toc-anchor="${anchor}"]`
                                ) as HTMLElement | null;
                                if (!el) return;
                                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                // Brief flash on the target heading so the learner
                                // clearly sees where they landed after the scroll.
                                el.style.transition = 'background-color 0.3s ease';
                                el.style.backgroundColor = 'hsl(var(--primary-50))';
                                el.style.borderRadius = '0.375rem';
                                window.setTimeout(() => {
                                    el.style.backgroundColor = 'transparent';
                                }, 900);
                            }}
                        />
                    );
                } else if (section.type === 'pdfViewer') {
                    const pdfUrl = section.content;
                    const title = section.meta?.title || '';
                    return (
                        <div
                            key={`pdf-${index}`}
                            style={{
                                border: '1px solid #e0e0e0', // design-lint-ignore: PDF viewer UI chrome — style prop
                                borderRadius: '8px',
                                margin: '16px 0',
                                padding: '16px',
                                background: '#fafafa', // design-lint-ignore: PDF viewer UI chrome — style prop
                            }}
                        >
                            {title && (
                                <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px', color: '#333' }}> {/* design-lint-ignore: PDF viewer UI chrome — style prop */}
                                    {title}
                                </div>
                            )}
                            <div style={{ width: '100%', height: '600px', border: '1px solid #ddd', borderRadius: '4px', overflow: 'hidden', background: '#fff' }}> {/* design-lint-ignore: PDF viewer UI chrome — style prop */}
                                <SimplePDFViewer pdfUrl={pdfUrl} />
                            </div>
                            <div style={{ marginTop: '6px', fontSize: '12px' }}>
                                <a
                                    href={pdfUrl}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    style={{ color: '#3366cc' }} // design-lint-ignore: PDF viewer link color — style prop
                                >
                                    {t('documentViewer.pdfViewer.openInNewTab')}
                                </a>
                            </div>
                        </div>
                    );
                } else if (section.type === 'code') {
                    return (
                        <EnhancedCodeBlock
                            key={`code-${index}`}
                            code={section.content}
                            language={section.meta?.language || ''}
                            className="my-4"
                        />
                    );
                } else {
                    return (
                        <div
                            key={`html-${index}`}
                            className="html-section"
                            dangerouslySetInnerHTML={{ __html: section.content }}
                        />
                    );
                }
            })}
        </div>
    );
};

