import type { Bone, DepthTuning, DynamicsTuning, PhysicsTemplate, Point, RigParameter, TrackingSettings } from "../types/rig";

export const defaultBones: Bone[] = [
  { id: "root", name: "Root", kind: "root", position: { x: 0.5, y: 0.55 }, length: 0.25, rotation: 0, scale: 1, locked: true },
  { id: "body", name: "Body", kind: "body", parentId: "root", position: { x: 0.5, y: 0.58 }, length: 0.32, rotation: 0, scale: 1 },
  { id: "neck", name: "Neck", kind: "neck", parentId: "body", position: { x: 0.5, y: 0.43 }, length: 0.09, rotation: 0, scale: 1 },
  { id: "head", name: "Head", kind: "head", parentId: "neck", position: { x: 0.5, y: 0.31 }, length: 0.18, rotation: 0, scale: 1 },
  { id: "face", name: "Face Controls", kind: "face", parentId: "head", position: { x: 0.5, y: 0.29 }, length: 0.11, rotation: 0, scale: 1 },
  { id: "hair-back", name: "Back Hair", kind: "hair", parentId: "head", position: { x: 0.5, y: 0.23 }, length: 0.23, rotation: 0, scale: 1 },
  { id: "hair-side", name: "Side Hair", kind: "hair", parentId: "head", position: { x: 0.5, y: 0.27 }, length: 0.28, rotation: 0, scale: 1 },
  { id: "hair-front", name: "Front Hair", kind: "hair", parentId: "head", position: { x: 0.5, y: 0.21 }, length: 0.16, rotation: 0, scale: 1 },
  { id: "cloth-chest", name: "Chest Cloth", kind: "cloth", parentId: "body", position: { x: 0.5, y: 0.52 }, length: 0.18, rotation: 0, scale: 1 },
  { id: "cloth-hips", name: "Hip Cloth", kind: "cloth", parentId: "body", position: { x: 0.5, y: 0.68 }, length: 0.2, rotation: 0, scale: 1 },
  { id: "accessory", name: "Accessory", kind: "accessory", parentId: "hair-front", position: { x: 0.5, y: 0.14 }, length: 0.12, rotation: 0, scale: 1 }
];

export const defaultDepthTuning: DepthTuning = {
  faceNeckBlend: 0.28,
  frontHairNeckBlend: 0.12,
  backHairNeckBlend: 0.18,
  frontHairCloneNeckBlend: 0.2,
  backHairCloneNeckBlend: 0.26,
  headProxyZOffset: 0,
  headProxyDepthScale: 1,
  chinShrink: 0.24,
  eyeVerticalOvershoot: 0.5,
  mouthOpenScaleLimit: 0.75
};

export const maxMouthOpenScaleLimit = 2.4;

export const defaultDynamicsTuning: DynamicsTuning = {
  frontHairInertia: 0.52,
  backHairInertia: 0.66,
  accessoryInertia: 0.56
};

export const defaultHeadRollPivot: Point = {
  x: 0.5,
  y: 0.43
};

export const defaultParameters: RigParameter[] = [
  { id: "ParamAngleX", label: "头部 X", min: -30, max: 30, value: 0, defaultValue: 0 },
  { id: "ParamAngleY", label: "头部 Y", min: -30, max: 30, value: 0, defaultValue: 0 },
  { id: "ParamAngleZ", label: "头部 Z", min: -30, max: 30, value: 0, defaultValue: 0 },
  { id: "ParamBodyAngleX", label: "身体 X", min: -10, max: 10, value: 0, defaultValue: 0 },
  { id: "ParamBodyAngleY", label: "身体 Y", min: -8, max: 8, value: 0, defaultValue: 0 },
  { id: "ParamBodyAngleZ", label: "身体 Z", min: -4, max: 4, value: 0, defaultValue: 0 },
  { id: "ParamEyeBallX", label: "眼球 X", min: -1, max: 1, value: 0, defaultValue: 0 },
  { id: "ParamEyeBallY", label: "眼球 Y", min: -1, max: 1, value: 0, defaultValue: 0 },
  { id: "ParamEyeLOpen", label: "左眼开合", min: 0, max: 1, value: 1, defaultValue: 1 },
  { id: "ParamEyeROpen", label: "右眼开合", min: 0, max: 1, value: 1, defaultValue: 1 },
  { id: "ParamMouthOpenY", label: "嘴开合", min: 0, max: 1, value: 0, defaultValue: 0 },
  { id: "ParamMouthForm", label: "口型", min: -1, max: 1, value: 0, defaultValue: 0 },
  { id: "ParamArmLA", label: "左臂抬起", min: 0, max: 1, value: 0, defaultValue: 0 },
  { id: "ParamArmRA", label: "右臂抬起", min: 0, max: 1, value: 0, defaultValue: 0 },
  { id: "ParamBreath", label: "呼吸", min: 0, max: 1, value: 0, defaultValue: 0 }
];

export const defaultPhysicsTemplates: PhysicsTemplate[] = [
  {
    id: "hair-soft",
    name: "柔顺长发",
    kind: "hair",
    stiffness: 0.28,
    drag: 0.72,
    gravity: { x: 0, y: 0.42 },
    wind: 0.18,
    input: ["ParamAngleX", "ParamAngleY", "ParamAngleZ"],
    previewColor: "#42d6a4"
  },
  {
    id: "hair-short",
    name: "短发轻摆",
    kind: "hair",
    stiffness: 0.56,
    drag: 0.62,
    gravity: { x: 0, y: 0.25 },
    wind: 0.08,
    input: ["ParamAngleX", "ParamAngleZ"],
    previewColor: "#55a6ff"
  },
  {
    id: "cloth-heavy",
    name: "厚衣服/裙摆",
    kind: "cloth",
    stiffness: 0.48,
    drag: 0.8,
    gravity: { x: 0, y: 0.68 },
    wind: 0.05,
    input: ["ParamBodyAngleX", "ParamBodyAngleZ", "ParamBreath"],
    previewColor: "#f6c453"
  },
  {
    id: "cloth-light",
    name: "薄衣料/飘带",
    kind: "cloth",
    stiffness: 0.22,
    drag: 0.67,
    gravity: { x: 0, y: 0.5 },
    wind: 0.28,
    input: ["ParamBodyAngleX", "ParamAngleZ", "ParamBreath"],
    previewColor: "#ff7a90"
  },
  {
    id: "accessory-spring",
    name: "发饰弹簧",
    kind: "accessory",
    stiffness: 0.38,
    drag: 0.58,
    gravity: { x: 0, y: 0.16 },
    wind: 0.16,
    input: ["ParamAngleX", "ParamAngleZ"],
    previewColor: "#b78cff"
  },
  {
    id: "arm-follow",
    name: "手臂跟随",
    kind: "arm",
    stiffness: 0.64,
    drag: 0.7,
    gravity: { x: 0, y: 0.18 },
    wind: 0,
    input: ["ParamBodyAngleX", "ParamArmLA", "ParamArmRA"],
    previewColor: "#ff9f43"
  }
];

export const defaultTrackingSettings: TrackingSettings = {
  enabled: false,
  tier: "balanced",
  width: 960,
  height: 540,
  fps: 30,
  microphoneVowels: false,
  poseEnabled: false,
  poseFps: 20,
  smoothing: 0.42,
  interpolationMultiplier: 2,
  forceSmoothing: true,
  antiJitter: true,
  eyeYGain: 1.75,
  mouthOpenLimit: 0.72,
  poseLimit: 1,
  armLimit: 1,
  armRotationReverse: {
    left: false,
    right: false
  },
  previewMode: "video",
  angleLimits: {
    x: 45,
    y: 45,
    z: 0
  }
};
