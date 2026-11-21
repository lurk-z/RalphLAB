'use client'

import { useLayoutEffect, useMemo, useRef } from 'react'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { ProteinDisplayStand } from './ProteinTable'

type Coordinate = [number, number, number]
type Residue = { chain: string; number: number; name: string; xyz: Coordinate }
type Contact = { left: Residue & { atom: string }; right: Residue & { atom: string }; distance_angstrom: number }
export type ComparisonStructure = {
  pdb: string
  title: string
  source_url: string
  paper_url: string
  resolution_angstrom: number
  trace: Residue[]
  contacts: Contact[]
  site_distances: Contact[]
}
export type InsulinComparisonTableState = { structures: ComparisonStructure[]; showContacts: boolean }

const TEAL = new THREE.Color('#169c90')
const BLUE = new THREE.Color('#517ac5')
const AMBER = new THREE.Color('#ffae30')
const DASH = new THREE.Color('#e8edf5')
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const DISPLAY_RADIUS = 0.237
const MODEL_Y = 0.35
const MODEL_SEPARATION = 0.444

const isFirstMolecule = (chain: string) => chain === 'A' || chain === 'B'
const asVector = (point: Residue) => new THREE.Vector3(...point.xyz)
function centerOf(points: THREE.Vector3[]) {
  return points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(points.length)
}

// The two deposited dimers have already been superposed into one coordinate system.
// Use the same orientation, origin and Å-to-scene scale for both displays. Orient the
// interface toward the initial camera so the neighboring molecules and their contacts are visible.
function projection(structures: ComparisonStructure[]) {
  const reference = structures[0]
  const native = reference.trace.map(asVector)
  const center = centerOf(native)
  const first = centerOf(reference.trace.filter(r => isFirstMolecule(r.chain)).map(asVector))
  const second = centerOf(reference.trace.filter(r => !isFirstMolecule(r.chain)).map(asVector))
  const up = second.sub(first).normalize()
  const patch = reference.trace.filter(r => ['B', 'D'].includes(r.chain) && r.number >= 23 && r.number <= 30)
  const view = centerOf(patch.map(asVector)).sub(center)
  view.addScaledVector(up, -view.dot(up)).normalize()
  const across = new THREE.Vector3().crossVectors(up, view).normalize()
  const radius = Math.max(...structures.flatMap(s => s.trace.map(r => asVector(r).distanceTo(center))))
  const scale = DISPLAY_RADIUS / radius
  return (r: Residue) => {
    const v = asVector(r).sub(center)
    return new THREE.Vector3(v.dot(across), v.dot(up), v.dot(view)).multiplyScalar(scale)
  }
}

type Geometry = 'sphere' | 'cylinder'
type Instance = { matrix: THREE.Matrix4; color: THREE.Color }
function dot(position: THREE.Vector3, radius: number, color: THREE.Color): Instance {
  const matrix = new THREE.Matrix4().makeScale(radius, radius, radius).setPosition(position)
  return { matrix, color }
}
function segment(a: THREE.Vector3, b: THREE.Vector3, radius: number, color: THREE.Color): Instance {
  const direction = b.clone().sub(a)
  const length = direction.length()
  const rotation = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, direction.normalize())
  const matrix = new THREE.Matrix4().compose(a.clone().lerp(b, 0.5), rotation, new THREE.Vector3(radius, length, radius))
  return { matrix, color }
}

function Copies({ name, geometry, instances, bright = false }: {
  name: string; geometry: Geometry; instances: Instance[]; bright?: boolean
}) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const target = mesh.current
    if (!target) return
    instances.forEach((instance, i) => {
      target.setMatrixAt(i, instance.matrix)
      target.setColorAt(i, instance.color)
    })
    target.instanceMatrix.needsUpdate = true
    if (target.instanceColor) target.instanceColor.needsUpdate = true
    target.computeBoundingSphere()
  }, [instances])
  if (instances.length === 0) return null
  return (
    <instancedMesh name={name} ref={mesh} args={[undefined, undefined, instances.length]}>
      {geometry === 'sphere' ? <sphereGeometry args={[1, 12, 8]} /> : <cylinderGeometry args={[1, 1, 1, 8]} />}
      {bright ? <meshBasicMaterial toneMapped={false} /> : <meshStandardMaterial roughness={0.46} metalness={0.06} />}
    </instancedMesh>
  )
}

function specimenGeometry(structure: ComparisonStructure, project: (r: Residue) => THREE.Vector3) {
  const residues: Instance[] = []
  const backbone: Instance[] = []
  const contactPairs: Instance[] = []
  const contactAtoms = new Map<string, Instance>()
  const contactSites = new Set<string>()
  const outsideCutoff: Instance[] = []
  const points = structure.trace.map(project)
  structure.trace.forEach((r, i) => {
    const color = isFirstMolecule(r.chain) ? TEAL : BLUE
    residues.push(dot(points[i], 0.0056, color))
    const prev = structure.trace[i - 1]
    if (prev && r.chain === prev.chain && r.number === prev.number + 1 && asVector(r).distanceTo(asVector(prev)) < 4.5) {
      backbone.push(segment(points[i - 1], points[i], 0.0039, color))
    }
  })
  for (const pair of structure.contacts) {
    const a = project(pair.left), b = project(pair.right)
    contactPairs.push(segment(a, b, 0.0028, AMBER))
    for (const [atom, point] of [[pair.left, a], [pair.right, b]] as const) {
      contactSites.add(`${atom.chain}-${atom.number}`)
      contactAtoms.set(`${atom.chain}-${atom.number}-${atom.atom}`, dot(point, 0.0053, AMBER))
    }
  }
  // In the lispro snapshot the two tracked residue pairs exceed the contact cutoff.
  // Draw their measured separation as dashes instead of adding a contact to the total.
  for (const pair of structure.site_distances) {
    if (pair.distance_angstrom <= 4.5) continue
    const a = project(pair.left), b = project(pair.right)
    for (let i = 0; i < 3; i++) {
      outsideCutoff.push(segment(a.clone().lerp(b, i / 3), a.clone().lerp(b, (i + 0.56) / 3), 0.0028, DASH))
    }
  }
  const contactResidues = structure.trace.flatMap((r, i) =>
    contactSites.has(`${r.chain}-${r.number}`) ? [dot(points[i], 0.0073, AMBER)] : [])
  return { residues, backbone, outsideCutoff, contactPairs, contactResidues, contactAtoms: [...contactAtoms.values()] }
}

function Specimen({ structure, project, x, showContacts }: {
  structure: ComparisonStructure; project: (r: Residue) => THREE.Vector3; x: number; showContacts: boolean
}) {
  const spans = useMemo(() => specimenGeometry(structure, project), [structure, project])
  const pdb = structure.pdb
  const name = pdb === '1LPH' ? 'Lispro' : 'ปกติ'
  return (
    <group name={`insulin_${pdb}`} position-x={x}>
      <group position-y={MODEL_Y} rotation={[-0.38, 0.2, -0.56]}>
        <Copies name={`calpha_${pdb}`} geometry="sphere" instances={spans.residues} />
        <Copies name={`backbone_${pdb}`} geometry="cylinder" instances={spans.backbone} />
        <group name={`contact_layer_${pdb}`} visible={showContacts}>
          <Copies name={`contact_residues_${pdb}`} geometry="sphere" instances={spans.contactResidues} bright />
          <Copies name={`contact_atoms_${pdb}`} geometry="sphere" instances={spans.contactAtoms} bright />
          <Copies name={`contact_pairs_${pdb}`} geometry="cylinder" instances={spans.contactPairs} bright />
          <Copies name={`site_separations_${pdb}`} geometry="cylinder" instances={spans.outsideCutoff} bright />
        </group>
      </group>
      <Html center position={[0, 0.605, 0]} zIndexRange={[8, 3]} style={{ pointerEvents: 'none' }}>
        <span style={{ display: 'block', whiteSpace: 'nowrap', background: '#153540ed', borderRadius: 4,
          color: '#fff', fontSize: 'clamp(10px, 1vw, 12px)', padding: '2px 6px', fontWeight: 600 }}>
          {name} · {pdb}
        </span>
      </Html>
    </group>
  )
}

export default function InsulinComparisonTable({ state, anchor }: { state: InsulinComparisonTableState; anchor: THREE.Vector3 }) {
  const project = useMemo(() => projection(state.structures), [state.structures])
  return (
    <group name="insulin_comparison_table" position={anchor} userData={{ showContacts: state.showContacts }}>
      <ProteinDisplayStand width={0.69} />
      {state.structures.map((s, i) => <Specimen key={s.pdb} structure={s} project={project}
        x={(i - (state.structures.length - 1) / 2) * MODEL_SEPARATION} showContacts={state.showContacts} />)}
    </group>
  )
}
