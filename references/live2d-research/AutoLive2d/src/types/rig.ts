export type PartKind =
  | "backHair"
  | "frontHair"
  | "sideHair"
  | "face"
  | "eyebrow"
  | "eyeWhite"
  | "iris"
  | "eyelash"
  | "nose"
  | "mouth"
  | "ear"
  | "neck"
  | "torso"
  | "arm"
  | "hand"
  | "bottomWear"
  | "topWear"
  | "accessory"
  | "unknown";

export type BoneKind =
  | "root"
  | "body"
  | "neck"
  | "head"
  | "face"
  | "hair"
  | "eye"
  | "mouth"
  | "arm"
  | "cloth"
  | "accessory";

export type ParameterId =
  | "ParamAngleX"
  | "ParamAngleY"
  | "ParamAngleZ"
  | "ParamBodyAngleX"
  | "ParamBodyAngleY"
  | "ParamBodyAngleZ"
  | "ParamEyeBallX"
  | "ParamEyeBallY"
  | "ParamEyeLOpen"
  | "ParamEyeROpen"
  | "ParamMouthOpenY"
  | "ParamMouthForm"
  | "ParamArmLA"
  | "ParamArmRA"
  | "ParamBreath";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface PsdLayerAsset {
  id: string;
  sourceName: string;
  path: string[];
  kind: PartKind;
  side?: "left" | "right" | "center";
  bounds: Rect;
  naturalBounds: Rect;
  opacity: number;
  visible: boolean;
  blendMode: string;
  imageUrl: string;
  z: number;
  recommendedZ: number;
  parentBoneId: string;
  pivot?: Point;
  localScale?: number;
  localRotation?: number;
  mesh: MeshBinding;
  deformers: DeformerBinding[];
  physicsTemplateId?: string;
  inertiaScale?: number;
  attachment?: LayerAttachment;
}

export interface LayerAttachment {
  type: "object" | "expression";
  parentLayerId?: string;
  exclusiveGroup?: string;
  expressionKey?: string;
  triggerKey?: string;
  cloneKind?: PartKind;
  proxyGroup?: "back" | "front";
  depthAnchor?: "neck";
  notes?: string;
}

export interface MeshBinding {
  rows: number;
  cols: number;
  points: Point[];
  depths?: number[];
  projectedDepths?: number[];
}

export interface DeformerBinding {
  id: string;
  parameter: ParameterId;
  axis: "x" | "y" | "z" | "opacity" | "scale";
  strength: number;
  keyframes: DeformKeyframe[];
}

export interface DeformKeyframe {
  value: number;
  translate: Point;
  rotate: number;
  scale: Point;
  opacity?: number;
}

export interface Bone {
  id: string;
  name: string;
  kind: BoneKind;
  parentId?: string;
  position: Point;
  length: number;
  rotation: number;
  scale: number;
  locked?: boolean;
}

export interface RigParameter {
  id: ParameterId;
  label: string;
  min: number;
  max: number;
  value: number;
  defaultValue: number;
}

export interface PhysicsTemplate {
  id: string;
  name: string;
  kind: "hair" | "cloth" | "accessory" | "arm";
  stiffness: number;
  drag: number;
  gravity: Point;
  wind: number;
  input: ParameterId[];
  previewColor: string;
}

export interface DepthTuning {
  faceNeckBlend: number;
  frontHairNeckBlend: number;
  backHairNeckBlend: number;
  frontHairCloneNeckBlend: number;
  backHairCloneNeckBlend: number;
  headProxyZOffset: number;
  headProxyDepthScale: number;
  chinShrink: number;
  eyeVerticalOvershoot: number;
  mouthOpenScaleLimit: number;
}

export interface DynamicsTuning {
  frontHairInertia: number;
  backHairInertia: number;
  accessoryInertia: number;
}

export interface Widget {
  id: string;
  name: string;
  parentBoneId: string;
  rect: Rect;
  z: number;
  triggerParameter: ParameterId;
}

export interface TrackingSettings {
  enabled: boolean;
  tier: "eco" | "balanced" | "quality";
  width: number;
  height: number;
  fps: number;
  microphoneVowels: boolean;
  poseEnabled: boolean;
  poseFps?: number;
  smoothing: number;
  interpolationMultiplier?: number;
  forceSmoothing?: boolean;
  antiJitter?: boolean;
  eyeYGain?: number;
  mouthOpenLimit?: number;
  poseLimit?: number;
  armLimit?: number;
  armRotationReverse?: {
    left?: boolean;
    right?: boolean;
  };
  previewMode?: "video" | "points";
  angleLimits?: {
    x: number;
    y: number;
    z: number;
  };
}

export interface TrackingState {
  hasFace: boolean;
  hasPose: boolean;
  yaw: number;
  pitch: number;
  roll: number;
  eyeX: number;
  eyeY: number;
  blinkLeft: number;
  blinkRight: number;
  mouthOpen: number;
  mouthForm: number;
  bodyLeanX: number;
  bodyLeanY: number;
  armLeft: number;
  armRight: number;
  fps: number;
  facePoints?: Point[];
  posePoints?: Point[];
  poseDebug?: {
    leftElbow: boolean;
    leftWrist: boolean;
    rightElbow: boolean;
    rightWrist: boolean;
    leftElbowLift: number;
    leftWristLift: number;
    rightElbowLift: number;
    rightWristLift: number;
    armLeftRaw: number;
    armRightRaw: number;
  };
}

export type StageBackgroundMode = "checker" | "green" | "white" | "black" | "transparent";

export interface ParameterSnapshot {
  id: string;
  name: string;
  createdAt: string;
  parameters: RigParameter[];
  depthTuning?: DepthTuning;
  dynamicsTuning?: DynamicsTuning;
  stageBackground?: StageBackgroundMode;
  headRollPivot?: Point;
}

export interface RigProject {
  version: 1;
  name: string;
  canvas: {
    width: number;
    height: number;
  };
  source: {
    fileName: string;
    importedAt: string;
    layerCount: number;
  };
  layers: PsdLayerAsset[];
  bones: Bone[];
  parameters: RigParameter[];
  physicsTemplates: PhysicsTemplate[];
  widgets: Widget[];
  depthMode?: "manual" | "depthMap" | "proxyHead";
  depthMapSource?: string;
  depthTuning?: DepthTuning;
  dynamicsTuning?: DynamicsTuning;
  parameterSnapshots?: ParameterSnapshot[];
  stageBackground?: StageBackgroundMode;
  headRollPivot?: Point;
  expressionState?: {
    active: Record<string, string>;
  };
  tracking: TrackingSettings;
}

export interface RigTemplateLayerBinding {
  id: string;
  sourceName: string;
  kind: PartKind;
  side?: "left" | "right" | "center";
  bounds?: Rect;
  naturalBounds?: Rect;
  recommendedZ?: number;
  parentBoneId: string;
  pivot?: Point;
  localScale?: number;
  localRotation?: number;
  mesh: MeshBinding;
  deformers: DeformerBinding[];
  physicsTemplateId?: string;
  inertiaScale?: number;
  attachment?: LayerAttachment;
  z: number;
}

export interface RigTemplate {
  version: 1;
  sourceCanvas: {
    width: number;
    height: number;
  };
  depthMode?: RigProject["depthMode"];
  depthMapSource?: string;
  depthTuning?: DepthTuning;
  dynamicsTuning?: DynamicsTuning;
  headRollPivot?: Point;
  expressionState?: RigProject["expressionState"];
  bones: Bone[];
  parameters?: RigParameter[];
  layerBindings: RigTemplateLayerBinding[];
  physicsTemplates: PhysicsTemplate[];
  widgets: Widget[];
}

export interface TemplateApplyReport {
  fileName: string;
  matchedLayers: number;
  unmatchedLayers: number;
  exactNameMatches: number;
  kindMatches: number;
  confidence: number;
  criticalMissing: PartKind[];
  unusedTemplateLayers: number;
  zWarnings: Array<{
    sourceName: string;
    from: number;
    to: number;
    delta: number;
  }>;
  layerMatches: Array<{
    layerId: string;
    sourceName: string;
    kind: PartKind;
    match: "exact" | "kind" | "none";
    confidence: number;
    templateSourceName?: string;
    templateKind?: PartKind;
    zBefore: number;
    zAfter: number;
    zDelta: number;
    warning?: string;
  }>;
  warnings: string[];
}

export interface ImportReport {
  fileName: string;
  canvasWidth: number;
  canvasHeight: number;
  layerCount: number;
  visibleLayerCount: number;
  unknownLayerCount: number;
  objectLayerCount?: number;
  expressionLayerCount?: number;
  safetyLimits?: {
    head: {
      x: number;
      y: number;
      z: number;
    };
    body: {
      x: number;
      y: number;
      z: number;
    };
  };
  zFixes: Array<{
    layerId: string;
    sourceName: string;
    from: number;
    to: number;
  }>;
}
