import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CaretDown, CaretUp, XCircle } from "@phosphor-icons/react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuPortal,
} from "@radix-ui/react-dropdown-menu";
import { myDropDownProps } from "./utils/types/dropdown-types";
import { dropdownSchema } from "./utils/schema/dropdown-schema";
import z from "zod";

export const MyDropdown = ({
    currentValue,
    handleChange,
    dropdownList,
    children,
    onSelect,
    placeholder,
    error,
    validation = dropdownSchema,
    onValidation,
}: myDropDownProps) => {
    const { t } = useTranslation("uiAtomsA");
    const resolvedPlaceholder = placeholder ?? t("dropdown.placeholder");
    const [isOpen, setIsOpen] = useState<boolean>(false);
    const [validationError, setValidationError] = useState<string>("");

    const DropdownError = ({ errorMessage }: { errorMessage: string }) => {
        return (
            <div className="flex items-center gap-1 ps-1 text-body font-regular text-danger-600">
                <span>
                    <XCircle />
                </span>
                <span className="mt-0.5">{errorMessage}</span>
            </div>
        );
    };

    const validateValue = (value: string | undefined) => {
        try {
            validation.parse({ value: value || "" });
            setValidationError("");
            onValidation?.(true);
            return true;
        } catch (error) {
            if (error instanceof z.ZodError) {
                setValidationError(error.errors[0]?.message || "");
                onValidation?.(false);
            }
            return false;
        }
    };

    useEffect(() => {
        validateValue(currentValue);
    }, [currentValue]);

    const handleValueChange = (value: string) => {
        if (handleChange) {
            handleChange(value);
        }
        if (onSelect) {
            onSelect(value);
        }
        validateValue(value);
        setIsOpen(false);
    };

    return (
        <div className="flex flex-col gap-1">
            <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
                {children ? (
                    <DropdownMenuTrigger className="w-full focus:outline-none">
                        {children}
                    </DropdownMenuTrigger>
                ) : (
                    <DropdownMenuTrigger
                        className={`inline-flex h-9 w-full min-w-60 items-center justify-between rounded-lg border px-3 py-2 text-subtitle text-neutral-600 focus:outline-none ${
                            error || validationError
                                ? "border-danger-600"
                                : isOpen
                                  ? "border-primary-500"
                                  : "border-neutral-300 hover:border-primary-200 focus:border-primary-500"
                        }`}
                    >
                        <div className={`truncate ${!currentValue ? "text-neutral-400" : ""}`}>
                            {currentValue || resolvedPlaceholder}
                        </div>
                        <div className="ms-2 flex-shrink-0">
                            <CaretDown className={`${isOpen ? "hidden" : "visible"} size-5`} />
                            <CaretUp className={`${isOpen ? "visible" : "hidden"} size-5`} />
                        </div>
                    </DropdownMenuTrigger>
                )}
                <DropdownMenuPortal container={document.getElementById("portal-root")}>
                    <DropdownMenuContent
                        className="z-50 mt-2 min-w-60 w-[var(--radix-dropdown-menu-trigger-width)] rounded-lg bg-white py-2 shadow focus:outline-none" /* design-lint-ignore: radix internal */
                        sideOffset={5}
                        align="start"
                    >
                        {dropdownList.map((item, key) => (
                            <DropdownMenuItem
                                key={key}
                                className={`cursor-pointer truncate px-3 py-2 text-subtitle text-neutral-600 hover:bg-primary-50 ${
                                    currentValue == item ? "bg-primary-50" : "bg-none"
                                } hover:outline-none`}
                                onClick={() => handleValueChange(item)}
                            >
                                {item}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenuPortal>
            </DropdownMenu>
            {(error || validationError) && !children && (
                <DropdownError errorMessage={error || validationError} />
            )}
        </div>
    );
};
