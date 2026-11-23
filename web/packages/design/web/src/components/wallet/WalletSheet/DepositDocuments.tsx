import * as React from "react";
import { Button } from "../../Button/Button";
import { PasskeyIcon } from "../../PasskeyIcon/PasskeyIcon";
import { Spinner } from "../../Spinner/Spinner";
import { Tag } from "../../Tag/Tag";
import {
  DocumentCapture,
  DocumentIcon,
} from "../DocumentCapture/DocumentCapture";
import { Screen } from "../Screen/Screen";
import { StepGlyph } from "../Steps/Steps";
import { StepHeader, type DepositStepProgress } from "./DepositScreens";
import "./DepositScreens.css";

type DocumentSelection = {
  file: File | null;
  onFileChange: (file: File | null) => void;
};

type DocumentRow = { name: string; state: "needed" | "added" | "sent" };

export interface WalletSheetDepositDocumentsProps extends DocumentSelection {
  title?: React.ReactNode;
  description?: React.ReactNode;
  step?: DepositStepProgress;
  documents: DocumentRow[];
  label: string;
  back?: DocumentSelection;
  submitLabel?: string;
  selectionDisabled?: boolean;
  submitDisabled?: boolean;
  status?: React.ReactNode;
  submitting?: boolean;
  onSubmit: () => void;
}

export function DepositDocuments(props: WalletSheetDepositDocumentsProps) {
  const {
    title = "Add a document",
    description,
    step = { count: 3, active: 1 },
    documents,
    label,
    file,
    onFileChange,
    back,
    submitLabel = "Send with passkey",
    status,
    submitting,
    onSubmit,
  } = props;
  const hasFiles = !!file && (!back || !!back.file);
  const selectionDisabled = submitting || props.selectionDisabled;
  const submitDisabled = !hasFiles || submitting || props.submitDisabled;
  return (
    <Screen>
      <StepHeader title={title} description={description} step={step} />
      <form
        className="tds-dep__kyc"
        onSubmit={(event) => {
          event.preventDefault();
          if (!submitDisabled) onSubmit();
        }}
      >
        <div className="tds-dep__kyc-group">
          <ul className="tds-dep__documents" role="list">
            {documents.map(({ name, state }, index) => (
              <li key={index} className="tds-dep__row tds-dep__document-row">
                <DocumentIcon />
                <span className="tds-dep__document-name">{name}</span>
                {state === "needed" ? (
                  <Tag>Needed</Tag>
                ) : (
                  <span
                    role="img"
                    aria-label={state === "added" ? "Added" : "Sent"}
                  >
                    <StepGlyph status="done" />
                  </span>
                )}
              </li>
            ))}
          </ul>
          <DocumentCapture
            label={label}
            value={file}
            onValueChange={onFileChange}
            disabled={selectionDisabled}
          />
          {back && (
            <DocumentCapture
              label="Back of ID"
              value={back.file}
              onValueChange={back.onFileChange}
              disabled={selectionDisabled}
            />
          )}
        </div>
        <div className="tds-dep__kyc-footer">
          {status && (
            <div className="tds-dep__note" role="status">
              {status}
            </div>
          )}
          <Button
            type="submit"
            variant="primary"
            className="tds-wsheet__cta"
            disabled={submitDisabled}
            aria-busy={submitting || undefined}
          >
            {submitting ? <Spinner tone="inherit" /> : <PasskeyIcon />}
            {submitLabel}
          </Button>
        </div>
      </form>
    </Screen>
  );
}
