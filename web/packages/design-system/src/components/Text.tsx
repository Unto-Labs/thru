import React from 'react';
import { cn } from '../utils';

type TextProps = {
  [x: string]: unknown;
  className?: string;
  as?: React.ElementType;
  bold?: boolean;
  children?: React.ReactNode;
};

type TextComponent = React.FC<TextProps>;

const baseClasses = 'text-current';

const Base: React.FC<TextProps & { defaultClasses: string }> = ({
  as = 'p',
  children,
  className,
  defaultClasses,
  ...props
}) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { bold, ...propsWithoutBold } = props;

  return React.createElement(
    as,
    {
      className: cn(baseClasses, defaultClasses, className),
      ...propsWithoutBold,
    },
    children
  );
};

const TextStyle = (className: { normal: string; bold: string }, props: TextProps) => {
  const boldClass = props.bold ? className.bold : undefined;
  return (
    <Base
      defaultClasses={cn(className.normal, boldClass)}
      {...props}
    />
  );
};

export const Heading1: TextComponent = (props) =>
  TextStyle({ normal: 'type-heading-1', bold: 'type-heading-1-bold' }, props);

export const Heading2: TextComponent = (props) =>
  TextStyle({ normal: 'type-heading-2', bold: 'type-heading-2-bold' }, props);

export const Heading3: TextComponent = (props) =>
  TextStyle({ normal: 'type-heading-3', bold: 'type-heading-3-bold' }, props);

export const Heading4: TextComponent = (props) =>
  TextStyle({ normal: 'type-heading-4', bold: 'type-heading-4-bold' }, props);

export const Heading5: TextComponent = (props) =>
  TextStyle({ normal: 'type-heading-5', bold: 'type-heading-5-bold' }, props);

export const Body1: TextComponent = (props) =>
  TextStyle({ normal: 'type-body-1', bold: 'type-body-1-bold' }, props);

export const Body3: TextComponent = (props) =>
  TextStyle({ normal: 'type-body-3', bold: 'type-body-3-bold' }, props);

export const Body4: TextComponent = (props) =>
  TextStyle({ normal: 'type-body-4', bold: 'type-body-4-bold' }, props);

export const Body5: TextComponent = (props) =>
  TextStyle({ normal: 'type-body-5', bold: 'type-body-5-bold' }, props);

export const Ui1: TextComponent = (props) =>
  TextStyle({ normal: 'type-ui-1', bold: 'type-ui-1-bold' }, props);

export const Ui2: TextComponent = (props) =>
  TextStyle({ normal: 'type-ui-2', bold: 'type-ui-2-bold' }, props);

export const Ui3: TextComponent = (props) =>
  TextStyle({ normal: 'type-ui-3', bold: 'type-ui-3-bold' }, props);

export const Ui4: TextComponent = (props) =>
  TextStyle({ normal: 'type-ui-4', bold: 'type-ui-4-bold' }, props);

export const Ui5: TextComponent = (props) =>
  TextStyle({ normal: 'type-ui-5', bold: 'type-ui-5-bold' }, props);

export const Button1: TextComponent = (props) =>
  TextStyle({ normal: 'type-button-1', bold: 'type-button-1-bold' }, props);

