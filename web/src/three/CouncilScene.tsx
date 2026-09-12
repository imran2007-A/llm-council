import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import { Bloom, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { BlendFunction, KernelSize } from "postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import { ACESFilmicToneMapping, MathUtils, Vector3 } from "three";
import type { PointLight } from "three";
import { Chair } from "./Chair";
import { CentreButton, FormationMotes } from "./CentreButton";
import { AbstractForm, SeatEmblem } from "./Presence";
import { Mannequin } from "./Mannequin";
import { MixamoAvatar, useMixamoClips } from "./MixamoAvatar";
import { AVATAR_MODE, HAS_MIXAMO_CLIPS } from "../avatars";
import { Floor, FormingRing, Table, seatPosition, seatRotation } from "./Table";
import { formation } from "../phases";
import type { Phase } from "../phases";
import { hex, palette, seatColor } from "../theme";
import type { SeatConfig, SeatState } from "../types";

/**
 * The chamber.
 *
 * Driven by two inputs only: the app phase, and the per-seat state from the server. No
 * animation reads an event directly, which is what keeps the scene and the data from
 * drifting apart when a stream stalls or a model fails mid-sentence.
 */

const BLANK: SeatState = {
  id: "", status: "idle", text: "", error: null,
  modelUsed: null, cached: false, tokenCount: 0, lastTokenAt: 0,
};

const CAMERA_POSITIONS: Record<string, [number, number, number]> = {
  forming: [0, 11, 13],
  ready: [0, 6.0, 9.4],
  asking: [0, 5.0, 8.8],
  answering: [0, 6.4, 10.2],
  deliberating: [0, 3.4, 7.2],
  ranked: [0, 6.2, 9.8],
  tabulate: [0, 7.4, 10.6],
  verdict: [0, 6.0, 9.6],
};

interface CameraProps {
  phase: Phase;
  elapsed: number;
  /** Where the Chairman sits, so the camera can go to them for the verdict. */
  chairmanPosition: [number, number, number];
}

function CameraRig({ phase, elapsed, chairmanPosition }: CameraProps) {
  const { camera, size } = useThree();
  const position = useRef(new Vector3(0, 11, 13));
  const lookAt = useRef(new Vector3(0, 0.9, 0));
  const scratch = useRef(new Vector3());
  const focusPoint = useRef(new Vector3(0, 0.9, 0));

  // A camera framed for a wide desktop viewport crops the council in portrait. An earlier
  // attempt scaled the distance by a hand-tuned factor and did not survive a fresh load,
  // so this computes the distance the frustum actually requires instead of guessing.
  //
  // In portrait the horizontal field of view is the binding one, and it is narrower than
  // the vertical: halfH = atan(tan(halfV) * aspect). The distance that fits a circle of
  // radius R is R / tan(halfAngle), taking whichever axis is tighter.
  // Distance alone cannot solve portrait: fitting a 4-unit circle across a narrow screen
  // at a 40 degree lens puts the camera 27 units back, which is geometrically correct and
  // visually useless -- the room becomes a speck. A wider lens on narrow viewports is the
  // conventional answer, so the fov opens up first and distance only covers what is left.
  const COUNCIL_RADIUS = 4.0;   // the ring of chairs, accepting a little crop at the edges
  const aspect = size.width / Math.max(1, size.height);
  const fov = aspect >= 1.3 ? 40 : aspect >= 0.9 ? 50 : 62;

  useEffect(() => {
    const perspective = camera as unknown as { fov: number; updateProjectionMatrix: () => void };
    if (perspective.fov !== fov) {
      perspective.fov = fov;
      perspective.updateProjectionMatrix();
    }
  }, [camera, fov]);

  const fitDistance = (() => {
    const halfV = (fov * Math.PI) / 360;
    const halfH = Math.atan(Math.tan(halfV) * aspect);
    return COUNCIL_RADIUS / Math.tan(Math.max(0.08, Math.min(halfV, halfH)));
  })();

  useFrame((_, delta) => {
    if (phase === "forming") {
      const t = MathUtils.clamp(
        (elapsed - formation.ring) / (formation.settle - formation.ring), 0, 1,
      );
      const eased = 1 - Math.pow(1 - t, 4);
      position.current.set(
        0,
        11 + (CAMERA_POSITIONS.ready[1] - 11) * eased,
        13 + (CAMERA_POSITIONS.ready[2] - 13) * eased,
      );
      lookAt.current.set(0, 0.9, 0);
    } else if (phase === "verdict") {
      // The panel fades in after VERDICT_HOLD_MS (see phases.ts), so this move is visible
      // for about a second before anything covers it.
      // Push in on the Chairman. The verdict is the one moment the room has a single
      // speaker, so the camera stops presenting a table and starts presenting a person.
      const [cx, , cz] = chairmanPosition;
      const outward = scratch.current.set(cx, 0, cz).normalize();
      position.current.set(cx, 2.05, cz).addScaledVector(outward, 2.4);
      position.current.y = 2.05;
      lookAt.current.set(cx * 0.5, 1.35, cz * 0.5);
    } else {
      const next = CAMERA_POSITIONS[phase] ?? CAMERA_POSITIONS.ready;
      position.current.set(next[0], next[1], next[2]);
      lookAt.current.set(0, 0.9, 0);
    }

    // Push the camera out to whatever the frustum needs, never pull it in: a wide desktop
    // viewport already fits, so this is a no-op there. The verdict push-in is deliberately
    // close and framed on one seat, so it is exempt.
    if (phase !== "verdict") {
      const distance = position.current.length();
      if (distance < fitDistance) {
        position.current.multiplyScalar(fitDistance / distance);
      }
    }

    // Frame-rate independent easing, so the move feels identical at 60Hz and 144Hz.
    const k = 1 - Math.pow(0.0015, delta);
    camera.position.lerp(position.current, k);

    // Ease the look target as well. Lerping position while snapping the target swings the
    // view at the start of every move.
    focusPoint.current.lerp(lookAt.current, k);
    camera.lookAt(focusPoint.current);
  });

  return null;
}

/**
 * A lamp over one seat, which brightens when that member is hovered or working.
 *
 * In a dark room the cheapest and most convincing way to say "this one" is to light it.
 * No outline, no badge: the chamber simply attends to whoever you point at.
 */
function SeatLamp({
  position, intensity, focus,
}: {
  position: [number, number, number];
  intensity: number;
  focus: number;
}) {
  const light = useRef<PointLight>(null);

  useFrame((_, delta) => {
    if (!light.current) return;
    const target = (9 + focus * 26) * intensity;
    const k = 1 - Math.pow(0.004, delta);
    light.current.intensity = MathUtils.lerp(light.current.intensity, target, k);
  });

  return (
    <pointLight
      ref={light}
      position={[position[0] * 0.82, 3.2, position[2] * 0.82]}
      intensity={9 * intensity}
      distance={7}
      decay={1.6}
      color={hex(palette.amber)}
    />
  );
}

function Lighting({ intensity, dim }: { intensity: number; dim: number }) {
  const ambient = useRef<PointLight>(null);
  return (
    <>
      <ambientLight intensity={0.16 * intensity * dim} color={hex(palette.amberDim)} />
      <spotLight
        position={[0, 6.5, 0]}
        angle={0.78}
        penumbra={1}
        intensity={46 * intensity * dim}
        color={hex(palette.amber)}
        distance={16}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
      />
      <directionalLight
        position={[-5, 4, -6]}
        intensity={0.42 * intensity * dim}
        color={hex(palette.brassLight)}
      />
      <pointLight
        ref={ambient}
        position={[0, 1.1, 0]}
        intensity={4 * intensity}
        distance={5}
        color={hex(palette.amber)}
      />
    </>
  );
}

interface Props {
  seats: SeatConfig[];
  chairman: SeatConfig;
  seatStates: Record<string, SeatState>;
  phase: Phase;
  elapsed: number;
  /** The keyboard trigger is focused, so the 3D button should look focused too. */
  centreFocused?: boolean;
  onCentreClick: () => void;
  onOpenSeat: (seatId: string) => void;
}

function SceneContents({
  seats, chairman, seatStates, phase, elapsed, centreFocused, onCentreClick, onOpenSeat,
}: Props) {
  const everyone = useMemo(() => [...seats, chairman], [seats, chairman]);
  const total = everyone.length;
  const forming = phase === "forming";
  const [hovered, setHovered] = useState<string | null>(null);

  const at = (start: number, duration: number) =>
    forming ? MathUtils.clamp((elapsed - start) / duration, 0, 1) : 1;

  const moteProgress = forming ? at(formation.split, formation.ring - formation.split) : 1;
  const ringProgress = forming ? at(formation.ring, formation.tableRise - formation.ring + 400) : 1;
  const tableRise = at(formation.tableRise, 700);
  const positions = useMemo(
    () => everyone.map((_, i) => seatPosition(i, total)),
    [everyone, total],
  );

  // Emblems hover above every seat at all times once the room exists. They are the only
  // thing that says who is sitting where, so hiding them until a question is asked left
  // the table anonymous exactly when someone is deciding whether to ask one. CSS dims
  // them at rest so five marks do not compete with the light at the centre.
  const showEmblems = phase !== "forming";

  // Loaded once and shared by every seat: Mixamo rigs all use the same bone names, so
  // one set of clips drives the whole council.
  const clips = useMixamoClips(AVATAR_MODE === "mixamo" && HAS_MIXAMO_CLIPS);

  // Hovering one member pulls light away from the rest. A lean, not a blackout.
  const dim = hovered ? 0.62 : 1;

  useEffect(() => {
    document.body.style.cursor = hovered ? "pointer" : "auto";
  }, [hovered]);

  return (
    <>
      <color attach="background" args={[palette.void]} />
      <fog attach="fog" args={[palette.void, 9, 24]} />
      <Lighting intensity={forming ? at(formation.ring, 900) : 1} dim={dim} />

      <Floor />
      <ContactShadows
        position={[0, 0.02, 0]}
        opacity={0.5}
        scale={16}
        blur={2.4}
        far={5}
        resolution={512}
        color="#000000"
      />

      <Table rise={tableRise} />
      <FormingRing progress={ringProgress} />
      {forming && moteProgress < 1 && (
        <FormationMotes
          positions={positions}
          colors={everyone.map((s) => seatColor(s.id))}
          progress={moteProgress}
        />
      )}

      {everyone.map((seat, i) => {
        const isChairman = seat.id === chairman.id;
        const rise = at(formation.chairs + i * formation.chairStagger, 600);
        const presence = at(formation.figures + i * formation.figureStagger, 700);
        const state = seatStates[seat.id] ?? { ...BLANK, id: seat.id };
        const accent = seatColor(seat.id);
        const [x, , z] = positions[i];
        const isHovered = hovered === seat.id;

        const working = state.status === "speaking" || state.status === "thinking";
        const delivering = isChairman && phase === "verdict";
        const focus = isHovered ? 1 : delivering ? 0.9 : working ? 0.45 : 0;

        return (
          <group key={seat.id}>
            <SeatLamp
              position={positions[i]}
              intensity={forming ? at(formation.chairs, 900) : 1}
              focus={focus}
            />
            <group position={[x, 0, z]} rotation={[0, seatRotation(i, total), 0]}>
              <Chair rise={rise} accent={accent} isChairman={isChairman} />
              {presence > 0.01 && (
                <group scale={presence} position={[0, (1 - presence) * -0.5, 0]}>
                  {AVATAR_MODE === "mixamo" ? (
                    <MixamoAvatar
                      seatId={seat.id}
                      state={state}
                      accent={accent}
                      isChairman={isChairman}
                      hovered={isHovered || delivering}
                      clips={clips}
                    />
                  ) : AVATAR_MODE === "mannequin" ? (
                    <Mannequin
                      seatId={seat.id}
                      state={state}
                      accent={accent}
                      isChairman={isChairman}
                      hovered={isHovered || delivering}
                    />
                  ) : (
                    <AbstractForm
                      state={state}
                      accent={accent}
                      isChairman={isChairman}
                      hovered={isHovered || delivering}
                    />
                  )}
                </group>
              )}
              {showEmblems && (
                <SeatEmblem
                  seatId={seat.id}
                  label={seat.label}
                  accent={accent}
                  state={state}
                  hovered={isHovered}
                  onHover={(h) => setHovered(h ? seat.id : null)}
                  onClick={() => onOpenSeat(seat.id)}
                  interactive={Boolean(state.text || state.error)}
                />
              )}
            </group>
          </group>
        );
      })}

      <CentreButton
        visible={phase === "ready"}
        enabled={phase === "ready"}
        focused={centreFocused}
        onClick={onCentreClick}
      />

      <CameraRig
        phase={phase}
        elapsed={elapsed}
        chairmanPosition={positions[total - 1]}
      />

      {/* No OrbitControls. It was mounted and grabbed the cursor, but CameraRig writes
          camera.position every frame, so dragging produced a twitch and an instant snap
          back. An affordance that invites a gesture it cannot honour is worse than none:
          the camera belongs to the phase. */}

      {/* Filmic grade. Tone mapping plus a little bloom does more for "cinematic" than
          any amount of extra geometry; grain and vignette stop dark areas banding on
          cheap panels and hold the eye in the middle of the frame. */}
      <EffectComposer enableNormalPass={false}>
        {/* Threshold kept high so only genuinely bright things bloom. At 0.22 the whole
            table glowed and the centre light blew out into a coloured smear. */}
        <Bloom
          intensity={0.42}
          luminanceThreshold={0.62}
          luminanceSmoothing={0.5}
          kernelSize={KernelSize.LARGE}
          mipmapBlur
        />
        <Vignette offset={0.22} darkness={0.86} blendFunction={BlendFunction.NORMAL} />
        {/* Film grain, not static. 0.4 was roughly five times too much and read as
            chromatic noise once bloom amplified it. */}
        <Noise premultiply blendFunction={BlendFunction.OVERLAY} opacity={0.06} />
      </EffectComposer>
    </>
  );
}

export function CouncilScene(props: Props) {
  useEffect(() => () => { document.body.style.cursor = "auto"; }, []);

  return (
    <div className="scene">
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ position: [0, 11, 13], fov: 40 }}
        gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 0.86 }}
      >
        <SceneContents {...props} />
      </Canvas>
    </div>
  );
}
