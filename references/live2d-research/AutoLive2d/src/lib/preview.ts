import { expressionMouthOpacity, isLayerBodyPart, isLayerHeadPart, isOpenMouthExpressionLayer } from "./deform3d";
import { defaultDynamicsTuning, defaultHeadRollPivot } from "./defaults";
import type { DynamicsTuning, ParameterId, PartKind, PhysicsTemplate, Point, PsdLayerAsset, RigParameter, TrackingSettings, TrackingState } from "../types/rig";

export type LayerStyle = {
  transform: string;
  opacity: number;
  filter?: string;
};

export type LayerMotion = {
  x: number;
  y: number;
  rotate: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  baseX?: number;
  baseY?: number;
  baseRotate?: number;
  baseScaleX?: number;
  baseScaleY?: number;
  physicsX?: number;
  physicsY?: number;
  physicsRotate?: number;
  tailX?: number;
  tailY?: number;
  tailRotate?: number;
  pivotX?: number;
  pivotY?: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function valueOf(parameters: RigParameter[], id: ParameterId): number {
  return parameters.find((parameter) => parameter.id === id)?.value ?? 0;
}

function angleLimit(settings: TrackingSettings | undefined, axis: "x" | "y" | "z", fallback: number): number {
  return Math.max(0, settings?.angleLimits?.[axis] ?? fallback);
}

export function applyTrackingToParameters(parameters: RigParameter[], tracking: TrackingState, settings?: TrackingSettings): RigParameter[] {
  const limitX = angleLimit(settings, "x", 45);
  const limitY = angleLimit(settings, "y", 45);
  const limitZ = angleLimit(settings, "z", 0);
  const eyeYGain = clamp(settings?.eyeYGain ?? 1.75, 0.5, 3);
  const mouthOpenLimit = clamp(settings?.mouthOpenLimit ?? 0.72, 0.05, 1);
  const poseLimit = clamp(settings?.poseLimit ?? 1, 0, 3);
  const armLimit = clamp(settings?.armLimit ?? 1, 0, 2);
  const mouthOpenDrive = Math.pow(clamp(tracking.mouthOpen, 0, 1), 1.12) * 0.82;
  const patch: Partial<Record<ParameterId, number>> = {
    ParamAngleX: tracking.yaw * limitX,
    ParamAngleY: tracking.pitch * limitY,
    ParamAngleZ: tracking.roll * limitZ,
    ParamBodyAngleX: tracking.bodyLeanX * 6.5 * poseLimit,
    ParamBodyAngleY: tracking.bodyLeanY * 4.2 * poseLimit,
    ParamBodyAngleZ: tracking.roll * 1.15 * poseLimit,
    ParamEyeBallX: tracking.eyeX,
    ParamEyeBallY: clamp(tracking.eyeY * eyeYGain, -1, 1),
    ParamEyeLOpen: 1 - tracking.blinkLeft,
    ParamEyeROpen: 1 - tracking.blinkRight,
    ParamMouthOpenY: clamp(mouthOpenDrive, 0, mouthOpenLimit),
    ParamMouthForm: tracking.mouthForm,
    ParamArmLA: clamp(tracking.armLeft * armLimit, 0, 1),
    ParamArmRA: clamp(tracking.armRight * armLimit, 0, 1)
  };

  return parameters.map((parameter) => {
    const next = patch[parameter.id];
    if (typeof next !== "number") return parameter;
    return {
      ...parameter,
      value: Math.min(parameter.max, Math.max(parameter.min, next))
    };
  });
}

function normalizedParam(parameters: RigParameter[], id: ParameterId): number {
  const parameter = parameters.find((item) => item.id === id);
  if (!parameter) return 0;
  if (parameter.max === parameter.min) return 0;
  return ((parameter.value - parameter.defaultValue) / Math.max(Math.abs(parameter.max - parameter.defaultValue), Math.abs(parameter.min - parameter.defaultValue))) || 0;
}

function openParam(parameters: RigParameter[], id: ParameterId): number {
  const parameter = parameters.find((item) => item.id === id);
  return parameter ? (parameter.value - parameter.min) / (parameter.max - parameter.min) : 0;
}

function eyeOpenForLayer(layer: PsdLayerAsset, parameters: RigParameter[]): number {
  if (layer.side === "left") return openParam(parameters, "ParamEyeLOpen");
  if (layer.side === "right") return openParam(parameters, "ParamEyeROpen");
  return Math.min(openParam(parameters, "ParamEyeLOpen"), openParam(parameters, "ParamEyeROpen"));
}

function effectiveBreath(parameters: RigParameter[], t: number): number {
  const manual = openParam(parameters, "ParamBreath");
  if (manual > 0.01) return manual;
  return 0.5 + Math.sin(t * 1.45) * 0.5;
}

function rectCenter(layer: PsdLayerAsset) {
  return {
    x: layer.naturalBounds.x + layer.naturalBounds.width * 0.5,
    y: layer.naturalBounds.y + layer.naturalBounds.height * 0.5
  };
}

function parentRotationOffset(layer: PsdLayerAsset, rotateDegrees: number, canvasSize: { width: number; height: number }) {
  if (Math.abs(rotateDegrees) < 0.0001) return { x: 0, y: 0 };
  const pivot = { x: 0.5, y: 0.52 };
  const center = rectCenter(layer);
  const localX = (center.x - pivot.x) * canvasSize.width;
  const localY = (center.y - pivot.y) * canvasSize.height;
  const rad = (rotateDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: localX * cos - localY * sin - localX,
    y: localX * sin + localY * cos - localY
  };
}

function resolveDynamicsTuning(tuning?: Partial<DynamicsTuning>): DynamicsTuning {
  return {
    ...defaultDynamicsTuning,
    ...tuning
  };
}

function inertiaForLayer(layer: PsdLayerAsset, tuning: DynamicsTuning): number {
  const layerScale = layerInertiaScale(layer);
  if (layer.kind === "frontHair" || layer.kind === "sideHair") return clamp(tuning.frontHairInertia * layerScale, 0, 2.4);
  if (layer.kind === "backHair") return clamp(tuning.backHairInertia * layerScale, 0, 2.4);
  if (layer.kind === "accessory") return clamp(tuning.accessoryInertia * layerScale, 0, 2.4);
  return 1;
}

function layerInertiaScale(layer: PsdLayerAsset): number {
  if (typeof layer.inertiaScale === "number") return clamp(layer.inertiaScale, 0, 2.4);
  const bounds = layer.naturalBounds;
  const areaScale = Math.sqrt(Math.max(0.0001, bounds.width * bounds.height) / 0.09);
  const kindBase = layer.kind === "accessory" ? 0.82 : layer.kind === "backHair" ? 1.08 : 1;
  return clamp(areaScale * kindBase, 0.55, 1.65);
}

function tailFactorForLayer(layer: PsdLayerAsset, tuning: DynamicsTuning): number {
  const height = Math.pow(clamp((layer.naturalBounds.height || 0.1) / 0.4, 0.28, 1), 0.5);
  const layerScale = layerInertiaScale(layer);
  if (layer.kind === "frontHair" || layer.kind === "sideHair") return height * clamp(tuning.frontHairInertia * layerScale, 0, 2.4);
  if (layer.kind === "backHair") return height * clamp(tuning.backHairInertia * layerScale, 0, 2.4);
  if (layer.kind === "accessory") return height * 0.82 * clamp(tuning.accessoryInertia * layerScale, 0, 2.4);
  return 0;
}

function rootPhysicsScaleForLayer(layer: PsdLayerAsset): number {
  if (layer.kind === "frontHair") return 0.14;
  if (layer.kind === "sideHair") return 0.18;
  if (layer.kind === "backHair") return 0.22;
  if (layer.kind === "accessory") return 0.2;
  return 1;
}

function physicsOffset(layer: PsdLayerAsset, templates: PhysicsTemplate[], t: number, parameters: RigParameter[], dynamics?: Partial<DynamicsTuning>) {
  const template = templates.find((item) => item.id === layer.physicsTemplateId);
  if (!template) return { x: 0, y: 0, rotate: 0, tailX: 0, tailY: 0, tailRotate: 0 };
  const tuning = resolveDynamicsTuning(dynamics);
  const inertia = inertiaForLayer(layer, tuning);

  const xDrive =
    template.input.reduce((sum, id) => {
      const drive = id === "ParamBreath" ? effectiveBreath(parameters, t) * 0.35 : normalizedParam(parameters, id);
      return sum + drive;
    }, 0) / Math.max(1, template.input.length);
  const zDrive = template.input.includes("ParamAngleZ") ? normalizedParam(parameters, "ParamAngleZ") : 0;
  const sway = Math.sin(t * (0.8 + template.stiffness * 2.4) + layer.z * 0.03) * template.wind;
  const neckDampen = layer.kind === "neck" ? 0.24 : 1;
  const tailFactor = tailFactorForLayer(layer, tuning);
  const tailSway = tailFactor
    ? Math.sin(t * (0.95 + (1 - template.stiffness) * 1.1) + layer.z * 0.061) * template.wind * (1 - template.drag * 0.18)
    : 0;
  return {
    x: (xDrive * (1 - template.stiffness) + sway) * 18 * neckDampen * inertia,
    y: (Math.abs(xDrive) * template.gravity.y + sway * 0.3) * 12 * neckDampen * inertia,
    rotate: (xDrive * 7 + sway * 9) * (1 - template.drag * 0.35) * neckDampen * inertia,
    tailX: (xDrive * 10 + zDrive * 16 + tailSway * 36) * tailFactor,
    tailY: (Math.abs(xDrive) * template.gravity.y * 3 + Math.abs(zDrive) * template.gravity.y * 3.2 + Math.abs(tailSway) * 8) * tailFactor,
    tailRotate: (xDrive * 5 + zDrive * 18 + tailSway * 18) * tailFactor
  };
}

function resolveHeadRollPivot(pivot?: Partial<Point>) {
  return {
    x: clamp(pivot?.x ?? defaultHeadRollPivot.x, 0, 1),
    y: clamp(pivot?.y ?? defaultHeadRollPivot.y, 0, 1)
  };
}

function kindBaseOffset(
  layer: PsdLayerAsset,
  parameters: RigParameter[],
  t: number,
  canvasSize: { width: number; height: number },
  headRollPivot?: Partial<Point>,
  trackingSettings?: TrackingSettings
): Pick<LayerMotion, "x" | "y" | "rotate" | "scaleX" | "scaleY" | "pivotX" | "pivotY"> {
  const kind = layer.kind;
  const headX = normalizedParam(parameters, "ParamAngleX");
  const headY = normalizedParam(parameters, "ParamAngleY");
  const headRoll = valueOf(parameters, "ParamAngleZ");
  const bodyX = normalizedParam(parameters, "ParamBodyAngleX");
  const bodyY = normalizedParam(parameters, "ParamBodyAngleY");
  const bodyZ = normalizedParam(parameters, "ParamBodyAngleZ");
  const breath = effectiveBreath(parameters, t);
  const mouth = openParam(parameters, "ParamMouthOpenY");
  const armL = openParam(parameters, "ParamArmLA");
  const armR = openParam(parameters, "ParamArmRA");
  const followsHead = isLayerHeadPart(layer);
  const followsBody = isLayerBodyPart(layer);

  const torsoCarrier = { x: bodyX * 5, y: bodyY * -1.6 + Math.sin(breath * Math.PI) * 1.8, rotate: bodyZ * 0.8 };
  const parentArc = parentRotationOffset(layer, torsoCarrier.rotate, canvasSize);
  const bodyCarrier = { x: torsoCarrier.x + parentArc.x, y: torsoCarrier.y + parentArc.y, rotate: torsoCarrier.rotate };
  const headPivot = resolveHeadRollPivot(headRollPivot);
  const headCarrier = followsHead
    ? { x: bodyCarrier.x + headX * 4.5, y: bodyCarrier.y + headY * -3.3, rotate: bodyCarrier.rotate + headRoll, pivotX: headPivot.x, pivotY: headPivot.y }
    : { x: 0, y: 0, rotate: 0 };

  if (layer.attachment?.type) {
    if (followsHead) {
      return { x: headCarrier.x, y: headCarrier.y, rotate: headCarrier.rotate, scaleX: 1, scaleY: 1, pivotX: headCarrier.pivotX, pivotY: headCarrier.pivotY };
    }
    if (followsBody) {
      return { x: bodyCarrier.x, y: bodyCarrier.y, rotate: bodyCarrier.rotate, scaleX: 1, scaleY: 1 };
    }
    return { x: 0, y: 0, rotate: 0, scaleX: 1, scaleY: 1 };
  }

  if (kind === "face" || kind === "ear" || kind === "nose") {
    return { x: headCarrier.x, y: headCarrier.y, rotate: headCarrier.rotate, scaleX: 1, scaleY: 1, pivotX: headCarrier.pivotX, pivotY: headCarrier.pivotY };
  }

  if (kind === "eyeWhite" || kind === "eyelash" || kind === "eyebrow") {
    return { x: headCarrier.x, y: headCarrier.y, rotate: headCarrier.rotate, scaleX: 1, scaleY: 1, pivotX: headCarrier.pivotX, pivotY: headCarrier.pivotY };
  }

  if (kind === "iris") {
    return { x: headCarrier.x, y: headCarrier.y, rotate: headCarrier.rotate, scaleX: 1, scaleY: 1, pivotX: headCarrier.pivotX, pivotY: headCarrier.pivotY };
  }

  if (kind === "mouth") {
    return { x: headCarrier.x, y: headCarrier.y, rotate: headCarrier.rotate, scaleX: 1, scaleY: 1, pivotX: headCarrier.pivotX, pivotY: headCarrier.pivotY };
  }

  if (kind === "frontHair" || kind === "accessory") {
    return { x: headCarrier.x, y: headCarrier.y, rotate: headCarrier.rotate, scaleX: 1, scaleY: 1, pivotX: headCarrier.pivotX, pivotY: headCarrier.pivotY };
  }

  if (kind === "sideHair" || kind === "backHair") {
    return { x: headCarrier.x, y: headCarrier.y, rotate: headCarrier.rotate, scaleX: 1, scaleY: 1, pivotX: headCarrier.pivotX, pivotY: headCarrier.pivotY };
  }

  if (kind === "topWear" || kind === "bottomWear" || kind === "torso" || kind === "neck") {
    if (kind === "neck") {
      return { x: bodyCarrier.x, y: bodyCarrier.y + Math.sin(breath * Math.PI) * 0.08, rotate: bodyCarrier.rotate, scaleX: 1, scaleY: 1 + Math.sin(breath * Math.PI) * 0.002 };
    }
    return { x: bodyCarrier.x, y: bodyCarrier.y, rotate: bodyCarrier.rotate, scaleX: 1, scaleY: 1 + Math.sin(breath * Math.PI) * 0.012 };
  }

  if (kind === "arm" || kind === "hand") {
    const arm = layer.side === "left" ? armL : layer.side === "right" ? armR : Math.max(armL, armR);
    const sideSign = layer.side === "right" ? -1 : layer.side === "left" ? 1 : 0;
    const reverse = (layer.side === "left" && trackingSettings?.armRotationReverse?.left) || (layer.side === "right" && trackingSettings?.armRotationReverse?.right);
    const direction = reverse ? -sideSign : sideSign;
    return {
      x: bodyCarrier.x,
      y: bodyCarrier.y,
      rotate: bodyCarrier.rotate + direction * arm * 40,
      scaleX: 1,
      scaleY: 1
    };
  }

  return { x: 0, y: 0, rotate: 0, scaleX: 1, scaleY: 1 };
}

export function layerPreviewMotion(
  layer: PsdLayerAsset,
  parameters: RigParameter[],
  templates: PhysicsTemplate[],
  t: number,
  canvasSize = { width: 768, height: 768 },
  dynamics?: Partial<DynamicsTuning>,
  headRollPivot?: Partial<Point>,
  trackingSettings?: TrackingSettings
): LayerMotion {
  const base = kindBaseOffset(layer, parameters, t, canvasSize, headRollPivot, trackingSettings);
  const physics = physicsOffset(layer, templates, t, parameters, dynamics);
  const rootPhysicsScale = rootPhysicsScaleForLayer(layer);
  const eyeOpen = eyeOpenForLayer(layer, parameters);
  const mouth = openParam(parameters, "ParamMouthOpenY");

  let opacity = layer.visible ? layer.opacity : 0;
  if (layer.kind === "eyeWhite") opacity *= Math.max(0.34, 0.58 + eyeOpen * 0.42);
  if (layer.kind === "iris") opacity *= eyeOpen >= 0.16 ? 1 : 0.18 + clamp(eyeOpen / 0.16, 0, 1) * 0.82;
  if (layer.kind === "eyelash") opacity *= 1;
  if (isOpenMouthExpressionLayer(layer)) opacity *= expressionMouthOpacity(layer, parameters);
  else if (layer.kind === "mouth") opacity *= 0.72 + mouth * 0.28;

  return {
    x: base.x + physics.x * rootPhysicsScale,
    y: base.y + physics.y * rootPhysicsScale,
    rotate: base.rotate + physics.rotate * rootPhysicsScale,
    scaleX: base.scaleX,
    scaleY: base.scaleY,
    opacity,
    baseX: base.x,
    baseY: base.y,
    baseRotate: base.rotate,
    baseScaleX: base.scaleX,
    baseScaleY: base.scaleY,
    physicsX: physics.x * rootPhysicsScale,
    physicsY: physics.y * rootPhysicsScale,
    physicsRotate: physics.rotate * rootPhysicsScale,
    tailX: physics.tailX,
    tailY: physics.tailY,
    tailRotate: physics.tailRotate,
    pivotX: base.pivotX,
    pivotY: base.pivotY
  };
}

export function layerPreviewStyle(
  layer: PsdLayerAsset,
  parameters: RigParameter[],
  templates: PhysicsTemplate[],
  t: number,
  canvasSize = { width: 768, height: 768 },
  dynamics?: Partial<DynamicsTuning>,
  headRollPivot?: Partial<Point>,
  trackingSettings?: TrackingSettings
): LayerStyle {
  const motion = layerPreviewMotion(layer, parameters, templates, t, canvasSize, dynamics, headRollPivot, trackingSettings);
  const transform = [
    `translate(${motion.x}px, ${motion.y}px)`,
    `rotate(${motion.rotate}deg)`,
    `scale(${motion.scaleX}, ${motion.scaleY})`
  ].join(" ");

  return { transform, opacity: motion.opacity };
}
