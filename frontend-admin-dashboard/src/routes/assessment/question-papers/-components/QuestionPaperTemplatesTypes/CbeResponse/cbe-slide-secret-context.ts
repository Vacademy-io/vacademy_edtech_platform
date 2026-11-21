import { createContext, useContext } from 'react';

/**
 * Present only when the CBE editor edits an LMS question slide, whose solution,
 * marking scheme and grading notes are stored apart from the question
 * (`question_slide.evaluation_secret_json`) and loaded by the slide editor.
 * `retry` reloads that secret after a failed load.
 */
export type CbeSlideSecretContextValue = { retry: () => void };

export const CbeSlideSecretContext = createContext<CbeSlideSecretContextValue | null>(null);

export const useCbeSlideSecret = () => useContext(CbeSlideSecretContext);
