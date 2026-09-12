import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { MathUtils, TorusGeometry } from "three";
import type { Group, Mesh, MeshStandardMaterial } from "three";
import { hex, palette, seatColor } from "../theme";
import type { SeatState } from "../types";

/**
 * The council's body: a neutral mannequin with a glossy faceplate.
 *
 * Built from primitives rather than loaded. That is not a compromise -- this form is
 * spheres, capsules and a torus, so modelling it in code costs nothing to download,
 * cannot half-load, and sidesteps the skinned-mesh path that has never been reliable
 * here. It also means the figure is parameterised: one constant changes every seat.
 *
 * The design is deliberately faceless. Five identical bodies around a table read as a
 * council; five *characters* would read as a cartoon, and would invite the question of
 * who each one is meant to be -- which is exactly the wrong question. Identity lives in
 * the accent ring and the emblem above the head, nowhere else.
 */

/* ------------------------------------------------------------------ the progress ring */

/**
 * Arc geometries, cached by how much of the circle they cover.
 *
 * The ring is the readout: it sweeps while a model works and closes into a full circle
 * when the answer lands. Animating that by rebuilding geometry every frame would allocate
 * sixty throwaway buffers a second per seat, so the arc length is quantised into steps and
 * the geometry for each step is built once and shared across all five seats.
 */
const ARC_STEPS = 24;
const arcCache = new Map<number, TorusGeometry>();

function arcGeometry(step: number): TorusGeometry {
  const key = MathUtils.clamp(Math.round(step), 1, ARC_STEPS);
  let geometry = arcCache.get(key);
  if (!geometry) {
    geometry = new TorusGeometry(0.062, 0.0085, 8, 40, (key / ARC_STEPS) * Math.PI * 2);
    arcCache.set(key, geometry);
  }
  return geometry;
}

/** How much of the circle the ring covers in each state. */
function arcTarget(status: SeatState["status"]): number {
  if (status === "done") return 1; // closed circle: finished
  if (status === "failed") return 0.14; // a broken stub
  if (status === "thinking" || status === "speaking") return 0.3; // a sweeping arc
  return 0.08; // idle: a quiet tick, just enough to catch the light
}

/* ------------------------------------------------------------------------ the figure */

interface Props {
  seatId: string;
  state: SeatState;
  accent: string;
  isChairman?: boolean;
  hovered: boolean;
}

export function Mannequin({ seatId, state, accent, isChairman, hovered }: Props) {
  const root = useRef<Group>(null);
  const chest = useRef<Group>(null);
  const head = useRef<Group>(null);
  const ring = useRef<Mesh>(null);
  const ringMat = useRef<MeshStandardMaterial>(null);
  const bodyMat = useRef<MeshStandardMaterial>(null);
  const arcStep = useRef(2);

  // Per-seat offset so five figures do not breathe in unison, which reads as a chorus
  // line rather than five separate minds.
  const seed = useMemo(() => (seatId.charCodeAt(0) % 9) * 0.7, [seatId]);
  const scale = isChairman ? 1.08 : 1;

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime;
    if (!root.current || !chest.current || !head.current || !ring.current) return;

    const speaking =
      state.status === "speaking" && performance.now() - state.lastTokenAt < 450;
    const thinking = state.status === "thinking";
    const working = speaking || thinking;

    // Frame-rate independent easing. Everything approaches a target rather than snapping,
    // so a status change reads as the body settling rather than cutting.
    const k = 1 - Math.pow(0.004, delta);

    // Breathing, always. A figure that is perfectly still reads as a prop, not an
    // occupant -- and the room is otherwise very quiet between questions.
    chest.current.position.y = Math.sin(t * 1.15 + seed) * 0.007;
    chest.current.rotation.x = MathUtils.lerp(
      chest.current.rotation.x,
      thinking ? 0.05 : 0,
      k,
    );

    if (speaking) {
      // Tied to real token arrival, not a loop: a stalled stream visibly stalls the
      // figure too, rather than miming to an empty pipe.
      head.current.rotation.x = Math.sin(t * 8.5 + seed) * 0.04;
      head.current.rotation.y = Math.sin(t * 3.1 + seed) * 0.055;
    } else if (thinking) {
      head.current.rotation.x = 0.13 + Math.sin(t * 1.3 + seed) * 0.018; // tipped down
      head.current.rotation.y = Math.sin(t * 0.65 + seed) * 0.08;
    } else {
      head.current.rotation.x *= 0.93;
      head.current.rotation.y *= 0.93;
    }

    // The ring sweeps while working and holds still once the answer has landed.
    ring.current.rotation.z = working ? -t * 1.9 : ring.current.rotation.z * 0.97;

    // Arc length only changes on a state change, so the geometry swap is rare.
    const wanted = MathUtils.clamp(
      Math.round(arcTarget(state.status) * ARC_STEPS),
      1,
      ARC_STEPS,
    );
    if (wanted !== arcStep.current) {
      arcStep.current = MathUtils.clamp(
        wanted > arcStep.current ? arcStep.current + 1 : arcStep.current - 1,
        1,
        ARC_STEPS,
      );
      ring.current.geometry = arcGeometry(arcStep.current);
    }

    if (ringMat.current) {
      const target = hovered ? 3.4 : state.status === "done" ? 2.4 : working ? 2 : 0.7;
      ringMat.current.emissiveIntensity = MathUtils.lerp(
        ringMat.current.emissiveIntensity,
        target,
        k,
      );
    }
    // Hovering lifts the whole body out of the gloom -- the "light up the person I point
    // at" behaviour, done with light rather than an outline so it belongs to the room.
    if (bodyMat.current) {
      bodyMat.current.emissiveIntensity = MathUtils.lerp(
        bodyMat.current.emissiveIntensity,
        hovered ? 0.3 : 0.04,
        k,
      );
    }
  });

  const failed = state.status === "failed";
  const ringColour = failed ? palette.bad : isChairman ? palette.brassLight : accent;
  const body = hex(palette.ink);

  return (
    <group ref={root} scale={scale}>
      <group ref={chest}>
        {/* Pelvis, sunk into the seat */}
        <mesh position={[0, 0.5, 0.02]} castShadow>
          <capsuleGeometry args={[0.115, 0.06, 6, 16]} />
          <meshStandardMaterial ref={bodyMat} color={body} emissive={body} emissiveIntensity={0.04} roughness={0.88} metalness={0.02} />
        </mesh>

        {/* Torso, leaning a little back into the chair */}
        <mesh position={[0, 0.68, -0.015]} rotation={[-0.07, 0, 0]} castShadow>
          <capsuleGeometry args={[0.125, 0.2, 6, 16]} />
          <meshStandardMaterial color={body} roughness={0.88} metalness={0.02} />
        </mesh>

        {/* Shoulders */}
        <mesh position={[0, 0.8, -0.02]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <capsuleGeometry args={[0.062, 0.2, 6, 12]} />
          <meshStandardMaterial color={body} roughness={0.88} metalness={0.02} />
        </mesh>

        {/* Neck */}
        <mesh position={[0, 0.875, -0.01]} castShadow>
          <cylinderGeometry args={[0.036, 0.045, 0.06, 12]} />
          <meshStandardMaterial color={body} roughness={0.88} metalness={0.02} />
        </mesh>

        {/* ---------------------------------------------------------------- the head */}
        <group ref={head} position={[0, 0.985, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[0.105, 28, 22]} />
            <meshStandardMaterial color={body} roughness={0.88} metalness={0.02} />
          </mesh>

          {/* The faceplate: a glossy black cap over the front of the skull. A spherical
              cap built around +Y and rotated to face the table, so it sits flush on the
              head instead of intersecting it. */}
          <mesh position={[0, 0, 0.004]} rotation={[Math.PI / 2, 0, 0]}>
            <sphereGeometry args={[0.108, 28, 20, 0, Math.PI * 2, 0, 0.92]} />
            <meshStandardMaterial color={hex(palette.void)} roughness={0.08} metalness={0.35} />
          </mesh>

          {/* The state ring, set into the faceplate */}
          <mesh ref={ring} position={[0, 0.004, 0.088]} geometry={arcGeometry(2)}>
            <meshStandardMaterial
              ref={ringMat}
              color={ringColour}
              emissive={ringColour}
              emissiveIntensity={0.7}
              roughness={0.25}
              metalness={0.1}
              toneMapped={false}
            />
          </mesh>
        </group>

        {/* Upper arms, dropping to the chair arms */}
        {[-1, 1].map((side) => (
          <group key={side}>
            <mesh
              position={[side * 0.155, 0.72, -0.01]}
              rotation={[0.1, 0, side * -0.13]}
              castShadow
            >
              <capsuleGeometry args={[0.042, 0.15, 6, 12]} />
              <meshStandardMaterial color={body} roughness={0.88} metalness={0.02} />
            </mesh>
            {/* Forearm, forward onto the knee */}
            <mesh
              position={[side * 0.17, 0.6, 0.11]}
              rotation={[1.15, 0, side * -0.06]}
              castShadow
            >
              <capsuleGeometry args={[0.036, 0.16, 6, 12]} />
              <meshStandardMaterial color={body} roughness={0.88} metalness={0.02} />
            </mesh>
            {/* Hand resting on the knee */}
            <mesh position={[side * 0.175, 0.545, 0.215]} castShadow>
              <sphereGeometry args={[0.042, 14, 12]} />
              <meshStandardMaterial color={body} roughness={0.88} metalness={0.02} />
            </mesh>
          </group>
        ))}

        {/* Thighs, forward along the seat */}
        {[-1, 1].map((side) => (
          <group key={side}>
            <mesh
              position={[side * 0.085, 0.5, 0.15]}
              rotation={[Math.PI / 2, 0, 0]}
              castShadow
            >
              <capsuleGeometry args={[0.068, 0.2, 6, 12]} />
              <meshStandardMaterial color={body} roughness={0.88} metalness={0.02} />
            </mesh>
            {/* Shin, dropping to the floor */}
            <mesh position={[side * 0.09, 0.28, 0.255]} castShadow>
              <capsuleGeometry args={[0.052, 0.2, 6, 12]} />
              <meshStandardMaterial color={body} roughness={0.88} metalness={0.02} />
            </mesh>
            {/* Foot */}
            <mesh position={[side * 0.09, 0.17, 0.3]} rotation={[0.2, 0, 0]} castShadow>
              <capsuleGeometry args={[0.045, 0.06, 4, 10]} />
              <meshStandardMaterial color={body} roughness={0.88} metalness={0.02} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

/** Exported for the scene's hover raycast: one cheap box instead of twenty capsules. */
export function MannequinHitBox({ onOver, onOut, onClick }: {
  onOver: () => void;
  onOut: () => void;
  onClick: () => void;
}) {
  return (
    <mesh
      position={[0, 0.72, 0.08]}
      visible={false}
      onPointerOver={(e) => { e.stopPropagation(); onOver(); }}
      onPointerOut={() => onOut()}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      <boxGeometry args={[0.52, 0.95, 0.62]} />
    </mesh>
  );
}

/** Kept so the accent colour has one owner even when a seat id is unknown. */
export const mannequinAccent = seatColor;
