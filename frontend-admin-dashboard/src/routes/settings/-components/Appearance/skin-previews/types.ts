import type { BrandPalette } from './palette';

/** The learner screens each skin model can draw. */
export type ModelScreen = 'home' | 'lesson' | 'result';

export const MODEL_SCREENS: ReadonlyArray<ModelScreen> = ['home', 'lesson', 'result'];

/**
 * The few words a model shows. Everything else in a model is a placeholder
 * bar or shape, so the only copy is the greeting and one button label per
 * screen, translated by the caller.
 */
export interface ModelCopy {
    /** "Good morning" on its own (Fun puts the name on the next line). */
    greeting: string;
    /** "Good morning, Asha". */
    greetingName: string;
    /** The sample learner's name. */
    name: string;
    continueLabel: string;
    nextLabel: string;
    passed: string;
}

export interface SkinModelProps {
    screen: ModelScreen;
    brand: BrandPalette;
    copy: ModelCopy;
}
