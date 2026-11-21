'use client'

import { useEffect, useRef, useState } from 'react'
import { restoreThreads, type Transcript } from '@/lib/lab-demo/chat-history'
import { assessmentText, assessmentViewRequested, requestedView, type ChatAssessment } from '@/lib/lab-demo/chat-assessment'
import { readLabSources,readSourceNotices } from '@/lib/lab-room/lab-sources'
import { applyLabTurn } from '@/lib/lab-room/chat-tools'
import { awaitChatQsar } from '@/lib/lab-room/wait-qsar'
import { readFormulaProposal, type FormulaProposal } from '@/lib/lab-demo/formula-proposal'
import { http } from '@/lib/api'
import type { Role } from '../agents/workflow'

export type Thread = Transcript
type Message = Thread['messages'][number]
export type ChatFormula = {
  id: string
  name: string
  items: { name?: string; smiles: string; concentration: number }[]
  assessment?: ChatAssessment
}

const MAX_THREADS = 20
const MAX_MESSAGES = 60
export const MAX_QUESTION_LENGTH = 4000

export function makeChatId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function useLabAgentChat(projectId: number | null, viewer: string) {
  const key = `ralphlab:openai-chat:v1:${encodeURIComponent(viewer)}:${projectId ?? 'none'}`
  const [store, setStore] = useState<{ key: string; threads: Thread[] } | null>(null)
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [activity, setActivity] = useState<Record<string, string[]>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const requests = useRef(new Map<string, AbortController>())
  const threads = store?.key === key ? store.threads : []

  useEffect(() => {
    let saved: Thread[] = []
    try {
      saved = restoreThreads(JSON.parse(window.localStorage.getItem(key) || '[]'))
    } catch { /* Browser storage may be disabled. */ }
    setStore({ key, threads: saved })
    setPending({})
    setActivity({})
    setErrors({})
    const active = requests.current
    return () => {
      active.forEach((controller) => controller.abort())
      active.clear()
    }
  }, [key])

  useEffect(() => {
    if (store?.key !== key) return
    try {
      window.localStorage.setItem(key, JSON.stringify(store.threads.slice(0, MAX_THREADS * 5)))
    } catch { /* Keep the live conversation when storage is unavailable. */ }
  }, [key, store])

  function addMessage(threadId: string, agent: Role, message: Message) {
    setStore((current) => {
      if (current?.key !== key) return current
      const thread = current.threads.find((item) => item.id === threadId)
      const updated = {
        id: threadId,
        agent,
        messages: [...(thread?.messages ?? []), message].slice(-MAX_MESSAGES),
        updatedAt: message.time,
      }
      return { key, threads: [updated, ...current.threads.filter((item) => item.id !== threadId)] }
    })
  }

  function deleteThread(id: string) {
    if (store?.key !== key) return
    requests.current.get(id)?.abort()
    requests.current.delete(id)
    setStore((current) => current?.key === key
      ? { key, threads: current.threads.filter((thread) => thread.id !== id) }
      : current)
    setPending(({ [id]: _deleted, ...rest }) => rest)
    setActivity(({ [id]: _deleted, ...rest }) => rest)
    setErrors(({ [id]: _deleted, ...rest }) => rest)
  }

  async function send(agent: Role, name: string, scope: string, thread: Thread, question: string, formula?: ChatFormula, retry = false) {
    const text = question.trim().slice(0, MAX_QUESTION_LENGTH)
    if (store?.key !== key || !text || requests.current.has(thread.id)) return
    const id = thread.id
    const controller = new AbortController()
    const startedAt = Date.now()
    const steps: string[] = []
    function recordStep(label: string) {
      if (controller.signal.aborted) return
      steps.push(label)
      setActivity((current) => ({ ...current, [id]: [...steps] }))
    }
    requests.current.set(id, controller)
    setPending((current) => ({ ...current, [id]: true }))
    setErrors((current) => ({ ...current, [id]: '' }))
    const messageId = (retry && thread.messages.at(-1)?.id) || makeChatId()
    if (!retry) addMessage(id, agent, { id: messageId, role: 'user', text, time: Date.now() })

    const ingredients = formula?.items.slice(0, 100).map((item) => `${item.name || item.smiles}: ${item.concentration}%`).join('\n')
    const results = formula?.assessment && assessmentText(formula.assessment)
    const showResults = assessmentViewRequested(text)
    const history = (retry ? thread.messages.slice(0,-1) : thread.messages).slice(-10)
      .map(m => {
        const links=[...(m.labLinks||[]),...(m.labLink?[m.labLink]:[])].filter(l=>l.project===projectId && l.id)
        return {role:m.role,text:[m.text.slice(0,1550),...links.map(l=>l.target+" · "+l.id)].filter(Boolean).join("\n").slice(0,2000)}
      })
    const context = [name,scope,formula?.name,ingredients,results].filter(Boolean).join("\n").slice(0,4000)
    try {
      if (!projectId) throw Error("เลือกโปรเจกต์ก่อนเริ่มแชต")
      const headers = {"content-type":"application/json","x-ralphlab-project":String(projectId)}
      const signal = controller.signal
      recordStep("ส่งโจทย์และประวัติสนทนาให้ OpenAI")
      const response = await fetch("/api/lab-chat",{method:"POST",headers,signal,
        body:JSON.stringify({id:messageId,role:agent,question:text,history,context})})
      const plan = await response.json()
      if (!response.ok) throw Error(plan.detail || "ติดต่อ OpenAI ไม่สำเร็จ")
      const sources=readLabSources(plan.sources)
      const sourceNotices=readSourceNotices(plan.sourceNotices)
      if(sources.length)recordStep("อ่านแหล่งอ้างอิง "+sources.length+" รายการ")
      const actingRole=plan.handledBy==="director"?"director":agent
      if(actingRole!==agent)recordStep("หัวหน้าแล็บรับคำสั่งต่อในแชตนี้")
      async function api(path:string,data?:object) {
        const init={method:data?"POST":"GET",headers,signal,cache:"no-store" as const,body:data?JSON.stringify(data):undefined}
        if(!path.startsWith("/api/timed")){
          const row=await http<any>(path,init)
          if(data && path==="/api/lab/projects/"+projectId+"/chat-qsar" &&
              row?.id===("id" in data ? data.id : undefined) && typeof row?.id==="string" &&
              ["queued","preparing","running"].includes(row.state)){
            recordStep("รอผลจากเครื่องคำนวณ QSAR")
            return awaitChatQsar(row,()=>http(path+"?job="+encodeURIComponent(row.id),
              {method:"GET",headers,signal,cache:"no-store"}),signal)
          }
          return row
        }
        const res=await fetch(path,init)
        const value=await res.json()
        if(!res.ok)throw Error(value.detail||"อ่านหรือบันทึกงานติดตามไม่ได้")
        return value
      }
      const reply=await applyLabTurn(plan,actingRole,projectId,messageId,(path,data)=>{
        recordStep("ดำเนินคำสั่งในโปรเจกต์")
        const newOrder=/\/(?:studies|director-briefs)$/.test(path)
        return api(path,newOrder&&sources.length?{...data,chat_sources:sources.filter(s=>s.url.startsWith('https://')),chat_turn_id:messageId}:data)
      },path=>api(path))
      const proposals = agent==="formulator" && Array.isArray(plan.proposals)
        ? plan.proposals.map(readFormulaProposal).filter((p:FormulaProposal|null)=>p!==null) : undefined
      if (!signal.aborted) addMessage(id,agent,{id:makeChatId(),role:"assistant",...reply,sources,sourceNotices,proposals,
        time:Date.now(),startedAt,publicSteps:steps,
        assessment:showResults && formula?.assessment ? {...formula.assessment,view:requestedView(text)} : undefined})
    } catch (error) {
      if (!controller.signal.aborted) setErrors(current=>({...current,[id]:error instanceof Error ? error.message : "ส่งข้อความไม่สำเร็จ"}))
    } finally {
      if (requests.current.get(id) === controller) {
        requests.current.delete(id)
        setPending((current) => ({ ...current, [id]: false }))
        setActivity(({ [id]: _done, ...rest }) => rest)
      }
    }
  }

  return { threads, pending, activity, errors, send, deleteThread, ready: store?.key === key }
}
