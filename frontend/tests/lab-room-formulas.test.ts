import test from 'node:test'
import assert from 'node:assert/strict'
import { addStudioFormula, emptyFormulaWorkspace, proposalItems, selectedFormula, studioProject } from '../src/lib/lab-room/formula-workspace.ts'
import { formulaAssessmentSignature, loadStudioWorkspace, saveStudioWorkspace } from '../src/lib/project-workspace.ts'

const item = { name: 'Glycerin', smiles: 'OCC(O)CO', concentration: 5 }
const draft = addStudioFormula(emptyFormulaWorkspace(), 'lab-formula:m1', 'V1', [item])

test('an accepted proposal stays selected and a duplicate preserves later edits', () => {
  assert.equal(selectedFormula(draft)?.formula.name, 'V1')
  const current = addStudioFormula(draft, 'another', 'V2', [])
  assert.equal(addStudioFormula(current, 'lab-formula:m1', 'duplicate', []), current)
  assert.equal(selectedFormula(current)?.formula.id, 'another')
  assert.equal(selectedFormula({ ...current, activeFormulaId: '' }), undefined)
})

test('an assessment from a different selection or revision never follows the current formula', () => {
  const record = { id: 'job', status: 'completed' } as const
  const snapshot = { assessment: record, startedAt: '', jobId: 'job', inputSignature: formulaAssessmentSignature([item], 'face') }
  const assessed = { ...draft, assessmentByFormulaId: { [draft.activeFormulaId]: snapshot } } as unknown as typeof draft
  assert.equal(selectedFormula(assessed)?.assessment, record)
  assert.equal(selectedFormula({ ...assessed, formulas: [{ ...draft.formulas[0], region: 'eye' }] })?.assessment, null)
  assert.equal(selectedFormula({ ...assessed, formulas: [{ ...draft.formulas[0], items: [] }] })?.assessment, null)
})

test('unbound sessions and projects use separate storage, and unrelated room contexts do not attach Studio data', () => {
  const values = new Map<string,string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => {values.set(key,value)}, removeItem: (key: string) => {values.delete(key)} }
  assert.equal(saveStudioWorkspace(null, 'u1', draft, storage), true)
  assert.equal(loadStudioWorkspace(null, 'u1', storage)?.activeFormulaId, draft.activeFormulaId)
  assert.equal(loadStudioWorkspace(null, 'u2', storage), null)
  assert.equal(loadStudioWorkspace(1, 'u1', storage), null)
  assert.equal(saveStudioWorkspace(1, 'u1', draft, storage), true)
  assert.equal(loadStudioWorkspace(2, 'u1', storage), null)
  assert.equal(studioProject({kind:'timed', studyId:'A', fixture:false}), undefined)
  assert.equal(studioProject({kind:'order', orderId:'A', projectId:1}), undefined)
  assert.equal(studioProject({kind:'invalid', param:'project', value:'invalid'}), undefined)
})

test('adding a proposal validates new structures before storing and leaves unknown ingredients unresolved', async () => {
  const seen: string[] = []
  const result = await proposalItems({name:'V1', items:[
    {name:'Water',smiles:'O',concentration:90},
    {name:'Candidate',smiles:'CC',concentration:7},
    {name:'Extract',smiles:'',concentration:3},
  ]}, async smiles => { seen.push(smiles); return {valid:false} })
  assert.deepEqual(seen,['CC'])
  assert.deepEqual(result.map(x => x.smiles),['',''])
})
