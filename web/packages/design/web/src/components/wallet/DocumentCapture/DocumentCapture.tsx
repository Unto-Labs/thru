import * as React from "react";
import { Field } from "@base-ui/react/field";
import { Button } from "../../Button/Button";
import { cn } from "../../../utils";
import {
  checkDocument,
  DOCUMENT_ACCEPT,
  DOCUMENT_CAMERA_ACCEPT,
  formatDocumentSize,
} from "./document";
import "../../Field/Field.css";
import "./DocumentCapture.css";

export interface DocumentCaptureProps {
  label: string;
  value: File | null;
  onValueChange: (file: File | null) => void;
  error?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function DocumentIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 3h7l5 5v13H6V3Z M13 3v6h5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DocumentCapture({
  label,
  value,
  onValueChange,
  error,
  disabled,
  id,
  className,
}: DocumentCaptureProps) {
  const labelId = React.useId();
  const hintId = React.useId();
  const errorId = React.useId();
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [rejection, setRejection] = React.useState<{
    for: File | null;
    error: string;
  } | null>(null);
  const [url, setUrl] = React.useState<string | null>(null);
  const checked = value ? checkDocument(value) : null;
  const accepted = checked?.ok ? checked : null;
  const isImage = accepted?.kind === "image";
  const rejected = rejection?.for === value ? rejection.error : undefined;
  const shownError =
    rejected ?? (checked && !checked.ok ? checked.error : undefined) ?? error;
  const describedBy = shownError ? `${hintId} ${errorId}` : hintId;

  React.useEffect(() => {
    if (!value || !isImage) {
      setUrl(null);
      return;
    }
    const nextUrl = URL.createObjectURL(value);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [value, isImage]);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || disabled) return;
    const result = checkDocument(file);
    if (!result.ok) {
      setRejection({ for: value, error: result.error });
      return;
    }
    setRejection(null);
    onValueChange(file);
  }

  return (
    <Field.Root
      disabled={disabled}
      className={cn("tds-field tds-doc-capture", className)}
    >
      <div
        role="group"
        aria-labelledby={labelId}
        data-error={!!shownError || undefined}
        aria-invalid={!!shownError || undefined}
      >
        <Field.Label
          id={labelId}
          nativeLabel={false}
          render={<div />}
          className="tds-field__label"
        >
          {label}
        </Field.Label>
        <div
          className="tds-doc-capture__preview"
          aria-live="polite"
          data-empty={!accepted || undefined}
        >
          {!accepted || !value ? (
            /* Pointer shortcut to the file picker; keyboard users have Upload file. */
            <button
              type="button"
              className="tds-doc-capture__pick"
              tabIndex={-1}
              disabled={disabled}
              aria-describedby={describedBy}
              onClick={() => fileRef.current?.click()}
            >
              <DocumentIcon />
              <span>Add a photo or a file</span>
            </button>
          ) : isImage ? (
            url && (
              <img
                className="tds-doc-capture__image"
                src={url}
                alt={`${label} preview`}
              />
            )
          ) : (
            <div className="tds-doc-capture__file">
              <DocumentIcon />
              <span className="tds-doc-capture__name">{value.name}</span>
              <span className="tds-doc-capture__size">
                {formatDocumentSize(value.size)}
              </span>
            </div>
          )}
        </div>
        <Field.Description id={hintId} className="tds-field__desc">
          PDF, PNG or JPG, up to 25 MB
        </Field.Description>
        <div className="tds-doc-capture__actions">
          <Button
            id={id}
            type="button"
            variant="outline"
            size="lg"
            disabled={disabled}
            aria-describedby={describedBy}
            onClick={() => cameraRef.current?.click()}
          >
            {accepted ? "Retake" : "Take photo"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={disabled}
            aria-describedby={describedBy}
            onClick={() => fileRef.current?.click()}
          >
            {accepted ? "Replace" : "Upload file"}
          </Button>
        </div>
        {shownError && (
          <Field.Error
            match
            role="alert"
            id={errorId}
            className="tds-field__error"
          >
            {shownError}
          </Field.Error>
        )}
      </div>
      <input
        ref={cameraRef}
        type="file"
        accept={DOCUMENT_CAMERA_ACCEPT}
        capture="environment"
        className="tds-doc-capture__input"
        tabIndex={-1}
        aria-hidden
        disabled={disabled}
        onChange={handleChange}
      />
      <input
        ref={fileRef}
        type="file"
        accept={DOCUMENT_ACCEPT}
        className="tds-doc-capture__input"
        tabIndex={-1}
        aria-hidden
        disabled={disabled}
        onChange={handleChange}
      />
    </Field.Root>
  );
}
