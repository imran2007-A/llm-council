import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  CapsuleGeometry, CylinderGeometry, Matrix4, MathUtils, SphereGeometry, TorusGeometry,
} from "three";
import { MeshStandardMaterial } from "three";
import type { BufferGeometry, Group, Mesh } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { hex, palette } from "../theme";
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

/* --------------------------------------------------------------------- the body mesh */

/**
 * The seated body as ONE geometry, built once for the whole council.
 *
 * It was eighteen separate meshes per figure, each with its own inline material: ninety
 * draw calls and ninety shader programs for five identical bodies. Merging the parts that
 * never move relative to each other collapses that to one call per figure, and because
 * every figure is the same shape the geometry itself is shared -- built on first use,
 * uploaded to the GPU once.
 *
 * The head is deliberately NOT merged in: it turns on its own while a model speaks.
 */
function buildBody(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const place = (g: BufferGeometry, x: number, y: number, z: number,
                 rx = 0, ry = 0, rz = 0) => {
    const m = new Matrix4().makeRotationFromEuler(
      { x: rx, y: ry, z: rz, order: "XYZ" } as never,
    );
    m.setPosition(x, y, z);
    g.applyMatrix4(m);
    parts.push(g);
  };

  place(new CapsuleGeometry(0.115, 0.06, 6, 16), 0, 0.5, 0.02);              // pelvis
  place(new CapsuleGeometry(0.125, 0.2, 6, 16), 0, 0.68, -0.015, -0.07);     // torso
  place(new CapsuleGeometry(0.062, 0.2, 6, 12), 0, 0.8, -0.02, 0, 0, Math.PI / 2);
  place(new CylinderGeometry(0.036, 0.045, 0.06, 12), 0, 0.875, -0.01);      // neck

  for (const side of [-1, 1]) {
    place(new CapsuleGeometry(0.042, 0.15, 6, 12), side * 0.155, 0.72, -0.01, 0.1, 0, side * -0.13);
    place(new CapsuleGeometry(0.036, 0.16, 6, 12), side * 0.17, 0.6, 0.11, 1.15, 0, side * -0.06);
    place(new SphereGeometry(0.042, 14, 12), side * 0.175, 0.545, 0.215);
    place(new CapsuleGeometry(0.068, 0.2, 6, 12), side * 0.085, 0.5, 0.15, Math.PI / 2);
    place(new CapsuleGeometry(0.052, 0.2, 6, 12), side * 0.09, 0.28, 0.255);
    place(new CapsuleGeometry(0.045, 0.06, 4, 10), side * 0.09, 0.17, 0.3, 0.2);
  }

  return mergeGeometries(parts, false) as BufferGeometry;
}

let bodyGeometry: BufferGeometry | null = null;
function sharedBody(): BufferGeometry {
  if (!bodyGeometry) bodyGeometry = buildBody();
  return bodyGeometry;
}

/** The head and its faceplate, also identical across the council. */
const headGeometry = new SphereGeometry(0.105, 24, 18);
const faceGeometry = new SphereGeometry(0.108, 24, 16, 0, Math.PI * 2, 0, 0.92);
/** Obsidian, identical on all five seats, so it is one material and one shader. */
const faceMaterial = new MeshStandardMaterial({
  color: hex(palette.void), roughness: 0.08, metalness: 0.35,
});

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

  // One material per seat, used by both the body and the head. Created here rather than
  // as JSX so the head can share the exact instance -- reading a ref during render to
  // wire them together worked only after the first frame, which left the head unlit on
  // the frame that mattered.
  const bodyMaterial = useMemo(
    () => new MeshStandardMaterial({
      color: hex(palette.ink),
      emissive: hex(palette.ink),
      emissiveIntensity: 0.04,
      roughness: 0.88,
      metalness: 0.02,
    }),
    [],
  );
  useEffect(() => () => bodyMaterial.dispose(), [bodyMaterial]);
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
    bodyMaterial.emissiveIntensity = MathUtils.lerp(
      bodyMaterial.emissiveIntensity,
      hovered ? 0.3 : 0.04,
      k,
    );
  });

  const failed = state.status === "failed";
  const ringColour = failed ? palette.bad : isChairman ? palette.brassLight : accent;

  return (
    // Local -Z is "toward the table": the chair model is turned by PI to face the centre,
    // so a figure built facing +Z sits with its back to the room. Every seat was facing
    // outward into the dark.
    <group ref={root} scale={scale} rotation={[0, Math.PI, 0]}>
      <group ref={chest}>
        {/* One draw call for the whole seated body. */}
        <mesh geometry={sharedBody()} material={bodyMaterial} castShadow />

        {/* ---------------------------------------------------------------- the head */}
        <group ref={head} position={[0, 0.985, 0]}>
          {/* The skull shares the body's material, so hovering lights the head with it
              rather than leaving a dull sphere on a glowing body. */}
          <mesh geometry={headGeometry} material={bodyMaterial} castShadow />

          {/* The faceplate: a glossy black cap over the front of the skull. A spherical
              cap built around +Y and rotated to face the table, so it sits flush on the
              head instead of intersecting it. Its material is identical on every seat,
              so all five share one. */}
          <mesh
            geometry={faceGeometry}
            material={faceMaterial}
            position={[0, 0, 0.004]}
            rotation={[Math.PI / 2, 0, 0]}
          />

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

