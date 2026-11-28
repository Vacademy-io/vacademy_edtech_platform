import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Copy } from '@phosphor-icons/react';
import type { PanelPartnerInviteResponse } from '@/classroom-shared/apiTypes';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import SelectField from '@/components/design-system/select-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Form } from '@/components/ui/form';
import { formatDateTime } from '@/lib/formatters';
import { panelErrorMessage } from '../api';
import {
    DEFAULT_INSTALL_DAYS,
    INSTALL_DAY_OPTIONS,
    cancelPartnerInvite,
    createPartnerInvite,
    formatInviteCode,
} from './api';

/**
 * Creates a one-time installer code. The server keeps only a hash of it, so the code is shown
 * here once and is gone when the dialog closes; the admin can cancel it while it is still shown.
 */
export function InviteDialog({
    open,
    instituteId,
    onClose,
}: {
    open: boolean;
    instituteId: string;
    onClose: () => void;
}) {
    const { t } = useTranslation('settingsClassroomPanels');
    const [invite, setInvite] = useState<PanelPartnerInviteResponse | null>(null);

    const close = () => {
        setInvite(null);
        onClose();
    };

    return (
        <MyDialog
            open={open}
            onOpenChange={(next) => {
                if (!next) close();
            }}
            heading={t('installers.invite.title')}
            dialogWidth="max-w-md"
        >
            {open &&
                (invite ? (
                    <InviteCode invite={invite} onClose={close} />
                ) : (
                    <InviteForm instituteId={instituteId} onCreated={setInvite} onCancel={close} />
                ))}
        </MyDialog>
    );
}

function InviteForm({
    instituteId,
    onCreated,
    onCancel,
}: {
    instituteId: string;
    onCreated: (invite: PanelPartnerInviteResponse) => void;
    onCancel: () => void;
}) {
    const { t } = useTranslation('settingsClassroomPanels');
    const schema = useMemo(
        () =>
            z.object({
                install_days: z
                    .string()
                    .refine((value) => INSTALL_DAY_OPTIONS.some((days) => String(days) === value)),
            }),
        []
    );
    const form = useForm<z.infer<typeof schema>>({
        resolver: zodResolver(schema),
        defaultValues: { install_days: String(DEFAULT_INSTALL_DAYS) },
    });
    const [failure, setFailure] = useState<string | null>(null);

    const submit = form.handleSubmit(async ({ install_days }) => {
        setFailure(null);
        try {
            onCreated(await createPartnerInvite(instituteId, Number(install_days)));
        } catch (error) {
            setFailure(panelErrorMessage(t, error));
        }
    });

    return (
        <Form {...form}>
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
                <p className="text-body text-neutral-600">{t('installers.invite.intro')}</p>
                <SelectField
                    label={t('installers.invite.daysLabel')}
                    labelStyle="text-body font-medium text-neutral-700"
                    name="install_days"
                    control={form.control}
                    className="sm:w-full"
                    options={INSTALL_DAY_OPTIONS.map((days) => ({
                        _id: days,
                        value: String(days),
                        label: t('installers.invite.days', { days }),
                    }))}
                />
                {failure && (
                    <Alert variant="destructive" role="alert">
                        <AlertDescription>{failure}</AlertDescription>
                    </Alert>
                )}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <MyButton type="button" buttonType="secondary" onClick={onCancel}>
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton type="submit" disable={form.formState.isSubmitting}>
                        {form.formState.isSubmitting
                            ? t('common.working')
                            : t('installers.invite.create')}
                    </MyButton>
                </div>
            </form>
        </Form>
    );
}

function InviteCode({
    invite,
    onClose,
}: {
    invite: PanelPartnerInviteResponse;
    onClose: () => void;
}) {
    const { t } = useTranslation('settingsClassroomPanels');
    const [cancelling, setCancelling] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const shown = formatInviteCode(invite.code);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(shown);
            toast.success(t('installers.invite.copied'));
        } catch {
            toast.error(t('installers.invite.copyFailed'));
        }
    };

    const cancel = async () => {
        if (cancelling) return;
        setCancelling(true);
        setFailure(null);
        try {
            await cancelPartnerInvite(invite.id);
            toast.success(t('installers.invite.cancelled'));
            onClose();
        } catch (error) {
            setFailure(panelErrorMessage(t, error));
        } finally {
            setCancelling(false);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
                <span className="text-caption text-neutral-500">
                    {t('installers.invite.codeLabel')}
                </span>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <output
                        aria-label={t('installers.invite.codeLabel')}
                        className="select-all break-all font-mono text-h2 font-semibold tracking-widest text-neutral-800"
                    >
                        {shown}
                    </output>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        className="shrink-0 gap-2"
                        onClick={() => void copy()}
                    >
                        <Copy size={16} />
                        {t('installers.invite.copy')}
                    </MyButton>
                </div>
                <p className="text-caption text-neutral-500">
                    {t('installers.invite.expires', { when: formatDateTime(invite.expires_at) })}
                </p>
            </div>
            <Alert role="status">
                <AlertDescription className="text-warning-600">
                    {t('installers.invite.shownOnce')}
                </AlertDescription>
            </Alert>
            {failure && (
                <Alert variant="destructive" role="alert">
                    <AlertDescription>{failure}</AlertDescription>
                </Alert>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <MyButton
                    type="button"
                    buttonType="text"
                    disable={cancelling}
                    onClick={() => void cancel()}
                >
                    {cancelling ? t('common.working') : t('installers.invite.cancel')}
                </MyButton>
                <MyButton type="button" onClick={onClose} disable={cancelling}>
                    {t('common.done')}
                </MyButton>
            </div>
        </div>
    );
}
