import { useFrame } from "@react-three/fiber";
import { useRef, useState } from "react";
import type { Group, Mesh, MeshStandardMaterial } from "three";
import { hex, palette } from "../theme";

/**
 * The circular button set into the middle of the table.
 *
 * It is also the seed of the formation sequence -- the single point that splits into five
 * and becomes the council. Ending where it began gives the opening a reason to exist
 * beyond decoration: the thing you watch form is the thing you then press.
 */

interface Props {
  visible: boolean;
  /** Disabled while the council is working. */
  enabled: boolean;
  /** The DOM trigger that gives this button a keyboard path is focused. */
  focused?: boolean;
  onClick: () => void;
  label?: string;
}

export function CentreButton({ visible, enabled, focused, onClick, label }: Props) {
  const group = useRef<Group>(null);
  const glow = useRef<MeshStandardMaterial>(null);
  const halo = useRef<Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const appear = useRef(0);

  useFrame((_, delta) => {
    if (!group.current) return;

    // Ease presence rather than toggling it, so showing and hiding are both soft.
    const target = visible ? 1 : 0;
    appear.current += (target - appear.current) * Math.min(1, delta * 6);
    const a = appear.current;
    group.current.scale.setScalar(Math.max(0.001, a));
    group.current.visible = a > 0.01;

    const t = performance.now() / 1000;

    if (glow.current) {
      // A slow pulse when idle says "press me" without a label shouting it. It stops
      // while disabled, which is how the table shows it is busy.
      const pulse = enabled ? 0.5 + Math.sin(t * 1.8) * 0.18 : 0.1;
      // Keyboard focus lights it exactly as hover does, so the ring a keyboard user
      // sees in the DOM is matched by the button itself lighting up in the scene.
      const lit = (hovered || focused) && enabled;
      const target = lit ? 0.95 : pulse * 0.6;
      glow.current.emissiveIntensity += (target - glow.current.emissiveIntensity) * 0.12;
    }

    if (halo.current) {
      // The halo breathes outward, like something radiating from the centre of the table.
      const s = enabled ? 1 + Math.sin(t * 1.8) * 0.06 : 1;
      halo.current.scale.setScalar(s * ((hovered || focused) && enabled ? 1.12 : 1));
    }
  });

  return (
    <group ref={group} position={[0, 0.8, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      {/* Halo */}
      <mesh ref={halo}>
        <ringGeometry args={[0.34, 0.42, 48]} />
        <meshStandardMaterial
          color={hex(palette.brass)}
          emissive={hex(palette.brass)}
          emissiveIntensity={0.5}
          transparent
          opacity={0.5}
          toneMapped={false}
        />
      </mesh>

      {/* The disc itself. The hit area is this mesh, so the cursor only changes over
          something that actually looks pressable. */}
      <mesh
        position={[0, 0, 0.01]}
        onClick={(e) => {
          e.stopPropagation();
          if (enabled) onClick();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          if (enabled) document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "auto";
        }}
      >
        <circleGeometry args={[0.32, 48]} />
        <meshStandardMaterial
          ref={glow}
          color={hex(palette.amber)}
          emissive={hex(palette.amber)}
          emissiveIntensity={0.6}
          roughness={0.2}
          metalness={0.4}
          toneMapped={false}
        />
      </mesh>

      {label && (
        <mesh position={[0, 0, 0.02]} visible={false}>
          {/* Reserved: the label is rendered as DOM in the overlay, where it stays
              crisp and can be read by a screen reader. */}
        </mesh>
      )}
    </group>
  );
}

/**
 * The five points that fly out of the centre during formation.
 * Rendered separately from the seats because they exist before the seats do.
 */
export function FormationMotes({
  positions,
  colors,
  progress,
}: {
  positions: [number, number, number][];
  colors: string[];
  /** 0 all at centre, 1 all arrived. */
  progress: number;
}) {
  if (progress <= 0 || progress >= 1) return null;

  // easeOutExpo: leave fast, arrive slowly. Motion with weight rather than a linear slide.
  const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);

  return (
    <>
      {positions.map((target, i) => {
        const x = target[0] * eased;
        const z = target[2] * eased;
        // A shallow arc: they rise as they travel and settle back down on arrival.
        const y = 0.8 + Math.sin(eased * Math.PI) * 0.9;
        return (
          <mesh key={i} position={[x, y, z]}>
            <sphereGeometry args={[0.07, 12, 12]} />
            <meshStandardMaterial
              color={colors[i]}
              emissive={colors[i]}
              emissiveIntensity={3}
              toneMapped={false}
            />
          </mesh>
        );
      })}
    </>
  );
}
