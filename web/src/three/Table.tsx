import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Mesh, MeshStandardMaterial } from "three";
import { hex, palette } from "../theme";

export const TABLE_RADIUS = 2.5;
// Tightened from 3.5: at the resting camera the near chairs were looming into
// the lens and clipping at the frame edge.
export const SEAT_RADIUS = 3.15;

interface TableProps {
  /** 0 absent, 1 fully formed. Drives the formation sequence. */
  rise?: number;
}

/** Walnut disc, brass inlay, and the light well beneath it. */
export function Table({ rise = 1 }: TableProps) {
  if (rise <= 0.001) return null;

  return (
    <group scale={[rise, 1, rise]} position={[0, (rise - 1) * 0.35, 0]}>
      {/* Top */}
      <mesh position={[0, 0.74, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[TABLE_RADIUS, TABLE_RADIUS, 0.1, 64]} />
        <meshStandardMaterial
          color={hex(palette.walnut)}
          roughness={0.32}
          metalness={0.12}
        />
      </mesh>

      {/* Brass inlay round the rim. A single bright line does more for "expensive" than
          any amount of surface detail, because it is what catches the key light. */}
      <mesh position={[0, 0.792, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[TABLE_RADIUS - 0.14, TABLE_RADIUS - 0.1, 64]} />
        <meshStandardMaterial
          color={hex(palette.brass)}
          emissive={hex(palette.brass)}
          emissiveIntensity={0.22}
          roughness={0.22}
          metalness={0.95}
        />
      </mesh>

      {/* Apron and pedestal */}
      <mesh position={[0, 0.66, 0]}>
        <cylinderGeometry args={[TABLE_RADIUS - 0.06, TABLE_RADIUS - 0.14, 0.12, 64]} />
        <meshStandardMaterial color={hex(palette.walnutDark)} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.32, 0]} castShadow>
        <cylinderGeometry args={[0.42, 0.78, 0.66, 32]} />
        <meshStandardMaterial color={hex(palette.walnutDark)} roughness={0.7} />
      </mesh>
    </group>
  );
}

/** The floor. Dark, faintly reflective, mostly there to catch shadow and falloff. */
export function Floor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <circleGeometry args={[14, 64]} />
      <meshStandardMaterial color={hex(palette.void)} roughness={0.85} metalness={0.25} />
    </mesh>
  );
}

interface RingProps {
  /** 0 to 1: how far round the circle the forming ring has swept. */
  progress: number;
}

/**
 * The ring of light that sweeps the circle and leaves the table behind it.
 *
 * Drawn as a ring whose arc grows, using thetaLength. Cheaper and crisper than a shader,
 * and it reads exactly the same at this scale.
 */
export function FormingRing({ progress }: RingProps) {
  const material = useRef<MeshStandardMaterial>(null);
  const mesh = useRef<Mesh>(null);

  useFrame(() => {
    if (!material.current) return;
    // Brightest mid-sweep, fading as it completes, so it hands off to the table rather
    // than sitting on top of it.
    const fade = progress < 0.85 ? 1 : 1 - (progress - 0.85) / 0.15;
    material.current.emissiveIntensity = 2.4 * fade;
    material.current.opacity = fade;
  });

  if (progress <= 0 || progress >= 1) return null;

  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.8, 0]}>
      <ringGeometry
        args={[TABLE_RADIUS - 0.05, TABLE_RADIUS + 0.05, 96, 1, 0, Math.PI * 2 * progress]}
      />
      <meshStandardMaterial
        ref={material}
        color={hex(palette.amber)}
        emissive={hex(palette.amber)}
        emissiveIntensity={2.4}
        transparent
        toneMapped={false}
      />
    </mesh>
  );
}

/** Seat positions round the table. The Chairman sits at the head, nearest the camera's far side. */
export function seatPosition(index: number, total: number): [number, number, number] {
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
  return [Math.cos(angle) * SEAT_RADIUS, 0, Math.sin(angle) * SEAT_RADIUS];
}

/** Rotation so a seat faces the centre of the table. */
export function seatRotation(index: number, total: number): number {
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
  return -angle + Math.PI / 2;
}
