import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { type Control } from "react-hook-form";
import { cn } from "@/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Check, CaretUpDown } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";

interface Options {
  _id: string | number;
  value: string | number;
  label: string;
}

interface SelectFieldProps {
  className?: string;
  label: string;
  name: string;
  options: Options[];
  required?: boolean;
  onSelect?: (value: string) => void;
  // eslint-disable-next-line
  control: any;
  disabled?: boolean;
}

const ComboboxField: React.FC<SelectFieldProps> = ({
  label,
  name,
  options,
  required = false,
  control,
  onSelect,
  disabled = false,
  className,
}) => {
  const { t } = useTranslation("uiAtomsA");
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Memoize filtered options to optimize performance with large lists (like cities)
  const filteredOptions = useMemo(() => {
    if (!searchQuery) return options;
    return options.filter((option) =>
      option.label.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [options, searchQuery]);

  return (
    <FormField
      control={control as Control}
      name={name}
      render={({ field }) => (
        <FormItem className={cn("w-full", className)}>
          <FormLabel>
            {label}
            {required && <span className="text-red-500">*</span>}
          </FormLabel>
          <Popover open={open} onOpenChange={setOpen} modal={true}>
            <PopoverTrigger asChild>
              <FormControl>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={open}
                  className={cn(
                    "w-full justify-between font-normal",
                    !field.value && "text-muted-foreground"
                  )}
                  disabled={disabled}
                >
                  {field.value
                    ? options.find(
                        (option) => option.value.toString() === field.value
                      )?.label || field.value
                    : t("comboboxField.selectLabel", { label })}
                  <CaretUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </FormControl>
            </PopoverTrigger>
            <PopoverContent className="w-radix-popover p-0">
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder={t("comboboxField.searchLabel", { label })}
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                />
                <CommandList>
                  <CommandEmpty>{t("comboboxField.noResults")}</CommandEmpty>
                  <CommandGroup>
                    {filteredOptions.map((option) => (
                      <CommandItem
                        key={option._id}
                        value={option.label}
                        onSelect={() => {
                          const val = option.value.toString();
                          field.onChange(val);
                          if (onSelect) {
                            onSelect(val);
                          }
                          setOpen(false);
                          setSearchQuery(""); // clear search on select
                        }}
                      >
                        <Check
                          className={cn(
                            "me-2 h-4 w-4",
                            field.value === option.value.toString()
                              ? "opacity-100"
                              : "opacity-0"
                          )}
                        />
                        {option.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <FormMessage />
        </FormItem>
      )}
    />
  );
};

export default ComboboxField;
