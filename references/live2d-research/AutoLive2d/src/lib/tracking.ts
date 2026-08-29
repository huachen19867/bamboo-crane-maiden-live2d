import {
  FaceLandmarker,
  FilesetResolver,
  PoseLandmarker,
  type NormalizedLandmark
} from "@mediapipe/tasks-vision";
import type { TrackingSettings, TrackingState } from "../types/rig";

const faceModelUrl = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";
const poseModels = {
  eco: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
  balanced: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
  quality: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
};
const wasmRoot = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";

export const emptyTrackingState: TrackingState = {
  hasFace: false,
  hasPose: false,
  yaw: 0,
  pitch: 0,
  roll: 0,
  eyeX: 0,
  eyeY: 0,
  blinkLeft: 0,
  blinkRight: 0,
  mouthOpen: 0,
  mouthForm: 0,
  bodyLeanX: 0,
  bodyLeanY: 0,
  armLeft: 0,
  armRight: 0,
  fps: 0,
  facePoints: [],
  posePoints: []
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: { x: number; y: number; z?: number }, b: { x: number; y: number; z?: number }) => ({ x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5, z: ((a.z ?? 0) + (b.z ?? 0)) * 0.5 });

type FaceCalibration = Pick<TrackingState, "yaw" | "pitch" | "roll" | "eyeX" | "eyeY">;
type ArmCalibration = { left: number; right: number };
type Delegate = "GPU" | "CPU";
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: DOMHighResTimeStamp, metadata: unknown) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

function tierConfidence(tier: TrackingSettings["tier"]): number {
  if (tier === "quality") return 0.3;
  if (tier === "balanced") return 0.12;
  return 0.1;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function modelTimeoutMs(tier: TrackingSettings["tier"], kind: "face" | "pose"): number {
  if (kind === "face") return tier === "eco" ? 12000 : 18000;
  if (tier === "quality") return 9000;
  if (tier === "balanced") return 8000;
  return 5000;
}

function poseIntervalMs(settings: TrackingSettings): number {
  const cameraFps = clamp(settings.fps || 30, 10, 60);
  const targetPoseFps = clamp(settings.poseFps ?? 20, 5, 30);
  if (settings.tier === "quality") return 1000 / Math.max(1, Math.min(cameraFps, targetPoseFps));
  if (settings.tier === "balanced") return 1000 / Math.max(1, Math.min(cameraFps, targetPoseFps));
  return 1000 / Math.max(1, Math.min(cameraFps, targetPoseFps, 8));
}

function faceIntervalMs(tier: TrackingSettings["tier"], fps: number): number {
  if (tier === "quality") return 1000 / Math.max(1, fps);
  if (tier === "balanced") return 1000 / Math.max(1, Math.min(fps, 20));
  return 1000 / Math.max(1, Math.min(fps, 12));
}

function delegateOrder(tier: TrackingSettings["tier"]): Delegate[] {
  return tier === "eco" ? ["CPU"] : ["GPU", "CPU"];
}

function shouldLoadPose(settings: TrackingSettings): boolean {
  return settings.poseEnabled && settings.tier !== "eco";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function withModelTimeout<T extends { close: () => void }>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timedOut = false;
  let timer: number | undefined;
  const guarded = promise.then((model) => {
    if (timedOut) {
      model.close();
      throw new Error(`${label} 加载超时`);
    }
    return model;
  });
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      timedOut = true;
      reject(new Error(`${label} 加载超时`));
    }, timeoutMs);
  });
  return Promise.race([guarded, timeout]).finally(() => {
    if (timer !== undefined) window.clearTimeout(timer);
  });
}

function smoothState(prev: TrackingState, next: TrackingState, smoothing: number): TrackingState {
  const t = clamp(1 - smoothing, 0.08, 0.92);
  const eyeT = clamp(1 - smoothing * 0.36, 0.35, 0.96);
  const blinkT = clamp(1 - smoothing * 0.2, 0.48, 0.96);
  const poseT = clamp(1 - smoothing * 0.68, 0.22, 0.82);
  const smoothArm = (previous: number, target: number) => {
    const diff = target - previous;
    if (Math.abs(diff) < 0.04) return previous;
    const armT = target > previous ? clamp(1 - smoothing * 1.34, 0.1, 0.28) : clamp(1 - smoothing * 1.7, 0.06, 0.18);
    const limited = clamp(diff * armT, -0.06, 0.085);
    return clamp(previous + limited, 0, 1);
  };
  const nextArmLeft = Math.max(next.armLeft, next.poseDebug?.armLeftRaw ?? 0);
  const nextArmRight = Math.max(next.armRight, next.poseDebug?.armRightRaw ?? 0);
  return {
    hasFace: next.hasFace,
    hasPose: next.hasPose,
    yaw: lerp(prev.yaw, next.yaw, t),
    pitch: lerp(prev.pitch, next.pitch, t),
    roll: lerp(prev.roll, next.roll, t),
    eyeX: lerp(prev.eyeX, next.eyeX, eyeT),
    eyeY: lerp(prev.eyeY, next.eyeY, eyeT),
    blinkLeft: lerp(prev.blinkLeft, next.blinkLeft, blinkT),
    blinkRight: lerp(prev.blinkRight, next.blinkRight, blinkT),
    mouthOpen: lerp(prev.mouthOpen, next.mouthOpen, t),
    mouthForm: lerp(prev.mouthForm, next.mouthForm, t),
    bodyLeanX: lerp(prev.bodyLeanX, next.bodyLeanX, poseT),
    bodyLeanY: lerp(prev.bodyLeanY, next.bodyLeanY, poseT),
    armLeft: smoothArm(prev.armLeft, nextArmLeft),
    armRight: smoothArm(prev.armRight, nextArmRight),
    fps: next.fps,
    facePoints: next.facePoints?.length ? next.facePoints : prev.facePoints ?? [],
    posePoints: next.posePoints?.length ? next.posePoints : prev.posePoints ?? [],
    poseDebug: next.poseDebug ?? prev.poseDebug
  };
}

function interpolateState(from: TrackingState, to: TrackingState, amount: number): TrackingState {
  const t = clamp(amount, 0, 1);
  const toArmLeft = Math.max(to.armLeft, to.poseDebug?.armLeftRaw ?? 0);
  const toArmRight = Math.max(to.armRight, to.poseDebug?.armRightRaw ?? 0);
  return {
    hasFace: to.hasFace,
    hasPose: to.hasPose,
    yaw: lerp(from.yaw, to.yaw, t),
    pitch: lerp(from.pitch, to.pitch, t),
    roll: lerp(from.roll, to.roll, t),
    eyeX: lerp(from.eyeX, to.eyeX, t),
    eyeY: lerp(from.eyeY, to.eyeY, t),
    blinkLeft: lerp(from.blinkLeft, to.blinkLeft, t),
    blinkRight: lerp(from.blinkRight, to.blinkRight, t),
    mouthOpen: lerp(from.mouthOpen, to.mouthOpen, t),
    mouthForm: lerp(from.mouthForm, to.mouthForm, t),
    bodyLeanX: lerp(from.bodyLeanX, to.bodyLeanX, t),
    bodyLeanY: lerp(from.bodyLeanY, to.bodyLeanY, t),
    armLeft: lerp(from.armLeft, toArmLeft, t),
    armRight: lerp(from.armRight, toArmRight, t),
    fps: to.fps,
    facePoints: to.facePoints?.length ? to.facePoints : from.facePoints ?? [],
    posePoints: to.posePoints?.length ? to.posePoints : from.posePoints ?? [],
    poseDebug: to.poseDebug ?? from.poseDebug
  };
}

function faceJumpScore(previous: TrackingState, next: TrackingState) {
  const yaw = Math.abs(next.yaw - previous.yaw);
  const pitch = Math.abs(next.pitch - previous.pitch);
  const roll = Math.abs(next.roll - previous.roll);
  const eyeX = Math.abs(next.eyeX - previous.eyeX);
  const eyeY = Math.abs(next.eyeY - previous.eyeY);
  return {
    weighted: yaw * 1.2 + pitch * 1.15 + roll * 0.9 + (eyeX + eyeY) * 0.48,
    maxAxis: Math.max(yaw, pitch, roll, eyeX, eyeY)
  };
}

function previewFacePoints(points: NormalizedLandmark[]) {
  const important = new Set([1, 4, 10, 13, 14, 33, 61, 133, 152, 263, 291, 362, 468, 473]);
  return points
    .map((point, index) => ({ point, index }))
    .filter(({ index }) => important.has(index) || index % 4 === 0)
    .map(({ point }) => ({ x: point.x, y: point.y }));
}

function usablePoseLandmark(point: NormalizedLandmark | undefined): NormalizedLandmark | undefined {
  if (!point) return undefined;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined;
  return point;
}

function previewPosePoints(points: NormalizedLandmark[]) {
  return [11, 12, 13, 14, 15, 16, 23, 24]
    .map((index) => usablePoseLandmark(points[index]))
    .filter(Boolean)
    .map((point) => ({ x: point!.x, y: point!.y }));
}

function armLiftRatio(point: NormalizedLandmark | undefined, lowerY: number, verticalSpan: number) {
  if (!point) return 0;
  return clamp((lowerY - point.y) / Math.max(0.001, verticalSpan), 0, 1.6);
}

function armRaiseFromPose(
  shoulder: NormalizedLandmark,
  elbow: NormalizedLandmark | undefined,
  wrist: NormalizedLandmark | undefined,
  lowerY: number,
  verticalSpan: number,
  horizontalScale: number
) {
  const normalizedHorizontal = Math.max(0.001, horizontalScale);
  const candidates: number[] = [];
  const heightScore = (point: NormalizedLandmark, start: number, weight = 1) =>
    clamp(((armLiftRatio(point, lowerY, verticalSpan) - start) / Math.max(0.001, 1 - start)) * weight, 0, 1);

  if (elbow) candidates.push(heightScore(elbow, 0.18, 0.78));
  if (wrist) candidates.push(heightScore(wrist, 0.08, 1));
  if (elbow && wrist) {
    const forearmCenter = midpoint(elbow, wrist);
    candidates.push(heightScore(forearmCenter as NormalizedLandmark, 0.12, 0.95));
  }

  const extendedPoint = wrist ?? elbow;
  if (extendedPoint) {
    const horizontalExtension = Math.abs(extendedPoint.x - shoulder.x) / normalizedHorizontal;
    const heightGate = clamp(armLiftRatio(extendedPoint, lowerY, verticalSpan) + 0.15, 0, 1);
    candidates.push(clamp((horizontalExtension - 0.28) * 0.46, 0, 0.5) * heightGate);
  }

  return candidates.length ? clamp(Math.max(...candidates), 0, 1) : 0;
}

function eyeAspectRatio(points: NormalizedLandmark[], indexes: number[]): number {
  const [left, upperOuter, upperInner, right, lowerInner, lowerOuter] = indexes.map((index) => points[index]);
  const vertical = (distance(upperOuter, lowerOuter) + distance(upperInner, lowerInner)) * 0.5;
  const horizontal = Math.max(0.001, distance(left, right));
  return vertical / horizontal;
}

function irisCenter(points: NormalizedLandmark[], indexes: number[]): { x: number; y: number } | undefined {
  const selected = indexes.map((index) => points[index]).filter(Boolean);
  if (!selected.length) return undefined;
  return {
    x: selected.reduce((sum, point) => sum + point.x, 0) / selected.length,
    y: selected.reduce((sum, point) => sum + point.y, 0) / selected.length
  };
}

function eyeVerticalDrive(iris: { x: number; y: number } | undefined, upper: NormalizedLandmark[], lower: NormalizedLandmark[], fallbackCenter: { x: number; y: number }): number {
  if (!iris || !upper.length || !lower.length) return 0;
  const upperY = upper.reduce((sum, point) => sum + point.y, 0) / upper.length;
  const lowerY = lower.reduce((sum, point) => sum + point.y, 0) / lower.length;
  const centerY = (upperY + lowerY) * 0.5;
  const halfHeight = Math.max(0.001, (lowerY - upperY) * 0.5);
  return clamp((centerY - iris.y) / halfHeight, -1, 1) || clamp((fallbackCenter.y - iris.y) / halfHeight, -1, 1);
}

function deriveFace(points: NormalizedLandmark[], calibration?: FaceCalibration): Partial<TrackingState> {
  const leftEyeOuter = points[33];
  const leftEyeInner = points[133];
  const rightEyeInner = points[362];
  const rightEyeOuter = points[263];
  const nose = points[1] ?? points[4];
  const chin = points[152];
  const forehead = points[10];
  const mouthTop = points[13];
  const mouthBottom = points[14];
  const mouthLeft = points[61];
  const mouthRight = points[291];

  if (!leftEyeOuter || !leftEyeInner || !rightEyeInner || !rightEyeOuter || !nose || !mouthTop || !mouthBottom) {
    return { hasFace: false };
  }

  const leftEye = midpoint(leftEyeOuter, leftEyeInner);
  const rightEye = midpoint(rightEyeInner, rightEyeOuter);
  const eyeCenter = midpoint(leftEye, rightEye);
  const faceHeight = forehead && chin ? Math.max(0.001, distance(forehead, chin)) : 0.35;
  const eyeSpan = Math.max(0.001, distance(leftEyeOuter, rightEyeOuter));
  const roll = clamp(Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) / 0.55, -1, 1);
  const yaw = clamp((nose.x - eyeCenter.x) / eyeSpan * 2.35, -1, 1);
  const pitch = clamp((nose.y - eyeCenter.y) / faceHeight * 3.35 - 0.66, -1, 1);
  const mouthWidth = mouthLeft && mouthRight ? Math.max(0.001, distance(mouthLeft, mouthRight)) : eyeSpan * 0.3;
  const mouthOpen = clamp((distance(mouthTop, mouthBottom) / mouthWidth - 0.04) / 0.52, 0, 1);

  const leftEar = eyeAspectRatio(points, [33, 160, 158, 133, 153, 144]);
  const rightEar = eyeAspectRatio(points, [362, 385, 387, 263, 373, 380]);
  const blinkLeft = clamp((0.23 - leftEar) / 0.12, 0, 1);
  const blinkRight = clamp((0.23 - rightEar) / 0.12, 0, 1);

  const leftIris = irisCenter(points, [468, 469, 470, 471, 472]);
  const rightIris = irisCenter(points, [473, 474, 475, 476, 477]);
  const rawEyeX = leftIris && rightIris ? clamp(((leftIris.x - leftEye.x) + (rightIris.x - rightEye.x)) / eyeSpan * 12, -1, 1) : 0;
  const leftEyeY = eyeVerticalDrive(leftIris, [points[160], points[158]].filter(Boolean), [points[153], points[144]].filter(Boolean), leftEye);
  const rightEyeY = eyeVerticalDrive(rightIris, [points[385], points[387]].filter(Boolean), [points[373], points[380]].filter(Boolean), rightEye);
  const rawEyeY = leftIris && rightIris ? clamp((leftEyeY + rightEyeY) * 0.5, -1, 1) : 0;
  const mouthForm = mouthLeft && mouthRight ? clamp((mouthWidth / eyeSpan - 0.33) * 4, -1, 1) : 0;

  return {
    hasFace: true,
    yaw: clamp(yaw - (calibration?.yaw ?? 0), -1, 1),
    pitch: clamp(pitch - (calibration?.pitch ?? 0), -1, 1),
    roll: clamp(roll - (calibration?.roll ?? 0), -1, 1),
    eyeX: clamp(rawEyeX - (calibration?.eyeX ?? 0), -1, 1),
    eyeY: clamp(rawEyeY - (calibration?.eyeY ?? 0), -1, 1),
    blinkLeft,
    blinkRight,
    mouthOpen,
    mouthForm
  };
}

function derivePose(points: NormalizedLandmark[]): Partial<TrackingState> {
  const leftShoulder = usablePoseLandmark(points[11]);
  const rightShoulder = usablePoseLandmark(points[12]);
  const leftElbow = usablePoseLandmark(points[13]);
  const rightElbow = usablePoseLandmark(points[14]);
  const leftWrist = usablePoseLandmark(points[15]);
  const rightWrist = usablePoseLandmark(points[16]);
  const leftHip = usablePoseLandmark(points[23]);
  const rightHip = usablePoseLandmark(points[24]);

  if (!leftShoulder || !rightShoulder) return { hasPose: false };

  const shoulderCenter = midpoint(leftShoulder, rightShoulder);
  const shoulderSpan = Math.max(0.001, distance(leftShoulder, rightShoulder));
  const hipCenter = leftHip && rightHip ? midpoint(leftHip, rightHip) : { x: shoulderCenter.x, y: shoulderCenter.y + shoulderSpan, z: 0 };
  const torsoSpan = Math.max(shoulderSpan, distance(shoulderCenter, hipCenter));
  const bodyLeanX = clamp((shoulderCenter.x - hipCenter.x) / torsoSpan * 2.35, -1, 1);
  const bodyLeanY = clamp(((shoulderCenter.y - hipCenter.y) / torsoSpan + 0.85) * 1.2, -1, 1);
  const lowerY = Math.max(hipCenter.y, shoulderCenter.y + shoulderSpan * 0.95);
  const verticalSpan = Math.max(shoulderSpan * 0.78, lowerY - shoulderCenter.y);
  const leftElbowLift = armLiftRatio(leftElbow, leftShoulder.y + verticalSpan, verticalSpan);
  const leftWristLift = armLiftRatio(leftWrist, leftShoulder.y + verticalSpan, verticalSpan);
  const rightElbowLift = armLiftRatio(rightElbow, rightShoulder.y + verticalSpan, verticalSpan);
  const rightWristLift = armLiftRatio(rightWrist, rightShoulder.y + verticalSpan, verticalSpan);
  const leftLiftFallback = clamp(Math.max(leftElbowLift * 0.78, leftWristLift) - 0.08, 0, 1);
  const rightLiftFallback = clamp(Math.max(rightElbowLift * 0.78, rightWristLift) - 0.08, 0, 1);
  const armLeft = Math.max(
    armRaiseFromPose(leftShoulder, leftElbow, leftWrist, leftShoulder.y + verticalSpan, verticalSpan, shoulderSpan),
    leftLiftFallback
  );
  const armRight = Math.max(
    armRaiseFromPose(rightShoulder, rightElbow, rightWrist, rightShoulder.y + verticalSpan, verticalSpan, shoulderSpan),
    rightLiftFallback
  );

  return {
    hasPose: true,
    bodyLeanX,
    bodyLeanY,
    armLeft,
    armRight,
    posePoints: previewPosePoints(points),
    poseDebug: {
      leftElbow: Boolean(leftElbow),
      leftWrist: Boolean(leftWrist),
      rightElbow: Boolean(rightElbow),
      rightWrist: Boolean(rightWrist),
      leftElbowLift,
      leftWristLift,
      rightElbowLift,
      rightWristLift,
      armLeftRaw: armLeft,
      armRightRaw: armRight
    }
  };
}

export class TrackingController {
  private face?: FaceLandmarker;
  private pose?: PoseLandmarker;
  private stream?: MediaStream;
  private keepAlivePeers?: [RTCPeerConnection, RTCPeerConnection];
  private audioContext?: AudioContext;
  private analyser?: AnalyserNode;
  private audioBins?: Uint8Array<ArrayBuffer>;
  private analysisCanvas?: HTMLCanvasElement;
  private analysisContext?: CanvasRenderingContext2D;
  private poseAnalysisCanvas?: HTMLCanvasElement;
  private poseAnalysisContext?: CanvasRenderingContext2D;
  private raf = 0;
  private backgroundTimer = 0;
  private backgroundWorker?: Worker;
  private backgroundWorkerUrl?: string;
  private videoFrameCallback = 0;
  private lastFrameAt = 0;
  private lastFpsAt = performance.now();
  private frames = 0;
  private state: TrackingState = { ...emptyTrackingState };
  private faceCalibration?: FaceCalibration;
  private armCalibration?: ArmCalibration;
  private armCalibrationSamples: ArmCalibration[] = [];
  private lastFaceAt = 0;
  private lastPoseAt = 0;
  private lastPoseEstimateAt = 0;
  private lastPoseState?: Partial<TrackingState>;
  private poseBackoffUntil = 0;
  private poseLoadToken = 0;
  private stopped = true;
  private targetState?: TrackingState;
  private transitionFrom: TrackingState = { ...emptyTrackingState };
  private transitionStartAt = 0;
  private transitionDurationMs = 0;
  private lastAcceptedFace?: TrackingState;
  private lastAcceptedFaceAt = 0;
  private rejectedFaceFrames = 0;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly settings: TrackingSettings,
    private readonly onState: (state: TrackingState) => void,
    private readonly onStatus: (status: string) => void
  ) {}

  async start() {
    this.stopped = false;
    const token = (this.poseLoadToken += 1);
    this.onStatus("加载 MediaPipe 模型");
    const vision = await FilesetResolver.forVisionTasks(wasmRoot);
    const delegates = delegateOrder(this.settings.tier);
    const confidence = tierConfidence(this.settings.tier);
    const createFace = (delegate: Delegate) =>
      FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: faceModelUrl,
          delegate
        },
        runningMode: "VIDEO",
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
        numFaces: 1,
        minFaceDetectionConfidence: confidence,
        minFacePresenceConfidence: confidence,
        minTrackingConfidence: confidence
      });
    const createPose = (delegate: Delegate) =>
      PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: poseModels[this.settings.tier],
          delegate
        },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: confidence,
        minPosePresenceConfidence: confidence,
        minTrackingConfidence: confidence
      });

    let faceDelegate: Delegate | undefined;
    let faceError: unknown;
    for (const delegate of delegates) {
      try {
        this.onStatus(`加载面部模型（${delegate}）`);
        this.face = await withModelTimeout(createFace(delegate), modelTimeoutMs(this.settings.tier, "face"), `面部模型（${delegate}）`);
        faceDelegate = delegate;
        break;
      } catch (error) {
        faceError = error;
        this.face?.close();
        this.face = undefined;
      }
    }

    if (!this.face || !faceDelegate) {
      throw new Error(`面部模型加载失败：${errorMessage(faceError)}`);
    }
    if (this.stopped || token !== this.poseLoadToken) {
      this.face.close();
      this.face = undefined;
      return;
    }

    this.onStatus("启动摄像头");
    const requestedFps = clamp(this.settings.fps || 30, 10, 60);
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { min: 320, ideal: this.settings.width, max: Math.max(this.settings.width, 1280) },
        height: { min: 240, ideal: this.settings.height, max: Math.max(this.settings.height, 720) },
        frameRate: { ideal: requestedFps, max: Math.max(requestedFps, 30) },
        facingMode: "user"
      },
      audio: this.settings.microphoneVowels
    });
    if (this.settings.microphoneVowels) {
      this.setupAudio(this.stream);
    }
    this.video.srcObject = this.stream;
    await this.video.play();
    void this.setupBackgroundKeepAlive(this.stream);
    this.onStatus(shouldLoadPose(this.settings) ? "面捕运行中（姿态后台加载）" : "面捕运行中（脸部稳定模式）");
    this.loop();
    if (shouldLoadPose(this.settings)) {
      void this.loadPoseInBackground(createPose, faceDelegate, token);
    }
  }

  private async loadPoseInBackground(createPose: (delegate: Delegate) => Promise<PoseLandmarker>, preferredDelegate: Delegate, token: number) {
    await delay(this.settings.tier === "quality" ? 650 : 120);
    if (this.stopped || token !== this.poseLoadToken) return;

    let poseDelegate: Delegate | undefined;
    let poseError: unknown;
    const delegates: Delegate[] =
      this.settings.tier === "quality"
        ? ["CPU", "GPU"]
        : [preferredDelegate, ...(["GPU", "CPU"] as Delegate[]).filter((delegate) => delegate !== preferredDelegate)];
    for (const delegate of delegates) {
      try {
        this.onStatus(`加载姿态模型（${delegate}）`);
        const pose = await withModelTimeout(createPose(delegate), modelTimeoutMs(this.settings.tier, "pose"), `姿态模型（${delegate}）`);
        if (this.stopped || token !== this.poseLoadToken) {
          pose.close();
          return;
        }
        this.pose = pose;
        poseDelegate = delegate;
        break;
      } catch (error) {
        poseError = error;
        this.pose?.close();
        this.pose = undefined;
      }
    }

    if (this.stopped || token !== this.poseLoadToken) return;
    this.onStatus(poseDelegate ? `面捕运行中（姿态 ${poseDelegate}）` : `面捕运行中（仅脸部，姿态不可用：${errorMessage(poseError)}）`);
  }

  stop() {
    this.stopped = true;
    this.poseLoadToken += 1;
    this.cancelScheduledLoop();
    this.closeBackgroundKeepAlive();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.audioContext?.close().catch(() => undefined);
    this.audioContext = undefined;
    this.analyser = undefined;
    this.audioBins = undefined;
    this.analysisCanvas = undefined;
    this.analysisContext = undefined;
    this.poseAnalysisCanvas = undefined;
    this.poseAnalysisContext = undefined;
    this.video.srcObject = null;
    this.face?.close();
    this.pose?.close();
    this.face = undefined;
    this.pose = undefined;
    this.closeBackgroundWorker();
    this.state = { ...emptyTrackingState };
    this.targetState = undefined;
    this.transitionFrom = { ...emptyTrackingState };
    this.transitionStartAt = 0;
    this.transitionDurationMs = 0;
    this.lastAcceptedFace = undefined;
    this.lastAcceptedFaceAt = 0;
    this.rejectedFaceFrames = 0;
    this.faceCalibration = undefined;
    this.armCalibration = undefined;
    this.armCalibrationSamples = [];
    this.lastPoseEstimateAt = 0;
    this.lastPoseState = undefined;
    this.poseBackoffUntil = 0;
    this.onState(this.state);
    this.onStatus("已停止");
  }

  private loop = () => {
    if (this.stopped) return;
    const now = performance.now();
    const frameInterval = faceIntervalMs(this.settings.tier, this.settings.fps);
    if (now - this.lastFrameAt >= frameInterval && this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      this.lastFrameAt = now;
      this.estimate(now);
    }
    this.emitInterpolatedState(now);
    this.scheduleLoop();
  };

  private cancelScheduledLoop() {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    if (this.backgroundTimer) {
      window.clearTimeout(this.backgroundTimer);
      this.backgroundTimer = 0;
    }
    this.backgroundWorker?.postMessage({ type: "cancel" });
    const video = this.video as VideoWithFrameCallback;
    if (this.videoFrameCallback && video.cancelVideoFrameCallback) {
      video.cancelVideoFrameCallback(this.videoFrameCallback);
      this.videoFrameCallback = 0;
    }
  }

  private scheduleLoop() {
    if (this.stopped) return;
    this.cancelScheduledLoop();
    const baseInterval = faceIntervalMs(this.settings.tier, this.settings.fps);
    const tickInterval = Math.max(16, Math.floor(baseInterval / this.interpolationMultiplier()));
    const run = () => {
      this.cancelScheduledLoop();
      this.loop();
    };

    if (document.visibilityState !== "hidden") {
      this.raf = requestAnimationFrame(run);
      return;
    }

    const video = this.video as VideoWithFrameCallback;
    if (video.requestVideoFrameCallback) {
      this.videoFrameCallback = video.requestVideoFrameCallback(run);
    }
    this.backgroundTimer = window.setTimeout(run, tickInterval);
    this.ensureBackgroundWorker().postMessage({ type: "schedule", delay: tickInterval });
  }

  private ensureBackgroundWorker() {
    if (this.backgroundWorker) return this.backgroundWorker;
    const code = `
      let timer = 0;
      self.onmessage = (event) => {
        const data = event.data || {};
        if (data.type === "schedule") {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            timer = 0;
            self.postMessage({ type: "tick" });
          }, Math.max(16, Number(data.delay) || 33));
          return;
        }
        if (data.type === "cancel") {
          if (timer) clearTimeout(timer);
          timer = 0;
          return;
        }
        if (data.type === "close") {
          if (timer) clearTimeout(timer);
          timer = 0;
          self.close();
        }
      };
    `;
    this.backgroundWorkerUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    this.backgroundWorker = new Worker(this.backgroundWorkerUrl);
    this.backgroundWorker.onmessage = () => {
      if (this.stopped) return;
      this.cancelScheduledLoop();
      this.loop();
    };
    return this.backgroundWorker;
  }

  private closeBackgroundWorker() {
    this.backgroundWorker?.postMessage({ type: "close" });
    this.backgroundWorker?.terminate();
    this.backgroundWorker = undefined;
    if (this.backgroundWorkerUrl) {
      URL.revokeObjectURL(this.backgroundWorkerUrl);
      this.backgroundWorkerUrl = undefined;
    }
  }

  private async setupBackgroundKeepAlive(stream: MediaStream) {
    if (!("RTCPeerConnection" in window)) return;
    this.closeBackgroundKeepAlive();
    const sender = new RTCPeerConnection({ iceServers: [] });
    const receiver = new RTCPeerConnection({ iceServers: [] });
    const closePeers = () => {
      sender.close();
      receiver.close();
    };
    try {
      sender.onicecandidate = (event) => {
        if (event.candidate) receiver.addIceCandidate(event.candidate).catch(() => undefined);
      };
      receiver.onicecandidate = (event) => {
        if (event.candidate) sender.addIceCandidate(event.candidate).catch(() => undefined);
      };
      stream.getTracks().forEach((track) => sender.addTrack(track, stream));
      const offer = await sender.createOffer();
      await sender.setLocalDescription(offer);
      await receiver.setRemoteDescription(offer);
      const answer = await receiver.createAnswer();
      await receiver.setLocalDescription(answer);
      await sender.setRemoteDescription(answer);
      if (this.stopped || this.stream !== stream) {
        closePeers();
        return;
      }
      this.keepAlivePeers = [sender, receiver];
    } catch {
      closePeers();
    }
  }

  private closeBackgroundKeepAlive() {
    this.keepAlivePeers?.forEach((peer) => peer.close());
    this.keepAlivePeers = undefined;
  }

  private interpolationMultiplier() {
    return clamp(Math.round(this.settings.interpolationMultiplier ?? 2), 1, 4);
  }

  private effectiveSmoothing() {
    const base = clamp(this.settings.smoothing, 0, 0.92);
    if (this.rejectedFaceFrames > 0) return Math.max(base, 0.74);
    if (this.settings.forceSmoothing ?? true) return Math.max(base, 0.56);
    return base;
  }

  private stabilizeTracking(next: TrackingState, now: number): TrackingState {
    if (!next.hasFace) return next;
    if (!(this.settings.antiJitter ?? true)) {
      this.lastAcceptedFace = next;
      this.lastAcceptedFaceAt = now;
      this.rejectedFaceFrames = 0;
      return next;
    }

    if (this.lastAcceptedFace && now - this.lastAcceptedFaceAt < 160) {
      const jump = faceJumpScore(this.lastAcceptedFace, next);
      if (this.rejectedFaceFrames < 6 && (jump.weighted > 0.92 || jump.maxAxis > 0.52)) {
        this.rejectedFaceFrames += 1;
        return {
          ...next,
          yaw: this.state.yaw,
          pitch: this.state.pitch,
          roll: this.state.roll,
          eyeX: this.state.eyeX,
          eyeY: this.state.eyeY,
          facePoints: this.state.facePoints?.length ? this.state.facePoints : next.facePoints
        };
      }
    }

    this.lastAcceptedFace = next;
    this.lastAcceptedFaceAt = now;
    this.rejectedFaceFrames = 0;
    return next;
  }

  private calibrateArmPose(poseState: Partial<TrackingState>): Partial<TrackingState> {
    if (!poseState.hasPose) return poseState;
    const rawLeft = clamp(Math.max(poseState.armLeft ?? 0, poseState.poseDebug?.armLeftRaw ?? 0), 0, 1);
    const rawRight = clamp(Math.max(poseState.armRight ?? 0, poseState.poseDebug?.armRightRaw ?? 0), 0, 1);

    if (!this.armCalibration) {
      this.armCalibrationSamples.push({ left: rawLeft, right: rawRight });
      const samples = this.armCalibrationSamples.slice(-4);
      this.armCalibrationSamples = samples;
      if (samples.length >= 4) {
        this.armCalibration = {
          left: samples.reduce((sum, sample) => sum + sample.left, 0) / samples.length,
          right: samples.reduce((sum, sample) => sum + sample.right, 0) / samples.length
        };
        this.onStatus("初始手臂零点已校准");
      }
      return {
        ...poseState,
        armLeft: 0,
        armRight: 0,
        poseDebug: poseState.poseDebug
          ? {
              ...poseState.poseDebug,
              armLeftRaw: 0,
              armRightRaw: 0
            }
          : poseState.poseDebug
      };
    }

    const armLeft = clamp(rawLeft - this.armCalibration.left, 0, 1);
    const armRight = clamp(rawRight - this.armCalibration.right, 0, 1);
    return {
      ...poseState,
      armLeft,
      armRight,
      poseDebug: poseState.poseDebug
        ? {
            ...poseState.poseDebug,
            armLeftRaw: armLeft,
            armRightRaw: armRight
          }
        : poseState.poseDebug
    };
  }

  private publishState(next: TrackingState, now: number) {
    const multiplier = this.interpolationMultiplier();
    if (multiplier <= 1) {
      this.targetState = undefined;
      this.state = next;
      this.onState(this.state);
      return;
    }

    this.transitionFrom = this.state;
    this.targetState = next;
    this.transitionStartAt = now;
    const baseInterval = faceIntervalMs(this.settings.tier, this.settings.fps);
    this.transitionDurationMs = Math.max(10, baseInterval * ((multiplier - 1) / multiplier));
  }

  private emitInterpolatedState(now: number) {
    if (!this.targetState || this.interpolationMultiplier() <= 1) return;
    const amount = this.transitionDurationMs <= 0 ? 1 : (now - this.transitionStartAt) / this.transitionDurationMs;
    this.state = interpolateState(this.transitionFrom, this.targetState, amount);
    this.onState(this.state);
    if (amount >= 1) {
      this.targetState = undefined;
    }
  }

  private estimate(now: number) {
    if (!this.face) return;

    const next: TrackingState = { ...emptyTrackingState };
    const frame = this.analysisFrame();
    const faceResult = this.face.detectForVideo(frame, now);
    const facePoints = faceResult.faceLandmarks[0];
    if (facePoints) {
      const rawFace = deriveFace(facePoints);
      if (!this.faceCalibration && rawFace.hasFace) {
        this.faceCalibration = {
          yaw: rawFace.yaw ?? 0,
          pitch: rawFace.pitch ?? 0,
          roll: rawFace.roll ?? 0,
          eyeX: rawFace.eyeX ?? 0,
          eyeY: rawFace.eyeY ?? 0
        };
        this.onStatus("初始角度已校准");
      }
      Object.assign(next, deriveFace(facePoints, this.faceCalibration));
      next.facePoints = previewFacePoints(facePoints);
      this.lastFaceAt = now;
    } else if (now - this.lastFaceAt < 650) {
      Object.assign(next, {
        hasFace: true,
        yaw: this.state.yaw,
        pitch: this.state.pitch,
        roll: this.state.roll,
        eyeX: this.state.eyeX,
        eyeY: this.state.eyeY,
        blinkLeft: this.state.blinkLeft,
        blinkRight: this.state.blinkRight,
        mouthOpen: this.state.mouthOpen,
        mouthForm: this.state.mouthForm,
        facePoints: this.state.facePoints
      });
    }
    if (this.analyser && this.audioBins) {
      const audio = this.estimateVowelForm();
      next.mouthForm = clamp((next.mouthForm || 0) * 0.55 + audio.form * 0.45, -1, 1);
      next.mouthOpen = clamp(Math.max(next.mouthOpen, audio.energy), 0, 1);
    }

    if (this.pose && now >= this.poseBackoffUntil && now - this.lastPoseEstimateAt >= poseIntervalMs(this.settings)) {
      this.lastPoseEstimateAt = now;
      const poseStart = performance.now();
      try {
        const poseResult = this.pose.detectForVideo(this.poseAnalysisFrame(), now);
        const poseCost = performance.now() - poseStart;
        if (poseCost > 42) this.poseBackoffUntil = now + Math.min(900, Math.max(120, poseCost * 4));
        const posePoints = poseResult.landmarks[0];
        if (posePoints) {
          const poseState = this.calibrateArmPose(derivePose(posePoints));
          Object.assign(next, poseState);
          if (poseState.hasPose) this.lastPoseState = poseState;
          this.lastPoseAt = now;
        } else if (now - this.lastPoseAt < 650) {
          Object.assign(next, {
            hasPose: true,
            bodyLeanX: this.lastPoseState?.bodyLeanX ?? this.state.bodyLeanX,
            bodyLeanY: this.lastPoseState?.bodyLeanY ?? this.state.bodyLeanY,
            armLeft: this.lastPoseState?.armLeft ?? this.state.armLeft,
            armRight: this.lastPoseState?.armRight ?? this.state.armRight,
            posePoints: this.lastPoseState?.posePoints ?? this.state.posePoints,
            poseDebug: this.lastPoseState?.poseDebug ?? this.state.poseDebug
          });
        }
      } catch (error) {
        this.pose?.close();
        this.pose = undefined;
        this.onStatus(`面捕运行中（姿态已停用：${errorMessage(error)}）`);
      }
    } else if (this.pose && now - this.lastPoseAt < 650) {
      Object.assign(next, {
        hasPose: true,
        bodyLeanX: this.lastPoseState?.bodyLeanX ?? this.state.bodyLeanX,
        bodyLeanY: this.lastPoseState?.bodyLeanY ?? this.state.bodyLeanY,
        armLeft: this.lastPoseState?.armLeft ?? this.state.armLeft,
        armRight: this.lastPoseState?.armRight ?? this.state.armRight,
        posePoints: this.lastPoseState?.posePoints ?? this.state.posePoints,
        poseDebug: this.lastPoseState?.poseDebug ?? this.state.poseDebug
      });
    }

    this.frames += 1;
    if (now - this.lastFpsAt > 800) {
      next.fps = Math.round((this.frames * 1000) / (now - this.lastFpsAt));
      this.frames = 0;
      this.lastFpsAt = now;
    } else {
      next.fps = this.state.fps;
    }

    const stable = this.stabilizeTracking(next, now);
    const smoothed = smoothState(this.state, stable, this.effectiveSmoothing());
    this.publishState(smoothed, now);
  }

  private analysisFrame(): TexImageSource {
    if (this.settings.width >= 720 && this.settings.height >= 480) return this.video;
    const sourceWidth = this.video.videoWidth || this.settings.width;
    const sourceHeight = this.video.videoHeight || this.settings.height;
    const aspect = sourceWidth / Math.max(1, sourceHeight);
    const targetWidth = Math.round(clamp(this.settings.width, 640, this.settings.tier === "eco" ? 640 : 720));
    const targetHeight = Math.round(clamp(targetWidth / Math.max(0.1, aspect), 360, this.settings.tier === "eco" ? 480 : 540));
    if (!this.analysisCanvas) {
      this.analysisCanvas = document.createElement("canvas");
      this.analysisContext = this.analysisCanvas.getContext("2d", { willReadFrequently: false }) ?? undefined;
    }
    if (!this.analysisCanvas || !this.analysisContext) return this.video;
    if (this.analysisCanvas.width !== targetWidth) this.analysisCanvas.width = targetWidth;
    if (this.analysisCanvas.height !== targetHeight) this.analysisCanvas.height = targetHeight;
    this.analysisContext.imageSmoothingEnabled = true;
    this.analysisContext.imageSmoothingQuality = "high";
    this.analysisContext.drawImage(this.video, 0, 0, targetWidth, targetHeight);
    return this.analysisCanvas;
  }

  private poseAnalysisFrame(): TexImageSource {
    const sourceWidth = this.video.videoWidth || this.settings.width;
    const sourceHeight = this.video.videoHeight || this.settings.height;
    const aspect = sourceWidth / Math.max(1, sourceHeight);
    const targetWidth = this.settings.tier === "quality" ? 384 : 320;
    const targetHeight = Math.round(clamp(targetWidth / Math.max(0.1, aspect), 180, this.settings.tier === "quality" ? 288 : 240));
    if (!this.poseAnalysisCanvas) {
      this.poseAnalysisCanvas = document.createElement("canvas");
      this.poseAnalysisContext = this.poseAnalysisCanvas.getContext("2d", { willReadFrequently: false }) ?? undefined;
    }
    if (!this.poseAnalysisCanvas || !this.poseAnalysisContext) return this.video;
    if (this.poseAnalysisCanvas.width !== targetWidth) this.poseAnalysisCanvas.width = targetWidth;
    if (this.poseAnalysisCanvas.height !== targetHeight) this.poseAnalysisCanvas.height = targetHeight;
    this.poseAnalysisContext.imageSmoothingEnabled = true;
    this.poseAnalysisContext.imageSmoothingQuality = "medium";
    this.poseAnalysisContext.drawImage(this.video, 0, 0, targetWidth, targetHeight);
    return this.poseAnalysisCanvas;
  }

  private setupAudio(stream: MediaStream) {
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) return;

    this.audioContext = new AudioContext();
    const source = this.audioContext.createMediaStreamSource(new MediaStream(audioTracks));
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.72;
    this.audioBins = new Uint8Array(this.analyser.frequencyBinCount);
    source.connect(this.analyser);
  }

  private estimateVowelForm() {
    if (!this.analyser || !this.audioBins || !this.audioContext) return { form: 0, energy: 0 };
    this.analyser.getByteFrequencyData(this.audioBins);

    const nyquist = this.audioContext.sampleRate / 2;
    const binHz = nyquist / this.audioBins.length;
    const band = (from: number, to: number) => {
      const start = Math.max(0, Math.floor(from / binHz));
      const end = Math.min(this.audioBins!.length - 1, Math.ceil(to / binHz));
      let sum = 0;
      for (let i = start; i <= end; i += 1) sum += this.audioBins![i];
      return sum / Math.max(1, end - start + 1) / 255;
    };

    const low = band(120, 450);
    const mid = band(450, 1200);
    const high = band(1200, 3200);
    const energy = clamp((low + mid + high) * 0.75, 0, 1);
    if (energy < 0.035) return { form: 0, energy: 0 };

    // A rough vowel proxy: rounded/open vowels lean negative, bright front vowels lean positive.
    const brightness = (high - low) / Math.max(0.001, low + mid + high);
    const openness = (low + mid * 0.4) / Math.max(0.001, high + mid + low);
    return {
      form: clamp(brightness * 2.2 - openness * 0.55, -1, 1),
      energy: clamp((energy - 0.04) * 1.8, 0, 1)
    };
  }
}
