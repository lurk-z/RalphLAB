'use client'

import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { fold, type Protein, type Residue } from '@/app/lab-room/protein/ProteinView'

export type ProteinTableState = { protein: Protein; angles: number[] }

const AXIS_Y = new THREE.Vector3(0, 1, 0)
const ATOM_COLORS = [new THREE.Color('#18c6b0'), new THREE.Color('#508cff'), new THREE.Color('#ffb253')]
const MODEL_RADIUS = 0.265
const CHANGE_SECONDS = 0.85

// One stable origin and scale for all poses, so a rotation never translates the fixed chain.
function modelLayout(protein: Protein) {
  const residues = protein.trace.filter(r => r.number >= protein.first && r.number <= protein.last)
  const native = residues.map(r => new THREE.Vector3(...r.xyz))
  const moving = native.filter((_, i) => residues[i].chain === 'B')
  const center = new THREE.Vector3()
  if (moving.length) {
    for (const p of moving) center.add(p)
    center.divideScalar(moving.length)
  } else {
    center.copy(native[protein.hinges[0]])
  }
  let radius = Math.max(...native.map(p => center.distanceTo(p)))
  if (protein.hinges.length > 1) {
    const k = protein.hinges[1]
    // Both hinged rotations preserve these lengths.
    const tailRadius = Math.max(...native.slice(k + 1).map(p => native[k].distanceTo(p)))
    radius = Math.max(radius, center.distanceTo(native[k]) + tailRadius)
  }
  const links: number[] = []
  residues.forEach((r, i) => {
    if (i > 0 && r.chain === residues[i - 1].chain && r.number === residues[i - 1].number + 1
      && native[i].distanceTo(native[i - 1]) < 4.5) links.push(i)
  })
  return { residues, links, center, scale: MODEL_RADIUS / radius }
}

function atomColor(r: Residue, i: number) {
  return ATOM_COLORS[r.chain ? Number(r.chain === 'B') : Math.min(2, Math.floor(i / 4))]
}

function Trace({ state, group }: { state: ProteinTableState; group: React.RefObject<THREE.Group> }) {
  const { protein, angles } = state
  const layout = useMemo(() => modelLayout(protein), [protein])
  const atoms = useRef<THREE.InstancedMesh>(null)
  const bonds = useRef<THREE.InstancedMesh>(null)
  const transform = useMemo(() => new THREE.Object3D(), [])
  const direction = useMemo(() => new THREE.Vector3(), [])
  const change = useRef({ from: angles.slice(), current: angles.slice(), to: angles.slice(), elapsed: 0, dirty: true })
  const reducedMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  const [firstAngle, secondAngle] = angles

  useLayoutEffect(() => {
    const c = change.current
    c.from = c.current.slice()
    c.to = [firstAngle, secondAngle]
    c.elapsed = reducedMotion ? CHANGE_SECONDS : 0
    c.dirty = true
  }, [layout, firstAngle, secondAngle, reducedMotion])

  useLayoutEffect(() => {
    const spheres = atoms.current, sticks = bonds.current
    if (!spheres || !sticks) return
    layout.residues.forEach((r, i) => spheres.setColorAt(i, atomColor(r, i)))
    layout.links.forEach((r, i) => sticks.setColorAt(i, atomColor(layout.residues[r], r)))
    if (spheres.instanceColor) spheres.instanceColor.needsUpdate = true
    if (sticks.instanceColor) sticks.instanceColor.needsUpdate = true
  }, [layout])

  useFrame((_, dt) => {
    const spheres = atoms.current, sticks = bonds.current
    const c = change.current
    if (!spheres || !sticks || !c.dirty) return
    c.elapsed = Math.min(CHANGE_SECONDS, c.elapsed + dt)
    const t = THREE.MathUtils.smoothstep(c.elapsed, 0, CHANGE_SECONDS)
    for (let i = 0; i < 2; i++) c.current[i] = THREE.MathUtils.lerp(c.from[i], c.to[i], t)
    const points = fold(layout.residues, protein.hinges, c.current)
    for (const p of points) p.sub(layout.center).multiplyScalar(layout.scale)
    transform.quaternion.identity()
    transform.scale.setScalar(protein.hinges.length ? 0.019 : 0.013)
    points.forEach((p, i) => {
      transform.position.copy(p)
      transform.updateMatrix()
      spheres.setMatrixAt(i, transform.matrix)
    })
    layout.links.forEach((i, index) => {
      const start = points[i - 1], end = points[i]
      direction.subVectors(end, start)
      const length = direction.length()
      transform.position.copy(start).lerp(end, 0.5)
      transform.quaternion.setFromUnitVectors(AXIS_Y, direction.normalize())
      transform.scale.set(0.006, length, 0.006)
      transform.updateMatrix()
      sticks.setMatrixAt(index, transform.matrix)
    })
    spheres.instanceMatrix.needsUpdate = true
    sticks.instanceMatrix.needsUpdate = true
    if (group.current) group.current.userData.angles = c.current.slice()
    c.dirty = c.elapsed < CHANGE_SECONDS && c.from.some((a, i) => a !== c.to[i])
  })

  return (
    <group position={[0, 0.097 + MODEL_RADIUS, 0]} rotation={[0, 0.35, protein.hinges.length ? -0.8 : 0]}>
      <instancedMesh name="protein_residues" ref={atoms} args={[undefined, undefined, layout.residues.length]} frustumCulled={false}>
        <sphereGeometry args={[1, 14, 10]} />
        <meshStandardMaterial roughness={0.34} metalness={0.12} />
      </instancedMesh>
      <instancedMesh name="protein_bonds" ref={bonds} args={[undefined, undefined, layout.links.length]} frustumCulled={false}>
        <cylinderGeometry args={[1, 1, 1, 8]} />
        <meshStandardMaterial roughness={0.48} />
      </instancedMesh>
    </group>
  )
}

function PlateLabel({ protein }: { protein: Protein }) {
  const canvas = useMemo(() => {
    const el = document.createElement('canvas')
    el.width = 768
    el.height = 90
    const ctx = el.getContext('2d')
    if (!ctx) return el
    ctx.fillStyle = '#19313d'
    ctx.fillRect(0, 0, el.width, el.height)
    ctx.fillStyle = '#d7f6ee'
    ctx.font = '600 45px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const region = protein.hinges.length ? `A · ${protein.first}–${protein.last}` : 'A + B'
    ctx.fillText(`PDB  ${protein.pdb}    /    ${region}`, el.width / 2, el.height / 2)
    return el
  }, [protein])
  return (
    <mesh position={[0, 0.052, 0.147]} rotation={[-0.22, 0, 0]}>
      <planeGeometry args={[0.31, 0.036]} />
      <meshBasicMaterial toneMapped={false}><canvasTexture attach="map" args={[canvas]} colorSpace={THREE.SRGBColorSpace} /></meshBasicMaterial>
    </mesh>
  )
}

export default function ProteinTable({ state, anchor }: { state: ProteinTableState; anchor: THREE.Vector3 }) {
  const group = useRef<THREE.Group>(null)
  const identity = useMemo(() => ({ pdb: state.protein.pdb, model: state.protein.model }), [state.protein.pdb, state.protein.model])
  return (
    <group name="protein_table" ref={group} position={anchor} userData={identity}>
      {/* The glassware already on the Blender table fits underneath the raised display. */}
      {[-0.25, 0.25].flatMap(x => [-0.125, 0.125].map(z =>
        <mesh key={`${x},${z}`} position={[x, 0.041, z]}>
          <cylinderGeometry args={[0.009, 0.012, 0.082, 10]} />
          <meshStandardMaterial color="#455b65" metalness={0.45} roughness={0.34} />
        </mesh>
      ))}
      <mesh position={[0, 0.08, 0]} receiveShadow>
        <boxGeometry args={[0.56, 0.019, 0.29]} />
        <meshStandardMaterial color="#263d49" roughness={0.48} metalness={0.25} />
      </mesh>
      <mesh position={[0, 0.0905, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.6, 1, 1]}>
        <ringGeometry args={[0.113, 0.118, 48]} />
        <meshBasicMaterial color="#56d4c2" toneMapped={false} />
      </mesh>
      <PlateLabel protein={state.protein} />
      <Trace key={state.protein.model} state={state} group={group} />
    </group>
  )
}
