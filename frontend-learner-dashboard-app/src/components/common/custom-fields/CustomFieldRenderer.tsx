import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MyInput } from "@/components/design-system/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { SpinnerGap } from "@phosphor-icons/react";
import PhoneInput from "react-phone-input-2";
// bootstrap.css is the ONE variant this app loads. Importing a second
// variant anywhere puts two incompatible geometries in the same bundle and
// the country flag lands on top of the country name — see the
// "react-phone-input-2 — design-system geometry" block in src/index.css.
import "react-phone-input-2/lib/bootstrap.css";
import { useFileUpload } from "@/hooks/use-file-upload";
import { getTokenFromCookie, getTokenDecodedData } from "@/lib/auth/sessionUtility";
import {
  phoneFieldHasInput,
  usePreferredPhoneCountries,
} from "@/hooks/use-preferred-phone-countries";
import { TokenKey } from "@/constants/auth/tokens";
import {
  FieldRenderType,
  parseFieldConfig,
  parseDropdownOptions,
  isUnrestrictedFileTypes,
  type CustomFieldFullConfig,
} from "@/components/common/enroll-by-invite/-utils/custom-field-helpers";

interface CustomFieldRendererProps {
  type: FieldRenderType | string;
  name: string;
  value?: string;
  onChange?: (value: string) => void;
  options?: Array<{ _id?: number; value: string; label: string }>;
  config?: string | CustomFieldFullConfig | null;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Shared renderer for learner-facing custom fields.
 *
 * Handles all 11 field types:
 *   text, number, email, url, phone, date, textarea, checkbox, radio, dropdown, file
 *
 * For `file` fields, uploads via the existing S3 signed-URL flow on change
 * and stores the resulting public URL as the field value.
 */
export const CustomFieldRenderer = ({
  type,
  name,
  value,
  onChange,
  options,
  config,
  required = false,
  disabled = false,
  placeholder,
}: CustomFieldRendererProps) => {
  const { t } = useTranslation("layoutCommonB");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string>("");
  const { uploadFile, uploadFilePublic, getPublicUrl, getPublicUrlWithoutLogin } = useFileUpload();

  // Normalise the render type
  const normalizedType = String(type).toUpperCase() as FieldRenderType;

  // Hooks cannot live inside the render switch below, so the phone country is
  // resolved here for every field type and only read by the PHONE case. It picks
  // up the institute's answer if domain routing replies after this form rendered,
  // and never moves once the visitor has touched the field (see the hook's rules).
  //
  // The freeze check is gated on the render type so a date, URL or file field
  // never pays for it, and — more importantly — so a non-phone value that merely
  // contains digits cannot trip the hook's permanent freeze latch.
  const { defaultCountry, preferredCountries } = usePreferredPhoneCountries({
    freeze:
      normalizedType === FieldRenderType.PHONE && phoneFieldHasInput(value),
  });

  // Resolve options: prefer explicit options prop, else parse from config.
  // Only parse for types that actually use options to avoid spurious
  // "Empty or invalid config" console warnings for date/text/checkbox/etc.
  const needsOptions =
    normalizedType === FieldRenderType.DROPDOWN ||
    normalizedType === FieldRenderType.RADIO ||
    normalizedType === FieldRenderType.MULTI_SELECT;
  const resolvedOptions =
    options && options.length > 0
      ? options
      : needsOptions && typeof config === "string"
        ? parseDropdownOptions(config)
        : undefined;

  // Resolve file constraints from config
  const parsedConfig: CustomFieldFullConfig | undefined =
    typeof config === "string"
      ? parseFieldConfig(config)
      : (config ?? undefined) || undefined;
  const allowedFileTypes = parsedConfig?.allowedFileTypes;
  const maxSizeMB = parsedConfig?.maxSizeMB;

  // Placeholder precedence: an explicit prop from the caller, then a per-field
  // override authored in the field's config JSON, then the auto-generated
  // "Enter <field name>". The config hook is what lets a single institute
  // reword one field's prompt without renaming the field or forking this file.
  const configPlaceholder = parsedConfig?.placeholder;
  const enterPlaceholder =
    placeholder || configPlaceholder || t("customFields.enterField", { name });

  const handleChange = (newValue: string) => {
    onChange?.(newValue);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!isUnrestrictedFileTypes(allowedFileTypes)) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      if (!allowedFileTypes!.some((ft) => ft.toLowerCase() === ext)) {
        alert(
          t("customFields.file.typeNotAllowed", {
            ext,
            allowed: allowedFileTypes!.join(", "),
          })
        );
        e.target.value = "";
        return;
      }
    }

    if (maxSizeMB && file.size > maxSizeMB * 1024 * 1024) {
      alert(t("customFields.file.tooLarge", { maxSizeMB }));
      e.target.value = "";
      return;
    }

    try {
      setIsUploading(true);

      // Detect whether the user is logged in to pick the right upload path.
      // Public pages (live-class registration, audience-response) don't have
      // an auth token, so we use the unauthenticated /media-service/public/*
      // endpoints instead.
      let token: string | null = null;
      let userId = "anonymous";
      try {
        token = getTokenFromCookie(TokenKey.accessToken);
        const decoded = token ? getTokenDecodedData(token) : null;
        if (decoded?.user) userId = decoded.user;
      } catch {
        // no token — public context
      }

      let fileId: string | undefined;
      if (token) {
        // Authenticated path: signed-URL → S3 PUT → acknowledge
        fileId = await uploadFile({
          file,
          setIsUploading,
          userId,
          source: "CUSTOM_FIELD",
          sourceId: "CUSTOM_FIELD_VALUE",
        });
      } else {
        // Public path: public signed-URL → S3 PUT (no acknowledge needed)
        fileId = await uploadFilePublic({
          file,
          source: "CUSTOM_FIELD",
          sourceId: "PUBLIC_UPLOAD",
        });
      }

      if (fileId) {
        const url = token
          ? await getPublicUrl(fileId)
          : await getPublicUrlWithoutLogin(fileId);
        const finalValue = url || fileId;
        setUploadedFileName(file.name);
        handleChange(finalValue);
      }
    } catch (err) {
      console.error("File upload failed:", err);
      alert(t("customFields.file.uploadFailed"));
    } finally {
      setIsUploading(false);
    }
  };

  // The control itself. Wrapped below so help text renders once for every type
  // instead of being repeated in each branch.
  const renderControl = () => {
    switch (normalizedType) {
      case FieldRenderType.TEXT:
        return (
          <MyInput
            inputType="text"
            inputPlaceholder={enterPlaceholder}
            input={value || ""}
            onChangeFunction={(e) => handleChange(e.target.value)}
            size="large"
            className="w-full"
            disabled={disabled}
            required={required}
          />
        );

      case FieldRenderType.NUMBER:
        return (
          <MyInput
            inputType="number"
            inputPlaceholder={enterPlaceholder}
            input={value || ""}
            onChangeFunction={(e) => handleChange(e.target.value)}
            size="large"
            className="w-full"
            disabled={disabled}
            required={required}
          />
        );

      case FieldRenderType.EMAIL:
        return (
          <MyInput
            inputType="email"
            inputPlaceholder={enterPlaceholder}
            input={value || ""}
            onChangeFunction={(e) => handleChange(e.target.value)}
            size="large"
            className="w-full"
            disabled={disabled}
            required={required}
          />
        );

      case FieldRenderType.URL:
        return (
          <MyInput
            inputType="url"
            inputPlaceholder={enterPlaceholder}
            input={value || ""}
            onChangeFunction={(e) => handleChange(e.target.value)}
            size="large"
            className="w-full"
            disabled={disabled}
            required={required}
          />
        );

      case FieldRenderType.PHONE: {
        return (
          <PhoneInput
            country={defaultCountry}
            preferredCountries={preferredCountries}
            value={value || ""}
            onChange={(val) => {
              const formatted = val.startsWith("+") ? val : `+${val}`;
              handleChange(formatted);
            }}
            enableSearch={true}
            disabled={disabled}
            placeholder={enterPlaceholder}
            // !h-10 matches the `size="large"` inputs this renderer uses for
            // every other field type; without it the library's padding-derived
            // height makes the phone field visibly taller than its neighbours.
            inputClass="!w-full !h-10"
            containerClass="!w-full"
          />
        );
      }

      case FieldRenderType.DATE:
        // Using native date input because the learner app's Calendar component
        // is a react-date-range *range* picker (mode="range" only), not a
        // single-date picker. The native <input type="date"> gives a good UX
        // on all modern browsers and avoids the component mismatch crash.
        return (
          <input
            type="date"
            value={value || ""}
            onChange={(e) => handleChange(e.target.value)}
            disabled={disabled}
            required={required}
            placeholder={placeholder || configPlaceholder || t("customFields.pickDate")}
            className="flex w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
        );

      case FieldRenderType.TEXTAREA:
        return (
          <Textarea
            placeholder={enterPlaceholder}
            value={value || ""}
            onChange={(e) => handleChange(e.target.value)}
            disabled={disabled}
            required={required}
            rows={3}
            className="min-h-16 w-full"
          />
        );

      case FieldRenderType.CHECKBOX: {
        // Optional section heading + long body (e.g. Terms & Conditions) shown
        // above the checkbox. The heading stays pinned above; the body scrolls.
        // `whitespace-pre-line` preserves the admin's line breaks.
        const heading = parsedConfig?.heading;
        const description = parsedConfig?.description;
        return (
          <div className="flex flex-col gap-2">
            {heading && (
              <h3 className="text-base font-semibold text-neutral-800">{heading}</h3>
            )}
            {description && (
              <div className="max-h-72 overflow-y-auto whitespace-pre-line rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
                {description}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Checkbox
                checked={value === "true"}
                onCheckedChange={(checked) =>
                  handleChange(checked === true ? "true" : "false")
                }
                disabled={disabled}
              />
              <Label className="text-sm">
                {name}
                {required && <span className="text-danger-600"> *</span>}
              </Label>
            </div>
          </div>
        );
      }

      case FieldRenderType.DROPDOWN:
        return (
          <Select
            value={value || ""}
            onValueChange={handleChange}
            disabled={disabled}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={placeholder || configPlaceholder || t("customFields.selectField", { name })} />
            </SelectTrigger>
            <SelectContent>
              {(resolvedOptions || []).map((opt, idx) => (
                <SelectItem key={opt._id ?? idx} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case FieldRenderType.RADIO:
        // Wrapped in a div so that FormControl's Slot doesn't merge its
        // id / aria-* props directly onto the Radix RadioGroup root, which
        // breaks internal ID management and makes items unclickable.
        return (
          <div>
            <RadioGroup
              value={value || ""}
              onValueChange={handleChange}
              disabled={disabled}
              className="flex flex-col gap-2"
            >
              {(resolvedOptions || []).map((opt, idx) => (
                <div key={opt._id ?? idx} className="flex items-center space-x-2">
                  <RadioGroupItem value={opt.value} id={`${name}-${idx}`} />
                  <Label htmlFor={`${name}-${idx}`}>{opt.label}</Label>
                </div>
              ))}
            </RadioGroup>
          </div>
        );

      case FieldRenderType.MULTI_SELECT: {
        // Multi-select checkboxes: value is a JSON array like ["Option1","Option3"]
        let selected: string[] = [];
        try {
          selected = value ? JSON.parse(value) : [];
        } catch {
          selected = value ? [value] : [];
        }
        const toggleOption = (optValue: string) => {
          const next = selected.includes(optValue)
            ? selected.filter((s) => s !== optValue)
            : [...selected, optValue];
          handleChange(JSON.stringify(next));
        };
        return (
          <div className="flex flex-col gap-2">
            {(resolvedOptions || []).map((opt, idx) => (
              <div key={opt._id ?? idx} className="flex items-center space-x-2">
                <Checkbox
                  checked={selected.includes(opt.value)}
                  onCheckedChange={() => toggleOption(opt.value)}
                  disabled={disabled}
                  id={`${name}-ms-${idx}`}
                />
                <Label htmlFor={`${name}-ms-${idx}`}>{opt.label}</Label>
              </div>
            ))}
          </div>
        );
      }

      case FieldRenderType.FILE: {
        const acceptAttr = isUnrestrictedFileTypes(allowedFileTypes)
          ? undefined
          : allowedFileTypes!.map((t) => `.${t}`).join(",");
        const isValidUrl =
          value && (value.startsWith("http://") || value.startsWith("https://"));
        return (
          <div className="flex flex-col gap-2">
            <input
              type="file"
              accept={acceptAttr}
              disabled={disabled || isUploading}
              onChange={handleFileChange}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm file:me-4 file:rounded file:border-0 file:bg-primary-50 file:px-4 file:py-1 file:text-sm file:font-medium file:text-primary-700 hover:file:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
            />
            {isUploading && (
              <div className="flex items-center gap-2 text-sm text-neutral-600">
                <SpinnerGap className="size-4 animate-spin" />
                {t("customFields.file.uploading")}
              </div>
            )}
            {!isUploading && uploadedFileName && (
              <div className="text-xs text-success-600">{t("customFields.file.uploaded", { fileName: uploadedFileName })}</div>
            )}
            {!isUploading && !uploadedFileName && isValidUrl && (
              <a
                href={value}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary-500 underline"
              >
                {t("customFields.file.viewCurrentFile")}
              </a>
            )}
            {!isUnrestrictedFileTypes(allowedFileTypes) && (
              <p className="text-xs text-neutral-500">
                {t("customFields.file.allowedTypes", { allowed: allowedFileTypes!.join(", ") })}
                {maxSizeMB && t("customFields.file.maxSize", { maxSizeMB })}
              </p>
            )}
          </div>
        );
      }

      default:
        return (
          <MyInput
            inputType="text"
            inputPlaceholder={enterPlaceholder}
            input={value || ""}
            onChangeFunction={(e) => handleChange(e.target.value)}
            size="large"
            className="w-full"
            disabled={disabled}
            required={required}
          />
        );
    }
  };

  const helpText = parsedConfig?.helpText?.trim();
  if (!helpText) return renderControl();
  return (
    <div className="flex flex-col gap-1">
      {renderControl()}
      <p className="text-caption text-neutral-500">{helpText}</p>
    </div>
  );
};
