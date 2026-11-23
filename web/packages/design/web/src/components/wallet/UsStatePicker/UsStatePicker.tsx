import * as React from "react";
import { RegionPicker } from "../RegionPicker/RegionPicker";
import {
  matchesUsState,
  usStateOptions,
  type UsStateBlocks,
  type UsStateCode,
} from "./usStates";

export interface UsStatePickerProps {
  value: UsStateCode | null;
  onValueChange: (code: UsStateCode) => void;
  label: string;
  blocked?: UsStateBlocks;
  error?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function UsStatePicker({ blocked, ...props }: UsStatePickerProps) {
  const options = React.useMemo(() => usStateOptions(blocked), [blocked]);
  return (
    <RegionPicker
      {...props}
      region="state"
      options={options}
      matches={matchesUsState}
    />
  );
}
