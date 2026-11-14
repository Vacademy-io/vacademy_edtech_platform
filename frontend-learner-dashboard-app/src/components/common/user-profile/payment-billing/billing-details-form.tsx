import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { SpinnerGap } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import i18n from "@/i18n";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MyButton } from "@/components/design-system/button";
import {
  BillingDetails,
  updateBillingDetails,
} from "./payment-method-services";

const billingSchema = z.object({
  name: z.string().min(2, i18n.t("userProfileExtra:billingDetailsForm.validation.nameRequired")),
  email: z.string().email(i18n.t("userProfileExtra:billingDetailsForm.validation.invalidEmail")),
  address_line: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postal_code: z.string().optional(),
  country: z.string().optional(),
});

type BillingFormValues = z.infer<typeof billingSchema>;

interface BillingDetailsFormProps {
  instituteId: string;
  billingDetails?: BillingDetails | null;
  onUpdated: () => void;
}

/**
 * Edits the billing name/email/address stored on the learner's payment
 * gateway customer record (Stripe Customer / eWay Token Customer).
 */
export const BillingDetailsForm = ({
  instituteId,
  billingDetails,
  onUpdated,
}: BillingDetailsFormProps) => {
  const { t } = useTranslation("userProfileExtra");
  const form = useForm<BillingFormValues>({
    resolver: zodResolver(billingSchema),
    defaultValues: {
      name: billingDetails?.name ?? "",
      email: billingDetails?.email ?? "",
      address_line: billingDetails?.address_line ?? "",
      city: billingDetails?.city ?? "",
      state: billingDetails?.state ?? "",
      postal_code: billingDetails?.postal_code ?? "",
      country: billingDetails?.country ?? "",
    },
  });

  // Prefill once the summary arrives (billingDetails loads async)
  useEffect(() => {
    if (billingDetails) {
      form.reset({
        name: billingDetails.name ?? "",
        email: billingDetails.email ?? "",
        address_line: billingDetails.address_line ?? "",
        city: billingDetails.city ?? "",
        state: billingDetails.state ?? "",
        postal_code: billingDetails.postal_code ?? "",
        country: billingDetails.country ?? "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingDetails]);

  const mutation = useMutation({
    mutationFn: (values: BillingFormValues) =>
      updateBillingDetails(instituteId, values),
    onSuccess: () => {
      toast.success(t("billingDetailsForm.toast.success"));
      onUpdated();
    },
    onError: (error) => {
      console.error("Billing details update failed:", error);
      toast.error(t("billingDetailsForm.toast.error"));
    },
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        className="space-y-4"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-medium uppercase text-gray-500">
                  {t("billingDetailsForm.labels.billingName")}
                </FormLabel>
                <FormControl>
                  <Input placeholder={t("billingDetailsForm.placeholders.billingName")} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-medium uppercase text-gray-500">
                  {t("billingDetailsForm.labels.billingEmail")}
                </FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    placeholder={t("billingDetailsForm.placeholders.billingEmail")}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="address_line"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs font-medium uppercase text-gray-500">
                {t("billingDetailsForm.labels.address")}
              </FormLabel>
              <FormControl>
                <Input placeholder={t("billingDetailsForm.placeholders.address")} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <FormField
            control={form.control}
            name="city"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-medium uppercase text-gray-500">
                  {t("billingDetailsForm.labels.city")}
                </FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="state"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-medium uppercase text-gray-500">
                  {t("billingDetailsForm.labels.state")}
                </FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="postal_code"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-medium uppercase text-gray-500">
                  {t("billingDetailsForm.labels.postalCode")}
                </FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="country"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-medium uppercase text-gray-500">
                  {t("billingDetailsForm.labels.country")}
                </FormLabel>
                <FormControl>
                  <Input placeholder={t("billingDetailsForm.placeholders.country")} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="flex justify-end">
          <MyButton
            type="submit"
            scale="medium"
            buttonType="primary"
            layoutVariant="default"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? (
              <>
                <SpinnerGap className="me-2 size-4 animate-spin" />
                {t("common.saving")}
              </>
            ) : (
              t("billingDetailsForm.saveBillingDetails")
            )}
          </MyButton>
        </div>
      </form>
    </Form>
  );
};
