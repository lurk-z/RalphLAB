'use client'

import { createContext, useContext, useRef, useState } from 'react'
import { Check, Plus } from 'lucide-react'
import type { FormulaProposal } from '@/lib/lab-demo/formula-proposal'

export const LabFormulaBox = createContext<{
  formulaIds: ReadonlySet<string>
  add: (id: string, proposal: FormulaProposal) => Promise<void>
} | null>(null)

export default function FormulaProposalCard({ id, proposal }: { id: string; proposal: FormulaProposal }) {
  const box = useContext(LabFormulaBox)
  const adding = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const formulaId = `lab-formula:${id}`
  const added = box?.formulaIds.has(formulaId)

  async function add() {
    if (!box || added || adding.current) return
    adding.current = true
    setBusy(true)
    setError('')
    try {
      await box.add(formulaId, proposal)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'เพิ่มสูตรไม่สำเร็จ กรุณาลองอีกครั้ง')
    } finally {
      adding.current = false
      setBusy(false)
    }
  }

  return (
    <section aria-label={`สูตรที่เสนอ ${proposal.name}`} className="my-2 min-w-0 rounded-xl border border-teal-200 bg-teal-50/50 p-3 leading-snug">
      <p className="font-semibold text-teal-950 [overflow-wrap:anywhere]">{proposal.name}</p>
      <details className="mt-1.5 text-xs text-slate-700">
        <summary className="cursor-pointer py-2 font-medium">ส่วนผสม {proposal.items.length} รายการ (% w/w)</summary>
        <ul className="mb-2 space-y-1">
          {proposal.items.map((item, index) => (
            <li key={index} className="flex items-start justify-between gap-3">
              <span className="min-w-0 [overflow-wrap:anywhere]">{item.name}</span>
              <span className="shrink-0 tabular-nums">{item.concentration}%</span>
            </li>
          ))}
        </ul>
      </details>
      {box && <button type="button" disabled={busy || added} onClick={() => void add()}
        className="mt-1 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-3 py-2 text-center text-sm font-medium text-white hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:bg-teal-100 disabled:text-teal-900">
        {added ? <Check aria-hidden="true" className="size-4 shrink-0" /> : <Plus aria-hidden="true" className="size-4 shrink-0" />}
        {added ? 'เพิ่มลงกล่องสูตรแล้ว' : busy ? 'กำลังสร้างสูตร…' : 'เพิ่มสูตรนี้ลงกล่องสูตร'}
      </button>}
      {added && <p role="status" className="mt-1.5 text-xs text-teal-950">เปิดสูตรใหม่ได้ที่กล่องสูตรในหน้าประเมิน</p>}
      {error && <p role="alert" className="mt-1.5 text-xs text-rose-800">{error}</p>}
    </section>
  )
}
