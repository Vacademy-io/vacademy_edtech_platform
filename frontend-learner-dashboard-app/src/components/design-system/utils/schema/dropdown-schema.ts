import { z } from "zod";
import i18n from "@/i18n";

export const dropdownSchema = z.object({
    value: z.string().min(1, i18n.t("uiAtomsA:dropdownSchema.required")),
});

export type DropdownSchema = z.infer<typeof dropdownSchema>;
