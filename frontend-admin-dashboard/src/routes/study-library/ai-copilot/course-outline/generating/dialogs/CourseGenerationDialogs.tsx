import React from 'react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { TagInput } from '@/components/ui/tag-input';
import {
    FileText,
    Video,
    Code,
    FileQuestion,
    ClipboardList,
    File,
    ImageIcon,
    Notebook,
    Puzzle,
    AlertTriangle,
} from 'lucide-react';
import { SlideType, SessionProgress } from '../../../shared/types';
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface RegenerateSlideDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    prompt: string;
    onPromptChange: (prompt: string) => void;
    onConfirm: () => void;
    promptRef: React.RefObject<HTMLTextAreaElement>;
}

export function RegenerateSlideDialog({
    open,
    onOpenChange,
    prompt,
    onPromptChange,
    onConfirm,
    promptRef,
}: RegenerateSlideDialogProps) {
    const { t } = useTranslation('studyLibraryCourseGenerationDialogs');
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90vh] w-[95vw] max-w-[95vw] flex-col p-0 sm:w-[80vw] sm:max-w-[80vw]">
                <DialogHeader className="shrink-0 border-b px-6 pb-4 pt-6">
                    <DialogTitle>{t('regenerateSlideDialog.title')}</DialogTitle>
                </DialogHeader>
                <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <div>
                        <Textarea
                            ref={promptRef}
                            value={prompt}
                            onChange={(e) => onPromptChange(e.target.value)}
                            placeholder={t('regenerateSlideDialog.promptPlaceholder')}
                            className="min-h-[150px] text-sm"
                        />
                    </div>
                </div>
                <div className="flex shrink-0 justify-end border-t px-6 py-4">
                    <MyButton buttonType="primary" onClick={onConfirm} disabled={!prompt.trim()}>
                        {t('regenerateSlideDialog.regenerate')}
                    </MyButton>
                </div>
            </DialogContent>
        </Dialog>
    );
}

interface RegenerateSessionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    sessionId: string | null;
    sessions: SessionProgress[];
    prompt: string;
    onPromptChange: (prompt: string) => void;
    sessionLength: string;
    onSessionLengthChange: (length: string) => void;
    customSessionLength: string;
    onCustomSessionLengthChange: (length: string) => void;
    includeDiagrams: boolean;
    onIncludeDiagramsChange: (include: boolean) => void;
    includeCodeSnippets: boolean;
    onIncludeCodeSnippetsChange: (include: boolean) => void;
    includePracticeProblems: boolean;
    onIncludePracticeProblemsChange: (include: boolean) => void;
    includeQuizzes: boolean;
    onIncludeQuizzesChange: (include: boolean) => void;
    includeHomework: boolean;
    onIncludeHomeworkChange: (include: boolean) => void;
    includeSolutions: boolean;
    onIncludeSolutionsChange: (include: boolean) => void;
    numberOfTopics: string;
    onNumberOfTopicsChange: (num: string) => void;
    topics: string[];
    onTopicsChange: (topics: string[]) => void;
    onConfirm: () => void;
    promptRef: React.RefObject<HTMLTextAreaElement>;
}

export function RegenerateSessionDialog({
    open,
    onOpenChange,
    sessionId,
    sessions,
    prompt,
    onPromptChange,
    sessionLength,
    onSessionLengthChange,
    customSessionLength,
    onCustomSessionLengthChange,
    includeDiagrams,
    onIncludeDiagramsChange,
    includeCodeSnippets,
    onIncludeCodeSnippetsChange,
    includePracticeProblems,
    onIncludePracticeProblemsChange,
    includeQuizzes,
    onIncludeQuizzesChange,
    includeHomework,
    onIncludeHomeworkChange,
    includeSolutions,
    onIncludeSolutionsChange,
    numberOfTopics,
    onNumberOfTopicsChange,
    topics,
    onTopicsChange,
    onConfirm,
    promptRef,
}: RegenerateSessionDialogProps) {
    const { t } = useTranslation('studyLibraryCourseGenerationDialogs');
    const session = sessions.find((s) => s.sessionId === sessionId);
    const chapterTerm = getTerminology(ContentTerms.Chapters, SystemTerms.Chapters);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90vh] w-[95vw] max-w-[95vw] flex-col p-0 sm:w-[80vw] sm:max-w-[80vw]">
                <DialogHeader className="shrink-0 border-b px-6 pb-4 pt-6">
                    <DialogTitle>
                        {`${t('regenerateSessionDialog.title', { term: chapterTerm })}${session ? `: ${session.sessionTitle}` : ''}`}
                    </DialogTitle>
                </DialogHeader>
                <div className="flex-1 space-y-6 overflow-y-auto px-6 py-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <div>
                        <Label className="mb-2 block">
                            {t('regenerateSessionDialog.promptLabel')}
                        </Label>
                        <Textarea
                            ref={promptRef}
                            value={prompt}
                            onChange={(e) => onPromptChange(e.target.value)}
                            placeholder={t('regenerateSessionDialog.promptPlaceholder')}
                            className="min-h-[150px] text-sm"
                        />
                    </div>

                    <div>
                        <Label htmlFor="regenerateSessionLength" className="mb-2 block">
                            {t('regenerateSessionDialog.lengthLabel', { term: chapterTerm })}
                        </Label>
                        <div className="space-y-2">
                            <Select value={sessionLength} onValueChange={onSessionLengthChange}>
                                <SelectTrigger id="regenerateSessionLength" className="w-full">
                                    <SelectValue
                                        placeholder={t('regenerateSessionDialog.lengthPlaceholder')}
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="45">
                                        {t('regenerateSessionDialog.length45')}
                                    </SelectItem>
                                    <SelectItem value="60">
                                        {t('regenerateSessionDialog.length60')}
                                    </SelectItem>
                                    <SelectItem value="90">
                                        {t('regenerateSessionDialog.length90')}
                                    </SelectItem>
                                    <SelectItem value="custom">
                                        {t('regenerateSessionDialog.lengthCustom')}
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                            {sessionLength === 'custom' && (
                                <Input
                                    type="number"
                                    min="1"
                                    value={customSessionLength}
                                    onChange={(e) => onCustomSessionLengthChange(e.target.value)}
                                    placeholder={t(
                                        'regenerateSessionDialog.customLengthPlaceholder'
                                    )}
                                    className="w-full"
                                />
                            )}
                        </div>
                    </div>

                    <div>
                        <Label className="mb-2 block">
                            {t('regenerateSessionDialog.componentsLabel')}
                        </Label>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            <div className="flex items-center space-x-2">
                                <Checkbox
                                    id="regenerateIncludeDiagrams"
                                    checked={includeDiagrams}
                                    onCheckedChange={(checked) =>
                                        onIncludeDiagramsChange(checked === true)
                                    }
                                />
                                <Label
                                    htmlFor="regenerateIncludeDiagrams"
                                    className="cursor-pointer"
                                >
                                    {t('regenerateSessionDialog.includeDiagrams')}
                                </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <Checkbox
                                    id="regenerateIncludeCodeSnippets"
                                    checked={includeCodeSnippets}
                                    onCheckedChange={(checked) =>
                                        onIncludeCodeSnippetsChange(checked === true)
                                    }
                                />
                                <Label
                                    htmlFor="regenerateIncludeCodeSnippets"
                                    className="cursor-pointer"
                                >
                                    {t('regenerateSessionDialog.includeCodeSnippets')}
                                </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <Checkbox
                                    id="regenerateIncludePracticeProblems"
                                    checked={includePracticeProblems}
                                    onCheckedChange={(checked) =>
                                        onIncludePracticeProblemsChange(checked === true)
                                    }
                                />
                                <Label
                                    htmlFor="regenerateIncludePracticeProblems"
                                    className="cursor-pointer"
                                >
                                    {t('regenerateSessionDialog.includePracticeProblems')}
                                </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <Checkbox
                                    id="regenerateIncludeQuizzes"
                                    checked={includeQuizzes}
                                    onCheckedChange={(checked) =>
                                        onIncludeQuizzesChange(checked === true)
                                    }
                                />
                                <Label
                                    htmlFor="regenerateIncludeQuizzes"
                                    className="cursor-pointer"
                                >
                                    {t('regenerateSessionDialog.includeQuizzes')}
                                </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <Checkbox
                                    id="regenerateIncludeHomework"
                                    checked={includeHomework}
                                    onCheckedChange={(checked) =>
                                        onIncludeHomeworkChange(checked === true)
                                    }
                                />
                                <Label
                                    htmlFor="regenerateIncludeHomework"
                                    className="cursor-pointer"
                                >
                                    {t('regenerateSessionDialog.includeAssignments')}
                                </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <Checkbox
                                    id="regenerateIncludeSolutions"
                                    checked={includeSolutions}
                                    onCheckedChange={(checked) =>
                                        onIncludeSolutionsChange(checked === true)
                                    }
                                />
                                <Label
                                    htmlFor="regenerateIncludeSolutions"
                                    className="cursor-pointer"
                                >
                                    {t('regenerateSessionDialog.includeSolutions')}
                                </Label>
                            </div>
                        </div>
                    </div>

                    <div>
                        <Label htmlFor="regenerateSessionNumberOfTopics" className="mb-2 block">
                            {t('regenerateSessionDialog.numberOfLabel', {
                                term: getTerminologyPlural(ContentTerms.Slides, SystemTerms.Slides),
                            })}
                        </Label>
                        <Input
                            id="regenerateSessionNumberOfTopics"
                            type="number"
                            min="1"
                            value={numberOfTopics}
                            onChange={(e) => onNumberOfTopicsChange(e.target.value)}
                            placeholder={t('regenerateSessionDialog.topicsCountPlaceholder')}
                            className="w-full"
                        />
                    </div>

                    <div>
                        <Label className="mb-2 block">
                            {t('regenerateSessionDialog.topicsInLabel', {
                                plural: getTerminologyPlural(
                                    ContentTerms.Slides,
                                    SystemTerms.Slides
                                ),
                                term: chapterTerm,
                            })}
                        </Label>
                        <TagInput
                            tags={topics}
                            onChange={onTopicsChange}
                            placeholder={t('regenerateSessionDialog.topicsPlaceholder')}
                        />
                    </div>
                </div>
                <div className="flex shrink-0 justify-end border-t px-6 py-4">
                    <MyButton buttonType="primary" onClick={onConfirm} disabled={!prompt.trim()}>
                        {t('regenerateSessionDialog.regenerate')}
                    </MyButton>
                </div>
            </DialogContent>
        </Dialog>
    );
}

interface AddSlideDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    selectedType: SlideType | null;
    onSelectType: (type: SlideType) => void;
    prompt: string;
    onPromptChange: (prompt: string) => void;
    onConfirm: () => void;
    onBack: () => void;
    promptRef: React.RefObject<HTMLTextAreaElement>;
}

export function AddSlideDialog({
    open,
    onOpenChange,
    selectedType,
    onSelectType,
    prompt,
    onPromptChange,
    onConfirm,
    onBack,
    promptRef,
}: AddSlideDialogProps) {
    const { t } = useTranslation('studyLibraryCourseGenerationDialogs');
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90vh] w-[95vw] max-w-[95vw] flex-col p-0 sm:w-[80vw] sm:max-w-[80vw]">
                <DialogHeader className="shrink-0 border-b px-6 pb-4 pt-6">
                    <DialogTitle>
                        {selectedType
                            ? t('addSlideDialog.generationTitle')
                            : t('addSlideDialog.selectTypeTitle')}
                    </DialogTitle>
                    {!selectedType && (
                        <DialogDescription>
                            {t('addSlideDialog.selectTypeDescription')}
                        </DialogDescription>
                    )}
                </DialogHeader>
                {!selectedType ? (
                    <div className="flex-1 overflow-y-auto p-4 [-ms-overflow-style:none] [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden">
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            <button
                                onClick={() => onSelectType('doc')}
                                className="flex flex-col items-center gap-2 rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:border-indigo-400 hover:bg-indigo-50"
                            >
                                <FileText className="size-6 text-blue-600" />
                                <span className="text-sm font-medium">
                                    {t('addSlideDialog.types.document')}
                                </span>
                            </button>
                            <button
                                onClick={() => onSelectType('pdf')}
                                className="flex flex-col items-center gap-2 rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:border-indigo-400 hover:bg-indigo-50"
                            >
                                <File className="size-6 text-red-600" />
                                <span className="text-sm font-medium">
                                    {t('addSlideDialog.types.pdf')}
                                </span>
                            </button>
                            <button
                                onClick={() => onSelectType('video')}
                                className="flex flex-col items-center gap-2 rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:border-indigo-400 hover:bg-indigo-50"
                            >
                                <Video className="size-6 text-red-600" />
                                <span className="text-sm font-medium">
                                    {t('addSlideDialog.types.video')}
                                </span>
                            </button>
                            <button
                                onClick={() => onSelectType('image')}
                                className="flex flex-col items-center gap-2 rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:border-indigo-400 hover:bg-indigo-50"
                            >
                                <ImageIcon className="size-6 text-blue-600" />
                                <span className="text-sm font-medium">
                                    {t('addSlideDialog.types.image')}
                                </span>
                            </button>
                            <button
                                onClick={() => onSelectType('jupyter')}
                                className="flex flex-col items-center gap-2 rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:border-indigo-400 hover:bg-indigo-50"
                            >
                                <Notebook className="size-6 text-orange-600" />
                                <span className="text-sm font-medium">
                                    {t('addSlideDialog.types.jupyter')}
                                </span>
                            </button>
                            <button
                                onClick={() => onSelectType('code-editor')}
                                className="flex flex-col items-center gap-2 rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:border-indigo-400 hover:bg-indigo-50"
                            >
                                <Code className="size-6 text-green-600" />
                                <span className="text-sm font-medium">
                                    {t('addSlideDialog.types.codeEditor')}
                                </span>
                            </button>
                            <button
                                onClick={() => onSelectType('scratch')}
                                className="flex flex-col items-center gap-2 rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:border-indigo-400 hover:bg-indigo-50"
                            >
                                <Puzzle className="size-6 text-purple-600" />
                                <span className="text-sm font-medium">
                                    {t('addSlideDialog.types.scratch')}
                                </span>
                            </button>
                            <button
                                onClick={() => onSelectType('video-jupyter')}
                                className="flex flex-col items-center gap-2 rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:border-indigo-400 hover:bg-indigo-50"
                            >
                                <div className="flex items-center gap-1">
                                    <Video className="size-6 text-red-600" />
                                    <Notebook className="size-6 text-orange-600" />
                                </div>
                                <span className="text-sm font-medium">
                                    {t('addSlideDialog.types.videoJupyter')}
                                </span>
                            </button>
                            <button
                                onClick={() => onSelectType('video-code-editor')}
                                className="flex flex-col items-center gap-2 rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:border-indigo-400 hover:bg-indigo-50"
                            >
                                <div className="flex items-center gap-1">
                                    <Video className="size-6 text-red-600" />
                                    <Code className="size-6 text-green-600" />
                                </div>
                                <span className="text-sm font-medium">
                                    {t('addSlideDialog.types.videoCode')}
                                </span>
                            </button>
                            <button
                                onClick={() => onSelectType('video-scratch')}
                                className="flex flex-col items-center gap-2 rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:border-indigo-400 hover:bg-indigo-50"
                            >
                                <div className="flex items-center gap-1">
                                    <Video className="size-6 text-red-600" />
                                    <Puzzle className="size-6 text-purple-600" />
                                </div>
                                <span className="text-sm font-medium">
                                    {t('addSlideDialog.types.videoScratch')}
                                </span>
                            </button>
                            <button
                                onClick={() => onSelectType('quiz')}
                                className="flex flex-col items-center gap-2 rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:border-indigo-400 hover:bg-indigo-50"
                            >
                                <FileQuestion className="size-6 text-purple-600" />
                                <span className="text-sm font-medium">
                                    {t('addSlideDialog.types.quiz')}
                                </span>
                            </button>
                            <button
                                onClick={() => onSelectType('assignment')}
                                className="flex flex-col items-center gap-2 rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:border-indigo-400 hover:bg-indigo-50"
                            >
                                <ClipboardList className="size-6 text-orange-600" />
                                <span className="text-sm font-medium">
                                    {t('addSlideDialog.types.assignment')}
                                </span>
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="flex-1 overflow-y-auto px-6 py-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                            <Textarea
                                ref={promptRef}
                                value={prompt}
                                onChange={(e) => onPromptChange(e.target.value)}
                                placeholder={t('addSlideDialog.promptPlaceholder')}
                                className="min-h-[150px] text-sm"
                            />
                        </div>
                        <div className="flex shrink-0 justify-end gap-2 border-t px-6 py-4">
                            <MyButton buttonType="secondary" onClick={onBack}>
                                {t('addSlideDialog.back')}
                            </MyButton>
                            <MyButton
                                buttonType="primary"
                                onClick={onConfirm}
                                disabled={!prompt.trim()}
                            >
                                {t('addSlideDialog.createPage')}
                            </MyButton>
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

interface AddSessionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    sessionName: string;
    onSessionNameChange: (name: string) => void;
    onConfirm: () => void;
}

export function AddSessionDialog({
    open,
    onOpenChange,
    sessionName,
    onSessionNameChange,
    onConfirm,
}: AddSessionDialogProps) {
    const { t } = useTranslation('studyLibraryCourseGenerationDialogs');
    const chapterTerm = getTerminology(ContentTerms.Chapters, SystemTerms.Chapters);
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] sm:w-full sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>
                        {t('addSessionDialog.title', { term: chapterTerm })}
                    </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div>
                        <Label htmlFor="sessionName" className="mb-2 block">
                            {t('addSessionDialog.nameLabel', { term: chapterTerm })}
                        </Label>
                        <Input
                            id="sessionName"
                            value={sessionName}
                            onChange={(e) => onSessionNameChange(e.target.value)}
                            placeholder={t('addSessionDialog.namePlaceholder', {
                                term: chapterTerm.toLowerCase(),
                            })}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && sessionName.trim()) {
                                    onConfirm();
                                }
                            }}
                            autoFocus
                        />
                    </div>
                </div>
                <div className="flex justify-end gap-3">
                    <MyButton buttonType="secondary" onClick={() => onOpenChange(false)}>
                        {t('addSessionDialog.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        onClick={onConfirm}
                        disabled={!sessionName.trim()}
                    >
                        {t('addSessionDialog.add', { term: chapterTerm })}
                    </MyButton>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export interface CourseContentCostPreview {
    credits: number | null;
    usageBilledSlides: number;
    sufficient: boolean | null;
    loading?: boolean;
}

interface GenerateCourseAssetsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
    costPreview?: CourseContentCostPreview;
}

export function GenerateCourseAssetsDialog({
    open,
    onOpenChange,
    onConfirm,
    costPreview,
}: GenerateCourseAssetsDialogProps) {
    const { t } = useTranslation('studyLibraryCourseGenerationDialogs');
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] sm:w-full sm:max-w-md">
                <DialogHeader>
                    <div className="mb-2 flex items-center gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-100">
                            <AlertTriangle className="size-5 text-amber-600" />
                        </div>
                        <DialogTitle className="text-xl">
                            {t('generateCourseAssetsDialog.title')}
                        </DialogTitle>
                    </div>
                    <DialogDescription className="pt-2">
                        <div className="space-y-3 text-neutral-700">
                            <p>{t('generateCourseAssetsDialog.reviewNotice')}</p>
                            <p className="font-semibold text-neutral-900">
                                {t('generateCourseAssetsDialog.noComingBack')}
                            </p>
                            {costPreview &&
                                costPreview.credits !== null &&
                                (costPreview.credits > 0 || costPreview.usageBilledSlides > 0) && (
                                <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                                    <p className="text-sm font-medium text-neutral-900">
                                        {t('generateCourseAssetsDialog.estimatedCost', {
                                            credits: costPreview.credits,
                                        })}
                                    </p>
                                    {costPreview.usageBilledSlides > 0 && (
                                        <p className="mt-1 text-xs text-neutral-600">
                                            {t('generateCourseAssetsDialog.usageBilled', {
                                                count: costPreview.usageBilledSlides,
                                            })}
                                        </p>
                                    )}
                                    {costPreview.sufficient === false && (
                                        <p className="mt-1 text-xs font-medium text-amber-700">
                                            {t('generateCourseAssetsDialog.insufficientBalance')}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    </DialogDescription>
                </DialogHeader>
                <div className="mt-6 flex justify-end gap-3">
                    <MyButton buttonType="secondary" onClick={() => onOpenChange(false)}>
                        {t('generateCourseAssetsDialog.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        onClick={() => {
                            onConfirm();
                            onOpenChange(false);
                        }}
                    >
                        {t('generateCourseAssetsDialog.proceed')}
                    </MyButton>
                </div>
            </DialogContent>
        </Dialog>
    );
}

interface LeaveDuringGenerationDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Stay on the page and let generation continue. */
    onStay: () => void;
    /** Abandon the run: the in-flight stream is aborted and partial pages are lost. */
    onLeave: () => void;
    /** Pages finished so far, e.g. "4 of 25" — omitted while the outline itself is generating. */
    progressLabel?: string;
}

/**
 * Confirmation shown when the user tries to leave while AI generation is still
 * streaming. Generation is driven entirely from this page, so navigating away
 * kills the stream and the partially generated pages cannot be resumed — hence
 * a hard confirm rather than the usual discard/save-to-drafts choice.
 */
export function LeaveDuringGenerationDialog({
    open,
    onOpenChange,
    onStay,
    onLeave,
    progressLabel,
}: LeaveDuringGenerationDialogProps) {
    const { t } = useTranslation('studyLibraryCourseGenerationDialogs');
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] sm:w-full sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('leaveDuringGenerationDialog.title')}</DialogTitle>
                    <DialogDescription className="text-neutral-600">
                        {progressLabel
                            ? t('leaveDuringGenerationDialog.progressPrefix', { progressLabel })
                            : ''}
                        {t('leaveDuringGenerationDialog.warning')}
                    </DialogDescription>
                </DialogHeader>
                <div className="mt-6 flex flex-col items-center justify-end gap-3 border-t border-neutral-200 pt-4 sm:flex-row">
                    <MyButton
                        buttonType="secondary"
                        onClick={onLeave}
                        className="w-full min-w-[160px] border-red-300 text-red-600 hover:border-red-400 hover:bg-red-50 hover:text-red-700 sm:w-auto"
                    >
                        {t('leaveDuringGenerationDialog.leaveAndStop')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        onClick={onStay}
                        className="w-full min-w-[130px] sm:w-auto"
                    >
                        {t('leaveDuringGenerationDialog.stayOnPage')}
                    </MyButton>
                </div>
            </DialogContent>
        </Dialog>
    );
}

interface BackToLibraryDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDiscard: () => void;
    onSaveToDrafts: () => void;
}

export function BackToLibraryDialog({
    open,
    onOpenChange,
    onDiscard,
    onSaveToDrafts,
}: BackToLibraryDialogProps) {
    const { t } = useTranslation('studyLibraryCourseGenerationDialogs');
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] sm:w-full sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('backToLibraryDialog.title')}</DialogTitle>
                    <DialogDescription className="text-neutral-600">
                        {t('backToLibraryDialog.description')}
                    </DialogDescription>
                </DialogHeader>
                <div className="mt-6 flex flex-col items-center justify-end gap-3 border-t border-neutral-200 pt-4 sm:flex-row">
                    <MyButton
                        buttonType="secondary"
                        onClick={() => onOpenChange(false)}
                        className="w-full min-w-[100px] sm:w-auto"
                    >
                        {t('backToLibraryDialog.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="secondary"
                        onClick={onDiscard}
                        className="min-w-[120px] border-red-300 text-red-600 hover:border-red-400 hover:bg-red-50 hover:text-red-700"
                    >
                        {t('backToLibraryDialog.discardCourse')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        onClick={onSaveToDrafts}
                        className="min-w-[130px]"
                    >
                        {t('backToLibraryDialog.saveToDrafts')}
                    </MyButton>
                </div>
            </DialogContent>
        </Dialog>
    );
}
