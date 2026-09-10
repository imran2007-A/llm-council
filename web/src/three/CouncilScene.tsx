import { Canvas } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group, Mesh } from "three";
import type { SeatConfig, SeatState, SeatStatus } from "../types";

/**
 * The council table.
 *
 * Deliberately plain: capsules round a disc. The visual design is not decided yet, and
 * every shape here is a placeholder. What matters is the wiring -- each avatar is driven
 * by the same SeatState the 2D cards use, so restyling means editing geometry and
 * materials in this file, not rerouting data.
 */

const STATUS_COLOR: Record<SeatStatus, string> = {
  idle: "#5a6172",
  thinking: "#e0af68",
  speaking: "#7aa2f7",
  done: "#7bd88f",
  failed: "#f7768e",
};

/** Seat positions evenly round a circle, with the Chairman at the head. */
function seatPosition(index: number, total: number, radius = 3.2): [number, number, number] {
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
  return [Math.cos(angle) * radius, 0, Math.sin(angle) * radius];
}

interface AvatarProps {
  seat: SeatConfig;
  state: SeatState;
  position: [number, number, number];
  isChairman: boolean;
}

function Avatar({ seat, state, position, isChairman }: AvatarProps) {
  const group = useRef<Group>(null);
  const body = useRef<Mesh>(null);

  useFrame((frame) => {
    if (!group.current || !body.current) return;
    const time = frame.clock.elapsedTime;

    // Speaking bobs in time with the token rate; thinking sways slowly; idle is still.
    // Reading status here rather than from an event keeps animation and data in sync.
    if (state.status === "speaking") {
      const recent = performance.now() - state.lastTokenAt < 400;
      group.current.position.y = recent ? Math.sin(time * 12) * 0.05 : 0;
      body.current.scale.y = 1 + Math.sin(time * 10) * 0.03;
    } else if (state.status === "thinking") {
      group.current.position.y = Math.sin(time * 2) * 0.03;
      body.current.scale.y = 1;
    } else {
      group.current.position.y = 0;
      body.current.scale.y = 1;
    }

    // Everyone faces the middle of the table.
    group.current.lookAt(0, 0.5, 0);
  });

  const height = isChairman ? 1.5 : 1.2;

  return (
    <group ref={group} position={position}>
      <mesh ref={body} position={[0, height / 2, 0]} castShadow>
        <capsuleGeometry args={[0.32, height - 0.64, 6, 16]} />
        <meshStandardMaterial
          color={STATUS_COLOR[state.status]}
          roughness={0.55}
          metalness={0.1}
        />
      </mesh>

      {/* Nameplate. Html keeps text crisp instead of fighting with 3D text rendering. */}
      <Html position={[0, height + 0.35, 0]} center distanceFactor={9}>
        <div style={{ color: "#e6e8ee", fontSize: 13, whiteSpace: "nowrap", opacity: 0.9 }}>
          {seat.label}
          {state.status === "failed" && <span style={{ color: "#f7768e" }}> ✕</span>}
        </div>
      </Html>
    </group>
  );
}

function Table() {
  return (
    <>
      <mesh position={[0, -0.1, 0]} receiveShadow>
        <cylinderGeometry args={[2.4, 2.4, 0.2, 48]} />
        <meshStandardMaterial color="#2a2f3c" roughness={0.8} />
      </mesh>
      <mesh position={[0, -1.1, 0]}>
        <cylinderGeometry args={[0.4, 0.6, 1.8, 24]} />
        <meshStandardMaterial color="#232733" roughness={0.9} />
      </mesh>
    </>
  );
}

interface Props {
  seats: SeatConfig[];
  chairman: SeatConfig;
  seatStates: Record<string, SeatState>;
}

export function CouncilScene({ seats, chairman, seatStates }: Props) {
  const everyone = [...seats, chairman];
  const blank: SeatState = {
    id: "", status: "idle", text: "", error: null,
    modelUsed: null, cached: false, tokenCount: 0, lastTokenAt: 0,
  };

  return (
    <Canvas shadows camera={{ position: [0, 4.5, 7], fov: 45 }}>
      <color attach="background" args={["#0f1115"]} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[4, 8, 4]} intensity={1.1} castShadow />
      <pointLight position={[0, 2, 0]} intensity={12} distance={9} color="#7aa2f7" />

      <Table />
      {everyone.map((seat, i) => (
        <Avatar
          key={seat.id}
          seat={seat}
          state={seatStates[seat.id] ?? { ...blank, id: seat.id }}
          position={seatPosition(i, everyone.length)}
          isChairman={seat.id === chairman.id}
        />
      ))}

      <OrbitControls
        enablePan={false}
        minDistance={4}
        maxDistance={14}
        maxPolarAngle={Math.PI / 2.1}
      />
    </Canvas>
  );
}
