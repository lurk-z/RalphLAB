'use client'

import { useMemo, useRef } from 'react'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import type { AgentStatus } from '@/lib/lab-demo/agent-status'
import type { Agent } from './agent'
import { ROLE_LABEL } from './roles'
import type { Role } from './workflow'

export default function AgentStatusLabel({ agent, status, onSelect }: {
  agent: Agent
  status: AgentStatus
  onSelect?: (role: Role, threadId?: string, messageId?: string) => void
}) {
  const anchor = useRef<Group>(null)
  const head = useMemo(() => agent.root.getObjectByName('Head'), [agent])
  useFrame(() => {
    if (!anchor.current) return
    const position = anchor.current.position
    if (head) {
      head.getWorldPosition(position)
      position.y += 0.15
    } else {
      agent.root.getWorldPosition(position)
      position.y += 0.8
    }
  })

  const role = agent.cfg.role
  const label = status.kind === 'thinking' ? 'thinking...' : status.label
  return <group ref={anchor}>
    <Html center zIndexRange={[12, 1]} style={{ pointerEvents: 'none' }}>
      <div data-agent-role={role} data-agent-status={status.kind}
        style={{ textShadow: '0 0 3px white, 0 1px 3px white' }}>
        {status.kind === 'question' ?
          <button type="button" className="pointer-events-auto grid size-8 place-items-center bg-transparent text-lg font-bold text-red-700 focus-visible:outline focus-visible:outline-2"
            aria-label={`เปิดคำถามจาก ${ROLE_LABEL[role]} · ${status.label}`} title={status.label}
            onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
            onClick={event => { event.stopPropagation(); onSelect?.(role, status.threadId, status.messageId) }}>
            1
          </button> :
          <span role="status" aria-label={`${ROLE_LABEL[role]} · ${label}`} title={label}
            className="block max-w-48 truncate text-center text-xs font-semibold text-slate-800">{label}</span>}
      </div>
    </Html>
  </group>
}
