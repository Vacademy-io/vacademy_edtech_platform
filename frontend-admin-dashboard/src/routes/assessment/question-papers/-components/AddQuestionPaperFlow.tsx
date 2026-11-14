import { Dispatch, ReactNode, SetStateAction, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CaretRight, Info, PencilSimpleLine, Sparkle, UploadSimple } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { GenerateWithAiDialog } from './GenerateWithAiDialog';
import { UploadQuestionPaperDialog } from './UploadQuestionPaperDialog';
import { CreateQuestionPaperDialog } from './CreateQuestionPaperDialog';
import { AddPaperWay, useAddPaperFlowStore } from '../-global-states/add-paper-flow-store';

interface WayOptionProps {
    icon: ReactNode;
    iconClassName: string;
    title: string;
    badge?: string;
    description: string;
    tags: string[];
    highlighted?: boolean;
    onClick: () => void;
}

/** One of the three ways to add a paper, shown as a selectable card. */
export const WayOption = ({
    icon,
    iconClassName,
    title,
    badge,
    description,
    tags,
    highlighted,
    onClick,
}: WayOptionProps) => (
    <button
        type="button"
        onClick={onClick}
        className={cn(
            'group flex w-full items-center gap-4 rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
            highlighted
                ? 'border-primary-200 bg-primary-50 hover:border-primary-400'
                : 'border-neutral-200 bg-white hover:border-primary-300 hover:bg-primary-50'
        )}
    >
        <span
            className={cn(
                'flex size-12 shrink-0 items-center justify-center rounded-lg',
                iconClassName
            )}
        >
            {icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex items-center gap-2 text-subtitle font-semibold text-neutral-700">
                {title}
                {badge && (
                    <Badge
                        variant="outline"
                        className="border-primary-200 bg-white text-2xs text-primary-500"
                    >
                        {badge}
                    </Badge>
                )}
            </span>
            <span className="text-caption text-neutral-600">{description}</span>
            <span className="mt-1 flex flex-wrap gap-2">
                {tags.map((tag) => (
                    <span
                        key={tag}
                        className="rounded-sm bg-neutral-100 px-2 py-0.5 text-2xs font-semibold text-neutral-600"
                    >
                        {tag}
                    </span>
                ))}
            </span>
        </span>
        <CaretRight size={18} className="shrink-0 text-neutral-400 group-hover:text-primary-500" />
    </button>
);

/** The three options, in the order and wording used by the chooser and the empty state. */
export const useAddPaperWays = () => {
    const { t } = useTranslation('assessmentQuestionPapersPage');
    return (onPick: (way: AddPaperWay) => void) => [
        <WayOption
            key="ai"
            highlighted
            icon={<Sparkle size={24} />}
            iconClassName="bg-white text-primary-500"
            title={t('chooser.ai.title')}
            badge={t('chooser.ai.badge')}
            description={t('chooser.ai.description')}
            tags={[t('chooser.ai.tag1'), t('chooser.ai.tag2'), t('chooser.ai.tag3')]}
            onClick={() => onPick('ai')}
        />,
        <WayOption
            key="upload"
            icon={<UploadSimple size={24} />}
            iconClassName="bg-info-50 text-info-600"
            title={t('chooser.upload.title')}
            description={t('chooser.upload.description')}
            tags={[t('chooser.upload.tag1'), t('chooser.upload.tag2'), t('chooser.upload.tag3')]}
            onClick={() => onPick('upload')}
        />,
        <WayOption
            key="manual"
            icon={<PencilSimpleLine size={24} />}
            iconClassName="bg-primary-50 text-primary-500"
            title={t('chooser.manual.title')}
            description={t('chooser.manual.description')}
            tags={[t('chooser.manual.tag1'), t('chooser.manual.tag2')]}
            onClick={() => onPick('manual')}
        />,
    ];
};

interface AddQuestionPaperFlowProps {
    currentQuestionIndex: number;
    setCurrentQuestionIndex: Dispatch<SetStateAction<number>>;
}

/**
 * "Add question paper": a chooser with the three ways, each opening its own flow.
 * Generate with AI reuses the existing dialog and wizard unchanged.
 */
export const AddQuestionPaperFlow = ({
    currentQuestionIndex,
    setCurrentQuestionIndex,
}: AddQuestionPaperFlowProps) => {
    const { t } = useTranslation('assessmentQuestionPapersPage');
    const ways = useAddPaperWays();
    const { chooserOpen, way, setChooserOpen, pickWay, closeWay, backToChooser } =
        useAddPaperFlowStore();
    // The store outlives the page: close everything when leaving it, so nothing
    // re-opens on the next visit.
    useEffect(
        () => () => {
            setChooserOpen(false);
            closeWay();
        },
        [setChooserOpen, closeWay]
    );
    const onWayOpenChange = (open: boolean) => {
        if (!open) closeWay();
    };

    return (
        <>
            <MyDialog
                heading={t('chooser.heading')}
                open={chooserOpen}
                onOpenChange={setChooserOpen}
                dialogWidth="max-w-2xl"
            >
                <div className="flex flex-col gap-3">
                    <p className="text-body text-neutral-600">{t('chooser.subtitle')}</p>
                    {ways(pickWay)}
                    <p className="flex items-center gap-2 text-caption text-neutral-500">
                        <Info size={16} className="shrink-0" />
                        {t('chooser.footnote')}
                    </p>
                </div>
            </MyDialog>
            <GenerateWithAiDialog open={way === 'ai'} onOpenChange={onWayOpenChange} />
            <UploadQuestionPaperDialog
                open={way === 'upload'}
                onOpenChange={onWayOpenChange}
                onBack={backToChooser}
                currentQuestionIndex={currentQuestionIndex}
                setCurrentQuestionIndex={setCurrentQuestionIndex}
            />
            <CreateQuestionPaperDialog
                open={way === 'manual'}
                onOpenChange={onWayOpenChange}
                onBack={backToChooser}
                currentQuestionIndex={currentQuestionIndex}
                setCurrentQuestionIndex={setCurrentQuestionIndex}
            />
        </>
    );
};
