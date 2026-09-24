/**
 * An address field and the helper line under it.
 *
 * `AddressField` is a multi-line mono field: a Thru address is 46 characters,
 * which wraps to two lines on a phone rather than scrolling out of sight.
 * Empty, it offers Paste inside the field; filled, a Clear button.
 *
 * `FieldHelper` is the one line under a field that says what the app thinks
 * of it - muted, checking, fine, a warning or an error - announced politely
 * to screen readers as it changes, with an optional Retry.
 */
import { type RefObject, useState } from "react";
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
import { IconAlert, IconCheck, IconClose, IconInfo, IconWarning } from "./Icons";
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
  /** Clear, shown once it has a value; empties the field when absent. */
  onClear?: () => void;
  /** Marks the value as wrong: an error-red border. */
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
  /* A multi-line field on web does not grow by itself; it follows its content
     height, which includes the padding. */
  const [contentHeight, setContentHeight] = useState(0);
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
        onContentSizeChange={(event) =>
          setContentHeight(Math.ceil(event.nativeEvent.contentSize.height))
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
        ref={inputRef as RefObject<TextInput | null> | undefined}
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
        onPaste ? (
          <View style={styles.pasteSlot}>
            <Button label="Paste" onPress={onPaste} size="sm" variant="outline" />
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
    borderColor: c.accent,
    ...(IS_WEB ? { boxShadow: `inset 0 0 0 1px ${c.accent}` } : null),
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
  pasteSlot: { padding: 5 },
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
