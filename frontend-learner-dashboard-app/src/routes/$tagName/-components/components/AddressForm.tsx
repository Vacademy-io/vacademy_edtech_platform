import React, { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import { SpinnerGap, MapPin } from "@phosphor-icons/react";

/**
 * Backend-shaped output. Parent reads this via getValue() at submit time.
 * UserDTO only has columns for these four fields (addressLine max 512 chars,
 * city max 255, region max 255, pinCode regex \d{6}), so granular UI inputs
 * (house no, landmark, district, post office) are concatenated into
 * addressLine — backend doesn't store them separately.
 */
export interface AddressFormValue {
  addressLine: string;
  city: string;
  region: string;
  pinCode: string;
}

export interface AddressFormHandle {
  validate: () => boolean;
  getValue: () => AddressFormValue;
}

interface AddressFormProps {
  /**
   * Pre-fill values from the logged-in user's StudentDetails. Only the four
   * backend-indexed fields are restored — granular fields stay blank because
   * we can't reliably parse them back out of the stored addressLine.
   */
  initial?: { city?: string; region?: string; pinCode?: string };
}

const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand",
  "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab",
  "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi",
  "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
];

const PINCODE_API = "https://api.postalpincode.in/pincode";

const labelCls = "text-caption font-bold text-gray-900 uppercase flex items-center gap-1.5";
const inputBase =
  "w-full px-3 py-2 bg-gray-50 border rounded-catalogue-md transition-all focus:bg-white focus:ring-2 text-sm font-medium";
const inputDefault = "border-gray-200 focus:ring-primary-50 focus:border-primary-400";
const inputError = "border-red-300 focus:ring-red-50";
const errorText = "text-red-500 text-caption font-semibold";

export const AddressForm = forwardRef<AddressFormHandle, AddressFormProps>(({ initial }, ref) => {
  const { t } = useTranslation("coursePlayerB");
  const [houseNo, setHouseNo] = useState("");
  const [area, setArea] = useState("");
  const [landmark, setLandmark] = useState("");
  const [pinCode, setPinCode] = useState("");
  const [stateName, setStateName] = useState("");
  const [district, setDistrict] = useState("");
  const [postOffice, setPostOffice] = useState("");
  const [postOfficeOptions, setPostOfficeOptions] = useState<string[]>([]);
  const [city, setCity] = useState("");

  const [pinLookupLoading, setPinLookupLoading] = useState(false);
  const [pinLookupError, setPinLookupError] = useState<string | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Pre-fill on initial mount / when StudentDetails loads after open. We don't
  // guard against overwriting user edits because, in this modal's lifecycle,
  // `initial` only flips from undefined → defined once per open.
  useEffect(() => {
    if (initial?.city) setCity(initial.city);
  }, [initial?.city]);
  useEffect(() => {
    if (initial?.region) setStateName(initial.region);
  }, [initial?.region]);
  useEffect(() => {
    if (initial?.pinCode) setPinCode(initial.pinCode);
  }, [initial?.pinCode]);

  // Debounced India Post lookup. Fires once `pinCode` is a clean 6-digit
  // string. Auto-fills state + district + Post Office list. User can still
  // override the state dropdown manually if the API picks the wrong one.
  useEffect(() => {
    if (!/^\d{6}$/.test(pinCode)) {
      setPostOfficeOptions([]);
      setPinLookupError(null);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPinLookupLoading(true);
      setPinLookupError(null);
      try {
        const res = await fetch(`${PINCODE_API}/${pinCode}`, { signal: controller.signal });
        const data = await res.json();
        const first = Array.isArray(data) ? data[0] : null;
        if (
          first?.Status === "Success" &&
          Array.isArray(first.PostOffice) &&
          first.PostOffice.length > 0
        ) {
          const offices: string[] = first.PostOffice
            .map((po: { Name?: string }) => po.Name)
            .filter((n: string | undefined): n is string => !!n);
          setPostOfficeOptions(offices);
          const firstPO = first.PostOffice[0];
          if (firstPO?.State) setStateName(firstPO.State);
          if (firstPO?.District) setDistrict(firstPO.District);
          setPostOffice((current) =>
            current && offices.includes(current) ? current : offices[0] || ""
          );
        } else {
          setPostOfficeOptions([]);
          setPinLookupError(t("addressForm.errors.pincodeNotFound"));
        }
      } catch (e) {
        if ((e as { name?: string }).name !== "AbortError") {
          setPinLookupError(t("addressForm.errors.indiaPostUnreachable"));
        }
      } finally {
        setPinLookupLoading(false);
      }
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [pinCode]);

  const buildAddressLine = (): string => {
    const parts: string[] = [];
    if (houseNo.trim()) parts.push(houseNo.trim());
    if (area.trim()) parts.push(area.trim());
    if (landmark.trim()) parts.push(`Near ${landmark.trim()}`);
    if (postOffice.trim()) parts.push(`PO ${postOffice.trim()}`);
    if (district.trim()) parts.push(`Dist ${district.trim()}`);
    return parts.join(", ");
  };

  const runValidation = (): Record<string, string> => {
    const next: Record<string, string> = {};
    if (!houseNo.trim()) next.houseNo = t("addressForm.errors.required");
    if (!area.trim()) next.area = t("addressForm.errors.required");
    if (!pinCode.trim()) next.pinCode = t("addressForm.errors.pincodeRequired");
    else if (!/^\d{6}$/.test(pinCode.trim())) next.pinCode = t("addressForm.errors.pincodeDigits");
    if (!stateName.trim()) next.stateName = t("addressForm.errors.selectState");
    if (!district.trim()) next.district = t("addressForm.errors.required");
    if (!postOffice.trim()) next.postOffice = t("addressForm.errors.required");
    if (!city.trim()) next.city = t("addressForm.errors.required");
    return next;
  };

  useImperativeHandle(ref, () => ({
    validate: () => {
      const next = runValidation();
      setErrors(next);
      return Object.keys(next).length === 0;
    },
    getValue: () => ({
      addressLine: buildAddressLine(),
      city: city.trim(),
      region: stateName.trim(),
      pinCode: pinCode.trim(),
    }),
  }));

  const handleBlur = (field: string) => {
    const next = runValidation();
    setErrors((prev) => ({ ...prev, [field]: next[field] || "" }));
  };

  const onPincodeChange = (raw: string) => {
    const cleaned = raw.replace(/\D/g, "").slice(0, 6);
    setPinCode(cleaned);
    if (errors.pinCode) setErrors((prev) => ({ ...prev, pinCode: "" }));
  };

  return (
    <div className="space-y-3">
      <label className={labelCls}>
        <MapPin className="h-3 w-3" /> {t("addressForm.label")}
      </label>

      {/* House / Flat / Building No. */}
      <div className="space-y-1">
        <input
          type="text"
          value={houseNo}
          onChange={(e) => { setHouseNo(e.target.value); if (errors.houseNo) setErrors((p) => ({ ...p, houseNo: "" })); }}
          onBlur={() => handleBlur("houseNo")}
          placeholder={t("addressForm.placeholders.houseNo")}
          className={`${inputBase} ${errors.houseNo ? inputError : inputDefault}`}
        />
        {errors.houseNo && <p className={errorText}>{errors.houseNo}</p>}
      </div>

      {/* Area / Street / Locality */}
      <div className="space-y-1">
        <input
          type="text"
          value={area}
          onChange={(e) => { setArea(e.target.value); if (errors.area) setErrors((p) => ({ ...p, area: "" })); }}
          onBlur={() => handleBlur("area")}
          placeholder={t("addressForm.placeholders.area")}
          className={`${inputBase} ${errors.area ? inputError : inputDefault}`}
        />
        {errors.area && <p className={errorText}>{errors.area}</p>}
      </div>

      {/* Landmark (optional) */}
      <input
        type="text"
        value={landmark}
        onChange={(e) => setLandmark(e.target.value)}
        placeholder={t("addressForm.placeholders.landmark")}
        className={`${inputBase} ${inputDefault}`}
      />

      {/* Pincode + City */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <div className="relative">
            <input
              type="text"
              inputMode="numeric"
              value={pinCode}
              onChange={(e) => onPincodeChange(e.target.value)}
              onBlur={() => handleBlur("pinCode")}
              placeholder={t("addressForm.placeholders.pincode")}
              maxLength={6}
              className={`${inputBase} pe-8 ${errors.pinCode ? inputError : inputDefault}`}
            />
            {pinLookupLoading && (
              <SpinnerGap className="absolute end-2.5 top-2.5 h-4 w-4 text-gray-400 animate-spin" />
            )}
          </div>
          {errors.pinCode && <p className={errorText}>{errors.pinCode}</p>}
          {!errors.pinCode && pinLookupError && <p className={errorText}>{pinLookupError}</p>}
        </div>

        <div className="space-y-1">
          <input
            type="text"
            value={city}
            onChange={(e) => { setCity(e.target.value); if (errors.city) setErrors((p) => ({ ...p, city: "" })); }}
            onBlur={() => handleBlur("city")}
            placeholder={t("addressForm.placeholders.city")}
            className={`${inputBase} ${errors.city ? inputError : inputDefault}`}
          />
          {errors.city && <p className={errorText}>{errors.city}</p>}
        </div>
      </div>

      {/* State + District */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <select
            value={stateName}
            onChange={(e) => { setStateName(e.target.value); if (errors.stateName) setErrors((p) => ({ ...p, stateName: "" })); }}
            onBlur={() => handleBlur("stateName")}
            className={`${inputBase} ${errors.stateName ? inputError : inputDefault}`}
          >
            <option value="">{t("addressForm.selectState")}</option>
            {INDIAN_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {errors.stateName && <p className={errorText}>{errors.stateName}</p>}
        </div>

        <div className="space-y-1">
          <input
            type="text"
            value={district}
            onChange={(e) => { setDistrict(e.target.value); if (errors.district) setErrors((p) => ({ ...p, district: "" })); }}
            onBlur={() => handleBlur("district")}
            placeholder={t("addressForm.placeholders.district")}
            className={`${inputBase} ${errors.district ? inputError : inputDefault}`}
          />
          {errors.district && <p className={errorText}>{errors.district}</p>}
        </div>
      </div>

      {/* Post Office */}
      <div className="space-y-1">
        {postOfficeOptions.length > 0 ? (
          <select
            value={postOffice}
            onChange={(e) => { setPostOffice(e.target.value); if (errors.postOffice) setErrors((p) => ({ ...p, postOffice: "" })); }}
            onBlur={() => handleBlur("postOffice")}
            className={`${inputBase} ${errors.postOffice ? inputError : inputDefault}`}
          >
            <option value="">{t("addressForm.selectPostOffice")}</option>
            {postOfficeOptions.map((po) => (
              <option key={po} value={po}>{po}</option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={postOffice}
            onChange={(e) => { setPostOffice(e.target.value); if (errors.postOffice) setErrors((p) => ({ ...p, postOffice: "" })); }}
            onBlur={() => handleBlur("postOffice")}
            placeholder={t("addressForm.placeholders.postOffice")}
            className={`${inputBase} ${errors.postOffice ? inputError : inputDefault}`}
          />
        )}
        {errors.postOffice && <p className={errorText}>{errors.postOffice}</p>}
      </div>
    </div>
  );
});

AddressForm.displayName = "AddressForm";
