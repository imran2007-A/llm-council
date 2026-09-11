import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { useEffect, useRef } from "react";
import { Vector3 } from "three";
import { Avatar } from "./Avatar";
import { Chair } from "./Chair";
import { CentreButton, FormationMotes } from "./CentreButton";
import { Floor, FormingRing, Table, seatPosition, seatRotation } from "./Table";
import { formation } from "../phases";
import type { Phase } from "../phases";
import { hex, palette, seatColor } from "../theme";
import type { SeatConfig, SeatState } from "../types";

/**
 * The chamber.
 *
 * Everything here is driven by two inputs: the app phase, and the per-seat state from the
 * server. No animation reads from an event directly, which is what stops the scene and
 * the data drifting apart when a stream stalls or a model fails mid-sentence.
 */

const BLANK: SeatState = {
  id: "", status: "idle", text: "", error: null,
  modelUsed: null, cached: false, tokenCount: 0, lastTokenAt: 0,
};

/** Where the camera rests in each phase. Deliberating pulls in tight and low. */
const CAMERA_POSITIONS: Record<string, [number, number, number]> = {
  forming: [0, 11, 13],
  ready: [0, 6.0, 9.4],
  asking: [0, 5.0, 8.8],
  answering: [0, 6.4, 10.2],
  deliberating: [0, 3.4, 7.2],
  ranked: [0, 6.2, 9.8],
  verdict: [0, 5.8, 9.2],
};

function CameraRig({ phase, elapsed }: { phase: Phase; elapsed: number }) {
  const { camera } = useThree();
  const target = useRef(new Vector3(0, 11, 13));
  const look = useRef(new Vector3(0, 0.9, 0));

  useFrame((_, delta) => {
    // During formation the camera is on a timeline; afterwards it eases to whatever the
    // current phase asks for. Both end up writing the same target vector.
    if (phase === "forming") {
      const t = Math.min(1, Math.max(0, (elapsed - formation.ring) / (formation.settle - formation.ring)));
      const eased = 1 - Math.pow(1 - t, 4);
      target.current.set(
        0,
        11 + (CAMERA_POSITIONS.ready[1] - 11) * eased,
        13 + (CAMERA_POSITIONS.ready[2] - 13) * eased,
      );
    } else {
      const next = CAMERA_POSITIONS[phase] ?? CAMERA_POSITIONS.ready;
      target.current.set(next[0], next[1], next[2]);
    }

    // Critically damped-ish follow. Frame-rate independent, so it feels the same on a
    // 60Hz laptop and a 144Hz monitor.
    const k = 1 - Math.pow(0.001, delta);
    camera.position.lerp(target.current, k);
    camera.lookAt(look.current);
  });

  return null;
}

/** A warm lamp hanging over one seat. */
function SeatLamp({ position, intensity }: { position: [number, number, number]; intensity: number }) {
  return (
    <pointLight
      position={[position[0] * 0.82, 3.2, position[2] * 0.82]}
      intensity={9 * intensity}
      distance={6.5}
      decay={1.6}
      color={hex(palette.amber)}
    />
  );
}

/** The warm key light that hangs over the table, plus a pool under each seat. */
function Lighting({ intensity }: { intensity: number }) {
  return (
    <>
      <ambientLight intensity={0.55 * intensity} color={hex(palette.amberDim)} />

      {/* The chandelier: one warm source directly above the table, which is what makes
          the brass inlay and the chair crowns read. */}
      <spotLight
        position={[0, 6.5, 0]}
        angle={1.05}
        penumbra={1}
        intensity={70 * intensity}
        color={hex(palette.amber)}
        distance={16}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0005}
      />

      {/* A dim rim from behind, so figures separate from the black rather than dissolving
          into it. */}
      <directionalLight
        position={[-5, 4, -6]}
        intensity={0.85 * intensity}
        color={hex(palette.brassLight)}
      />

      {/* Glow from the table's centre, as if the button lights the room. */}
      <pointLight
        position={[0, 1.1, 0]}
        intensity={4 * intensity}
        distance={5}
        color={hex(palette.amber)}
      />
    </>
  );
}

/** A short preview of what a seat is saying, floating beside its chair. */
function SeatPreview({
  state,
  label,
  accent,
  onOpen,
  visible,
}: {
  state: SeatState;
  label: string;
  accent: string;
  onOpen: () => void;
  visible: boolean;
}) {
  if (!visible) return null;

  const preview = state.error
    ? state.error
    : state.text.slice(-160); // the tail, so it reads as currently-being-spoken

  const speaking = state.status === "speaking";
  const busy = state.status === "thinking";

  return (
    <Html position={[0, 2.05, 0]} center distanceFactor={7} zIndexRange={[10, 0]}>
      <button
        className="seat-preview"
        data-status={state.status}
        style={{ "--accent": accent } as React.CSSProperties}
        onClick={onOpen}
        disabled={!state.text && !state.error}
      >
        <span className="seat-preview__name">{label}</span>
        <span className="seat-preview__body">
          {busy && !preview ? <span className="seat-preview__dots"><i /><i /><i /></span> : preview}
        </span>
        {speaking && <span className="seat-preview__live" />}
        {state.status === "done" && state.text && (
          <span className="seat-preview__more">Read in full</span>
        )}
      </button>
    </Html>
  );
}

interface Props {
  seats: SeatConfig[];
  chairman: SeatConfig;
  seatStates: Record<string, SeatState>;
  phase: Phase;
  /** ms since the formation sequence began. */
  elapsed: number;
  onCentreClick: () => void;
  onOpenSeat: (seatId: string) => void;
}

function SceneContents({
  seats, chairman, seatStates, phase, elapsed, onCentreClick, onOpenSeat,
}: Props) {
  const everyone = [...seats, chairman];
  const total = everyone.length;
  const forming = phase === "forming";

  // Each element of the formation reads its own progress off one clock, rather than
  // chaining callbacks. Timings live in phases.ts so the DOM overlay can use them too.
  const at = (start: number, duration: number) =>
    forming ? Math.min(1, Math.max(0, (elapsed - start) / duration)) : 1;

  const moteProgress = forming ? at(formation.split, formation.ring - formation.split) : 1;
  const ringProgress = forming ? at(formation.ring, formation.tableRise - formation.ring + 400) : 1;
  const tableRise = at(formation.tableRise, 700);
  const positions = everyone.map((_, i) => seatPosition(i, total));
  const colors = everyone.map((s) => seatColor(s.id));

  const showPreviews = phase === "answering" || phase === "deliberating" || phase === "ranked";

  return (
    <>
      <color attach="background" args={[palette.void]} />
      <fog attach="fog" args={[palette.void, 12, 30]} />
      <Lighting intensity={forming ? at(formation.ring, 900) : 1} />
      {positions.map((p, i) => (
        <SeatLamp key={i} position={p} intensity={forming ? at(formation.chairs, 900) : 1} />
      ))}
      <Floor />

      <Table rise={tableRise} />
      <FormingRing progress={ringProgress} />
      {forming && moteProgress < 1 && (
        <FormationMotes positions={positions} colors={colors} progress={moteProgress} />
      )}

      {everyone.map((seat, i) => {
        const isChairman = seat.id === chairman.id;
        const rise = at(formation.chairs + i * formation.chairStagger, 600);
        const presence = at(formation.figures + i * formation.figureStagger, 700);
        const state = seatStates[seat.id] ?? { ...BLANK, id: seat.id };
        const accent = seatColor(seat.id);
        const [x, , z] = positions[i];

        return (
          <group key={seat.id} position={[x, 0, z]} rotation={[0, seatRotation(i, total), 0]}>
            <Chair rise={rise} accent={accent} isChairman={isChairman} />
            <Avatar
              seatId={seat.id}
              state={state}
              accent={accent}
              isChairman={isChairman}
              presence={presence}
            />
            <SeatPreview
              state={state}
              label={seat.label}
              accent={accent}
              visible={showPreviews}
              onOpen={() => onOpenSeat(seat.id)}
            />
          </group>
        );
      })}

      <CentreButton
        visible={phase === "ready"}
        enabled={phase === "ready"}
        onClick={onCentreClick}
      />

      <CameraRig phase={phase} elapsed={elapsed} />

      {/* Look around, but not underneath the floor or from impossible distances. Panning
          is off: there is one subject here, and it is in the middle. */}
      <OrbitControls
        enablePan={false}
        enabled={phase !== "forming"}
        minDistance={4.5}
        maxDistance={13}
        maxPolarAngle={Math.PI / 2.15}
        target={[0, 0.9, 0]}
      />
    </>
  );
}

export function CouncilScene(props: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Releasing the cursor on unmount: a 3D component that leaves the page with a pointer
  // cursor stuck on is a small bug that feels like a big one.
  useEffect(() => () => { document.body.style.cursor = "auto"; }, []);

  return (
    <div ref={ref} className="scene">
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ position: [0, 11, 13], fov: 40 }}
        gl={{ antialias: true }}
      >
        <SceneContents {...props} />
      </Canvas>
    </div>
  );
}
