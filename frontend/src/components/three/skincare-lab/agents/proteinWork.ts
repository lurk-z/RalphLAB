import { Vector2 } from 'three'
import { Cancelled, type Agent } from './agent'
import type { Role, Team } from './workflow'

export type ProteinWork = { id: string; role: Role }
export type ProteinPhase = 'walking' | 'working' | 'done'

// South edge of lab_table_left. The baked nav mesh keeps the route clear of the table and walls.
const WORK_SPOT = { pos: new Vector2(0.15, 0.34), yaw: Math.PI }
const WORK_SECONDS = 1.8

function take(agent: Agent) {
  agent.signal.cancelled = true
  agent.clearTask()
  agent.carrying = false
  agent.signal = { cancelled: false }
  return agent.signal
}

function home(agent: Agent) {
  take(agent)
  void agent.goHome().catch((error) => {
    if (!(error instanceof Cancelled)) console.error('Protein table return journey', error)
  })
}

/** Owns the actors while a work order occupies the table. One recorded action is presented at a time. */
export class ProteinCrew {
  private current: ProteinWork | null = null

  constructor(private readonly team: Team) {}

  start() {
    this.current = null
    for (const agent of Object.values(this.team)) home(agent)
  }

  present(work: ProteinWork | null, publish: (id: string, phase: ProteinPhase) => void) {
    if (work?.id === this.current?.id && work?.role === this.current?.role) return
    const departing = this.current?.role
    this.current = work
    if (departing && departing !== work?.role) home(this.team[departing])
    if (!work) return

    const agent = this.team[work.role]
    const signal = take(agent)
    const run = async () => {
      publish(work.id, 'walking')
      if (agent.seated) await agent.standUp()
      if (signal.cancelled) return
      await agent.walkTo(WORK_SPOT)
      if (signal.cancelled) return
      const review = work.role === 'director' || work.role === 'evaluator'
      void agent.play(review || !agent.has('Bench_Work') ? 'Talk_Gesture' : 'Bench_Work')
      publish(work.id, 'working')
      if (signal.cancelled) return
      await agent.wait(WORK_SECONDS)
      if (signal.cancelled) return
      void agent.play('Idle_Stand')
      publish(work.id, 'done')
    }
    void run().catch((error) => {
      if (!(error instanceof Cancelled)) console.error('Protein table action', error)
    })
  }

  stop() {
    this.current = null
    for (const agent of Object.values(this.team)) {
      agent.signal.cancelled = true
      agent.clearTask()
    }
  }
}
