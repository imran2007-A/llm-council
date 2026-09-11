import { useGLTF } from "@react-three/drei";
import { Suspense } from "react";
import { hex, palette } from "../theme";

/**
 * A seat at the table.
 *
 * Two implementations behind one component. If `web/public/models/chair.glb` exists it is
 * used; otherwise a procedural chair is built from primitives. Same props, same
 * transform, same place in the scene graph -- so dropping the file in is the whole
 * migration, with no other file touched.
 */

const CHAIR_URL = "/models/chair.glb";

interface Props {
  /** 0 at the floor, 1 fully risen. Drives the formation sequence. */
  rise?: number;
  accent: string;
  isChairman?: boolean;
}

/** Procedural fallback: high-backed, buttoned, brass-footed. Reads as a throne in silhouette. */
function ProceduralChair({ accent, isChairman = false }: Props) {
  const backHeight = isChairman ? 1.02 : 0.8;
  const leather = hex(palette.walnut);

  return (
    <group>
      {/* Seat cushion */}
      <mesh position={[0, 0.46, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.62, 0.14, 0.6]} />
        <meshStandardMaterial color={leather} roughness={0.62} metalness={0.05} />
      </mesh>

      {/* High back, tilted slightly for comfort -- a vertical back reads as a kitchen
          chair no matter how good the material is. */}
      <mesh position={[0, 0.5 + backHeight / 2, -0.26]} rotation={[-0.08, 0, 0]} castShadow>
        <boxGeometry args={[0.62, backHeight, 0.1]} />
        <meshStandardMaterial color={leather} roughness={0.6} metalness={0.05} />
      </mesh>

      {/* A thin crown of the seat's own colour: identifies the occupant from across the
          table, and gives each chair a point of difference without repainting it. */}
      <mesh position={[0, 0.5 + backHeight, -0.26]} rotation={[-0.08, 0, 0]}>
        <boxGeometry args={[0.5, 0.028, 0.115]} />
        <meshStandardMaterial
          color={accent}
          emissive={accent}
          emissiveIntensity={0.12}
          roughness={0.4}
          metalness={0.7}
        />
      </mesh>

      {/* Arms */}
      {[-0.34, 0.34].map((x) => (
        <mesh key={x} position={[x, 0.62, -0.02]} castShadow>
          <boxGeometry args={[0.09, 0.09, 0.5]} />
          <meshStandardMaterial color={leather} roughness={0.5} metalness={0.1} />
        </mesh>
      ))}

      {/* Brass legs */}
      {[
        [-0.25, -0.24], [0.25, -0.24], [-0.25, 0.24], [0.25, 0.24],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.2, z]} castShadow>
          <cylinderGeometry args={[0.035, 0.028, 0.4, 10]} />
          <meshStandardMaterial
            color={hex(palette.brass)}
            roughness={0.28}
            metalness={0.85}
          />
        </mesh>
      ))}
    </group>
  );
}

function LoadedChair({ accent }: Props) {
  const { scene } = useGLTF(CHAIR_URL);
  // Cloned so five chairs do not share one mutable object in the scene graph.
  return <primitive object={scene.clone()} userData={{ accent }} />;
}

export function Chair(props: Props) {
  const rise = props.rise ?? 1;
  return (
    // Rising from below the floor, clipped by the table's own shadow, is what makes the
    // formation read as assembly rather than as things fading in.
    <group position={[0, (rise - 1) * 1.6, 0]} scale={[1, Math.max(0.001, rise), 1]}>
      <Suspense fallback={<ProceduralChair {...props} />}>
        {HAS_CHAIR_MODEL ? <LoadedChair {...props} /> : <ProceduralChair {...props} />}
      </Suspense>
    </group>
  );
}

/**
 * Set to true once you have dropped a chair.glb into web/public/models/.
 *
 * A build-time flag rather than a runtime fetch: probing for the file would mean a 404 in
 * the network log on every load, and a frame where the chair is missing.
 */
export const HAS_CHAIR_MODEL = false;
