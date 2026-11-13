"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Amount } from "@engine";

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  before?: string;
  after?: string;
  /** Allow values below zero. */
  signed?: boolean;
  hint?: string;
  children?: ReactNode;
}

/**
 * A number input that keeps what the user is typing (so "12." or an empty box
 * is not rewritten mid-edit) and reports a number on every valid change.
 */
export function NumberField(props: NumberFieldProps) {
  const { label, value, onChange, before, after, signed, hint, children } = props;
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);

  return (
    <label className="field">
      <span>{label}</span>
      <div className="control">
        {before && <span className="affix">{before}</span>}
        <input
          inputMode="decimal"
          value={text}
          onFocus={(e) => {
            setFocused(true);
            e.target.select();
          }}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            const n = raw.trim() === "" ? 0 : Number(raw.replace(/,/g, ""));
            if (Number.isFinite(n)) onChange(signed ? n : Math.max(0, n));
          }}
        />
        {after && <span className="affix after">{after}</span>}
        {children}
      </div>
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

/** A yearly dollar amount or a percent of pay, with a toggle between the two. */
export function AmountField(props: {
  label: string;
  value: Amount;
  onChange: (value: Amount) => void;
  hint?: string;
}) {
  const { label, value, onChange, hint } = props;
  return (
    <NumberField
      label={label}
      value={value.value}
      onChange={(n) => onChange({ ...value, value: n })}
      before={value.kind === "dollars" ? "$" : undefined}
      after={value.kind === "percent" ? "% of pay" : "a year"}
      hint={hint}
    >
      <span className="unit">
        {(["dollars", "percent"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={value.kind === kind}
            aria-label={kind === "dollars" ? `${label} in dollars` : `${label} as a percent of pay`}
            onClick={() => onChange({ kind, value: value.kind === kind ? value.value : 0 })}
          >
            {kind === "dollars" ? "$" : "%"}
          </button>
        ))}
      </span>
    </NumberField>
  );
}

export function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="field">
      <span className="label">{props.label}</span>
      <div className="segmented" role="group" aria-label={props.label}>
        {props.options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={props.value === option.value}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <div className="control">
        <select value={props.value} onChange={(e) => props.onChange(e.target.value as T)}>
          {props.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}

export function Checkbox(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      {props.label}
    </label>
  );
}
