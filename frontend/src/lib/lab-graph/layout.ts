/**
 * Incremental layout. Nodes that already have a position never move; newly revealed nodes
 * fan out from the node that revealed them, away from where the user came from.
 */
import type { ProjectGraph } from './model.ts'

export type Point = { x: number; y: number }

/** First four branches of a focused agent: up-left, up-right, down-left, down-right. */
const ROOT_ANGLES = [-145, -35, 145, 35, -90, 90, 180, 0]
const rad = (deg: number) => (deg * Math.PI) / 180

function distanceFor(graph: ProjectGraph, parent: string, child: string) {
  const from = graph.nodes[parent]
  const to = graph.nodes[child]
  if (from.kind === 'agent' && to.kind === 'branch') return 250
  if (from.kind === 'formula' && to.kind === 'formula') return 170
  if (to.kind === 'agent') return 210
  return 185
}

function collides(p: Point, placed: Point[]) {
  return placed.some((q) => ((p.x - q.x) / 175) ** 2 + ((p.y - q.y) / 62) ** 2 < 1)
}

export function placeNodes(graph: ProjectGraph, parents: Map<string, string | null>, previous: Record<string, Point>) {
  const positions: Record<string, Point> = {}
  for (const [id, point] of Object.entries(previous)) if (parents.has(id)) positions[id] = point
  const placed = () => Object.values(positions)

  // Roots: the first sits at the origin; several new roots at once form a ring.
  const newRoots = [...parents].filter(([id, parent]) => parent === null && !positions[id]).map(([id]) => id)
  if (newRoots.length) {
    const existing = placed()
    const cx = existing.length ? Math.max(...existing.map((p) => p.x)) + 520 : 0
    if (newRoots.length === 1) positions[newRoots[0]] = existing.length ? free({ x: cx, y: 0 }, 0, 0) : { x: 0, y: 0 }
    else newRoots.forEach((id, i) => {
      const angle = rad(-90 + (360 / newRoots.length) * i)
      positions[id] = { x: cx + Math.cos(angle) * 240, y: Math.sin(angle) * 180 }
    })
  }

  // Children, in reveal order, grouped under the node that revealed them.
  const byParent = new Map<string, string[]>()
  for (const [id, parent] of parents) {
    if (parent === null || positions[id]) continue
    byParent.set(parent, [...(byParent.get(parent) ?? []), id])
  }
  const order = [...parents.keys()]
  for (const parent of order) {
    const kids = byParent.get(parent)
    if (!kids || !positions[parent]) continue
    const origin = positions[parent]
    const grand = parents.get(parent)
    const from = grand ? positions[grand] : undefined
    // Angles come from the full sibling list, so siblings revealed later fill their own slot.
    const siblings = (graph.children[parent] ?? []).filter((c) => parents.get(c) === parent)
    kids.forEach((id) => {
      const i = Math.max(0, siblings.indexOf(id))
      const n = siblings.length
      let angle: number
      if (graph.nodes[parent].kind === 'formula' && graph.nodes[id].kind === 'formula') angle = 0
      else if (!from) angle = ROOT_ANGLES[i % ROOT_ANGLES.length]
      else {
        const base = Math.atan2(origin.y - from.y, origin.x - from.x) * 180 / Math.PI
        const spread = Math.min(110, 38 * (n - 1))
        angle = n === 1 ? base : base - spread / 2 + (spread / (n - 1)) * i
      }
      const distance = distanceFor(graph, parent, id)
      positions[id] = free({ x: origin.x + Math.cos(rad(angle)) * distance, y: origin.y + Math.sin(rad(angle)) * distance }, angle, distance, origin)
    })
  }
  return positions

  /** Nudge around the intended spot until it does not overlap a placed node. */
  function free(target: Point, angle: number, distance: number, origin?: Point): Point {
    if (!collides(target, placed())) return target
    for (let ring = 1; ring < 10; ring++) {
      for (const turn of [1, -1]) {
        const a = rad(angle + turn * ring * 14)
        const d = distance + ring * 28
        const p = origin ? { x: origin.x + Math.cos(a) * d, y: origin.y + Math.sin(a) * d } : { x: target.x, y: target.y + turn * ring * 90 }
        if (!collides(p, placed())) return p
      }
    }
    return target
  }
}
