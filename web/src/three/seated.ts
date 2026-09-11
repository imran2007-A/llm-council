import { Quaternion, Vector3 } from "three";
import type { Object3D } from "three";

/**
 * Sitting a standing character down, in code.
 *
 * The CC0 characters are rigged but ship with no animations, so there is no "sitting"
 * clip to play. Posing the bones directly avoids requiring an Adobe account to retarget
 * Mixamo clips, and it turns out to be better anyway: the head can move when tokens
 * actually arrive, so a stalled model visibly stalls instead of miming to an empty stream.
 *
 * Two properties of these rigs make the naive approach fail, and both were found the hard
 * way by measuring the file rather than guessing:
 *
 *  - They are authored at 1/100 scale with a x100 armature node, so bone translations are
 *    around 0.009. Nudging a bone by "0.4" moves it forty times the height of the whole
 *    character. Nothing here touches bone positions; placement happens on the parent group
 *    in world units instead.
 *  - The armature carries a -90 degrees X rotation from Blender's Z-up convention, so bone
 *    local axes do not line up with anything predictable. Every joint is therefore rotated
 *    about a WORLD axis, which is independent of how the rig happens to be oriented.
 */

export interface BoneSet {
  hips?: Object3D;
  spine?: Object3D;
  neck?: Object3D;
  head?: Object3D;
  upperLegL?: Object3D;
  upperLegR?: Object3D;
  lowerLegL?: Object3D;
  lowerLegR?: Object3D;
  upperArmL?: Object3D;
  upperArmR?: Object3D;
  lowerArmL?: Object3D;
  lowerArmR?: Object3D;
  handL?: Object3D;
  handR?: Object3D;
  footL?: Object3D;
  footR?: Object3D;
}

const ALIASES: Record<keyof BoneSet, string[]> = {
  hips: ["Hips", "mixamorigHips", "Pelvis"],
  spine: ["Spine", "Spine1", "mixamorigSpine"],
  neck: ["Neck", "mixamorigNeck"],
  head: ["Head", "mixamorigHead"],
  upperLegL: ["UpperLeg.L", "LeftUpLeg", "mixamorigLeftUpLeg", "Thigh.L"],
  upperLegR: ["UpperLeg.R", "RightUpLeg", "mixamorigRightUpLeg", "Thigh.R"],
  lowerLegL: ["LowerLeg.L", "LeftLeg", "mixamorigLeftLeg", "Shin.L"],
  lowerLegR: ["LowerLeg.R", "RightLeg", "mixamorigRightLeg", "Shin.R"],
  upperArmL: ["UpperArm.L", "LeftArm", "mixamorigLeftArm"],
  upperArmR: ["UpperArm.R", "RightArm", "mixamorigRightArm"],
  lowerArmL: ["LowerArm.L", "LeftForeArm", "mixamorigLeftForeArm"],
  lowerArmR: ["LowerArm.R", "RightForeArm", "mixamorigRightForeArm"],
  handL: ["Hand.L", "LeftHand", "mixamorigLeftHand"],
  handR: ["Hand.R", "RightHand", "mixamorigRightHand"],
  footL: ["Foot.L", "LeftFoot", "mixamorigLeftFoot"],
  footR: ["Foot.R", "RightFoot", "mixamorigRightFoot"],
};

/**
 * Bone names are compared with punctuation and case removed.
 *
 * three's GLTFLoader runs every node name through PropertyBinding.sanitizeNodeName, which
 * strips characters reserved by the animation system -- including the dot. A rig authored
 * with "UpperArm.L" therefore arrives as "UpperArmL", and matching the authored name finds
 * nothing. That failure is silent and looks exactly like a broken pose: the council sat
 * down correctly, because "Hips" survives unchanged, but no arm or leg ever moved.
 */
const normalise = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

export function findBones(root: Object3D): BoneSet {
  const byName = new Map<string, Object3D>();
  root.traverse((o) => {
    if (!o.name) return;
    const key = normalise(o.name);
    if (!byName.has(key)) byName.set(key, o);
  });

  const bones: BoneSet = {};
  for (const [key, names] of Object.entries(ALIASES) as [keyof BoneSet, string[]][]) {
    for (const name of names) {
      const found = byName.get(normalise(name));
      if (found) {
        bones[key] = found;
        break;
      }
    }
  }
  return bones;
}

/** Tuned by eye against renders. */
export const SEATED = {
  /** Where the head bone should sit when standing, in world units. */
  targetHeadHeight: 1.6,
  /** Where the seat of the chair is. */
  seatHeight: 0.47,
  /** Knees apart, as a fraction of the sideways axis. */
  splay: 0.16,
  /** Thighs angle down slightly rather than perfectly level. */
  thighDrop: 0.18,
  /** Upper arms hang close to the body, angled out a little. */
  armOut: 0.22,
} as const;

/**
 * Point a bone in a chosen direction.
 *
 * Rotating by fixed angles about guessed axes does not survive contact with a real rig:
 * these characters carry a -90 degrees armature correction from Blender's Z-up
 * convention, so no local axis means what you would expect, and every guess produced a
 * differently contorted figure.
 *
 * Aiming sidesteps the question. A bone's direction is simply the direction to its child,
 * which is measurable; the rotation that takes that to the direction we want is then
 * exact, whatever convention the rig was authored in.
 */
function aimBone(bone: Object3D, child: Object3D, targetDir: Vector3): void {
  const from = new Vector3();
  const to = new Vector3();
  bone.updateWorldMatrix(true, false);
  child.updateWorldMatrix(true, false);
  bone.getWorldPosition(from);
  child.getWorldPosition(to);

  const current = to.sub(from);
  if (current.lengthSq() < 1e-10) return;
  current.normalize();

  const delta = new Quaternion().setFromUnitVectors(current, targetDir.clone().normalize());

  // Apply the delta in world space, then express the result back in the bone's parent
  // space. three's rotateOnWorldAxis assumes an unrotated parent, which is exactly the
  // assumption that fails inside a skeleton.
  const world = new Quaternion();
  bone.getWorldQuaternion(world);
  const targetWorld = delta.multiply(world);

  const parentWorld = new Quaternion();
  if (bone.parent) bone.parent.getWorldQuaternion(parentWorld);
  bone.quaternion.copy(parentWorld.invert().multiply(targetWorld));
  bone.updateWorldMatrix(false, true);
}

/**
 * Scale a character to a known height, sit it down, and drop it onto the chair.
 * Returns the uniform scale applied.
 */
export function applySeatedPose(root: Object3D, bones: BoneSet): number {
  root.updateWorldMatrix(true, true);
  const probe = new Vector3();

  // Normalise height from the HEAD BONE, not a bounding box.
  //
  // Box3.setFromObject transforms each mesh's rest-pose bounds by that mesh's own world
  // matrix. On these files the skinned meshes sit outside the x100 armature node, so the
  // box came back 0.004 units tall and the correction scaled every character up by ~430x,
  // putting them so far outside the frame they looked like they had failed to load.
  const headY = bones.head ? bones.head.getWorldPosition(probe).y - root.position.y : 0;
  const scale = headY > 0.01 ? SEATED.targetHeadHeight / headY : 1;
  root.scale.multiplyScalar(scale);
  root.updateWorldMatrix(true, true);

  // Work out which way this character faces from its own skeleton, rather than assuming.
  // The line from the right hip to the left hip is "left"; forward follows from that.
  const left = new Vector3();
  if (bones.upperLegL && bones.upperLegR) {
    const l = new Vector3();
    const r = new Vector3();
    bones.upperLegL.getWorldPosition(l);
    bones.upperLegR.getWorldPosition(r);
    left.copy(l).sub(r).setY(0);
  }
  if (left.lengthSq() < 1e-8) left.set(1, 0, 0);
  left.normalize();

  const up = new Vector3(0, 1, 0);
  const forward = new Vector3().crossVectors(up, left).normalize();
  const down = new Vector3(0, -1, 0);

  const { splay, thighDrop, armOut } = SEATED;

  // Thighs forward and very slightly down, knees a little apart.
  const thighL = forward.clone().addScaledVector(left, splay).addScaledVector(down, thighDrop);
  const thighR = forward.clone().addScaledVector(left, -splay).addScaledVector(down, thighDrop);
  if (bones.upperLegL && bones.lowerLegL) aimBone(bones.upperLegL, bones.lowerLegL, thighL);
  if (bones.upperLegR && bones.lowerLegR) aimBone(bones.upperLegR, bones.lowerLegR, thighR);

  // Shins straight down to the floor.
  if (bones.lowerLegL && bones.footL) aimBone(bones.lowerLegL, bones.footL, down);
  if (bones.lowerLegR && bones.footR) aimBone(bones.lowerLegR, bones.footR, down);

  // Upper arms down beside the body.
  const armL = down.clone().addScaledVector(left, armOut);
  const armR = down.clone().addScaledVector(left, -armOut);
  if (bones.upperArmL && bones.lowerArmL) aimBone(bones.upperArmL, bones.lowerArmL, armL);
  if (bones.upperArmR && bones.lowerArmR) aimBone(bones.upperArmR, bones.lowerArmR, armR);

  // Forearms forward, resting along the arms of the chair.
  const foreL = forward.clone().addScaledVector(down, 0.25);
  if (bones.lowerArmL && bones.handL) aimBone(bones.lowerArmL, bones.handL, foreL);
  if (bones.lowerArmR && bones.handR) aimBone(bones.lowerArmR, bones.handR, foreL);

  // Finally sit the figure down by putting the hips at seat height.
  root.updateWorldMatrix(true, true);
  if (bones.hips) {
    const hipsY = bones.hips.getWorldPosition(probe).y;
    root.position.y += SEATED.seatHeight - hipsY;
  }

  return scale;
}

/**
 * Per-frame life on top of the static pose.
 *
 * `speaking` means a token arrived recently, not merely that the seat's status is
 * "speaking" -- that distinction is what makes a stalled stream look stalled.
 */
export function animateSeated(
  bones: BoneSet,
  t: number,
  status: "idle" | "thinking" | "speaking" | "done" | "failed",
  speaking: boolean,
  seed: number,
): void {
  const head = bones.head;
  const neck = bones.neck;
  if (!head || !neck) return;

  // Rotations are applied to the head's own local frame each frame, so they are additive
  // on top of whatever the seated pose left, and do not accumulate.
  if (status === "speaking" && speaking) {
    head.rotation.x = Math.sin(t * 8 + seed) * 0.05;
    head.rotation.z = Math.sin(t * 2.7 + seed) * 0.07;
  } else if (status === "thinking") {
    head.rotation.x = 0.12 + Math.sin(t * 1.2 + seed) * 0.02;
    head.rotation.z = Math.sin(t * 0.6 + seed) * 0.1;
  } else {
    // Breathing and a slow idle drift, so nobody reads as a mannequin.
    head.rotation.x += (Math.sin(t * 0.5 + seed) * 0.02 - head.rotation.x) * 0.05;
    head.rotation.z += (Math.sin(t * 0.35 + seed) * 0.04 - head.rotation.z) * 0.05;
  }
  neck.rotation.x = Math.sin(t * 1.1 + seed) * 0.012;
}
