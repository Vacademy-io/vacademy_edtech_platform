import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, PencilSimple, Plus, Star, Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import type { SavedCertificateTemplate } from '../../-utils/certificate-template-library';

interface Props {
    templates: SavedCertificateTemplate[];
    /** Which entry the editor currently has open. */
    activeTemplateId: string | null;
    /** Which entry learners actually receive. */
    defaultTemplateId: string | null;
    onOpen: (id: string) => void;
    onMakeDefault: (id: string) => void;
    onRename: (id: string, name: string) => void;
    onDelete: (id: string) => void;
    /** Sends the admin to the Upload tab to add another design. */
    onAdd: () => void;
    disabled?: boolean;
}

/**
 * The institute's saved certificate designs, and the one control that decides
 * which of them is issued.
 *
 * <p>"Default" is stated on the card rather than in a dropdown elsewhere because
 * it is the only property here with consequences: every other action changes
 * what the admin is looking at, this one changes what a learner receives.
 */
export const CertificateTemplateLibrary = ({
    templates,
    activeTemplateId,
    defaultTemplateId,
    onOpen,
    onMakeDefault,
    onRename,
    onDelete,
    onAdd,
    disabled,
}: Props) => {
    const { t } = useTranslation('settingsCertificateTemplateLibrary');
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [draftName, setDraftName] = useState('');

    const commitRename = (id: string) => {
        const name = draftName.trim();
        if (name) onRename(id, name);
        setRenamingId(null);
    };

    return (
        <div className="rounded-lg border bg-card p-4">
            <div className="mb-3 flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-sm font-semibold text-neutral-800">
                        {t('header.title')}
                    </h3>
                    <p className="text-xs text-neutral-500">
                        {t('header.descriptionPart1')}{' '}
                        <span className="font-medium text-amber-700">
                            {t('header.descriptionDefault')}
                        </span>{' '}
                        {t('header.descriptionPart2')}
                    </p>
                </div>
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    onClick={onAdd}
                    disable={disabled}
                    className="shrink-0"
                >
                    <Plus size={14} className="mr-1" />
                    {t('addTemplate')}
                </MyButton>
            </div>

            {templates.length === 0 ? (
                <div className="rounded-md border border-dashed border-neutral-300 p-6 text-center">
                    <p className="text-sm text-neutral-600">{t('emptyState.title')}</p>
                    <p className="mt-1 text-xs text-neutral-500">
                        {t('emptyState.description')}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {templates.map((template) => {
                        const isActive = template.id === activeTemplateId;
                        const isDefault = template.id === defaultTemplateId;
                        return (
                            <div
                                key={template.id}
                                className={cn(
                                    'group relative flex flex-col overflow-hidden rounded-md border bg-white transition-all',
                                    isActive
                                        ? 'border-primary-500 ring-2 ring-primary-100'
                                        : 'border-neutral-200 hover:border-primary-300 hover:shadow-sm',
                                    disabled && 'opacity-60'
                                )}
                            >
                                <button
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => onOpen(template.id)}
                                    className="relative aspect-[1123/794] w-full bg-neutral-50"
                                    title={t('card.openTitle')}
                                >
                                    <img
                                        src={template.imageTemplate.imageDataUrl}
                                        alt={template.name}
                                        className="size-full object-contain"
                                        draggable={false}
                                    />
                                    {isDefault && (
                                        // Reads on any artwork: certificate
                                        // backgrounds are usually cream, which a
                                        // pale amber chip disappears into.
                                        <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-caption font-medium text-white shadow-sm">
                                            <Star size={10} weight="fill" />
                                            {t('card.defaultBadge')}
                                        </span>
                                    )}
                                    {isActive && (
                                        <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-primary-500 px-2 py-0.5 text-caption font-medium text-white">
                                            <Check size={10} weight="bold" />
                                            {t('card.editingBadge')}
                                        </span>
                                    )}
                                </button>

                                <div className="flex flex-col gap-2 border-t px-2.5 py-2">
                                    {renamingId === template.id ? (
                                        <input
                                            autoFocus
                                            value={draftName}
                                            onChange={(e) => setDraftName(e.target.value)}
                                            onBlur={() => commitRename(template.id)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') commitRename(template.id);
                                                if (e.key === 'Escape') setRenamingId(null);
                                            }}
                                            className="w-full rounded border px-1.5 py-1 text-caption"
                                            aria-label={t('card.renameInputAriaLabel')}
                                        />
                                    ) : (
                                        <button
                                            type="button"
                                            disabled={disabled}
                                            onClick={() => {
                                                setRenamingId(template.id);
                                                setDraftName(template.name);
                                            }}
                                            className="flex items-center gap-1 truncate text-left text-caption font-semibold text-neutral-800 hover:text-primary-500"
                                            title={t('card.renameTitle')}
                                        >
                                            <span className="truncate">{template.name}</span>
                                            <PencilSimple
                                                size={11}
                                                className="shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
                                            />
                                        </button>
                                    )}

                                    <div className="flex items-center justify-between gap-1">
                                        {isDefault ? (
                                            <span className="text-caption text-neutral-400">
                                                {t('card.issuedToLearners')}
                                            </span>
                                        ) : (
                                            <button
                                                type="button"
                                                disabled={disabled}
                                                onClick={() => onMakeDefault(template.id)}
                                                className="text-caption font-medium text-primary-500 hover:underline disabled:cursor-not-allowed"
                                            >
                                                {t('card.makeDefault')}
                                            </button>
                                        )}
                                        {/* Deleting the default would leave the
                                            institute issuing whatever happened to
                                            sort first. Make another one default
                                            first — an explicit choice, not a
                                            side effect of a delete. */}
                                        {!isDefault && (
                                            <button
                                                type="button"
                                                disabled={disabled}
                                                onClick={() => onDelete(template.id)}
                                                className="rounded p-1 text-neutral-400 hover:bg-danger-50 hover:text-danger-600"
                                                title={t('card.deleteTitle')}
                                                aria-label={t('card.deleteAriaLabel', {
                                                    name: template.name,
                                                })}
                                            >
                                                <Trash size={12} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
