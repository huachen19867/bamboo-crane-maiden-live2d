import type { MeshBinding, ParameterId, PartKind, Point, Rect, DeformerBinding } from "../types/rig";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function meshDensityForKind(kind: PartKind) {
  if (kind === "backHair") {
    return { rows: 14, cols: 8 };
  }
  if (kind === "frontHair" || kind === "sideHair") {
    return { rows: 11, cols: 8 };
  }
  if (kind === "accessory") {
    return { rows: 8, cols: 7 };
  }
  if (kind === "face") {
    return { rows: 6, cols: 6 };
  }
  if (kind === "eyeWhite" || kind === "iris" || kind === "eyelash" || kind === "eyebrow" || kind === "mouth" || kind === "nose" || kind === "ear") {
    return { rows: 5, cols: 5 };
  }
  if (kind === "topWear" || kind === "bottomWear" || kind === "torso" || kind === "arm" || kind === "hand" || kind === "neck") {
    return { rows: 4, cols: 4 };
  }
  return { rows: 3, cols: 3 };
}

export function makeGridMesh(kind: PartKind, bounds: Rect): MeshBinding {
  const { rows, cols } = meshDensityForKind(kind);
  const points = [];
  const depths = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const u = cols === 1 ? 0.5 : col / (cols - 1);
      const v = rows === 1 ? 0.5 : row / (rows - 1);
      const x = bounds.x + bounds.width * (cols === 1 ? 0.5 : col / (cols - 1));
      const y = bounds.y + bounds.height * (rows === 1 ? 0.5 : row / (rows - 1));
      points.push({ x, y });
      depths.push(defaultVertexDepth(kind, u, v));
    }
  }

  return { rows, cols, points, depths };
}

export function makeMeshWithDensity(bounds: Rect, rows: number, cols: number, kind: PartKind = "unknown"): MeshBinding {
  const safeRows = Math.max(2, Math.round(rows));
  const safeCols = Math.max(2, Math.round(cols));
  const points = [];
  const depths = [];

  for (let row = 0; row < safeRows; row += 1) {
    for (let col = 0; col < safeCols; col += 1) {
      const u = col / (safeCols - 1);
      const v = row / (safeRows - 1);
      points.push({
        x: bounds.x + bounds.width * u,
        y: bounds.y + bounds.height * v
      });
      depths.push(defaultVertexDepth(kind, u, v));
    }
  }

  return { rows: safeRows, cols: safeCols, points, depths };
}

export function defaultPivotForKind(kind: PartKind, bounds: Rect, side?: "left" | "right" | "center"): Point | undefined {
  if (kind === "arm") {
    const centerX = bounds.x + bounds.width * 0.5;
    const onRightHalf = side === "right" || (side !== "left" && centerX >= 0.5);
    const shoulderX = onRightHalf ? bounds.x - bounds.width * 0.12 : bounds.x + bounds.width * 1.12;
    return {
      x: shoulderX,
      y: bounds.y + bounds.height * 0.045
    };
  }
  if (kind === "hand") {
    return {
      x: bounds.x + bounds.width * 0.5,
      y: bounds.y + bounds.height * 0.08
    };
  }
  return undefined;
}

function defaultVertexDepth(kind: PartKind, u: number, v: number): number {
  const dx = (u - 0.5) * 2;
  const dy = (v - 0.48) * 2;
  const dome = Math.max(0, 1 - dx * dx * 0.75 - dy * dy * 0.62);
  const surface = Math.sqrt(dome);

  if (kind === "nose") return 0.02 + surface * 0.026;
  if (kind === "iris" || kind === "eyeWhite" || kind === "eyelash") return 0.012 + surface * 0.016;
  if (kind === "eyebrow") return 0.011 + surface * 0.015;
  if (kind === "mouth") return 0.01 + surface * 0.014;
  if (kind === "face" || kind === "ear") return 0.012 + surface * 0.02;
  if (kind === "frontHair" || kind === "accessory") return 0.018 + surface * 0.026 + Math.pow(clamp(v, 0, 1), 1.7) * 0.016;
  if (kind === "sideHair") return 0.012 + surface * 0.022 + Math.pow(clamp(v, 0, 1), 1.55) * 0.014;
  if (kind === "backHair") return -0.026 + surface * 0.008;
  if (kind === "neck" || kind === "topWear" || kind === "bottomWear" || kind === "torso") return 0.006;
  return 0;
}

export function makeDefaultDeformers(kind: PartKind): DeformerBinding[] {
  const translateFor = (axis: DeformerBinding["axis"], strength: number, sign: -1 | 1) => ({
    x: axis === "x" ? sign * strength : 0,
    y: axis === "y" ? -sign * strength : 0
  });
  const base = (parameter: ParameterId, axis: DeformerBinding["axis"], strength: number): DeformerBinding => ({
    id: `${parameter}-${axis}-${kind}`,
    parameter,
    axis,
    strength,
    keyframes: [
      { value: -1, translate: translateFor(axis, strength, -1), rotate: axis === "z" ? -strength * 8 : 0, scale: { x: 1, y: 1 } },
      { value: 0, translate: { x: 0, y: 0 }, rotate: 0, scale: { x: 1, y: 1 } },
      { value: 1, translate: translateFor(axis, strength, 1), rotate: axis === "z" ? strength * 8 : 0, scale: { x: 1, y: 1 } }
    ]
  });

  if (kind === "face" || kind === "ear" || kind === "nose") {
    return [base("ParamAngleX", "x", 0.018), base("ParamAngleY", "y", 0.014), base("ParamAngleZ", "z", 0.8)];
  }

  if (kind === "eyeWhite" || kind === "iris" || kind === "eyelash" || kind === "eyebrow") {
    if (kind === "iris") {
      return [base("ParamAngleX", "x", 0.012), base("ParamAngleY", "y", 0.006)];
    }
    return [base("ParamAngleX", "x", 0.006), base("ParamAngleY", "y", 0.004)];
  }

  if (kind === "mouth") {
    return [
      base("ParamAngleX", "x", 0.018),
      {
        id: "ParamMouthOpenY-scale-mouth",
        parameter: "ParamMouthOpenY",
        axis: "scale",
        strength: 0.2,
        keyframes: [
          { value: 0, translate: { x: 0, y: 0 }, rotate: 0, scale: { x: 1, y: 0.72 }, opacity: 0.9 },
          { value: 1, translate: { x: 0, y: 0 }, rotate: 0, scale: { x: 1.08, y: 1.42 }, opacity: 1 }
        ]
      }
    ];
  }

  if (kind === "frontHair" || kind === "sideHair" || kind === "backHair" || kind === "accessory") {
    return [base("ParamAngleX", "x", 0.026), base("ParamAngleZ", "z", 0.9), base("ParamBreath", "y", 0.006)];
  }

  if (kind === "neck") {
    return [];
  }

  if (kind === "topWear" || kind === "bottomWear" || kind === "arm" || kind === "hand") {
    if (kind === "arm" || kind === "hand") {
      return [
        base("ParamBodyAngleX", "x", 0.012),
        base("ParamBodyAngleZ", "z", 0.18)
      ];
    }
    return [base("ParamBodyAngleX", "x", 0.018), base("ParamBodyAngleZ", "z", 0.65), base("ParamBreath", "scale", 0.01)];
  }

  return [base("ParamAngleX", "x", 0.012)];
}

export function recommendedPhysicsTemplate(kind: PartKind): string | undefined {
  if (kind === "frontHair" || kind === "sideHair" || kind === "backHair") return kind === "backHair" ? "hair-soft" : "hair-short";
  if (kind === "topWear" || kind === "bottomWear") return kind === "bottomWear" ? "cloth-heavy" : "cloth-light";
  if (kind === "accessory") return "hair-short";
  if (kind === "arm" || kind === "hand") return "arm-follow";
  return undefined;
}
