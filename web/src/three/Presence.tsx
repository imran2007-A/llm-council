import { Billboard, Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { MathUtils } from "three";
import type { Group, Mesh, MeshStandardMaterial } from "three";
import { hex, palette } from "../theme";
import type { SeatState } from "../types";

/**
 * What occupies a chair, and the emblem that hovers above it.
 *
 * The figures are abstract on purpose. Low-poly characters under cinematic lighting are a
 * mismatch -- the lighting promises a fidelity the models cannot pay off, and the result
 * reads as cheap rather than stylised. Shape and light have no uncanny valley.
 *
 * Swapping back to loaded humanoids is still one constant in Avatar.tsx; this is the
 * body that constant selects by default.
 */

/* ------------------------------------------------------------------ the form itself */

interface FormProps {
  state: SeatState;
  accent: string;
  isChairman?: boolean;
  hovered: boolean;
}

export function AbstractForm({ state, accent, isChairman, hovered }: FormProps) {
  const group = useRef<Group>(null);
  const core = useRef<Mesh>(null);
  const shell = useRef<Mesh>(null);
  const material = useRef<MeshStandardMaterial>(null);
  const glow = useRef<MeshStandardMaterial>(null);

  const height = isChairman ? 1.05 : 0.86;
  const seed = useMemo(() => Math.random() * 10, []);

  useFrame((frameState, delta) => {
    const t = frameState.clock.elapsedTime;
    if (!group.current || !core.current || !shell.current) return;

    // Speaking means a token arrived recently, not merely that the status says so. A
    // stalled stream should visibly stall rather than mime to an empty pipe.
    const speaking = state.status === "speaking" && performance.now() - state.lastTokenAt < 450;
    const thinking = state.status === "thinking";

    // Everything eases towards a target rather than snapping, so a status change reads as
    // the form settling into a new state instead of cutting to it.
    const k = 1 - Math.pow(0.002, delta);

    const targetY = 0.95 + (speaking ? 0.06 : 0) + Math.sin(t * (speaking ? 3.4 : 1.1) + seed) * 0.035;
    group.current.position.y = MathUtils.lerp(group.current.position.y, targetY, k);

    // The shell turns slowly while idle and faster while the model is working, which
    // gives the room a sense of activity without any text on screen.
    const spin = thinking ? 0.55 : speaking ? 0.32 : 0.08;
    shell.current.rotation.y += delta * spin;
    shell.current.rotation.x = Math.sin(t * 0.4 + seed) * 0.12;

    // The core pulses in time with arriving tokens.
    const pulse = speaking ? 1 + Math.sin(t * 11) * 0.06 : 1;
    core.current.scale.setScalar(MathUtils.lerp(core.current.scale.x, pulse, k));

    if (material.current) {
      const target = hovered ? 1.25 : speaking ? 0.85 : thinking ? 0.4 : 0.16;
      material.current.emissiveIntensity = MathUtils.lerp(
        material.current.emissiveIntensity, target, k,
      );
    }
    if (glow.current) {
      const target = hovered ? 0.5 : speaking ? 0.32 : 0.12;
      glow.current.opacity = MathUtils.lerp(glow.current.opacity, target, k);
    }
  });

  const failed = state.status === "failed";
  const colour = failed ? palette.bad : accent;

  return (
    <group ref={group} position={[0, 0.95, 0]}>
      {/* Outer shell: a faceted cage that turns. Open enough to see the core through. */}
      <mesh ref={shell} castShadow>
        <icosahedronGeometry args={[height * 0.62, 0]} />
        <meshStandardMaterial
          ref={glow}
          color={colour}
          emissive={colour}
          emissiveIntensity={0.4}
          roughness={0.12}
          metalness={0.9}
          transparent
          opacity={0.14}
          flatShading
          wireframe
        />
      </mesh>

      {/* The core. Obsidian with an inner light, so it reads as carved rather than drawn. */}
      <mesh ref={core} castShadow>
        <octahedronGeometry args={[height * 0.38, 0]} />
        <meshStandardMaterial
          ref={material}
          color={hex(palette.void)}
          emissive={colour}
          emissiveIntensity={0.2}
          roughness={0.28}
          metalness={0.75}
          flatShading
        />
      </mesh>

      {/* A quiet base, so the form is seated rather than floating free of the chair. */}
      <mesh position={[0, -height * 0.62, 0]} receiveShadow>
        <cylinderGeometry args={[height * 0.34, height * 0.4, 0.05, 6]} />
        <meshStandardMaterial
          color={hex(palette.walnutDark)}
          roughness={0.5}
          metalness={0.6}
        />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------------- emblem */

interface EmblemProps {
  seatId: string;
  label: string;
  accent: string;
  state: SeatState;
  hovered: boolean;
  onHover: (hovered: boolean) => void;
  onClick: () => void;
  /** Emblems only become clickable once there is something to read. */
  interactive: boolean;
}

/**
 * The emblem floating above a seat.
 *
 * This is the whole readout during a run: no streamed text at the table, just each
 * member's mark, its state, and a name that appears on hover. Watching four blocks of
 * prose race each other is noise -- you cannot read them at that speed, and it buries the
 * one thing worth watching, which is who is still thinking.
 */
export function SeatEmblem({
  seatId, label, accent, state, hovered, onHover, onClick, interactive,
}: EmblemProps) {
  const working = state.status === "thinking" || state.status === "speaking";
  const group = useRef<Group>(null);
  const drift = useRef({ x: 0, y: 0 });

  /**
   * The emblems lean toward the cursor.
   *
   * Asked for at the start -- "hovering above everyone, interactive to the cursor" --
   * and never built. They sat perfectly still, which is what makes a floating object read
   * as pasted on rather than present in the room.
   *
   * The lean is tiny and the whole council leans together, so moving the mouse across the
   * table sends a shallow wave through five marks rather than twitching one. Eased toward
   * the target rather than set from it: pointer position is a step function, and anything
   * driven straight off it looks mechanical no matter how small the movement.
   */
  useFrame(({ pointer, clock }, delta) => {
    if (!group.current) return;
    const k = 1 - Math.pow(0.0015, delta);
    drift.current.x = MathUtils.lerp(drift.current.x, pointer.x, k);
    drift.current.y = MathUtils.lerp(drift.current.y, pointer.y, k);

    const bob = Math.sin(clock.elapsedTime * 0.9 + seatId.charCodeAt(0)) * 0.018;
    group.current.position.x = drift.current.x * 0.12;
    group.current.position.y = 1.72 + bob + drift.current.y * 0.07;
    group.current.rotation.z = -drift.current.x * 0.09;
  });

  return (
    <group ref={group} position={[0, 1.72, 0]}>
      <Billboard>
      <Html center distanceFactor={9.5} zIndexRange={[20, 0]}>
        <div
          className="emblem"
          data-status={state.status}
          data-hovered={hovered || undefined}
          data-interactive={interactive || undefined}
          style={{
            "--accent": accent,
            "--mark": `url(/brand/emblem-${seatId}.png)`,
          } as React.CSSProperties}
          onPointerEnter={() => onHover(true)}
          onPointerLeave={() => onHover(false)}
          onClick={() => interactive && onClick()}
          role={interactive ? "button" : undefined}
          tabIndex={interactive ? 0 : -1}
          onKeyDown={(e) => {
            if (interactive && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              onClick();
            }
          }}
          aria-label={label}
        >
          {/* The ring carries the state: it spins while the model works, completes when
              the answer lands, and breaks when the seat fails. */}
          <svg className="emblem__ring" viewBox="0 0 48 48" aria-hidden>
            <circle className="emblem__track" cx="24" cy="24" r="21" />
            <circle className="emblem__arc" cx="24" cy="24" r="21" />
          </svg>
          <span className="emblem__mark" aria-hidden />
          {working && <span className="emblem__pulse" aria-hidden />}
          <span className="emblem__label">{label}</span>
        </div>
        </Html>
      </Billboard>
    </group>
  );
}
