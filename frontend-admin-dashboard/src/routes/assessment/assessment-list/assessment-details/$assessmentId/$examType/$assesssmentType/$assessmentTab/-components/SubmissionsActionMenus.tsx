import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
    CaretDown,
    ChartBar,
    Export,
    FileCsv,
    FileZip,
    ListChecks,
    Sparkle,
    UploadSimple,
    UserFocus,
} from '@phosphor-icons/react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';

/**
 * One menu row: icon chip, a plain-words title and one line on what it does. The old
 * toolbar showed these as separate buttons with near-identical names ("Check submitted
 * copies", "Upload & check copies", "Bulk checks", "AI Evaluations"), and admins could
 * not tell which one to press — the description is what removes that guess.
 */
const MenuRow = ({
    icon,
    title,
    description,
    tone = 'primary',
    onSelect,
}: {
    icon: ReactNode;
    title: string;
    description: string;
    tone?: 'primary' | 'info' | 'success' | 'neutral';
    onSelect: () => void;
}) => (
    <DropdownMenuItem
        className="cursor-pointer items-start gap-3 rounded-md px-2.5 py-2"
        onClick={onSelect}
    >
        <span
            className={cn(
                'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg',
                tone === 'primary' && 'bg-primary-50 text-primary-500',
                tone === 'info' && 'bg-info-50 text-info-600',
                tone === 'success' && 'bg-success-50 text-success-600',
                tone === 'neutral' && 'bg-neutral-100 text-neutral-600'
            )}
        >
            {icon}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-body font-semibold text-neutral-700">{title}</span>
            <span className="text-caption text-neutral-500">{description}</span>
        </span>
    </DropdownMenuItem>
);

const SectionLabel = ({ children }: { children: ReactNode }) => (
    // The size sits on an inner span: DropdownMenuLabel merges className with cn(), and
    // tailwind-merge reads the custom text-2xs as a colour and drops it.
    <DropdownMenuLabel className="px-2.5 pb-1 pt-2">
        <span className="text-2xs font-semibold uppercase tracking-wide text-neutral-400">
            {children}
        </span>
    </DropdownMenuLabel>
);

interface AiCheckMenuProps {
    onCheckSubmitted: () => void;
    onUploadCopies: () => void;
    onToggleProgress: () => void;
    isProgressOpen: boolean;
    onOpenResults: () => void;
}

/** Everything AI copy checking does, behind one button, grouped as start → track. */
export const AiCheckMenu = ({
    onCheckSubmitted,
    onUploadCopies,
    onToggleProgress,
    isProgressOpen,
    onOpenResults,
}: AiCheckMenuProps) => {
    const { t } = useTranslation('assessmentSubmissionsTab');
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <MyButton
                    type="button"
                    scale="small"
                    buttonType="secondary"
                    className="!h-9 gap-1.5 border-primary-200 bg-primary-50 px-3 font-semibold !text-primary-500"
                >
                    <Sparkle size={16} weight="fill" />
                    {t('actionMenus.ai.trigger')}
                    <CaretDown size={14} />
                </MyButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-80 p-1.5">
                <SectionLabel>{t('actionMenus.ai.startSection')}</SectionLabel>
                <MenuRow
                    icon={<UserFocus size={18} />}
                    title={t('actionMenus.ai.checkSubmitted.title')}
                    description={t('actionMenus.ai.checkSubmitted.description')}
                    onSelect={onCheckSubmitted}
                />
                <MenuRow
                    icon={<UploadSimple size={18} />}
                    title={t('actionMenus.ai.upload.title')}
                    description={t('actionMenus.ai.upload.description')}
                    onSelect={onUploadCopies}
                />
                <DropdownMenuSeparator className="my-1.5" />
                <SectionLabel>{t('actionMenus.ai.trackSection')}</SectionLabel>
                <MenuRow
                    icon={<ListChecks size={18} />}
                    tone="info"
                    title={
                        isProgressOpen
                            ? t('actionMenus.ai.progress.hideTitle')
                            : t('actionMenus.ai.progress.title')
                    }
                    description={t('actionMenus.ai.progress.description')}
                    onSelect={onToggleProgress}
                />
                <MenuRow
                    icon={<Sparkle size={18} weight="fill" />}
                    tone="success"
                    title={t('actionMenus.ai.results.title')}
                    description={t('actionMenus.ai.results.description')}
                    onSelect={onOpenResults}
                />
            </DropdownMenuContent>
        </DropdownMenu>
    );
};

interface ExportMenuProps {
    onExportCsv: () => void;
    onExportZip: () => void;
    onAiReport: () => void;
    /** Pending tab: the CSV is the "never attempted" list, not a results sheet. */
    isPendingList?: boolean;
    /** Pending learners have no attempt, so there is no report card to export. */
    showReportCards?: boolean;
}

/** The three downloads, which used to be three more buttons on the filter row. */
export const ExportMenu = ({
    onExportCsv,
    onExportZip,
    onAiReport,
    isPendingList = false,
    showReportCards = true,
}: ExportMenuProps) => {
    const { t } = useTranslation('assessmentSubmissionsTab');
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <MyButton
                    type="button"
                    scale="small"
                    buttonType="secondary"
                    className="!h-9 gap-1.5 px-3 font-medium"
                >
                    <Export size={16} />
                    {t('actionMenus.export.trigger')}
                    <CaretDown size={14} />
                </MyButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 p-1.5">
                <MenuRow
                    icon={<FileCsv size={18} />}
                    tone="neutral"
                    title={
                        isPendingList
                            ? t('actionMenus.export.csvPending.title')
                            : t('actionMenus.export.csv.title')
                    }
                    description={
                        isPendingList
                            ? t('actionMenus.export.csvPending.description')
                            : t('actionMenus.export.csv.description')
                    }
                    onSelect={onExportCsv}
                />
                {showReportCards && (
                    <MenuRow
                        icon={<FileZip size={18} />}
                        tone="neutral"
                        title={t('actionMenus.export.zip.title')}
                        description={t('actionMenus.export.zip.description')}
                        onSelect={onExportZip}
                    />
                )}
                <MenuRow
                    icon={<ChartBar size={18} weight="fill" />}
                    title={t('actionMenus.export.aiReport.title')}
                    description={t('actionMenus.export.aiReport.description')}
                    onSelect={onAiReport}
                />
            </DropdownMenuContent>
        </DropdownMenu>
    );
};
