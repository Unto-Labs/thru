import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import { font, space, text, touch } from "./tokens";
import { makeStyles, useThemeColors } from "./theme";
import { Button } from "./Button";
import { IconAlert, IconCheck, IconClose, IconInfo, IconScan, IconWarning } from "./Icons";
import { Spinner } from "./loading/MarkDrawOn";

const IS_WEB = Platform.OS === "web";

/** What a caller can do with a kit field through `inputRef`. Structural, so
    an app on its own copy of react-native's types can hold one. */
export interface FieldHandle {
  focus(): void;
  blur(): void;
}

export interface AddressFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  /** Paste, shown while the field is empty. */
  onPaste?: () => void;
  /** A QR scan button beside Paste, shown while the field is empty. */
  onScan?: () => void;
  /** Clear, shown once it has a value; empties the field when absent. */
  onClear?: () => void;
  /** Marks the value as wrong. */
  error?: boolean;
  placeholder?: string;
  accessibilityLabel?: string;
  autoFocus?: boolean;
  onSubmitEditing?: TextInputProps["onSubmitEditing"];
  inputRef?: RefObject<FieldHandle | null>;
}

export function AddressField({
  value,
  onChangeText,
  onPaste,
  onScan,
  onClear,
  error = false,
  placeholder,
  accessibilityLabel,
  autoFocus,
  onSubmitEditing,
  inputRef,
}: AddressFieldProps) {
  const styles = useStyles();
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);
  /* A textarea's scrollHeight is never less than its own height, so measure
     at natural height on web or the field could only grow. */
  const [contentHeight, setContentHeight] = useState(0);
  const nodeRef = useRef<TextInput | null>(null);
  const setInputRef = useCallback((node: TextInput | null) => {
    nodeRef.current = node;
    if (inputRef) inputRef.current = node;
  }, [inputRef]);
  useLayoutEffect(() => {
    if (!IS_WEB) return;
    const node = nodeRef.current as unknown as {
      scrollHeight: number;
      style: { height: string };
    } | null;
    if (!node) return;
    const height = node.style.height;
    node.style.height = "auto";
    const natural = Math.ceil(node.scrollHeight);
    node.style.height = height;
    setContentHeight(natural);
  });
  const empty = value === "";

  return (
    <View
      style={[
        styles.field,
        focused ? styles.fieldFocused : null,
        error ? styles.fieldError : null,
      ]}
    >
      <TextInput
        accessibilityLabel={accessibilityLabel}
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect={false}
        autoFocus={autoFocus}
        blurOnSubmit={false}
        multiline
        /* One row until the address wraps; the field grows from there. */
        numberOfLines={1}
        onBlur={() => setFocused(false)}
        /* An address has no line breaks; Return is the field's submit, and a
           pasted break is dropped. */
        onChangeText={(next) => onChangeText(next.replace(/[\r\n]+/g, ""))}
        onContentSizeChange={
          IS_WEB
            ? undefined
            : (event) => setContentHeight(Math.ceil(event.nativeEvent.contentSize.height))
        }
        onFocus={() => setFocused(true)}
        onKeyPress={
          IS_WEB
            ? (event) => {
                const native = event.nativeEvent as unknown as {
                  key?: string;
                  shiftKey?: boolean;
                  repeat?: boolean;
                  isComposing?: boolean;
                };
                if (native.key !== "Enter" || native.shiftKey || native.isComposing) return;
                (event as unknown as { preventDefault?: () => void }).preventDefault?.();
                onSubmitEditing?.(event as never);
              }
            : undefined
        }
        onSubmitEditing={IS_WEB ? undefined : onSubmitEditing}
        placeholder={placeholder}
        placeholderTextColor={colors.fgSubtle}
        ref={setInputRef}
        returnKeyType="next"
        selectionColor={colors.accent}
        spellCheck={false}
        style={[
          styles.input,
          contentHeight > 0
            ? { height: Math.max(touch.controlMd - 2, contentHeight) }
            : null,
        ]}
        submitBehavior="submit"
        value={value}
      />
      {empty ? (
        onPaste || onScan ? (
          <View style={styles.pasteSlot}>
            {onPaste ? <Button label="Paste" onPress={onPaste} size="sm" variant="outline" /> : null}
            {onScan ? (
              <Pressable
                accessibilityLabel="Scan QR code"
                accessibilityRole="button"
                hitSlop={(touch.hitMin - touch.controlSm) / 2}
                onPress={onScan}
                style={({ pressed }) => [styles.scan, pressed ? { opacity: 0.85 } : null]}
              >
                <IconScan size={18} color={colors.fg} />
              </Pressable>
            ) : null}
          </View>
        ) : null
      ) : (
        <Pressable
          accessibilityLabel="Clear address"
          accessibilityRole="button"
          onPress={onClear ?? (() => onChangeText(""))}
          style={styles.clear}
        >
          <IconClose size={16} color={colors.fgMuted} />
        </Pressable>
      )}
    </View>
  );
}

export type FieldHelperTone = "muted" | "checking" | "ok" | "warn" | "error";

export interface FieldHelperProps {
  tone: FieldHelperTone;
  message: string;
  /** Shows an inline Retry, for a check that could not be made. */
  onRetry?: () => void;
}

export function FieldHelper({ tone, message, onRetry }: FieldHelperProps) {
  const styles = useStyles();
  const colors = useThemeColors();
  const color =
    tone === "ok"
      ? colors.forest
      : tone === "warn"
        ? colors.saffron
        : tone === "error"
          ? colors.error
          : colors.fgMuted;
  return (
    <View accessibilityLiveRegion="polite" style={styles.helper}>
      <View style={styles.helperGlyph}>
        {tone === "checking" ? (
          <Spinner size={12} color={colors.fgMuted} />
        ) : tone === "ok" ? (
          <IconCheck size={16} color={color} />
        ) : tone === "warn" ? (
          <IconWarning size={16} color={color} />
        ) : tone === "error" ? (
          <IconAlert size={16} color={color} />
        ) : (
          <IconInfo size={16} color={color} />
        )}
      </View>
      <Text style={[styles.helperText, { color }]}>
        {message}
        {onRetry ? " " : null}
        {onRetry ? (
          <Text
            accessibilityRole="button"
            onPress={onRetry}
            style={styles.retry}
            suppressHighlighting
          >
            Retry
          </Text>
        ) : null}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  field: {
    alignItems: "flex-start",
    backgroundColor: c.bg,
    borderColor: c.borderStrong,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: touch.controlMd,
  },
  fieldFocused: {
    borderColor: c.fgMuted,
    ...(IS_WEB ? { boxShadow: `inset 0 0 0 1px ${c.fgMuted}` } : null),
  } as never,
  fieldError: {
    borderColor: c.error,
    ...(IS_WEB ? { boxShadow: "none" } : null),
  } as never,
  input: {
    color: c.fg,
    flex: 1,
    fontFamily: font.mono,
    fontSize: text.base,
    lineHeight: 22,
    minHeight: touch.controlMd - 2,
    minWidth: 0,
    paddingBottom: 12,
    paddingLeft: 12,
    paddingRight: space[2],
    paddingTop: 12,
    textAlignVertical: "top",
    ...(IS_WEB
      ? { outlineStyle: "none", resize: "none", wordBreak: "break-all", overflow: "hidden" }
      : null),
  } as never,
  /* Inset 5 so the 36pt button sits inside the 46pt interior. */
  pasteSlot: { flexDirection: "row", gap: 6, padding: 5 },
  /* Button's outline sm, square around the glyph. */
  scan: {
    alignItems: "center",
    borderColor: c.borderStrong,
    borderWidth: 1,
    height: touch.controlSm,
    justifyContent: "center",
    width: touch.controlSm,
  },
  clear: {
    alignItems: "center",
    height: touch.hitMin,
    justifyContent: "center",
    width: touch.hitMin,
  },
  helper: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: space[2],
    marginTop: space[2],
  },
  helperGlyph: {
    alignItems: "center",
    height: 19,
    justifyContent: "center",
    width: 16,
  },
  helperText: {
    flex: 1,
    fontFamily: font.sans,
    fontSize: text.sm,
    lineHeight: 19,
  },
  retry: {
    color: c.fg,
    fontFamily: font.monoSemiBold,
    fontSize: text.sm,
    textDecorationLine: "underline",
  },
}));
