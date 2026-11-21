import type { FormulaItem } from "../api";
import { isWaterItem, resolveCatalogSubstance } from "../catalog.ts";
import { MAX_ITEMS_PER_FORMULA } from "../project-workspace.ts";

export type FormulaProposal = {
  name: string;
  items: FormulaItem[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readItem(value: unknown): FormulaItem | null {
  if (!isRecord(value) || typeof value.name !== "string" || !value.name.trim()) return null;

  const { concentration } = value;
  if (typeof concentration !== "number" || !Number.isFinite(concentration) || concentration <= 0 || concentration > 100) return null;

  const name = value.name.trim();
  const suppliedSmiles = typeof value.smiles === "string" ? value.smiles.trim() : "";
  if (isWaterItem({ name })) return { name, smiles: "O", concentration };

  // A model-provided water structure must not replace a named non-water row.
  const smiles = resolveCatalogSubstance(name)?.smiles || (suppliedSmiles === "O" ? "" : suppliedSmiles);
  return { name, smiles, concentration };
}

export function readFormulaProposal(value: unknown): FormulaProposal | null {
  if (!isRecord(value) || typeof value.name !== "string" || !value.name.trim()) return null;
  if (!Array.isArray(value.items) || !value.items.length || value.items.length > MAX_ITEMS_PER_FORMULA) return null;

  const items: FormulaItem[] = [];
  let total = 0;
  for (const raw of value.items) {
    const item = readItem(raw);
    if (!item) return null;
    items.push(item);
    total += item.concentration;
  }

  if (Math.abs(total - 100) > 0.0001) return null;
  return { name: value.name.trim(), items };
}
