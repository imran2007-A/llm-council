/**
 * What sits in the chairs. One file, two switches.
 *
 * Kept separate from everything else so changing the entire council's appearance is an
 * obvious one-line edit rather than a hunt through the scene graph.
 */

export type AvatarMode =
  /** Faceted forms built in code. No files, no downloads, works everywhere. */
  | "abstract"
  /** Mixamo characters loaded from web/public/models/mixamo/. */
  | "mixamo";

/**
 * Set to "mixamo" once the character files are in place.
 *
 * A build-time constant rather than a runtime probe on purpose: checking whether the
 * files exist would mean a 404 on every load for anyone who has not added them, and a
 * frame where the chairs are empty.
 */
export const AVATAR_MODE: AvatarMode = "abstract";

/**
 * Set to true once anim-idle.fbx, anim-talking.fbx or anim-thinking.fbx are present.
 *
 * With characters but no clips, the council is posed seated in code instead -- which
 * still looks right, it simply does not breathe.
 */
export const HAS_MIXAMO_CLIPS = false;
