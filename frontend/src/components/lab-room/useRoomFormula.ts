'use client'

import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { withWaterBase } from '@/lib/catalog'
import type { FormulaProposal } from '@/lib/lab-demo/formula-proposal'
import { addStudioFormula, emptyFormulaWorkspace, proposalItems, selectedFormula, studioProject } from '@/lib/lab-room/formula-workspace'
import type { RoomContext } from '@/lib/lab-room/route'
import { chatAssessment } from '@/lib/lab-station/assessment'
import { loadStudioWorkspace, saveStudioWorkspace, type ProjectWorkspaceDraft } from '@/lib/project-workspace'

export function useRoomFormula(context: RoomContext, viewer: string) {
  const project = studioProject(context)
  const key = JSON.stringify([viewer, context.kind, project])
  const [loaded, setLoaded] = useState<{ key: string; draft: ProjectWorkspaceDraft } | null>(null)
  const active = useRef<AbortController | null>(null)
  useEffect(() => {
    if (project === undefined) return
    const controller = new AbortController()
    active.current = controller
    let allowed = false
    const refresh = () => {
      if (allowed && !controller.signal.aborted) {
        setLoaded({ key, draft: loadStudioWorkspace(project, viewer) ?? emptyFormulaWorkspace() })
      }
    }
    async function open() {
      if (project != null) {
        const record = await api.getProject(project, controller.signal)
        if (record.id !== project) return
      }
      allowed = true
      refresh()
    }
    void open().catch(() => { if (!controller.signal.aborted) setLoaded(null) })
    window.addEventListener('storage', refresh)
    window.addEventListener('pageshow', refresh)
    return () => {
      controller.abort()
      window.removeEventListener('storage', refresh)
      window.removeEventListener('pageshow', refresh)
    }
  }, [key, project, viewer])

  if (project === undefined || loaded?.key !== key) return { formula: undefined, box: null }
  const selected = selectedFormula(loaded.draft)
  const name = selected?.formula.name.trim() || 'สูตรที่ประเมิน'
  const formula = selected && { id: selected.formula.id, name, items: withWaterBase(selected.formula.items),
    assessment: chatAssessment(selected.assessment, name) }

  async function add(id: string, proposal: FormulaProposal) {
    const controller = active.current
    if (!controller || controller.signal.aborted || project === undefined) throw new Error('กรุณาเปิดงานอีกครั้ง')
    const items = await proposalItems(proposal, smiles => api.validateSmiles(smiles, controller.signal))
    const persist = () => {
      if (controller.signal.aborted) throw new Error('โครงการเปลี่ยนระหว่างสร้างสูตร กรุณาลองอีกครั้ง')
      const latest = loadStudioWorkspace(project, viewer) ?? emptyFormulaWorkspace()
      const draft = addStudioFormula(latest, id, proposal.name, items)
      if (draft !== latest && !saveStudioWorkspace(project, viewer, draft)) throw new Error('บันทึกกล่องสูตรไม่สำเร็จ')
      setLoaded({ key, draft })
    }
    // Serialize independent room tabs that accept proposals for the same project.
    if (project !== null && navigator.locks) await navigator.locks.request('ralphlab:formula:' + project, persist)
    else persist()
  }
  return { formula, box: { formulaIds: new Set(loaded.draft.formulas.map(entry => entry.id)), add } }
}
