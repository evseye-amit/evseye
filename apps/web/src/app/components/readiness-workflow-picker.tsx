"use client";

export type ReadinessWorkflowOption = {
  code: string;
  label: string;
  description?: string;
};

export type ReadinessPlanOption = {
  code: string;
  label: string;
  description?: string;
};

const defaultWorkflows: ReadinessWorkflowOption[] = [
  {
    code: "SIMPLE",
    label: "Direct activation",
    description: "Activate after the vehicle record and components are ready.",
  },
  {
    code: "PREPARATION_QC",
    label: "Preparation + QC",
    description: "Run vehicle preparation and an independent quality check.",
  },
  {
    code: "STAGED_PREPARATION_QC",
    label: "Staged preparation + QC",
    description: "Follow the shared stage plan before the final quality check.",
  },
];

const workflowLabel = (code: string) =>
  defaultWorkflows.find((option) => option.code === code)?.label ??
  code.replaceAll("_", " ");

export function normalizeReadinessWorkflows(value: unknown): ReadinessWorkflowOption[] {
  if (!Array.isArray(value)) return defaultWorkflows;
  const options = value.flatMap((entry): ReadinessWorkflowOption[] => {
    if (typeof entry === "string" && entry.trim()) {
      return [{ code: entry, label: workflowLabel(entry) }];
    }
    if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      const code = String(record.code ?? record.value ?? "").trim();
      if (!code) return [];
      return [{
        code,
        label: String(record.label ?? record.name ?? workflowLabel(code)),
        description: record.description ? String(record.description) : undefined,
      }];
    }
    return [];
  });
  return options.length ? options : defaultWorkflows;
}

export function normalizeReadinessPlans(value: unknown): ReadinessPlanOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ReadinessPlanOption[] => {
    if (typeof entry === "string" && entry.trim()) {
      return [{ code: entry, label: entry.replaceAll("_", " ") }];
    }
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const code = String(record.code ?? record.value ?? "").trim();
    if (!code) return [];
    return [{
      code,
      label: String(record.label ?? record.name ?? code.replaceAll("_", " ")),
      description: record.description ? String(record.description) : undefined,
    }];
  });
}

export function ReadinessWorkflowPicker({
  workflow,
  stagePlanCode,
  workflows,
  plans,
  defaultWorkflow,
  onWorkflowChange,
  onStagePlanChange,
  disabled = false,
}: Readonly<{
  workflow: string;
  stagePlanCode: string;
  workflows?: ReadinessWorkflowOption[];
  plans?: ReadinessPlanOption[];
  defaultWorkflow?: string;
  onWorkflowChange: (value: string) => void;
  onStagePlanChange: (value: string) => void;
  disabled?: boolean;
}>) {
  const options = workflows?.length ? workflows : defaultWorkflows;
  const planOptions = plans ?? [];
  const planWorkflow = workflow === "STAGED_PREPARATION_QC";
  return (
    <fieldset className="readiness-workflow-picker" disabled={disabled}>
      <legend>Readiness workflow</legend>
      <p className="readiness-workflow-help">
        Choose how this vehicle becomes ready. You can change the plan before preparation starts.
      </p>
      <div className="readiness-workflow-options">
        {options.map((option) => (
          <label className={`readiness-workflow-option${workflow === option.code ? " selected" : ""}`} key={option.code}>
            <input
              type="radio"
              name="readinessWorkflow"
              value={option.code}
              checked={workflow === option.code}
              onChange={(event) => onWorkflowChange(event.target.value)}
            />
            <span>
              <strong>{option.label}</strong>
              {option.description && <small>{option.description}</small>}
            </span>
          </label>
        ))}
      </div>
      {defaultWorkflow && (
        <p className="readiness-workflow-default">
          Company default: <strong>{workflowLabel(defaultWorkflow)}</strong>
        </p>
      )}
      {planWorkflow && planOptions.length > 0 && (
        <label className="readiness-stage-plan-field">
          Stage plan (optional)
          <select value={stagePlanCode} onChange={(event) => onStagePlanChange(event.target.value)}>
            <option value="">Use the workflow default</option>
            {planOptions.map((plan) => (
              <option key={plan.code} value={plan.code}>
                {plan.label}
              </option>
            ))}
          </select>
          <small>Shared plans keep stage handoffs consistent across hubs.</small>
        </label>
      )}
    </fieldset>
  );
}
