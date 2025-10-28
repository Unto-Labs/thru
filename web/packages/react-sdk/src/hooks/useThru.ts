import { useContext } from "react";
import { ThruContext } from "../ThruContext";

/**
 * useThru - Access the Thru SDK context
 * Must be used within a ThruProvider
 */
export function useThru() {
    const context = useContext(ThruContext);
    return context;
}