import { useContext } from "react";
import { ThruContext } from "../ThruContext";

/** Must be used within a ThruProvider. */
export function useThru() {
    const context = useContext(ThruContext);
    return context;
}