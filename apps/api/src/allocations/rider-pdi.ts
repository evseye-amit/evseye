type PdiItem = Record<string, unknown> & { code: string };

export function pdiItems(checklist: unknown): PdiItem[] {
  if (!Array.isArray(checklist)) return [];
  return checklist.filter((item): item is PdiItem => Boolean(item && typeof item === 'object' && typeof item.code === 'string' && item.code.trim()));
}

export function riderPdiItems(checklist: unknown): PdiItem[] {
  // Older accepted records may lack the flag. Only an explicit false makes a check optional.
  return pdiItems(checklist).filter(item => item.mandatory !== false);
}

export function riderPdiWorkflow<T extends { pdiChecklist?: unknown }>(workflow: T) {
  return { ...workflow, pdiChecklist: riderPdiItems(workflow.pdiChecklist) };
}
