import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Form } from '@/components/ui/form';
import { MyInput } from '@/components/design-system/input';
import PhoneInputField from '@/components/design-system/phone-input-field';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { useAutosuggestUsers } from '../../../-hooks/useAutosuggestUsers';
import { AutosuggestUser, ParentLinkPersonInput } from '../../../-types/bulk-assign-types';

const buildCreateNewSchema = (t: TFunction) =>
    z.object({
        fullName: z.string().min(1, t('validation.nameRequired')),
        email: z.string().email(t('validation.invalidEmail')),
        // PhoneInputField (react-phone-input-2) already restricts entry to
        // digits and formats per country — no extra numeric regex needed here.
        mobileNumber: z.string().optional(),
    });
type CreateNewFormValues = z.infer<ReturnType<typeof buildCreateNewSchema>>;

interface Props {
    instituteId: string;
    /** "Student" or "Guardian" — used in tab labels and copy. */
    personLabel: string;
    /** Roles to filter the "link existing" autosuggest search by. */
    searchRoles: string[];
    value: ParentLinkPersonInput | undefined;
    onChange: (value: ParentLinkPersonInput) => void;
}

/**
 * Reusable "Add {person}" / "Link Existing {person}" picker used inside a
 * learner chip's guardian-link sub-form — for either the student (when the
 * chip itself is flagged as the guardian) or the guardian (when adding one
 * for the chip).
 */
export const GuardianLinkPanel = ({ instituteId, personLabel, searchRoles, value, onChange }: Props) => {
    const { t } = useTranslation('manageStudentsGuardianLinkPanel');
    const [tab, setTab] = useState<'create_new' | 'link_existing'>(value?.kind ?? 'create_new');
    const [searchQuery, setSearchQuery] = useState('');

    const form = useForm<CreateNewFormValues>({
        resolver: zodResolver(buildCreateNewSchema(t)),
        mode: 'onChange',
        defaultValues: {
            fullName: value?.kind === 'create_new' ? value.fullName : '',
            email: value?.kind === 'create_new' ? value.email : '',
            mobileNumber: value?.kind === 'create_new' ? value.mobileNumber : '',
        },
    });

    const emitCreateNew = <K extends 'fullName' | 'email'>(field: K, fieldValue: string) => {
        // react-hook-form's setValue overload resolves PathValueImpl<K> from a
        // literal key — it can't be satisfied through a generic K (no `as`
        // cast survives it either), so dispatch to a literal call per field
        // instead of a single generic call. mobileNumber is handled separately
        // below (PhoneInputField writes straight into RHF state via `control`).
        switch (field) {
            case 'fullName':
                form.setValue('fullName', fieldValue, { shouldValidate: true });
                break;
            case 'email':
                form.setValue('email', fieldValue, { shouldValidate: true });
                break;
        }
        const next = { ...form.getValues(), [field]: fieldValue };
        onChange({
            kind: 'create_new',
            fullName: next.fullName || '',
            email: next.email || '',
            mobileNumber: next.mobileNumber || '',
        });
    };

    // PhoneInputField owns `mobileNumber` directly via RHF `control` (its
    // onChange never goes through emitCreateNew above), so bubble it up to
    // the parent's ParentLinkPersonInput separately. Only while this tab is
    // actually active, so switching to "Link Existing" can't get silently
    // clobbered back to a create_new value by a stray watch tick.
    const watchedMobile = form.watch('mobileNumber');
    useEffect(() => {
        if (tab !== 'create_new') return;
        const next = form.getValues();
        onChange({
            kind: 'create_new',
            fullName: next.fullName || '',
            email: next.email || '',
            mobileNumber: next.mobileNumber || '',
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [watchedMobile, tab]);

    const { data: suggestedUsers, isFetching } = useAutosuggestUsers({
        instituteId,
        query: searchQuery,
        roles: searchRoles,
        enabled: tab === 'link_existing',
    });

    const selectedExisting = value?.kind === 'link_existing' ? value : null;

    const selectExisting = (u: AutosuggestUser) => {
        onChange({ kind: 'link_existing', userId: u.id, name: u.full_name || u.username, email: u.email });
        setSearchQuery('');
    };

    const clearExisting = () => {
        onChange({ kind: 'link_existing', userId: '', name: '', email: '' });
    };

    return (
        <Form {...form}>
        <div className="rounded-md border border-neutral-200 bg-white p-3">
            <Tabs value={tab} onValueChange={(v) => setTab(v as 'create_new' | 'link_existing')}>
                <TabsList className="h-8 w-full">
                    <TabsTrigger value="create_new" className="flex-1 text-caption">
                        {t('tabs.addPerson', { person: personLabel })}
                    </TabsTrigger>
                    <TabsTrigger value="link_existing" className="flex-1 text-caption">
                        {t('tabs.linkExistingPerson', { person: personLabel })}
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="create_new" className="mt-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                        <MyInput
                            label={t('form.fullNameLabel')}
                            required
                            size="small"
                            inputType="text"
                            inputPlaceholder={t('form.fullNamePlaceholder', { person: personLabel })}
                            input={form.watch('fullName')}
                            onChangeFunction={(e) => emitCreateNew('fullName', e.target.value)}
                            error={form.formState.errors.fullName?.message}
                        />
                        <MyInput
                            label={t('form.emailLabel')}
                            required
                            size="small"
                            inputType="email"
                            inputPlaceholder={t('form.emailPlaceholder')}
                            input={form.watch('email')}
                            onChangeFunction={(e) => emitCreateNew('email', e.target.value)}
                            error={form.formState.errors.email?.message}
                        />
                        <div className="w-full sm:w-auto sm:min-w-56">
                            <PhoneInputField
                                label={t('form.mobileLabel')}
                                name="mobileNumber"
                                control={form.control}
                                placeholder={t('form.mobilePlaceholder')}
                            />
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="link_existing" className="mt-3">
                    {selectedExisting?.userId ? (
                        <div className="flex items-center justify-between rounded-md border border-primary-200 bg-primary-50 px-3 py-2">
                            <div>
                                <p className="text-caption font-medium text-primary-700">
                                    {selectedExisting.name}
                                </p>
                                <p className="text-caption text-primary-400">{selectedExisting.email}</p>
                            </div>
                            <button
                                type="button"
                                onClick={clearExisting}
                                className="rounded-full text-primary-400 hover:text-primary-700"
                                title={t('existing.changeTitle')}
                            >
                                <X size={12} weight="bold" />
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className="relative">
                                <MagnifyingGlass
                                    size={14}
                                    className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
                                />
                                <Input
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder={t('existing.searchPlaceholder', {
                                        person: personLabel.toLowerCase(),
                                    })}
                                    className="h-8 pl-9 text-caption"
                                />
                            </div>
                            {isFetching && (
                                <p className="mt-2 text-caption text-neutral-400">{t('existing.searching')}</p>
                            )}
                            {!isFetching && suggestedUsers && suggestedUsers.length > 0 && (
                                <div className="mt-2 rounded-md border border-neutral-200 bg-white shadow-sm">
                                    {suggestedUsers.map((u: AutosuggestUser) => (
                                        <button
                                            key={u.id}
                                            type="button"
                                            onClick={() => selectExisting(u)}
                                            className="flex w-full items-center justify-between border-b border-neutral-100 px-3 py-2 text-left text-caption last:border-b-0 hover:bg-primary-50"
                                        >
                                            <div>
                                                <p className="font-medium text-neutral-800">
                                                    {u.full_name || u.username}
                                                </p>
                                                <p className="text-caption text-neutral-400">{u.email}</p>
                                            </div>
                                            <span className="font-medium text-primary-500">
                                                {t('existing.select')}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            {!isFetching && searchQuery.length >= 2 && (!suggestedUsers || suggestedUsers.length === 0) && (
                                <p className="mt-2 text-caption text-neutral-400">
                                    {t('existing.noResults', {
                                        person: personLabel.toLowerCase(),
                                        query: searchQuery,
                                    })}
                                </p>
                            )}
                            {searchQuery.length < 2 && (
                                <p className="mt-2 text-caption text-neutral-400">
                                    {t('existing.minChars')}
                                </p>
                            )}
                        </>
                    )}
                </TabsContent>
            </Tabs>
        </div>
        </Form>
    );
};
