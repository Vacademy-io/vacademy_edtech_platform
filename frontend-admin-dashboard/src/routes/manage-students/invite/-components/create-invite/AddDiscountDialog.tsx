import React from 'react';
import {
    Dialog as ShadDialog,
    DialogContent as ShadDialogContent,
    DialogHeader as ShadDialogHeader,
    DialogTitle as ShadDialogTitle,
} from '@/components/ui/dialog';
import { Form, FormField, FormItem, FormLabel, FormControl } from '@/components/ui/form';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { MyButton } from '@/components/design-system/button';
import { UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { AddDiscountFormValues, InviteLinkFormValues } from './GenerateInviteLinkSchema';

interface AddDiscountDialogProps {
    form: UseFormReturn<InviteLinkFormValues>;
    addDiscountForm: UseFormReturn<AddDiscountFormValues>;
    handleAddDiscount: (values: AddDiscountFormValues) => void;
}

export function AddDiscountDialog({
    form,
    addDiscountForm,
    handleAddDiscount,
}: AddDiscountDialogProps) {
    const { t } = useTranslation('manageStudentsAddDiscountDialog');
    return (
        <ShadDialog
            open={form.watch('showAddDiscountDialog')}
            onOpenChange={(open) => form.setValue('showAddDiscountDialog', open)}
        >
            <ShadDialogContent className="max-w-md">
                <ShadDialogHeader>
                    <ShadDialogTitle>{t('title')}</ShadDialogTitle>
                </ShadDialogHeader>
                <Form {...addDiscountForm}>
                    <form
                        className="space-y-4"
                        onSubmit={addDiscountForm.handleSubmit(handleAddDiscount)}
                    >
                        <FormField
                            control={addDiscountForm.control}
                            name="title"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t('fields.title.label')}</FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder={t('fields.title.placeholder')}
                                            {...field}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={addDiscountForm.control}
                            name="code"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t('fields.code.label')}</FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder={t('fields.code.placeholder')}
                                            {...field}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={addDiscountForm.control}
                            name="type"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t('fields.type.label')}</FormLabel>
                                    <FormControl>
                                        <Select value={field.value} onValueChange={field.onChange}>
                                            <SelectTrigger>
                                                <SelectValue
                                                    placeholder={t('fields.type.placeholder')}
                                                />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="percent">
                                                    {t('fields.type.options.percent')}
                                                </SelectItem>
                                                <SelectItem value="rupees">
                                                    {t('fields.type.options.rupees')}
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={addDiscountForm.control}
                            name="value"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t('fields.value.label')}</FormLabel>
                                    <FormControl>
                                        <Input
                                            type="number"
                                            placeholder={
                                                addDiscountForm.watch('type') === 'percent'
                                                    ? t('fields.value.placeholderPercent')
                                                    : t('fields.value.placeholderRupees')
                                            }
                                            {...field}
                                            onChange={(e) => field.onChange(Number(e.target.value))}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={addDiscountForm.control}
                            name="expires"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t('fields.expires.label')}</FormLabel>
                                    <FormControl>
                                        <Input type="date" {...field} />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <div className="flex justify-end">
                            <MyButton type="submit" scale="small" buttonType="primary">
                                {t('actions.save')}
                            </MyButton>
                        </div>
                    </form>
                </Form>
            </ShadDialogContent>
        </ShadDialog>
    );
}
