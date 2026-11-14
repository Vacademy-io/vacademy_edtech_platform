import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UploadSimple, Warning } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { UploadFileInS3 } from '@/services/upload_file';
import { getUserId } from '@/utils/userDetails';
import { createCatalogueBadge } from '@/services/student-badges';
import {
    BADGE_ICON_NAMES,
    type BadgeDefinitionConfig,
} from '@/routes/settings/-constants/badge-config';
import { BadgeVisual, isBuiltInBadgeIcon } from '@/routes/settings/-constants/badge-icon-map';
import { isLibraryToken } from '@/routes/settings/-constants/badge-library';
import { BadgeLibraryPicker } from '@/routes/settings/-components/BadgesRewards/BadgeLibraryPicker';

const NAME_MAX = 120;
const DESCRIPTION_MAX = 500;
const DEFAULT_ICON = 'Star';

const buildSchema = (t: (key: string) => string) =>
    z.object({
        name: z
            .string()
            .trim()
            .min(1, t('create.nameRequired'))
            .max(NAME_MAX, t('create.nameTooLong')),
        description: z.string().trim().max(DESCRIPTION_MAX, t('create.descriptionTooLong')),
        icon: z.string().min(1),
        hidden: z.boolean(),
    });

type CreateBadgeForm = z.infer<ReturnType<typeof buildSchema>>;

export interface CreateBadgeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Current catalogue, used for the (non-blocking) duplicate-name warning. */
    existingBadges: BadgeDefinitionConfig[];
    /** Receives the server-persisted definition. */
    onCreated: (badge: BadgeDefinitionConfig) => void;
}

/**
 * Creates ONE staff-awarded badge in the institute catalogue through the server's append
 * endpoint (never by re-saving the whole settings blob from client state), so a stale tab
 * can't wipe badges created elsewhere. Institute-admin only — the caller gates the trigger.
 */
export function CreateBadgeDialog({
    open,
    onOpenChange,
    existingBadges,
    onCreated,
}: CreateBadgeDialogProps) {
    const { t } = useTranslation('manageStudentsBadges');
    const queryClient = useQueryClient();
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const form = useForm<CreateBadgeForm>({
        resolver: zodResolver(buildSchema(t)),
        defaultValues: { name: '', description: '', icon: DEFAULT_ICON, hidden: false },
        mode: 'onBlur',
    });

    useEffect(() => {
        if (!open) {
            form.reset({ name: '', description: '', icon: DEFAULT_ICON, hidden: false });
        }
    }, [open, form]);

    const name = form.watch('name');
    const icon = form.watch('icon');
    const hidden = form.watch('hidden');
    const description = form.watch('description');

    const trimmedName = name.trim().toLowerCase();
    const duplicate = trimmedName
        ? existingBadges.find(
              (b) => b.enabled !== false && b.name.trim().toLowerCase() === trimmedName
          )
        : undefined;

    const handleUpload = async (file: File | undefined) => {
        if (!file) return;
        setUploading(true);
        try {
            const fileId = await UploadFileInS3(
                file,
                () => {},
                getUserId() || 'admin',
                'BADGE_ICON',
                'INSTITUTE',
                true
            );
            if (fileId) {
                form.setValue('icon', fileId, { shouldDirty: true });
                toast.success(t('create.imageUploaded'));
            } else {
                toast.error(t('create.uploadFailed'));
            }
        } catch {
            toast.error(t('create.uploadFailed'));
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const submit = form.handleSubmit(async (values) => {
        try {
            const response = await createCatalogueBadge({
                name: values.name.trim(),
                description: values.description.trim(),
                icon: values.icon || DEFAULT_ICON,
                hidden: values.hidden,
            });
            await queryClient.invalidateQueries({ queryKey: ['badges-settings'] });
            onCreated(response.badge);
            toast.success(t('create.successToast', { name: response.badge.name }));
            onOpenChange(false);
        } catch {
            toast.error(t('create.errorToast'));
        }
    });

    const iconHint = isLibraryToken(icon)
        ? t('create.iconLibraryHint')
        : icon && !isBuiltInBadgeIcon(icon)
          ? t('create.iconCustomHint')
          : null;

    return (
        <MyDialog
            heading={t('create.title')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
            footer={
                <>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('create.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={uploading}
                        onAsyncClick={async () => {
                            await submit();
                        }}
                        loadingText={t('create.submitting')}
                    >
                        {t('create.submit')}
                    </MyButton>
                </>
            }
        >
            <Form {...form}>
                <form
                    noValidate
                    onSubmit={(e) => {
                        e.preventDefault();
                        void submit();
                    }}
                    className="flex flex-col gap-4"
                >
                    <p className="text-caption text-muted-foreground">{t('create.intro')}</p>

                    <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                            <FormItem className="space-y-1">
                                <FormControl>
                                    <MyInput
                                        label={t('create.nameLabel')}
                                        required
                                        inputType="text"
                                        inputPlaceholder={t('create.namePlaceholder')}
                                        input={field.value}
                                        onChangeFunction={field.onChange}
                                        onBlur={field.onBlur}
                                        name={field.name}
                                        ref={field.ref}
                                        maxLength={NAME_MAX}
                                        className="w-full sm:w-full"
                                    />
                                </FormControl>
                                <FormMessage className="text-caption" />
                                {duplicate && (
                                    <p
                                        role="status"
                                        className="flex items-start gap-1 text-caption text-warning-700"
                                    >
                                        <Warning className="mt-0.5 size-3.5 shrink-0" />
                                        {t('create.duplicateWarning', { name: duplicate.name })}
                                    </p>
                                )}
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="description"
                        render={({ field }) => (
                            <FormItem className="space-y-1">
                                <FormLabel className="text-subtitle font-regular">
                                    {t('create.descriptionLabel')}
                                </FormLabel>
                                <FormControl>
                                    <Textarea
                                        {...field}
                                        rows={2}
                                        maxLength={DESCRIPTION_MAX}
                                        placeholder={t('create.descriptionPlaceholder')}
                                        className="text-body"
                                    />
                                </FormControl>
                                <div className="flex items-center justify-between gap-2">
                                    <FormMessage className="text-caption" />
                                    <span className="ms-auto text-2xs text-muted-foreground">
                                        {description.length}/{DESCRIPTION_MAX}
                                    </span>
                                </div>
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="icon"
                        render={({ field }) => (
                            <FormItem className="space-y-1.5">
                                <FormLabel className="text-subtitle font-regular">
                                    {t('create.iconLabel')}
                                </FormLabel>
                                <div className="flex items-start gap-3">
                                    <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-50 text-primary-500 ring-1 ring-primary-200">
                                        <BadgeVisual icon={field.value} size={26} fill />
                                    </span>
                                    <div className="grid min-w-0 flex-1 grid-cols-8 gap-1">
                                        {BADGE_ICON_NAMES.map((iconName) => {
                                            const selected = field.value === iconName;
                                            return (
                                                <button
                                                    key={iconName}
                                                    type="button"
                                                    aria-label={t('create.iconOptionAriaLabel', {
                                                        name: iconName,
                                                    })}
                                                    aria-pressed={selected}
                                                    onClick={() => field.onChange(iconName)}
                                                    className={cn(
                                                        'flex aspect-square items-center justify-center rounded-md border transition-colors',
                                                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
                                                        selected
                                                            ? 'border-primary-500 bg-primary-50 text-primary-600'
                                                            : 'border-border text-neutral-500 hover:border-primary-300 hover:bg-primary-50'
                                                    )}
                                                >
                                                    <BadgeVisual icon={iconName} size={16} />
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <BadgeLibraryPicker
                                        value={field.value}
                                        onSelect={(token) => field.onChange(token)}
                                    />
                                    <span className="text-caption text-muted-foreground">
                                        {t('create.chooseFromLibrary')}
                                    </span>
                                    <label
                                        className={cn(
                                            'ms-auto inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 text-caption text-neutral-600 transition-colors hover:border-primary-300 hover:bg-primary-50',
                                            uploading && 'pointer-events-none opacity-60'
                                        )}
                                    >
                                        <UploadSimple className="size-4" />
                                        {uploading
                                            ? t('create.uploading')
                                            : t('create.uploadImage')}
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            disabled={uploading}
                                            onChange={(e) => handleUpload(e.target.files?.[0])}
                                        />
                                    </label>
                                </div>
                                {iconHint && (
                                    <p className="text-2xs text-muted-foreground">{iconHint}</p>
                                )}
                                <FormMessage className="text-caption" />
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="hidden"
                        render={({ field }) => (
                            <FormItem className="space-y-0">
                                <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                                    <div className="min-w-0">
                                        <FormLabel className="text-body font-semibold text-card-foreground">
                                            {t('create.hiddenLabel')}
                                        </FormLabel>
                                        <p className="mt-0.5 text-caption text-muted-foreground">
                                            {t('create.hiddenHelp')}
                                        </p>
                                    </div>
                                    <FormControl>
                                        <Switch
                                            checked={hidden}
                                            onCheckedChange={field.onChange}
                                            aria-label={t('create.hiddenLabel')}
                                        />
                                    </FormControl>
                                </div>
                            </FormItem>
                        )}
                    />
                </form>
            </Form>
        </MyDialog>
    );
}
