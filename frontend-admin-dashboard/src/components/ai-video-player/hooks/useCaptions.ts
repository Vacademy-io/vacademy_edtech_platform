/**
 * useCaptions Hook
 * Fetches word timestamps and computes current caption based on playback time
 * Uses sentence-based chunking for stable, easy-to-read captions
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { WordTimestamp, CaptionSettings, DEFAULT_CAPTION_SETTINGS } from '../types';

interface UseCaptionsProps {
    wordsUrl?: string;
    currentTime: number;
    audioStartAt?: number; // Offset for when audio starts in timeline
    playbackRate?: number; // Current playback speed (scales caption tail duration)
    /**
     * The timeline reserves a caption band (lesson "board" layouts). Captions
     * are then on unless the viewer turned them off on such a video — kept
     * apart from the general setting, which defaults to off and would leave
     * the band empty.
     */
    lessonBand?: boolean;
}

const LESSON_CAPTIONS_KEY = 'ai-player-lesson-captions';

function readLessonCaptionsOff(): boolean {
    try {
        return localStorage.getItem(LESSON_CAPTIONS_KEY) === 'off';
    } catch {
        return false;
    }
}

interface CaptionPhrase {
    words: WordTimestamp[];
    text: string;
    startTime: number;
    endTime: number;
}

interface UseCaptionsReturn {
    // Caption data
    words: WordTimestamp[];
    isLoading: boolean;
    error: string | null;

    // Current caption state - now returns a stable phrase
    currentPhrase: CaptionPhrase | null;
    currentWordIndex: number; // For karaoke highlighting

    // Settings
    settings: CaptionSettings;
    updateSettings: (updates: Partial<CaptionSettings>) => void;
    toggleCaptions: () => void;

    // Legacy compatibility
    currentWords: WordTimestamp[];
}

// Target words per phrase (like YouTube - around 8-12 words per line)
const WORDS_PER_PHRASE = 10;
// Minimum phrase duration in seconds
const MIN_PHRASE_DURATION = 2.0;
// Maximum phrase duration in seconds
const MAX_PHRASE_DURATION = 5.0;

/**
 * Split words into stable phrases based on timing and natural breaks
 */
function buildPhrases(words: WordTimestamp[]): CaptionPhrase[] {
    if (words.length === 0) return [];

    const phrases: CaptionPhrase[] = [];
    let currentPhraseWords: WordTimestamp[] = [];
    let phraseStartTime = 0;

    for (let i = 0; i < words.length; i++) {
        const word = words[i]!;

        // Start a new phrase
        if (currentPhraseWords.length === 0) {
            phraseStartTime = word.start;
        }

        currentPhraseWords.push(word);

        const phraseDuration = word.end - phraseStartTime;
        const wordCount = currentPhraseWords.length;

        // Determine if we should end this phrase
        const shouldBreak =
            // Natural sentence break (ends with punctuation)
            /[.!?]$/.test(word.word.trim()) ||
            // Maximum words reached
            wordCount >= WORDS_PER_PHRASE ||
            // Maximum duration exceeded
            phraseDuration >= MAX_PHRASE_DURATION ||
            // Comma with enough words and time
            (/[,;:]$/.test(word.word.trim()) &&
                wordCount >= 5 &&
                phraseDuration >= MIN_PHRASE_DURATION) ||
            // Long pause between this word and next (natural break)
            (i < words.length - 1 && words[i + 1]!.start - word.end > 0.5);

        if (shouldBreak || i === words.length - 1) {
            // Create phrase
            phrases.push({
                words: [...currentPhraseWords],
                text: currentPhraseWords.map((w) => w.word).join(' '),
                startTime: phraseStartTime,
                endTime: word.end,
            });
            currentPhraseWords = [];
        }
    }

    return phrases;
}

export function useCaptions({
    wordsUrl,
    currentTime,
    audioStartAt = 0,
    playbackRate = 1,
    lessonBand = false,
}: UseCaptionsProps): UseCaptionsReturn {
    const [words, setWords] = useState<WordTimestamp[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [settings, setSettings] = useState<CaptionSettings>(() => {
        // Try to load from localStorage
        try {
            const saved = localStorage.getItem('ai-player-caption-settings');
            if (saved) {
                return { ...DEFAULT_CAPTION_SETTINGS, ...JSON.parse(saved) };
            }
        } catch {
            // Ignore parse errors
        }
        return DEFAULT_CAPTION_SETTINGS;
    });

    const [lessonCaptionsOff, setLessonCaptionsOff] = useState<boolean>(readLessonCaptionsOff);
    const setLessonCaptions = useCallback((on: boolean) => {
        setLessonCaptionsOff(!on);
        try {
            localStorage.setItem(LESSON_CAPTIONS_KEY, on ? 'on' : 'off');
        } catch {
            // Ignore storage errors
        }
    }, []);
    const enabled = lessonBand ? !lessonCaptionsOff : settings.enabled;

    // Precomputed phrases for stable display
    const phrasesRef = useRef<CaptionPhrase[]>([]);

    // Calculate audio-relative time (since words are timed relative to audio start)
    const audioTime = useMemo(() => {
        return Math.max(0, currentTime - audioStartAt);
    }, [currentTime, audioStartAt]);

    // Fetch words from URL
    useEffect(() => {
        if (!wordsUrl) {
            setWords([]);
            phrasesRef.current = [];
            return;
        }

        const fetchWords = async () => {
            try {
                setIsLoading(true);
                setError(null);

                const response = await fetch(wordsUrl);
                if (!response.ok) {
                    throw new Error(`Failed to load captions: ${response.status}`);
                }

                const data = await response.json();

                // Validate structure
                if (!Array.isArray(data)) {
                    throw new Error('Invalid caption data format');
                }

                // Validate and clean words
                const validWords: WordTimestamp[] = data
                    .filter(
                        (w: unknown) =>
                            w && typeof w === 'object' && 'word' in w && 'start' in w && 'end' in w
                    )
                    .map((w: { word: string; start: number; end: number }) => ({
                        word: String(w.word),
                        start: Number(w.start),
                        end: Number(w.end),
                    }));

                setWords(validWords);

                // Pre-compute stable phrases
                phrasesRef.current = buildPhrases(validWords);
                console.log(
                    `🎤 Loaded ${validWords.length} words, created ${phrasesRef.current.length} phrases`
                );
            } catch (err) {
                console.error('Error loading captions:', err);
                setError(err instanceof Error ? err.message : 'Failed to load captions');
                setWords([]);
                phrasesRef.current = [];
            } finally {
                setIsLoading(false);
            }
        };

        fetchWords();
    }, [wordsUrl]);

    // Save settings to localStorage when they change
    useEffect(() => {
        try {
            localStorage.setItem('ai-player-caption-settings', JSON.stringify(settings));
        } catch {
            // Ignore storage errors
        }
    }, [settings]);

    // Find current phrase (stable - doesn't change until phrase ends)
    const currentPhrase = useMemo((): CaptionPhrase | null => {
        if (!enabled || phrasesRef.current.length === 0) return null;

        // Scale caption tail inversely with playback speed so captions
        // linger proportionally at high speeds.
        // At 1x: 0.3s tail / 0.1s lead (unchanged). At 2x: 0.6s. At 0.5x: 0.15s.
        const rate = Math.max(0.5, playbackRate);
        const scaledTail = 0.3 * rate;
        const scaledLead = 0.1 * rate;

        // Find the phrase that contains current time
        for (const phrase of phrasesRef.current) {
            if (audioTime >= phrase.startTime - scaledLead && audioTime <= phrase.endTime + scaledTail) {
                return phrase;
            }
        }

        return null;
    }, [audioTime, enabled, playbackRate]);

    // Find current word index within the phrase (for karaoke mode)
    const currentWordIndex = useMemo(() => {
        if (!currentPhrase) return -1;

        for (let i = 0; i < currentPhrase.words.length; i++) {
            const word = currentPhrase.words[i]!;
            if (audioTime >= word.start && audioTime < word.end) {
                return i;
            }
        }

        // If between words, check if we're close to a word
        for (let i = 0; i < currentPhrase.words.length; i++) {
            const word = currentPhrase.words[i]!;
            if (audioTime < word.start && audioTime >= word.start - 0.1) {
                return i;
            }
        }

        return -1;
    }, [currentPhrase, audioTime]);

    // Update settings
    const updateSettings = useCallback(
        (updates: Partial<CaptionSettings>) => {
            if (lessonBand && updates.enabled !== undefined) {
                const { enabled: on, ...rest } = updates;
                setLessonCaptions(on);
                setSettings((prev) => ({ ...prev, ...rest }));
                return;
            }
            setSettings((prev) => ({ ...prev, ...updates }));
        },
        [lessonBand, setLessonCaptions]
    );

    // Toggle captions on/off
    const toggleCaptions = useCallback(() => {
        if (lessonBand) {
            setLessonCaptions(lessonCaptionsOff);
            return;
        }
        setSettings((prev) => ({ ...prev, enabled: !prev.enabled }));
    }, [lessonBand, lessonCaptionsOff, setLessonCaptions]);

    const effectiveSettings = useMemo(
        () => (enabled === settings.enabled ? settings : { ...settings, enabled }),
        [settings, enabled]
    );

    return {
        words,
        isLoading,
        error,
        currentPhrase,
        currentWordIndex,
        settings: effectiveSettings,
        updateSettings,
        toggleCaptions,
        // Legacy compatibility - return words from current phrase
        currentWords: currentPhrase?.words || [],
    };
}

export default useCaptions;
