import * as React from "react";
import { Toast as Base } from "@base-ui/react/toast";
import "./Toast.css";

export type ToastKind = "success" | "error" | "info" | "warn";

const Icon = ({ kind }: { kind: ToastKind }) => {
  const p = { width: 13, height: 13, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true } as const;
  const s = { stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "success") return <svg {...p}><path d="M3 8.5l3.5 3.5L13 4" {...s} /></svg>;
  if (kind === "error") return <svg {...p}><path d="M4 4l8 8M12 4l-8 8" {...s} /></svg>;
  if (kind === "warn") return <svg {...p}><path d="M8 2l6 11H2L8 2zM8 6.5v3" {...s} /><circle cx="8" cy="11.5" r="0.6" fill="currentColor" /></svg>;
  return <svg {...p}><path d="M8 7.5v4M8 4.6v.2" {...s} /><circle cx="8" cy="8" r="6.2" {...s} /></svg>;
};

function ToastList() {
  const { toasts } = Base.useToastManager();
  return toasts.map((toast) => {
    const kind = ((toast.data as { kind?: ToastKind } | undefined)?.kind ?? "info") as ToastKind;
    return (
      <Base.Root key={toast.id} toast={toast} className={`tds-toast tds-toast--${kind}`}>
        <span className="tds-toast__icon">
          <Icon kind={kind} />
        </span>
        <div className="tds-toast__main">
          <Base.Title className="tds-toast__title" />
          <Base.Description className="tds-toast__desc" />
        </div>
        <Base.Close className="tds-toast__close" aria-label="Close">
          <svg width={11} height={11} viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
          </svg>
        </Base.Close>
        <span
          className="tds-toast__bar"
          style={{ "--toast-dur": `${(toast.timeout ?? 5000) / 1000}s` } as React.CSSProperties}
        />
      </Base.Root>
    );
  });
}

/**
 * Toast — transient notifications with a typed accent bar + timeout.
 *
 *   <Toast.Provider>
 *     <App />
 *     <Toast.Viewport />
 *   </Toast.Provider>
 *
 *   const toast = Toast.useToast();
 *   toast.add({ title: "Saved", description: "…", data: { kind: "success" } });
 */
export const Toast = {
  Provider: Base.Provider,
  useToast: Base.useToastManager,
  Viewport: function ToastViewport() {
    return (
      <Base.Portal>
        <Base.Viewport className="tds-toast-viewport">
          <ToastList />
        </Base.Viewport>
      </Base.Portal>
    );
  },
};
