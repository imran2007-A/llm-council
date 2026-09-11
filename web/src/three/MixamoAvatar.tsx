import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimationMixer, LoopRepeat } from "three";
import type { AnimationAction, AnimationClip, Group, Mesh, Object3D } from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { AbstractForm } from "./Presence";
import { applySeatedPose, findBones } from "./seated";
import type { SeatState, SeatStatus } from "../types";

/**
 * Mixamo characters.
 *
 * Mixamo exports FBX, never glTF, so the FBX is loaded directly rather than making anyone
 * run a conversion step -- the download works untouched.
 *
 * The standard Mixamo split is followed: one file per character carrying mesh and
 * skeleton, and one file per animation exported "without skin", carrying only motion.
 * Every Mixamo rig shares bone names, so one set of clips drives the whole council.
 *
 * Loading is imperative rather than through useLoader and Suspense. Suspense is the wrong
 * tool for an asset that is allowed to be absent: a missing or unparseable file leaves the
 * boundary suspended forever with no error, which looks exactly like a slow download and
 * cost real time to diagnose. Loading by hand gives an explicit failure path, so a seat
 * quietly keeps its abstract form instead of a chair sitting empty for no stated reason.
 */

export const MIXAMO_DIR = "/models/mixamo";

/** Clips, in preference order per state. The first one that loaded wins. */
const CLIP_FOR_STATUS: Record<SeatStatus, string[]> = {
  idle: ["idle"],
  thinking: ["thinking", "idle"],
  speaking: ["talking", "idle"],
  done: ["idle"],
  failed: ["idle"],
};

/** Animation files looked for. Any that are missing are skipped without complaint. */
export const CLIP_FILES = ["idle", "talking", "thinking"] as const;

/**
 * Loads are queued, one at a time, each on a fresh loader.
 *
 * three's FBXLoader keeps parse state in module scope, so several loads in flight against
 * one instance interfere with each other. The symptom is maddening rather than obvious:
 * the same build succeeds on one reload and silently produces nothing on the next, with no
 * error on either. Serialising also keeps each ~700ms synchronous parse from piling up
 * into one long freeze.
 */
const cache = new Map<string, Promise<Group | null>>();
let queue: Promise<unknown> = Promise.resolve();

function loadFbx(url: string): Promise<Group | null> {
  let pending = cache.get(url);
  if (!pending) {
    pending = queue.then(() => new Promise<Group | null>((resolve) => {
      new FBXLoader().load(
        url,
        (group) => resolve(group as unknown as Group),
        undefined,
        // A missing or unparseable file is an expected outcome here, not an exception.
        () => resolve(null),
      );
    }));
    cache.set(url, pending);
    // Everything queued after this waits for it, successfully or not.
    queue = pending.catch(() => null);
  }
  return pending;
}

/** Loads the shared animation clips once. Empty means "pose them in code instead". */
export function useMixamoClips(enabled: boolean): Record<string, AnimationClip> {
  const [clips, setClips] = useState<Record<string, AnimationClip>>({});

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    Promise.all(CLIP_FILES.map((name) => loadFbx(`${MIXAMO_DIR}/anim-${name}.fbx`)))
      .then((results) => {
        if (cancelled) return;
        const found: Record<string, AnimationClip> = {};
        results.forEach((group, i) => {
          const clip = group?.animations?.[0];
          if (clip) {
            clip.name = CLIP_FILES[i];
            found[CLIP_FILES[i]] = clip;
          }
        });
        setClips(found);
      });

    return () => { cancelled = true; };
  }, [enabled]);

  return clips;
}

interface Props {
  seatId: string;
  state: SeatState;
  accent: string;
  isChairman?: boolean;
  hovered: boolean;
  clips: Record<string, AnimationClip>;
}

export function MixamoAvatar(props: Props) {
  const { seatId, state, isChairman, clips } = props;
  const group = useRef<Group>(null);
  const mixer = useRef<AnimationMixer | null>(null);
  const actions = useRef<Record<string, AnimationAction>>({});
  const playing = useRef<string | null>(null);
  const [source, setSource] = useState<Group | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadFbx(`${MIXAMO_DIR}/seat-${seatId}.fbx`).then((loaded) => {
      if (!cancelled) setSource(loaded);
    });
    return () => { cancelled = true; };
  }, [seatId]);

  const hasClips = Object.keys(clips).length > 0;

  const model = useMemo(() => {
    if (!source) return null;
    const copy = source.clone(true);

    if (hasClips) {
      // Mixamo authors in centimetres, and the clips carry their own posing.
      copy.scale.setScalar(0.01);
    } else {
      // No motion available, so sit them down by hand. applySeatedPose normalises height
      // from the head bone, which absorbs the centimetre scale on its own.
      applySeatedPose(copy, findBones(copy));
    }

    copy.traverse((child: Object3D) => {
      const mesh = child as Mesh & { isMesh?: boolean };
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // A posed or animated skinned mesh keeps its rest-pose bounds, so seats near the
        // edge of frame can vanish as the camera moves.
        mesh.frustumCulled = false;
      }
    });
    return copy;
  }, [source, hasClips]);

  useEffect(() => {
    if (!model || !hasClips) return;
    const instance = new AnimationMixer(model);
    mixer.current = instance;
    actions.current = {};
    playing.current = null;
    for (const [name, clip] of Object.entries(clips)) {
      const action = instance.clipAction(clip);
      action.setLoop(LoopRepeat, Infinity);
      actions.current[name] = action;
    }
    return () => {
      instance.stopAllAction();
      instance.uncacheRoot(model);
      mixer.current = null;
    };
  }, [model, clips, hasClips]);

  // Crossfade on status change. Fading rather than cutting matters here: a hard switch
  // from thinking to talking reads as a glitch rather than as a person reacting.
  useEffect(() => {
    const name = CLIP_FOR_STATUS[state.status].find((candidate) => actions.current[candidate]);
    if (!name || name === playing.current) return;
    const next = actions.current[name];
    const previous = playing.current ? actions.current[playing.current] : null;
    next.reset().setEffectiveWeight(1).fadeIn(0.4).play();
    previous?.fadeOut(0.4);
    playing.current = name;
  }, [state.status, clips]);

  useFrame((_, delta) => {
    mixer.current?.update(delta);
  });

  // Until the character arrives -- or if the file is missing entirely -- the seat keeps
  // its abstract form. An empty chair reads as a bug; a form that is simply not a person
  // reads as a choice.
  if (!model) return <AbstractForm {...props} />;

  return (
    <group ref={group} scale={isChairman ? 1.06 : 1}>
      <primitive object={model} />
    </group>
  );
}
