import type { PartKind } from "../types/rig";

const rules: Array<{ kind: PartKind; terms: string[]; z: number; bone: string }> = [
  { kind: "accessory", terms: ["tail", "wings", "wing"], z: 12, bone: "hair-back" },
  { kind: "backHair", terms: ["back hair", "hair back", "rear hair", "behind hair", "后发", "后髮", "背发"], z: 10, bone: "hair-back" },
  { kind: "neck", terms: ["neck", "脖", "颈"], z: 20, bone: "neck" },
  { kind: "torso", terms: ["body", "torso", "base body", "身体", "躯干", "上身"], z: 38, bone: "body" },
  { kind: "bottomWear", terms: ["bottomwear", "bottom wear", "skirt", "pants", "leg", "下装", "裙", "裤"], z: 34, bone: "cloth-hips" },
  { kind: "topWear", terms: ["topwear", "top wear", "neckwear", "neck wear", "collar", "choker", "shirt", "jacket", "cloth", "衣", "上衣", "外套"], z: 42, bone: "cloth-chest" },
  { kind: "arm", terms: ["arm", "sleeve", "left arm", "right arm", "handwear", "hand wear", "手臂", "袖"], z: 28, bone: "body" },
  { kind: "hand", terms: ["hand", "glove", "手", "手套"], z: 29, bone: "body" },
  { kind: "ear", terms: ["ear", "ears", "耳"], z: 58, bone: "head" },
  { kind: "face", terms: ["face", "head", "skin", "脸", "面部", "头"], z: 60, bone: "head" },
  { kind: "nose", terms: ["nose", "鼻"], z: 70, bone: "head" },
  { kind: "eyeWhite", terms: ["eyewhite", "eye white", "white eye", "sclera", "眼白"], z: 78, bone: "head" },
  { kind: "iris", terms: ["irides", "iris", "pupil", "eye ball", "eyeball", "瞳", "虹膜", "眼珠"], z: 82, bone: "head" },
  { kind: "eyelash", terms: ["eyelash", "lash", "lid", "睫", "眼线", "眼睑"], z: 86, bone: "head" },
  { kind: "eyebrow", terms: ["eyebrow", "brow", "眉"], z: 88, bone: "head" },
  { kind: "mouth", terms: ["mouth", "lip", "teeth", "tongue", "口", "嘴", "唇", "牙"], z: 90, bone: "head" },
  { kind: "sideHair", terms: ["side hair", "hair side", "tail hair", "侧发", "鬓发"], z: 95, bone: "head" },
  { kind: "frontHair", terms: ["front hair", "bangs", "fringe", "hair front", "前发", "刘海"], z: 110, bone: "head" },
  { kind: "accessory", terms: ["accessory", "ornament", "ribbon", "halo", "hat", "headwear", "head wear", "headdress", "eyewear", "eye wear", "glasses", "sunglasses", "objects", "object", "hair accessory", "head accessory", "饰", "装饰", "发饰", "帽"], z: 120, bone: "hair-front" }
];

const readableRules: Array<{ kind: PartKind; terms: string[]; z: number; bone: string }> = [
  { kind: "backHair", terms: ["后发", "后髮", "背发"], z: 10, bone: "hair-back" },
  { kind: "neck", terms: ["脖子", "颈部"], z: 20, bone: "neck" },
  { kind: "torso", terms: ["身体", "躯干", "上身", "主体"], z: 38, bone: "body" },
  { kind: "bottomWear", terms: ["下装", "裙", "裤", "腿"], z: 34, bone: "cloth-hips" },
  { kind: "topWear", terms: ["衣", "上衣", "外套", "衣服"], z: 42, bone: "cloth-chest" },
  { kind: "arm", terms: ["手臂", "左臂", "右臂", "胳膊", "袖", "袖子"], z: 28, bone: "body" },
  { kind: "hand", terms: ["手", "左手", "右手", "手套"], z: 29, bone: "body" },
  { kind: "ear", terms: ["耳", "耳朵"], z: 58, bone: "head" },
  { kind: "face", terms: ["脸", "脸盘", "面部", "头", "头部", "皮肤"], z: 60, bone: "head" },
  { kind: "nose", terms: ["鼻", "鼻子"], z: 70, bone: "head" },
  { kind: "eyeWhite", terms: ["眼白", "眼眶"], z: 78, bone: "head" },
  { kind: "iris", terms: ["瞳", "瞳孔", "虹膜", "眼珠"], z: 82, bone: "head" },
  { kind: "eyelash", terms: ["睫", "睫毛", "眼线", "眼睑", "眼皮"], z: 86, bone: "head" },
  { kind: "eyebrow", terms: ["眉", "眉毛"], z: 88, bone: "head" },
  { kind: "mouth", terms: ["口", "嘴", "嘴巴", "唇", "牙", "舌"], z: 90, bone: "head" },
  { kind: "sideHair", terms: ["侧发", "侧髮", "鬓发"], z: 95, bone: "head" },
  { kind: "frontHair", terms: ["前发", "前髮", "刘海"], z: 110, bone: "head" },
  { kind: "accessory", terms: ["饰", "装饰", "发饰", "帽"], z: 120, bone: "hair-front" }
];

export function normalizeLayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyLayer(name: string): { kind: PartKind; recommendedZ: number; parentBoneId: string } {
  const normalized = normalizeLayerName(name);
  const readableExact = readableRules.find((rule) => rule.terms.some((term) => normalized === term));
  if (readableExact) {
    return { kind: readableExact.kind, recommendedZ: readableExact.z, parentBoneId: readableExact.bone };
  }

  const readablePartial = readableRules.find((rule) => rule.terms.some((term) => normalized.includes(term)));
  if (readablePartial) {
    return { kind: readablePartial.kind, recommendedZ: readablePartial.z, parentBoneId: readablePartial.bone };
  }

  const exact = rules.find((rule) => rule.terms.some((term) => normalized === term));
  if (exact) {
    return { kind: exact.kind, recommendedZ: exact.z, parentBoneId: exact.bone };
  }

  const partial = rules.find((rule) => rule.terms.some((term) => normalized.includes(term)));
  if (partial) {
    return { kind: partial.kind, recommendedZ: partial.z, parentBoneId: partial.bone };
  }

  return { kind: "unknown", recommendedZ: 65, parentBoneId: "root" };
}

export function kindLabel(kind: PartKind): string {
  const labels: Record<PartKind, string> = {
    backHair: "后发",
    frontHair: "前发",
    sideHair: "侧发",
    face: "脸",
    eyebrow: "眉毛",
    eyeWhite: "眼白",
    iris: "虹膜/眼珠",
    eyelash: "睫毛/眼线",
    nose: "鼻子",
    mouth: "嘴",
    ear: "耳朵",
    neck: "脖子",
    torso: "身体",
    arm: "手臂",
    hand: "手/手套",
    bottomWear: "下装",
    topWear: "上衣",
    accessory: "装饰",
    unknown: "未识别"
  };
  return labels[kind];
}

export function boneLabel(id: string): string {
  const labels: Record<string, string> = {
    root: "Root",
    body: "身体",
    neck: "脖子",
    head: "头部",
    face: "五官",
    "hair-back": "后发",
    "hair-side": "侧发",
    "hair-front": "前发",
    "cloth-chest": "上衣",
    "cloth-hips": "下装",
    accessory: "装饰"
  };
  return labels[id] ?? id;
}
