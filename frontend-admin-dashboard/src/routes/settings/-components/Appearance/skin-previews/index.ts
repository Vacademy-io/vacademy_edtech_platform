import type { ComponentType } from 'react';
import type { StudentUiType } from '@/types/theme-role-settings';
import { CleanerPlayModel } from './CleanerPlayModel';
import { CorporateModel } from './CorporateModel';
import { DefaultModel } from './DefaultModel';
import { FunModel } from './FunModel';
import { PlayModel } from './PlayModel';
import { VibrantModel } from './VibrantModel';
import type { SkinModelProps } from './types';

/** A scale model of the learner app for every skin an admin can pick. */
export const SKIN_MODELS: Record<StudentUiType, ComponentType<SkinModelProps>> = {
    default: DefaultModel,
    vibrant: VibrantModel,
    play: PlayModel,
    cleanerPlay: CleanerPlayModel,
    corporate: CorporateModel,
    fun: FunModel,
};

/** The order the picker lists them in. */
export const SKIN_ORDER: ReadonlyArray<StudentUiType> = [
    'default',
    'vibrant',
    'play',
    'cleanerPlay',
    'corporate',
    'fun',
];

export { PhoneFrame } from './PhoneFrame';
export { brandPalette } from './palette';
export { MODEL_SCREENS, type ModelCopy, type ModelScreen } from './types';
