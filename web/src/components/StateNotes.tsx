"use client";

import type { Bundle } from "@engine";

type State = Bundle["states"][string];

const GROUP_NAMES: Record<string, string> = {
  brackets: "tax brackets",
  standardDeduction: "standard deduction",
  personalExemption: "exemptions",
};

/** What the numbers for this state do not capture, and how fresh its data is. */
export function StateNotes({ state, taxYear }: { state: State; taxYear: number }) {
  const notes: string[] = [];
  const { rules, incomeTax } = state;

  if (rules.hasLocalIncomeTaxes) {
    notes.push("Local income taxes (city, county or school district) are not included.");
  }
  if (rules.hasStatePayrollTax) {
    notes.push("State payroll taxes such as disability or paid leave contributions are not included.");
  }

  if (incomeTax.type === "bracketed") {
    const groups = {
      brackets: incomeTax.brackets,
      standardDeduction: incomeTax.standardDeduction,
      personalExemption: incomeTax.personalExemption,
    };
    const stale = Object.entries(groups)
      .filter(([, g]) => g?.valuesTaxYear !== undefined && g.valuesTaxYear !== taxYear)
      .map(([key, g]) => `${GROUP_NAMES[key]} (${g!.valuesTaxYear})`);
    if (stale.length > 0) {
      notes.push(
        `${state.name} has not published all of its ${taxYear} figures yet. Using earlier ones for: ${stale.join(", ")}.`,
      );
    }
    const unconfirmed = Object.entries(groups)
      .filter(([, g]) => g && g.confidence !== "primary")
      .map(([key]) => GROUP_NAMES[key]);
    if (unconfirmed.length > 0) {
      notes.push(
        `Not yet checked against ${state.name}'s own publications: ${unconfirmed.join(", ")}.`,
      );
    }
  }

  const all = [...notes, ...rules.notes];
  if (all.length === 0) return null;

  return (
    <section className="card">
      <h2>What to know about {state.name}</h2>
      <p className="sub">Things that affect what you owe that these numbers leave out or simplify.</p>
      <ul className="notes">
        {all.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </section>
  );
}
