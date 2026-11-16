import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Plus, Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import type {
    BannerCarouselConfig,
    BannerSlide,
    CheckIssue,
} from '../../-types/learner-home-types';
import { emptySlide } from '../../-utils/block-factory';
import { LIMITS } from '../../-utils/publish-checks';
import { FieldIssues } from '../shared/FieldIssues';
import { ImageRefField } from '../shared/ImageRefField';
import { exact } from '../shared/issues';
import { LinkTargetPicker } from '../shared/LinkTargetPicker';
import { ScheduleEditor } from '../shared/ScheduleEditor';
import { SwitchField, TextField } from '../shared/fields';

export function BannerEditor({
    blockKey,
    config,
    onChange,
    issues,
}: {
    blockKey: string;
    config: BannerCarouselConfig;
    onChange: (next: BannerCarouselConfig) => void;
    issues: CheckIssue[];
}) {
    const { t } = useTranslation('learnerHome');
    const setSlide = (i: number, patch: Partial<BannerSlide>) =>
        onChange({
            ...config,
            slides: config.slides.map((s, j) => (j === i ? { ...s, ...patch } : s)),
        });
    const move = (i: number, to: number) => {
        const slides = [...config.slides];
        const [s] = slides.splice(i, 1);
        slides.splice(to, 0, s!);
        onChange({ ...config, slides });
    };
    return (
        <div className="space-y-4">
            <TextField
                id={`${blockKey}-title`}
                label={t('banner.title')}
                hint={t('banner.titleHint')}
                value={config.title}
                onChange={(title) => onChange({ ...config, title })}
                max={LIMITS.banner.title}
                issues={issues}
                path="config.title"
            />
            <SwitchField
                id={`${blockKey}-rotate`}
                label={t('banner.autoRotate')}
                hint={t('banner.autoRotateHint')}
                checked={config.auto_rotate}
                onChange={(auto_rotate) => onChange({ ...config, auto_rotate })}
            />
            <div className="space-y-3">
                <div className="flex items-baseline justify-between gap-2">
                    <h4 className="text-body font-semibold text-neutral-700">
                        {t('banner.slides')}
                    </h4>
                    <span className="text-caption text-neutral-500">{t('banner.maxSlides')}</span>
                </div>
                <FieldIssues issues={exact(issues, 'config.slides')} />
                <ol className="space-y-3">
                    {config.slides.map((slide, i) => {
                        const p = `config.slides[${i}]`;
                        const n = i + 1;
                        return (
                            <li
                                key={slide.key}
                                className="space-y-3 rounded-md border border-neutral-200 p-3"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-body font-semibold">
                                        {t('banner.slide', { n })}
                                    </span>
                                    <div className="flex items-center gap-1">
                                        <MyButton
                                            type="button"
                                            buttonType="text"
                                            layoutVariant="icon"
                                            scale="medium"
                                            aria-label={t('banner.moveUp', { n })}
                                            disabled={i === 0}
                                            onClick={() => move(i, i - 1)}
                                        >
                                            <ArrowUp className="size-4" />
                                        </MyButton>
                                        <MyButton
                                            type="button"
                                            buttonType="text"
                                            layoutVariant="icon"
                                            scale="medium"
                                            aria-label={t('banner.moveDown', { n })}
                                            disabled={i === config.slides.length - 1}
                                            onClick={() => move(i, i + 1)}
                                        >
                                            <ArrowDown className="size-4" />
                                        </MyButton>
                                        <MyButton
                                            type="button"
                                            buttonType="text"
                                            layoutVariant="icon"
                                            scale="medium"
                                            aria-label={t('banner.removeSlide', { n })}
                                            disabled={
                                                config.slides.length <= LIMITS.banner.slidesMin
                                            }
                                            onClick={() =>
                                                onChange({
                                                    ...config,
                                                    slides: config.slides.filter((_, j) => j !== i),
                                                })
                                            }
                                        >
                                            <Trash className="size-4" />
                                        </MyButton>
                                    </div>
                                </div>
                                <ImageRefField
                                    id={`${slide.key}-img`}
                                    label={t('banner.phoneImage')}
                                    slot="bannerPhone"
                                    value={slide.image}
                                    onChange={(image) => setSlide(i, { image })}
                                    issues={issues}
                                    path={`${p}.image`}
                                />
                                <ImageRefField
                                    id={`${slide.key}-dimg`}
                                    label={t('banner.desktopImage')}
                                    hint={t('banner.desktopImageHint')}
                                    slot="bannerDesktop"
                                    value={slide.desktop_image}
                                    onChange={(desktop_image) => setSlide(i, { desktop_image })}
                                    issues={issues}
                                    path={`${p}.desktop_image`}
                                />
                                <LinkTargetPicker
                                    id={`${slide.key}-link`}
                                    label={t('banner.link')}
                                    value={slide.link}
                                    onChange={(link) => setSlide(i, { link })}
                                    issues={issues}
                                    path={`${p}.link`}
                                />
                                <div className="space-y-1">
                                    <p className="text-body font-semibold text-neutral-700">
                                        {t('banner.schedule')}
                                    </p>
                                    <ScheduleEditor
                                        id={`${slide.key}-when`}
                                        startsAt={slide.starts_at}
                                        endsAt={slide.ends_at}
                                        onChange={(w) => setSlide(i, w)}
                                        issues={issues}
                                        pathPrefix={`${p}.`}
                                        compact
                                    />
                                </div>
                            </li>
                        );
                    })}
                </ol>
                {config.slides.length < LIMITS.banner.slidesMax && (
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        onClick={() =>
                            onChange({ ...config, slides: [...config.slides, emptySlide()] })
                        }
                    >
                        <Plus className="me-1 size-3.5" aria-hidden />
                        {t('banner.addSlide')}
                    </MyButton>
                )}
            </div>
        </div>
    );
}
