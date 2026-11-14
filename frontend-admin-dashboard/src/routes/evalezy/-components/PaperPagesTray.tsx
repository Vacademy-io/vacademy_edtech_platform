import { useTranslation } from 'react-i18next';
import { CaretLeft, CaretRight, Camera, ImageSquare, Check, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { movePage, type ScanPage } from '../-lib/scan-pdf';

/**
 * The photos of the question paper before they become its PDF: numbered, so a wrong
 * order shows, with arrows to fix it. A gallery does not always hand photos back in
 * the order they were tapped, and the read numbers the questions from this order.
 */
export const PaperPagesTray = ({
    pages,
    maxPages,
    allowCamera,
    onChange,
    onTakeMore,
    onPickMore,
    onConfirm,
}: {
    pages: ScanPage[];
    maxPages: number;
    allowCamera: boolean;
    onChange: (pages: ScanPage[]) => void;
    onTakeMore: () => void;
    onPickMore: () => void;
    onConfirm: () => void;
}) => {
    const { t } = useTranslation('evalezy');
    const tooMany = pages.length > maxPages;

    const remove = (page: ScanPage) => {
        URL.revokeObjectURL(page.url);
        onChange(pages.filter((p) => p.id !== page.id));
    };

    return (
        <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-3">
            <div className="flex flex-col gap-1">
                <p className="text-body font-medium text-neutral-800">
                    {t('create.pagesTitle', { count: pages.length })}
                </p>
                <p className="text-caption text-neutral-500">{t('create.pagesHint')}</p>
            </div>

            <ol className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {pages.map((page, index) => (
                    <li key={page.id} className="flex flex-col gap-1">
                        <div className="relative">
                            <img
                                src={page.url}
                                alt={t('scanner.pageAlt', { number: index + 1 })}
                                className="h-28 w-full rounded-md border border-neutral-200 object-cover"
                            />
                            <span className="absolute left-1 top-1 flex size-6 items-center justify-center rounded-full bg-primary-500 text-caption font-semibold text-white">
                                {index + 1}
                            </span>
                            <button
                                type="button"
                                aria-label={t('scanner.removePage', { number: index + 1 })}
                                onClick={() => remove(page)}
                                className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-danger-600 text-white"
                            >
                                <X size={12} weight="bold" />
                            </button>
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                className="h-8 w-full min-w-0 px-0"
                                aria-label={t('create.movePageEarlier', { number: index + 1 })}
                                disabled={index === 0}
                                onClick={() => onChange(movePage(pages, index, -1))}
                            >
                                <CaretLeft size={14} />
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                className="h-8 w-full min-w-0 px-0"
                                aria-label={t('create.movePageLater', { number: index + 1 })}
                                disabled={index === pages.length - 1}
                                onClick={() => onChange(movePage(pages, index, 1))}
                            >
                                <CaretRight size={14} />
                            </MyButton>
                        </div>
                    </li>
                ))}
            </ol>

            {tooMany && (
                <p className="text-caption text-danger-700">
                    {t('create.tooManyPages', { max: maxPages })}
                </p>
            )}

            <div className="grid grid-cols-2 gap-2">
                {allowCamera && (
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        className="h-9 w-full"
                        onClick={onTakeMore}
                    >
                        <Camera size={16} />
                        {t('create.takeMore')}
                    </MyButton>
                )}
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    className={allowCamera ? 'h-9 w-full' : 'col-span-2 h-9 w-full'}
                    onClick={onPickMore}
                >
                    <ImageSquare size={16} />
                    {t('create.pickMore')}
                </MyButton>
            </div>
            <MyButton
                type="button"
                buttonType="primary"
                scale="medium"
                className="w-full"
                disabled={tooMany}
                onClick={onConfirm}
            >
                <Check size={16} weight="bold" />
                {t('create.usePages', { count: pages.length })}
            </MyButton>
        </div>
    );
};
