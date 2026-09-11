import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Suspense, useMemo, useRef } from "react";
import type { Group } from "three";
// Object3D.clone() copies meshes but leaves every SkinnedMesh bound to the ORIGINAL
// skeleton. With five seats that put all five characters on one shared rig standing at
// the world origin -- they rendered as a single figure in the middle of the table.
// SkeletonUtils.clone rebuilds the bone hierarchy per instance, which is what makes five
// independently posable characters possible.
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { animateSeated, applySeatedPose, findBones } from "./seated";
import type { BoneSet } from "./seated";
import { hex, palette } from "../theme";
import type { SeatState } from "../types";

/**
 * Whoever occupies a chair.
 *
 * Three interchangeable bodies behind one component -- a loaded GLB, a simple procedural
 * figure, and an abstract form -- chosen by AVATAR_STYLE. They take identical props and
 * occupy the same transform, so changing the look of the whole council is one constant,
 * not a refactor. That was a deliberate requirement: the humanoids may not survive
 * contact with the finished scene.
 */

export type AvatarStyle = "gltf" | "figure" | "abstract";

/** Switch the entire council's appearance here. */
export const AVATAR_STYLE: AvatarStyle = "gltf";

/**
 * Drop Ready Player Me exports in web/public/models/ with these names, then set
 * AVATAR_STYLE to "gltf". Keys are seat ids from council/config.py.
 */
export const AVATAR_URLS: Record<string, string> = {
  nemotron: "/models/seat-nemotron.glb",
  gptoss: "/models/seat-gptoss.glb",
  qwen: "/models/seat-qwen.glb",
  gemini: "/models/seat-gemini.glb",
  chairman: "/models/seat-chairman.glb",
};

interface Props {
  seatId: string;
  state: SeatState;
  accent: string;
  isChairman?: boolean;
  /** 0 absent, 1 fully present. Drives arrival during the formation sequence. */
  presence?: number;
}

/* ------------------------------------------------------------------ procedural bodies */

/** A seated figure from primitives: readable silhouette, no files, no licence. */
function ProceduralFigure({ state, accent, isChairman }: Props) {
  const torso = useRef<Group>(null);
  const head = useRef<Group>(null);
  const skin = hex(palette.inkMuted);
  const cloth = hex(palette.raised);
  const scale = isChairman ? 1.24 : 1.14;

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (!torso.current || !head.current) return;

    // Breathing, always. A figure that is perfectly still reads as a prop.
    torso.current.position.y = Math.sin(t * 1.2) * 0.006;

    if (state.status === "speaking") {
      // Small, quick head motion while words are arriving. Tied to real token timing
      // rather than a loop, so a stalled stream visibly stalls the avatar too.
      const talking = performance.now() - state.lastTokenAt < 500;
      head.current.rotation.x = talking ? Math.sin(t * 9) * 0.045 : 0;
      head.current.rotation.y = talking ? Math.sin(t * 3.3) * 0.06 : 0;
    } else if (state.status === "thinking") {
      head.current.rotation.x = 0.16 + Math.sin(t * 1.4) * 0.02; // head tipped down
      head.current.rotation.y = Math.sin(t * 0.7) * 0.09;
    } else {
      head.current.rotation.x *= 0.92; // ease back rather than snap
      head.current.rotation.y *= 0.92;
    }
  });

  return (
    <group scale={scale}>
      <group ref={torso}>
        {/* Torso, leaning very slightly back into the chair */}
        <mesh position={[0, 0.84, -0.04]} rotation={[-0.06, 0, 0]} castShadow>
          <capsuleGeometry args={[0.17, 0.34, 6, 14]} />
          <meshStandardMaterial color={cloth} roughness={0.68} />
        </mesh>

        {/* Shoulders, in the seat's colour: the clearest identity cue at a distance */}
        <mesh position={[0, 1.02, -0.04]} castShadow>
          <capsuleGeometry args={[0.19, 0.1, 6, 14]} />
          <meshStandardMaterial color={accent} roughness={0.55} metalness={0.15} />
        </mesh>

        <group ref={head} position={[0, 1.26, -0.02]}>
          <mesh castShadow>
            <sphereGeometry args={[0.125, 20, 16]} />
            <meshStandardMaterial color={skin} roughness={0.8} />
          </mesh>
        </group>

        {/* Upper arms resting on the chair arms */}
        {[-0.24, 0.24].map((x) => (
          <mesh key={x} position={[x, 0.86, 0.02]} rotation={[0, 0, x > 0 ? -0.28 : 0.28]} castShadow>
            <capsuleGeometry args={[0.058, 0.26, 6, 10]} />
            <meshStandardMaterial color={cloth} roughness={0.68} />
          </mesh>
        ))}

        {/* Thighs, forward along the seat */}
        {[-0.1, 0.1].map((x) => (
          <mesh key={x} position={[x, 0.6, 0.2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <capsuleGeometry args={[0.075, 0.28, 6, 10]} />
            <meshStandardMaterial color={cloth} roughness={0.68} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** The fallback the user asked to keep available: no body, a suspended form. */
function AbstractForm({ state, accent, isChairman }: Props) {
  const group = useRef<Group>(null);
  const height = isChairman ? 0.52 : 0.42;

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (!group.current) return;
    group.current.rotation.y = t * 0.25;
    const talking = state.status === "speaking" && performance.now() - state.lastTokenAt < 500;
    group.current.position.y = 1.05 + Math.sin(t * (talking ? 5 : 1.4)) * (talking ? 0.03 : 0.015);
  });

  return (
    <group ref={group} position={[0, 1.05, 0]}>
      <mesh castShadow>
        <octahedronGeometry args={[height, 0]} />
        <meshStandardMaterial
          color={accent}
          emissive={accent}
          emissiveIntensity={state.status === "speaking" ? 0.9 : 0.25}
          roughness={0.15}
          metalness={0.7}
          flatShading
        />
      </mesh>
    </group>
  );
}

/* ----------------------------------------------------------------------- loaded model */

function LoadedAvatar({ seatId, state, isChairman }: Props) {
  const url = AVATAR_URLS[seatId] ?? AVATAR_URLS.chairman;
  const group = useRef<Group>(null);
  const bones = useRef<BoneSet>({});
  const { scene } = useGLTF(url);

  // Cloned per seat: five seats sharing one scene graph would share one pose, and posing
  // the first would pose them all.
  const model = useMemo(() => {
    const copy = cloneSkinned(scene);
    const found = findBones(copy);
    applySeatedPose(copy, found);
    bones.current = found;
    copy.traverse((o) => {
      const mesh = o as unknown as { isMesh?: boolean; castShadow?: boolean; frustumCulled?: boolean };
      if (mesh.isMesh) {
        mesh.castShadow = true;
        // A posed skinned mesh keeps the bounding box of its rest pose, so seats at the
        // edge of frame can vanish as the camera moves. Cheaper to always draw five.
        mesh.frustumCulled = false;
      }
    });
    return copy;
  }, [scene]);

  // A per-seat offset so five figures do not breathe and glance in perfect unison, which
  // reads as a chorus line rather than a group of individuals.
  const seed = useMemo(() => (seatId.charCodeAt(0) % 7) * 0.9, [seatId]);

  useFrame(({ clock }) => {
    const speaking = performance.now() - state.lastTokenAt < 500;
    animateSeated(bones.current, clock.elapsedTime, state.status, speaking, seed);
  });

  return (
    <group ref={group} scale={isChairman ? 1.06 : 1}>
      <primitive object={model} />
    </group>
  );
}

/* ------------------------------------------------------------------------- the switch */

export function Avatar(props: Props) {
  const presence = props.presence ?? 1;
  if (presence <= 0.001) return null;

  const Body =
    AVATAR_STYLE === "gltf"
      ? LoadedAvatar
      : AVATAR_STYLE === "abstract"
        ? AbstractForm
        : ProceduralFigure;

  return (
    // Arriving figures scale and lift into place rather than popping in.
    <group scale={presence} position={[0, (1 - presence) * -0.5, 0]}>
      <Suspense fallback={<ProceduralFigure {...props} />}>
        <Body {...props} />
      </Suspense>
    </group>
  );
}
