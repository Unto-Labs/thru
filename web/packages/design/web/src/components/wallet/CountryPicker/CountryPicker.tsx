import * as React from "react";
import { RegionPicker } from "../RegionPicker/RegionPicker";
import {
  matchesRegion,
  type RegionOption,
} from "../RegionPicker/regionOptions";
import "./CountryPicker.css";

export type CountryBlocks = Readonly<Partial<Record<string, string>>>;

export interface CountryPickerProps {
  countries: readonly string[];
  value: string | null;
  onValueChange: (code: string) => void;
  label: string;
  blocked?: CountryBlocks;
  error?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

const COUNTRY_ALIASES: Readonly<Partial<Record<string, readonly string[]>>> = {
  AE: ["uae"],
  GB: ["uk"],
  KR: ["korea"],
  NL: ["holland"],
  US: ["usa", "america"],
};

function normalizeSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function matchesCountry(option: RegionOption, query: string): boolean {
  return matchesRegion(
    option,
    query,
    normalizeSearch,
    COUNTRY_ALIASES[option.code.toUpperCase()],
  );
}

export function CountryPicker({
  countries,
  blocked,
  ...props
}: CountryPickerProps) {
  const options = React.useMemo(() => {
    const countryNames = new Intl.DisplayNames("en", { type: "region" });
    return countries.map((code) => ({
      code,
      name: countryNames.of(code) ?? code,
      blockedReason: blocked?.[code],
    }));
  }, [countries, blocked]);
  return (
    <RegionPicker
      {...props}
      region="country"
      options={options}
      matches={matchesCountry}
    />
  );
}
