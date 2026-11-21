import { Cancelled, type Agent, type Sample } from './agent'
import { HANDOFFS, type Progress } from './handoffDemo'

export type Role = 'director' | 'researcher' | 'formulator' | 'analyst' | 'evaluator'
export type Team = Record<Role, Agent>

/** Walk to `target`'s visiting spot and talk; a standing owner turns round and answers. */
async function visit(team: Team, from: Role, target: Role) {
  const a = team[from]
  const b = team[target]
  await a.walkTo(b.cfg.visit)
  if (b.cfg.station.kind === 'stand') {
    await b.faceTowards(a.pos)
    void b.talk(1)
  }
  await a.talk(1)
  if (b.cfg.station.kind === 'stand') {
    await b.turnTo(b.cfg.station.yaw)
    b.play(b.cfg.station.clip)
  }
}

export async function runWorkflow(team: Team, sample: Sample, signal: { cancelled: boolean }, publish?: (progress: Progress) => void) {
  try {
    do {
      sample.hide()
      for (const [index, row] of HANDOFFS.entries()) {
        if (signal.cancelled) return
        if (row.item === 'sample') sample.hide()
        publish?.({ index, delivered: false })
        const sender = team[row.from]
        await sender.work(2)
        if (sender.seated) await sender.standUp()
        if (row.item === 'sample') {
          sample.reset()
          sample.pickUp(sender)
        }
        if (row.item === 'report') sample.carryReport(sender)
        await visit(team, row.from, row.to)
        if (signal.cancelled) return
        if (row.item === 'sample') sample.putDown()
        sample.hideReport()
        publish?.({ index, delivered: true })
        await sender.goHome()
      }
    } while (!publish && !signal.cancelled)
  } catch (e) {
    if (!(e instanceof Cancelled)) throw e
  }
}
