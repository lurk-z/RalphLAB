import type { ProjectWorkspaceDraft, WorkspaceFormula } from '../project-workspace.ts'
import { formulaAssessmentSignature, MAX_FORMULAS } from '../project-workspace.ts'
import { isWaterItem, resolveCatalogSubstance } from '../catalog.ts'
import type { FormulaProposal } from '../lab-demo/formula-proposal.ts'
import type { RoomContext } from './route.ts'

/** Only project workspaces, standalone Studio, and explicitly selected D01 can save a formula. */
export function studioProject(context: RoomContext): number | null | undefined {
  if (context.kind === 'project' || context.kind === 'demo') return context.projectId
  if (context.kind === 'none') return null
  return undefined
}

export function emptyFormulaWorkspace(): ProjectWorkspaceDraft {
  return { formulas: [], activeFormulaId: '', region: 'face', dayIdx: 1, mode: 'assess',
    formulaPanelOpen: false, assessmentByFormulaId: {}, paintByFormulaId: {}, graphByFormulaId: {} }
}

export function selectedFormula(workspace: ProjectWorkspaceDraft) {
  const formula = workspace.formulas.find(entry => entry.id === workspace.activeFormulaId)
  if (!formula) return undefined
  const snapshot = workspace.assessmentByFormulaId[formula.id]
  const signature = formulaAssessmentSignature(formula.items, formula.region)
  const assessment = snapshot?.inputSignature === signature ? snapshot.assessment : null
  return { formula, assessment }
}

export async function proposalItems(proposal: FormulaProposal,
  validate: (smiles: string) => Promise<{ valid: boolean; canonical?: string | null }>) {
  return Promise.all(proposal.items.filter(item => !isWaterItem(item)).map(async item => {
    if (!item.smiles || resolveCatalogSubstance(item.name || '')?.smiles === item.smiles) return item
    const checked = await validate(item.smiles)
    const structure = checked.canonical || item.smiles
    return { ...item, smiles: checked.valid && !isWaterItem({ smiles: structure }) ? structure : '' }
  }))
}

/** Read the latest draft after validation, then apply one idempotent append. */
export function addStudioFormula(workspace: ProjectWorkspaceDraft, id: string, name: string, items: WorkspaceFormula['items']): ProjectWorkspaceDraft {
  if (workspace.formulas.some(entry => entry.id === id)) return workspace
  if (workspace.formulas.length >= MAX_FORMULAS) throw new Error('กล่องสูตรเต็มแล้ว')
  const formula = { id, name, type: 'สูตรจากแล็บ', region: workspace.region, items }
  return { ...workspace, formulas: [...workspace.formulas, formula], activeFormulaId: id }
}
