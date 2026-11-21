'use client'

import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import type { LabRoom } from './plainRoom'

// Start on an elevated three-quarter view of the whole room.
const OVERVIEW_DIRECTION = new THREE.Vector3(0.5, 0.72, 1).normalize()
const BENCH_DIRECTION = new THREE.Vector3(0.96, 0.73, 0.76).normalize()
const COMPARISON_DIRECTION = new THREE.Vector3(0.26, 0.68, 1).normalize()
const FRAME_FILL = 0.88
const OVERVIEW_TRANSITION_SECONDS = 0.6

type OverviewTransition = {
  elapsed: number
  fromTarget: THREE.Vector3
  fromPosition: THREE.Vector3
  toTarget: THREE.Vector3
  toPosition: THREE.Vector3
}

export default function CameraRig({ room, chatOpen, followingAgent, proteinAnchor, comparing }: {
  room: LabRoom
  chatOpen: boolean
  followingAgent: boolean
  proteinAnchor: THREE.Vector3 | null
  comparing: boolean
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const { width, height } = useThree((s) => s.size)
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const framedCamera = useRef<THREE.PerspectiveCamera | null>(null)
  const previousChatOpen = useRef(chatOpen)
  const previousBench = useRef<THREE.Vector3 | null>(null)
  const previousComparing = useRef(comparing)
  const framedSize = useRef({ width: 0, height: 0 })
  const transition = useRef<OverviewTransition | null>(null)

  // Every limit is derived from the room's real size, not hard-coded units.
  const { center, corners, radius, maxDim, targetBox } = useMemo(() => {
    const { radius } = room.bounds.getBoundingSphere(new THREE.Sphere())
    // Include the agent's approach in the desk framing. Orbit controls remain free
    // after this first framing, including while individual protein poses change.
    const focusBounds = proteinAnchor ? new THREE.Box3(
      proteinAnchor.clone().add(comparing ? new THREE.Vector3(-0.47, -0.34, -0.20) : new THREE.Vector3(-0.57, -0.34, -0.24)),
      proteinAnchor.clone().add(comparing ? new THREE.Vector3(0.47, 0.66, 0.44) : new THREE.Vector3(0.57, 0.72, 0.60))
    ) : room.bounds
    const focus = focusBounds.getCenter(new THREE.Vector3())
    const corners: THREE.Vector3[] = []
    for (const x of [focusBounds.min.x, focusBounds.max.x]) {
      for (const y of [focusBounds.min.y, focusBounds.max.y]) {
        for (const z of [focusBounds.min.z, focusBounds.max.z]) corners.push(new THREE.Vector3(x, y, z).sub(focus))
      }
    }
    const size = room.bounds.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    const targetBox = room.bounds.clone().expandByScalar(maxDim * 0.2)
    targetBox.min.y = room.bounds.min.y // never pivot below the floor slab
    return { center: focus, corners, radius, maxDim, targetBox }
  }, [room, proteinAnchor, comparing])

  const aspect = width > 0 && height > 0 ? width / height : 1
  const tanVertical = FRAME_FILL * Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()) / 2)
  const tanHorizontal = tanVertical * aspect
  // Even the narrowest pane must allow the camera to back up far enough.
  const maxDistance = Math.max(maxDim * 3, radius * (1 + 1 / Math.min(tanVertical, tanHorizontal)))

  useLayoutEffect(() => {
    camera.near = maxDim * 0.004
    camera.far = maxDim * 30
    camera.updateProjectionMatrix()

    framedCamera.current = null
    transition.current = null
  }, [camera, maxDim, room])

  useLayoutEffect(() => {
    const chatClosed = previousChatOpen.current && !chatOpen
    previousChatOpen.current = chatOpen
    if (width <= 0 || height <= 0) return
    const benchChanged = previousBench.current !== proteinAnchor || previousComparing.current !== comparing
    previousBench.current = proteinAnchor
    previousComparing.current = comparing

    const initialFrame = framedCamera.current !== camera
    const sizeChanged = framedSize.current.width !== width || framedSize.current.height !== height
    framedSize.current = { width, height }
    // The panel's first resize must not interrupt the Agent just selected.
    if (followingAgent && !initialFrame) {
      transition.current = null
      return
    }
    if (!initialFrame && !sizeChanged && !chatClosed && !benchChanged) return

    const controls = controlsRef.current
    const direction = !initialFrame && !benchChanged && controls
      ? camera.position.clone().sub(controls.target).normalize()
      : comparing ? COMPARISON_DIRECTION : proteinAnchor ? BENCH_DIRECTION : OVERVIEW_DIRECTION
    framedCamera.current = camera

    // Compute the new view without moving the live camera before the animation starts.
    const worldToCamera = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(direction, new THREE.Vector3(), camera.up),
    ).invert()
    const view = new THREE.Vector3()
    let distance = 0
    for (const corner of corners) {
      view.copy(corner).applyQuaternion(worldToCamera)
      distance = Math.max(distance, view.z + Math.max(Math.abs(view.x) / tanHorizontal, Math.abs(view.y) / tanVertical))
    }
    const position = center.clone().addScaledVector(direction, distance)
    if (!initialFrame && (chatClosed || benchChanged) && controls && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      transition.current = { elapsed: 0, fromTarget: controls.target.clone(), fromPosition: camera.position.clone(), toTarget: center, toPosition: position }
      return
    }
    if (transition.current) {
      // The canvas can report its expanded size a frame after the chat closes.
      transition.current.toPosition.copy(position)
      transition.current.toTarget = center
      return
    }

    camera.position.copy(position)
    if (controls) {
      controls.target.copy(center)
      controls.update()
    } else camera.lookAt(center)
    camera.updateMatrixWorld()
  }, [camera, center, corners, width, height, tanHorizontal, tanVertical, chatOpen, followingAgent, proteinAnchor, comparing])

  // Keep the orbit pivot near the room so panning can't lose the scene.
  useFrame((_, deltaTime) => {
    const controls = controlsRef.current
    if (!controls) return
    const animation = transition.current
    if (animation) {
      animation.elapsed += Math.min(deltaTime, 0.05)
      const progress = Math.min(1, animation.elapsed / OVERVIEW_TRANSITION_SECONDS)
      const eased = progress * progress * (3 - 2 * progress)
      controls.target.lerpVectors(animation.fromTarget, animation.toTarget, eased)
      camera.position.lerpVectors(animation.fromPosition, animation.toPosition, eased)
      controls.update()
      if (progress === 1) transition.current = null
      return
    }
    controls.target.clamp(targetBox.min, targetBox.max)
  })

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      enablePan
      screenSpacePanning
      zoomToCursor
      rotateSpeed={0.7}
      zoomSpeed={0.9}
      panSpeed={0.9}
      minDistance={maxDim * 0.03}
      maxDistance={maxDistance}
      minPolarAngle={0.05}
      maxPolarAngle={Math.PI / 2 - 0.03}
      onStart={() => { transition.current = null }}
    />
  )
}
