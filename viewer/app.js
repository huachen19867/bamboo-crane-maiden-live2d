(() => {
  'use strict';

  const canvas = document.querySelector('#stage');
  const ctx = canvas.getContext('2d', { alpha: true });
  const loadLabel = document.querySelector('#load');
  const video = document.querySelector('#cameraVideo');
  const W = canvas.width;
  const H = canvas.height;
  const TAU = Math.PI * 2;
  const RIG_SCALE = 0.97;
  const rigX = x => x * RIG_SCALE + 68;
  const rigY = y => y * RIG_SCALE + 100;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const mix = (a, b, t) => a + (b - a) * t;
  const approach = (value, target, speed, dt) => mix(value, target, 1 - Math.exp(-speed * dt));
  const rad = degrees => degrees * Math.PI / 180;

  const paths = {
    base: '../assets/runtime/body-rig-base.png',
    head: '../assets/runtime/head-base.png',
    hairRoot: '../assets/runtime/hair-root.png',
    hairTips: '../assets/runtime/hair-tips.png',
    armLeft: '../assets/runtime/arm-left.png',
    armRight: '../assets/runtime/arm-right.png',
    footLeft: '../assets/runtime/foot-left.png',
    footRight: '../assets/runtime/foot-right.png',
    hemLeft: '../assets/runtime/hem-left.png',
    hemCenter: '../assets/runtime/hem-center.png',
    hemRight: '../assets/runtime/hem-right.png',
    ribbonUpper: '../assets/runtime/ribbon-upper.png',
    ribbonLower: '../assets/runtime/ribbon-lower.png',
    eyeLeft: '../assets/runtime/eye-left-open.png',
    eyeRight: '../assets/runtime/eye-right-open.png',
    master: '../assets/runtime/character-master.png',
    reference: '../assets/runtime/reference-preview.png'
  };

  const PARAM_DEFAULTS = {
    rootX: 0, rootY: 0,
    headX: 0, headY: 0, headZ: 0,
    bodyX: 0, bodyY: 0, bodyZ: 0, breath: 0,
    shoulderL: 0, shoulderR: 0,
    elbowL: 0, elbowR: 0,
    wristL: 0, wristR: 0,
    hipX: 0, hipY: 0,
    kneeL: 0, kneeR: 0,
    footL: 0, footR: 0,
    weightShift: 0,
    eyeOpenL: 1, eyeOpenR: 1,
    eyeBallX: 0, eyeBallY: 0,
    mouthOpen: 0
  };

  const makeSpring = () => ({ x: 0, velocity: 0, target: 0 });
  const MODE_LABELS = {
    auto: '自动待机', puppet: '人工操偶', mocap: '摄像头动捕',
    show: '编排演出', reference: '参考图校对'
  };
  const EXPRESSIONS = ['neutral', 'smile', 'surprised', 'focused'];
  const EXPRESSION_LABELS = ['平静', '浅笑', '惊喜', '凝神'];

  const state = {
    ready: false,
    images: {},
    mode: 'auto',
    lastLiveMode: 'auto',
    timeMs: 0,
    lastFrameMs: 0,
    showStartMs: 0,
    motionScale: 1,
    blinkEnabled: true,
    highlights: true,
    debugRig: false,
    params: { ...PARAM_DEFAULTS },
    targets: { ...PARAM_DEFAULTS },
    input: {
      keys: new Set(),
      pointer: { x: 0, y: 0, down: false, dragging: false, startX: 0, startY: 0, lastX: 0, lastY: 0 },
      gamepad: { connected: false, index: 0, axes: [0, 0, 0, 0], buttons: [], injected: false }
    },
    driver: {
      activeSources: ['auto'],
      priority: ['keyboard-action', 'timeline', 'mocap', 'gamepad', 'auto', 'secondary-physics'],
      activeMode: 'auto'
    },
    action: { name: 'idle', amount: 0, source: 'auto', triggered: null, untilMs: 0 },
    expression: { index: 0, name: 'neutral', label: '平静' },
    gait: { phase: 0, speed: 0, directionX: 0, directionY: 0 },
    feet: {
      left: { contact: true, anchor: { x: rigX(520), y: rigY(1171) }, slidePx: 0, liftPx: 0 },
      right: { contact: true, anchor: { x: rigX(628), y: rigY(1108) }, slidePx: 0, liftPx: 0 }
    },
    physics: {
      wind: { base: 1.2, turbulence: 0.06, dragX: 0, dragY: 0, impulseX: 0, impulseY: 0, effectiveX: 0 },
      hair: { left: makeSpring(), right: makeSpring(), tips: makeSpring() },
      cloth: {
        sleeveLeft: makeSpring(), sleeveRight: makeSpring(),
        hemLeft: makeSpring(), hemCenter: makeSpring(), hemRight: makeSpring(),
        ribbonUpper: makeSpring(), ribbonLower: makeSpring()
      }
    },
    mocap: {
      active: false, source: null, confidence: 0,
      face: { eyeLOpen: 1, eyeROpen: 1, mouthOpen: 0 },
      pose: { headX: 0, headY: 0, armL: 0, armR: 0, hipX: 0 }
    },
    camera: { active: false, stream: null, frame: null, lastSampleMs: 0, confidence: 0 },
    debug: { manual: false, state: 'idle', options: {}, timeMs: 0 },
    metrics: { frames: 0, fps: 60, lastFpsMs: 0 },
    score: 0,
    cranePulse: 0,
    petals: []
  };

  for (let index = 0; index < 12; index++) {
    state.petals.push({
      x: 70 + ((index * 193) % 1110), y: 80 + ((index * 311) % 980),
      vx: 5 + (index % 3) * 4, vy: 10 + (index % 4) * 3,
      phase: index * 1.73, size: 5 + (index % 4) * 1.7
    });
  }

  let readyResolve;
  const readyPromise = new Promise(resolve => { readyResolve = resolve; });
  const loadImage = src => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`无法读取 ${src}`));
    image.src = src;
  });

  function resetRuntime() {
    state.mode = 'auto';
    state.lastLiveMode = 'auto';
    state.timeMs = performance.now();
    state.lastFrameMs = state.timeMs;
    state.showStartMs = state.timeMs;
    state.input.keys.clear();
    Object.assign(state.input.pointer, { x: 0, y: 0, down: false, dragging: false, startX: 0, startY: 0, lastX: 0, lastY: 0 });
    state.input.gamepad = { connected: false, index: 0, axes: [0, 0, 0, 0], buttons: [], injected: false };
    Object.assign(state.params, PARAM_DEFAULTS);
    Object.assign(state.targets, PARAM_DEFAULTS);
    Object.assign(state.gait, { phase: 0, speed: 0, directionX: 0, directionY: 0 });
    Object.assign(state.feet.left, { contact: true, slidePx: 0, liftPx: 0 });
    Object.assign(state.feet.right, { contact: true, slidePx: 0, liftPx: 0 });
    state.driver.activeSources = ['auto'];
    state.driver.activeMode = 'auto';
    Object.assign(state.action, { name: 'idle', amount: 0, source: 'auto', triggered: null, untilMs: 0 });
    state.expression = { index: 0, name: 'neutral', label: '平静' };
    state.mocap = {
      active: false, source: null, confidence: 0,
      face: { eyeLOpen: 1, eyeROpen: 1, mouthOpen: 0 },
      pose: { headX: 0, headY: 0, armL: 0, armR: 0, hipX: 0 }
    };
    state.physics.wind.dragX = 0;
    state.physics.wind.dragY = 0;
    state.physics.wind.impulseX = 0;
    state.physics.wind.impulseY = 0;
    for (const group of [state.physics.hair, state.physics.cloth]) {
      for (const spring of Object.values(group)) Object.assign(spring, { x: 0, velocity: 0, target: 0 });
    }
    state.debug.manual = false;
    syncModeButtons();
    renderScene(state.timeMs);
    return true;
  }

  function setMode(mode) {
    if (!MODE_LABELS[mode]) return false;
    if (mode !== 'reference') state.lastLiveMode = mode;
    state.mode = mode;
    state.debug.manual = false;
    if (mode === 'show') state.showStartMs = performance.now();
    syncModeButtons();
    return true;
  }

  function syncModeButtons() {
    document.querySelectorAll('[data-mode]').forEach(button => button.classList.toggle('active', button.dataset.mode === state.mode));
    const hud = document.querySelector('#modeHud');
    if (hud) hud.textContent = MODE_LABELS[state.mode] || state.mode;
  }

  function setExpression(index) {
    const safe = clamp(Number(index) || 0, 0, EXPRESSIONS.length - 1);
    state.expression = { index: safe, name: EXPRESSIONS[safe], label: EXPRESSION_LABELS[safe] };
  }

  function triggerAction(name, duration = 1100, source = 'ui') {
    const now = performance.now();
    state.action.triggered = name;
    state.action.untilMs = now + duration;
    state.action.source = source;
    if (name === 'gust' || name === 'point') {
      state.physics.wind.impulseX += name === 'gust' ? 2.6 : 1.5;
      state.physics.wind.impulseY -= name === 'gust' ? 0.5 : 0.2;
    }
    if (name === 'step') state.gait.phase = 0;
    return true;
  }

  function keyboardAxes() {
    const keys = state.input.keys;
    return {
      x: (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0),
      y: (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0),
      turn: (keys.has('e') ? 1 : 0) - (keys.has('q') ? 1 : 0)
    };
  }

  function gamepadButtonPressed(index) {
    const value = state.input.gamepad.buttons.find(button => Number(button.index) === index);
    return Boolean(value?.pressed || Number(value?.value) > 0.5);
  }

  function pollGamepads() {
    if (state.input.gamepad.injected) return;
    const pads = navigator.getGamepads?.();
    const pad = pads && [...pads].find(Boolean);
    if (!pad) {
      state.input.gamepad.connected = false;
      state.input.gamepad.axes = [0, 0, 0, 0];
      state.input.gamepad.buttons = [];
      return;
    }
    state.input.gamepad.connected = true;
    state.input.gamepad.index = pad.index;
    state.input.gamepad.axes = [...pad.axes].map(value => Math.abs(value) < 0.08 ? 0 : value);
    state.input.gamepad.buttons = pad.buttons.map((button, index) => ({ index, pressed: button.pressed, value: button.value }));
  }

  function currentAction(nowMs, showAction = null) {
    const keys = state.input.keys;
    if (keys.has('z')) return { name: 'wave', source: 'keyboard-action' };
    if (keys.has('x')) return { name: 'sleeve', source: 'keyboard-action' };
    if (keys.has('c')) return { name: 'bow', source: 'keyboard-action' };
    if (keys.has('v')) return { name: 'point', source: 'keyboard-action' };
    if (gamepadButtonPressed(0)) return { name: 'wave', source: 'gamepad-action' };
    if (gamepadButtonPressed(1)) return { name: 'bow', source: 'gamepad-action' };
    if (gamepadButtonPressed(2)) return { name: 'sleeve', source: 'gamepad-action' };
    if (gamepadButtonPressed(3)) return { name: 'point', source: 'gamepad-action' };
    if (state.action.triggered && nowMs < state.action.untilMs) return { name: state.action.triggered, source: state.action.source };
    if (showAction) return { name: showAction, source: 'timeline' };
    return { name: 'idle', source: 'auto' };
  }

  function showTargets(nowMs, target) {
    const elapsed = ((nowMs - state.showStartMs) % 16000 + 16000) % 16000;
    let action = null;
    if (elapsed < 2200) {
      target.headX += Math.sin(elapsed / 2200 * Math.PI) * 0.38;
      target.headZ -= Math.sin(elapsed / 2200 * Math.PI) * 0.16;
    } else if (elapsed < 4800) {
      action = 'wave';
      target.headX = 0.3;
    } else if (elapsed < 6700) {
      action = 'gust';
      target.bodyZ = 0.08;
      state.physics.wind.impulseX = Math.max(state.physics.wind.impulseX, 1.7);
    } else if (elapsed < 9200) {
      action = 'step';
      target.rootY = -3;
    } else if (elapsed < 11600) {
      action = 'point';
      target.headX = 0.55;
    } else if (elapsed < 13700) {
      action = 'bow';
    } else {
      target.headX = mix(0.35, 0, (elapsed - 13700) / 2300);
    }
    return action;
  }

  function blinkClosure(ms) {
    if (!state.blinkEnabled) return 0;
    const t = ((ms % 1520) + 1520) % 1520;
    if (t >= 230) return 0;
    if (t < 78) return t / 78;
    if (t < 112) return 1;
    return 1 - (t - 112) / 118;
  }

  function buildTargets(nowMs, dt, deterministic = false) {
    const t = nowMs / 1000;
    const target = { ...PARAM_DEFAULTS };
    const pointer = state.input.pointer;
    const debug = state.debug.manual ? state.debug : null;

    if (!debug) {
      target.breath = 0.5 + 0.5 * Math.sin(t * 1.65);
      target.bodyX = Math.sin(t * 0.72) * 0.06;
      target.bodyZ = Math.sin(t * 0.51) * 0.025;
      target.headZ = Math.sin(t * 0.43 + 0.7) * 0.04;
      target.headX = pointer.x * 0.34;
      target.headY = pointer.y * 0.2;
      target.eyeBallX = pointer.x;
      target.eyeBallY = pointer.y;
    }

    let showAction = null;
    if (!debug && state.mode === 'show') showAction = showTargets(nowMs, target);

    if (!debug && state.mocap.active && state.mocap.confidence > 0.03) {
      const confidence = clamp(state.mocap.confidence, 0, 1);
      target.headX = mix(target.headX, Number(state.mocap.pose.headX) || 0, confidence);
      target.headY = mix(target.headY, Number(state.mocap.pose.headY) || 0, confidence);
      target.shoulderL += (Number(state.mocap.pose.armL) || 0) * confidence;
      target.shoulderR += (Number(state.mocap.pose.armR) || 0) * confidence;
      target.hipX += (Number(state.mocap.pose.hipX) || 0) * confidence;
      target.eyeOpenL = clamp(Number(state.mocap.face.eyeLOpen) || 0, 0.05, 1);
      target.eyeOpenR = clamp(Number(state.mocap.face.eyeROpen) || 0, 0.05, 1);
      target.mouthOpen = clamp(Number(state.mocap.face.mouthOpen) || 0, 0, 1);
    }

    const keyboard = keyboardAxes();
    const pad = state.input.gamepad;
    const padX = pad.connected ? Number(pad.axes[0]) || 0 : 0;
    const padY = pad.connected ? -(Number(pad.axes[1]) || 0) : 0;
    const padHeadX = pad.connected ? Number(pad.axes[2]) || 0 : 0;
    const padArm = pad.connected ? -(Number(pad.axes[3]) || 0) : 0;
    const moveX = clamp(keyboard.x + padX, -1, 1);
    const moveY = clamp(keyboard.y + padY, -1, 1);
    const turn = clamp(keyboard.turn + padHeadX * 0.6, -1, 1);
    const movement = clamp(Math.hypot(moveX, moveY), 0, 1);
    state.gait.speed = approach(state.gait.speed, movement, movement ? 10 : 4, dt);
    state.gait.directionX = moveX;
    state.gait.directionY = moveY;
    if (movement > 0.03) state.gait.phase += dt * TAU * (1.55 + movement * 0.45);
    target.rootX += moveX * 12;
    target.rootY += -Math.max(0, moveY) * 3 + Math.max(0, -moveY) * 2;
    target.bodyZ += turn * 0.12;
    target.hipX += moveX * 0.3;
    target.weightShift += moveX * 0.28;
    target.headX += padHeadX * 0.35;
    target.shoulderR += padArm * 0.32;

    let gaitPhase = state.gait.phase;
    let gaitAmount = state.gait.speed;
    if (state.action.triggered === 'step' && nowMs < state.action.untilMs) gaitAmount = Math.max(gaitAmount, 0.8);

    if (debug?.state === 'step') {
      gaitPhase = clamp(Number(debug.options.phase) || 0, 0, 1) * TAU;
      gaitAmount = 1;
      target.rootY = -2;
      if (debug.options.side === 'right') gaitPhase += Math.PI;
    }
    const gaitSin = Math.sin(gaitPhase);
    const leftLift = Math.max(0, gaitSin) * gaitAmount;
    const rightLift = Math.max(0, -gaitSin) * gaitAmount;
    target.kneeL += leftLift;
    target.kneeR += rightLift;
    target.footL += leftLift;
    target.footR += rightLift;
    target.hipY += Math.abs(Math.sin(gaitPhase)) * gaitAmount * 0.12;
    target.weightShift += Math.cos(gaitPhase) * gaitAmount * 0.22;
    state.feet.left.contact = gaitAmount < 0.04 || gaitSin <= 0.22;
    state.feet.right.contact = gaitAmount < 0.04 || gaitSin >= -0.22;
    state.feet.left.liftPx = leftLift * 18;
    state.feet.right.liftPx = rightLift * 18;
    state.feet.left.slidePx = state.feet.left.contact ? Math.sin(gaitPhase * 0.5) * 0.55 : 0;
    state.feet.right.slidePx = state.feet.right.contact ? Math.cos(gaitPhase * 0.5) * 0.55 : 0;

    const selectedAction = debug?.state === 'arm'
      ? { name: 'wave', source: 'visual-acceptance' }
      : currentAction(nowMs, showAction);
    const actionTarget = selectedAction.name === 'idle' ? 0 : 1;
    state.action.amount = deterministic ? actionTarget : approach(state.action.amount, actionTarget, actionTarget ? 11 : 4.5, dt);
    state.action.name = selectedAction.name;
    state.action.source = selectedAction.source;
    let actionAmount = state.action.amount;
    if (debug?.state === 'arm') actionAmount = clamp(Number(debug.options.amount) || 0, 0, 1);

    if (selectedAction.name === 'wave') {
      target.shoulderR -= 0.22 * actionAmount;
      target.elbowR += 0.24 * actionAmount;
      target.wristR += Math.sin(t * 9) * 0.24 * actionAmount + 0.16 * actionAmount;
      target.headX += 0.18 * actionAmount;
    } else if (selectedAction.name === 'sleeve') {
      target.shoulderL += 0.2 * actionAmount;
      target.shoulderR -= 0.18 * actionAmount;
      target.elbowL -= 0.22 * actionAmount;
      target.elbowR += 0.24 * actionAmount;
      target.bodyY -= 0.08 * actionAmount;
    } else if (selectedAction.name === 'bow') {
      target.bodyY += 0.52 * actionAmount;
      target.headY += 0.28 * actionAmount;
      target.headZ -= 0.06 * actionAmount;
      target.shoulderL += 0.12 * actionAmount;
      target.shoulderR -= 0.1 * actionAmount;
    } else if (selectedAction.name === 'point') {
      target.shoulderR -= 0.26 * actionAmount;
      target.elbowR += 0.2 * actionAmount;
      target.wristR -= 0.14 * actionAmount;
      target.headX += 0.42 * actionAmount;
    } else if (selectedAction.name === 'gust') {
      target.shoulderL += 0.16 * actionAmount;
      target.shoulderR -= 0.18 * actionAmount;
      target.bodyZ += 0.08 * actionAmount;
    } else if (selectedAction.name === 'step') {
      target.rootY -= 3 * actionAmount;
      target.weightShift += Math.sin(t * 4) * 0.25 * actionAmount;
    }

    if (debug?.state === 'idle') {
      Object.assign(target, PARAM_DEFAULTS);
      state.action.name = 'idle';
      state.action.amount = 0;
      state.feet.left.contact = true;
      state.feet.right.contact = true;
    }
    if (debug?.state === 'wind') {
      Object.assign(target, PARAM_DEFAULTS);
      target.eyeOpenL = 1;
      target.eyeOpenR = 1;
    }
    if (debug?.state === 'step') {
      // Keep the waist connector coincident with idle while only the free leg
      // and foot channels demonstrate support/swing.  Live gameplay still uses
      // the hip and root weight transfer calculated above.
      target.rootX = 0;
      target.rootY = 0;
      target.hipX = 0;
      target.hipY = 0;
      target.weightShift = 0;
    }
    if (debug?.state === 'blink') {
      Object.assign(target, PARAM_DEFAULTS);
      const amount = clamp(Number(debug.options.amount) || 0, 0, 1);
      target.eyeOpenL = 1 - amount;
      target.eyeOpenR = 1 - amount;
    } else if (!state.mocap.active && !debug) {
      const closure = blinkClosure(nowMs);
      target.eyeOpenL = 1 - closure;
      target.eyeOpenR = 1 - clamp(closure * 1.02, 0, 1);
    }

    const scale = state.motionScale;
    for (const key of Object.keys(PARAM_DEFAULTS)) {
      if (key.startsWith('eyeOpen')) continue;
      if (key === 'breath') continue;
      target[key] *= scale;
    }
    return target;
  }

  function springStep(spring, target, dt, stiffness, damping) {
    spring.target = target;
    const acceleration = (target - spring.x) * stiffness - spring.velocity * damping;
    spring.velocity += acceleration * dt;
    spring.x += spring.velocity * dt;
    if (!Number.isFinite(spring.x) || !Number.isFinite(spring.velocity)) Object.assign(spring, { x: 0, velocity: 0, target: 0 });
  }

  function updatePhysics(nowMs, dt, deterministic = false) {
    const phase = nowMs / 1000;
    const wind = state.physics.wind;
    if (!deterministic) {
      const decay = Math.exp(-dt * 2.7);
      wind.dragX *= decay;
      wind.dragY *= decay;
      wind.impulseX *= decay;
      wind.impulseY *= decay;
    }
    let base = wind.base;
    let turbulence = wind.turbulence;
    let direction = 1;
    if (state.debug.manual) {
      if (state.debug.state === 'wind') {
        base = Number(state.debug.options.wind) || 2.4;
        turbulence = Number(state.debug.options.turbulence) || 0.06;
        direction = 1;
      } else {
        base = 0;
        turbulence = 0;
      }
    }
    const trigger = gamepadButtonPressed(6) ? 1.2 : 0;
    const effective = direction * (base * 12 + wind.dragX * 38 + wind.impulseX * 34 + trigger * 18);
    const noise = Math.sin(phase * 7.1) * turbulence * 42 + Math.sin(phase * 3.7 + 1.1) * turbulence * 28;
    wind.effectiveX = effective + noise;
    const targets = {
      hairLeft: effective * 0.9 + noise * 1.2,
      hairRight: effective * 1.08 + noise * 0.85,
      hairTips: effective * 1.32 + noise * 1.55,
      sleeveLeft: effective * 0.62 + noise * 0.75,
      sleeveRight: effective * 0.74 + noise * 0.62,
      hemLeft: effective * 0.52 + noise * 0.6,
      hemCenter: effective * 0.42 + noise * 0.45,
      hemRight: effective * 0.64 + noise * 0.7,
      ribbonUpper: effective * 1.5 + noise * 1.2,
      ribbonLower: effective * 1.22 + noise * 1.4
    };
    if (deterministic) {
      const debugPhase = clamp(Number(state.debug.options.phase) || 0, 0, 1);
      const wave = 0.55 + debugPhase * 0.75;
      state.physics.hair.left.x = targets.hairLeft * wave;
      state.physics.hair.right.x = targets.hairRight * (0.7 + debugPhase * 0.55);
      state.physics.hair.tips.x = targets.hairTips * wave;
      state.physics.cloth.sleeveLeft.x = targets.sleeveLeft * wave;
      state.physics.cloth.sleeveRight.x = targets.sleeveRight * (0.7 + debugPhase * 0.55);
      state.physics.cloth.hemLeft.x = targets.hemLeft * wave;
      state.physics.cloth.hemCenter.x = targets.hemCenter * (0.62 + debugPhase * 0.5);
      state.physics.cloth.hemRight.x = targets.hemRight * wave;
      state.physics.cloth.ribbonUpper.x = targets.ribbonUpper * wave;
      state.physics.cloth.ribbonLower.x = targets.ribbonLower * (0.64 + debugPhase * 0.6);
      for (const group of [state.physics.hair, state.physics.cloth]) {
        for (const spring of Object.values(group)) spring.velocity = 0;
      }
      return;
    }
    springStep(state.physics.hair.left, targets.hairLeft, dt, 19, 7.5);
    springStep(state.physics.hair.right, targets.hairRight, dt, 15, 6.8);
    springStep(state.physics.hair.tips, targets.hairTips, dt, 12, 5.9);
    springStep(state.physics.cloth.sleeveLeft, targets.sleeveLeft, dt, 13, 6.5);
    springStep(state.physics.cloth.sleeveRight, targets.sleeveRight, dt, 11, 5.9);
    springStep(state.physics.cloth.hemLeft, targets.hemLeft, dt, 10, 5.4);
    springStep(state.physics.cloth.hemCenter, targets.hemCenter, dt, 12, 6.2);
    springStep(state.physics.cloth.hemRight, targets.hemRight, dt, 9, 5.1);
    springStep(state.physics.cloth.ribbonUpper, targets.ribbonUpper, dt, 8, 4.8);
    springStep(state.physics.cloth.ribbonLower, targets.ribbonLower, dt, 7, 4.4);
  }

  function updateDrivers() {
    const sources = ['auto'];
    if (state.mode === 'show') sources.push('timeline');
    if (state.mocap.active) sources.push('mocap');
    if (state.input.gamepad.connected) sources.push('gamepad');
    if (state.input.keys.size) sources.push('keyboard', 'keyboard-action');
    if (state.input.pointer.dragging || Math.abs(state.physics.wind.impulseX) > 0.02) sources.push('pointer-wind');
    sources.push('secondary-physics');
    state.driver.activeSources = [...new Set(sources)];
    state.driver.activeMode = state.mode;
  }

  function updatePetals(dt) {
    for (const petal of state.petals) {
      petal.x += (petal.vx + state.physics.wind.effectiveX * 0.13) * dt;
      petal.y += petal.vy * dt;
      petal.phase += dt * 2.1;
      if (petal.x > W + 30 || petal.y > H + 30) {
        petal.x = -20 - (petal.phase * 17 % 90);
        petal.y = 40 + (petal.phase * 71 % 320);
      }
    }
  }

  function updateRuntime(nowMs, dt, deterministic = false) {
    pollGamepads();
    if (state.camera.active && nowMs - state.camera.lastSampleMs > 80) sampleCameraMotion(nowMs);
    state.timeMs = nowMs;
    const target = buildTargets(nowMs, dt, deterministic);
    Object.assign(state.targets, target);
    for (const key of Object.keys(PARAM_DEFAULTS)) {
      const speed = key.startsWith('eyeOpen') ? 30 : key.includes('foot') || key.includes('knee') ? 14 : 8;
      state.params[key] = deterministic ? target[key] : approach(state.params[key], target[key], speed, dt);
    }
    updatePhysics(nowMs, dt, deterministic);
    updateDrivers();
    if (!deterministic) {
      updatePetals(dt);
      state.cranePulse = approach(state.cranePulse, 0, 2.8, dt);
    }
  }

  function drawBackground(reference = false) {
    if (reference && state.images.reference) {
      ctx.drawImage(state.images.reference, 0, 0, W, H);
      return;
    }
    const sky = ctx.createRadialGradient(615, 330, 65, 620, 620, 930);
    sky.addColorStop(0, '#fff9d9');
    sky.addColorStop(.38, '#deeee2');
    sky.addColorStop(.72, '#a8cdc1');
    sky.addColorStop(1, '#668d86');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalAlpha = .2;
    for (let x = 45; x < W + 180; x += 125) {
      const lean = (x % 3) * 16;
      const bamboo = ctx.createLinearGradient(x, 0, x + 28, 0);
      bamboo.addColorStop(0, '#144d45'); bamboo.addColorStop(.5, '#7aa58b'); bamboo.addColorStop(1, '#17483f');
      ctx.strokeStyle = bamboo;
      ctx.lineWidth = 18;
      ctx.beginPath(); ctx.moveTo(x, -30); ctx.lineTo(x - 65 + lean, H + 60); ctx.stroke();
      ctx.strokeStyle = 'rgba(227,241,190,.72)'; ctx.lineWidth = 2;
      for (let y = 90 + (x % 80); y < H; y += 145) {
        ctx.beginPath(); ctx.moveTo(x - y * 0.052 - 10, y); ctx.lineTo(x - y * 0.052 + 24, y - 3); ctx.stroke();
      }
    }
    ctx.restore();
    const ground = ctx.createLinearGradient(0, 890, 0, H);
    ground.addColorStop(0, 'rgba(81,126,112,0)');
    ground.addColorStop(1, 'rgba(20,66,61,.48)');
    ctx.fillStyle = ground; ctx.fillRect(0, 850, W, 404);
  }

  function drawPetals() {
    ctx.save();
    for (const petal of state.petals) {
      ctx.translate(petal.x, petal.y);
      ctx.rotate(Math.sin(petal.phase) * 0.8);
      ctx.fillStyle = 'rgba(247, 184, 186, .72)';
      ctx.beginPath();
      ctx.ellipse(0, 0, petal.size, petal.size * 0.48, 0.2, 0, TAU);
      ctx.fill();
      ctx.rotate(-Math.sin(petal.phase) * 0.8);
      ctx.translate(-petal.x, -petal.y);
    }
    ctx.restore();
  }

  function drawCrane() {
    const pulse = state.cranePulse;
    ctx.save();
    ctx.translate(982, 305 + Math.sin(state.timeMs / 1000 * 0.7) * 3);
    ctx.rotate(-0.04);
    ctx.globalAlpha = .88;
    ctx.fillStyle = '#f7f5e7';
    ctx.strokeStyle = '#273d3b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 88, 68, 38, -0.12, 0, TAU);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-30, 75);
    ctx.bezierCurveTo(-65, 30, -74, -30, -36, -58);
    ctx.bezierCurveTo(-8, -78, 8, -58, -8, -43);
    ctx.bezierCurveTo(-37, -18, -14, 43, 16, 70);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ca3b35';
    ctx.beginPath(); ctx.arc(-28, -59, 10, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1e3231';
    ctx.beginPath(); ctx.moveTo(-37, -54); ctx.lineTo(-102, -40); ctx.lineTo(-40, -62); ctx.fill();
    ctx.strokeStyle = '#273d3b'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(17, 116); ctx.lineTo(12, 210); ctx.moveTo(42, 116); ctx.lineTo(55, 206); ctx.stroke();
    ctx.strokeStyle = 'rgba(247,245,231,.96)'; ctx.lineWidth = 15; ctx.lineCap = 'round';
    const wing = 0.25 + pulse * 0.9;
    ctx.beginPath(); ctx.moveTo(24, 78); ctx.quadraticCurveTo(88, 8 - wing * 32, 126, 2 - wing * 55); ctx.stroke();
    ctx.restore();
  }

  function drawLayer(image, pivotX, pivotY, transform = {}) {
    if (!image) return;
    const { x = 0, y = 0, rotation = 0, scaleX = 1, scaleY = 1, alpha = 1 } = transform;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(pivotX + x, pivotY + y);
    ctx.rotate(rotation);
    ctx.scale(scaleX, scaleY);
    ctx.translate(-pivotX, -pivotY);
    ctx.drawImage(image, 0, 0, W, H);
    ctx.restore();
  }

  function drawEye(image, x, y, open, gazeX, gazeY, isLeft) {
    const width = isLeft ? 56 : 52;
    const height = 31;
    const safeOpen = clamp(open, 0.055, 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - width / 2, y - height / 2, width, height);
    ctx.clip();
    ctx.translate(x + gazeX * 2.6, y + gazeY * 1.8);
    ctx.scale(1, safeOpen);
    ctx.translate(-x, -y);
    ctx.drawImage(image, 0, 0, W, H);
    ctx.restore();
    if (open < 0.18) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rad(-15));
      ctx.strokeStyle = '#3a3027';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-width * .43, 0); ctx.quadraticCurveTo(0, 4.2, width * .43, -1); ctx.stroke();
      ctx.restore();
    }
    if (state.highlights && open > 0.3) {
      ctx.fillStyle = 'rgba(255,255,236,.94)';
      ctx.beginPath(); ctx.arc(x + gazeX * 3 + 1, y - 7 + gazeY * 2, 2.25, 0, TAU); ctx.fill();
    }
  }

  function drawExpression() {
    const expression = state.expression.name;
    ctx.save();
    ctx.translate(68, 100);
    ctx.scale(RIG_SCALE, RIG_SCALE);
    if (expression === 'smile') {
      ctx.strokeStyle = 'rgba(123,67,55,.78)'; ctx.lineWidth = 1.7;
      ctx.beginPath(); ctx.moveTo(567, 247); ctx.quadraticCurveTo(583, 259, 599, 245); ctx.stroke();
      ctx.fillStyle = 'rgba(235,126,126,.09)';
      ctx.beginPath(); ctx.ellipse(526, 236, 20, 8, 0, 0, TAU); ctx.ellipse(624, 230, 18, 8, 0, 0, TAU); ctx.fill();
    } else if (expression === 'surprised') {
      ctx.fillStyle = 'rgba(112,63,53,.72)'; ctx.beginPath(); ctx.ellipse(583, 250, 5, 7 + state.params.mouthOpen * 4, 0, 0, TAU); ctx.fill();
    } else if (expression === 'focused') {
      ctx.strokeStyle = 'rgba(65,51,39,.68)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(516, 151); ctx.lineTo(557, 157); ctx.moveTo(591, 153); ctx.lineTo(628, 145); ctx.stroke();
    }
    ctx.restore();
  }

  function drawRig() {
    const p = state.params;
    const cloth = state.physics.cloth;
    const hair = state.physics.hair;
    const breathScale = 1 + p.breath * 0.0035;
    const waistX = rigX(558);
    const waistY = rigY(585);
    ctx.save();
    ctx.translate(waistX + p.rootX, waistY + p.rootY);
    ctx.rotate(p.bodyZ);
    ctx.scale(breathScale, breathScale);
    ctx.translate(-waistX, -waistY);

    drawLayer(state.images.footLeft, rigX(513), rigY(1085), {
      x: state.feet.left.contact ? -p.rootX + state.feet.left.slidePx : Math.sin(state.gait.phase) * 7,
      y: -state.feet.left.liftPx, rotation: rad(p.footL * 9 - p.kneeL * 3)
    });
    drawLayer(state.images.footRight, rigX(625), rigY(1030), {
      x: state.feet.right.contact ? -p.rootX + state.feet.right.slidePx : -Math.sin(state.gait.phase) * 7,
      y: -state.feet.right.liftPx, rotation: rad(-p.footR * 8 + p.kneeR * 3)
    });

    drawLayer(state.images.hemLeft, rigX(455), rigY(620), { x: cloth.hemLeft.x * .42, y: Math.abs(cloth.hemLeft.x) * .07, rotation: rad(cloth.hemLeft.x * .18 - p.weightShift * 2) });
    drawLayer(state.images.hemRight, rigX(690), rigY(605), { x: cloth.hemRight.x * .5, y: Math.abs(cloth.hemRight.x) * .06, rotation: rad(cloth.hemRight.x * .17 + p.weightShift * 2) });
    drawLayer(state.images.hemCenter, rigX(565), rigY(610), { x: cloth.hemCenter.x * .34, y: Math.abs(cloth.hemCenter.x) * .05, rotation: rad(cloth.hemCenter.x * .12) });

    drawLayer(state.images.base, waistX, waistY, { x: p.hipX * 7, y: p.hipY * 4, rotation: p.bodyX * .03 + p.bodyY * .09 });
    drawLayer(state.images.armLeft, rigX(442), rigY(375), { x: cloth.sleeveLeft.x * .16, y: Math.abs(cloth.sleeveLeft.x) * .025, rotation: p.shoulderL + p.elbowL * .18 + rad(cloth.sleeveLeft.x * .05) });
    drawLayer(state.images.armRight, rigX(655), rigY(335), { x: cloth.sleeveRight.x * .18, y: Math.abs(cloth.sleeveRight.x) * .025, rotation: p.shoulderR + p.elbowR * .16 + rad(cloth.sleeveRight.x * .05) });

    drawLayer(state.images.ribbonLower, rigX(620), rigY(600), { x: cloth.ribbonLower.x * .66, y: Math.abs(cloth.ribbonLower.x) * .08, rotation: rad(cloth.ribbonLower.x * .16) });
    drawLayer(state.images.ribbonUpper, rigX(640), rigY(440), { x: cloth.ribbonUpper.x * .72, y: Math.abs(cloth.ribbonUpper.x) * .07, rotation: rad(cloth.ribbonUpper.x * .14) });

    ctx.save();
    ctx.translate(rigX(565), rigY(330));
    ctx.rotate(p.headZ + p.headX * .045 - p.headY * .025);
    ctx.translate(-rigX(565), -rigY(330));
    drawLayer(state.images.head, rigX(565), rigY(330), { x: p.headX * 4, y: p.headY * 3 });
    drawLayer(state.images.hairRoot, rigX(565), rigY(315), { x: hair.left.x * .06, rotation: rad(hair.left.x * .045) });
    drawLayer(state.images.hairTips, rigX(565), rigY(245), { x: hair.tips.x * .55, y: Math.abs(hair.tips.x) * .065, rotation: rad(hair.right.x * .11) });
    drawEye(state.images.eyeLeft, rigX(541), rigY(187), p.eyeOpenL, p.eyeBallX, p.eyeBallY, true);
    drawEye(state.images.eyeRight, rigX(609), rigY(181), p.eyeOpenR, p.eyeBallX, p.eyeBallY, false);
    drawExpression();
    ctx.restore();
    ctx.restore();
  }

  function drawDebugRig() {
    const p = state.params;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,215,90,.9)';
    ctx.fillStyle = 'rgba(30,45,40,.78)';
    ctx.lineWidth = 2;
    const points = {
      neck: [rigX(565) + p.rootX, rigY(330) + p.rootY], waist: [rigX(558) + p.rootX, rigY(585) + p.rootY],
      shoulderL: [rigX(442) + p.rootX, rigY(375) + p.rootY], handL: [rigX(305) + p.rootX, rigY(535) + p.rootY],
      shoulderR: [rigX(655) + p.rootX, rigY(335) + p.rootY], handR: [rigX(790) + p.rootX, rigY(285) + p.rootY],
      footL: [state.feet.left.anchor.x, state.feet.left.anchor.y], footR: [state.feet.right.anchor.x, state.feet.right.anchor.y]
    };
    for (const [a, b] of [['neck', 'waist'], ['shoulderL', 'handL'], ['shoulderR', 'handR'], ['waist', 'footL'], ['waist', 'footR']]) {
      ctx.beginPath(); ctx.moveTo(...points[a]); ctx.lineTo(...points[b]); ctx.stroke();
    }
    for (const [name, point] of Object.entries(points)) {
      ctx.beginPath(); ctx.arc(point[0], point[1], name.startsWith('foot') ? 7 : 5, 0, TAU); ctx.fill(); ctx.stroke();
    }
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(14,39,36,.82)';
    ctx.fillRect(24, 1035, 280, 118);
    ctx.fillStyle = '#e9d47f';
    ctx.fillText(`L ${state.feet.left.contact ? 'CONTACT' : 'SWING'} slide ${state.feet.left.slidePx.toFixed(2)}px`, 38, 1064);
    ctx.fillText(`R ${state.feet.right.contact ? 'CONTACT' : 'SWING'} slide ${state.feet.right.slidePx.toFixed(2)}px`, 38, 1090);
    ctx.fillText(`action ${state.action.name} / ${state.action.source}`, 38, 1116);
    ctx.fillText(`drivers ${state.driver.activeSources.join(' > ')}`, 38, 1142);
    ctx.restore();
  }

  function renderScene(nowMs) {
    ctx.clearRect(0, 0, W, H);
    if (state.mode === 'reference' && !state.debug.manual) {
      drawBackground(true);
      return;
    }
    drawBackground(false);
    drawPetals();
    ctx.save();
    ctx.globalAlpha = .18;
    ctx.fillStyle = '#123e3a';
    ctx.beginPath(); ctx.ellipse(550 + state.params.rootX, 1158, 205, 34, 0, 0, TAU); ctx.fill();
    ctx.restore();
    drawCrane();
    drawRig();
    if (state.debugRig) drawDebugRig();
  }

  function updateHud(nowMs) {
    state.metrics.frames++;
    if (!state.metrics.lastFpsMs) state.metrics.lastFpsMs = nowMs;
    if (nowMs - state.metrics.lastFpsMs >= 500) {
      state.metrics.fps = state.metrics.frames * 1000 / (nowMs - state.metrics.lastFpsMs);
      state.metrics.frames = 0;
      state.metrics.lastFpsMs = nowMs;
      document.querySelector('#fpsHud').textContent = `${Math.round(state.metrics.fps)} FPS`;
    }
    document.querySelector('#modeHud').textContent = `${MODE_LABELS[state.mode]} · ${state.expression.label}`;
    document.querySelector('#leftFootHud').textContent = `左脚 · ${state.feet.left.contact ? '支撑' : '摆动'}`;
    document.querySelector('#rightFootHud').textContent = `右脚 · ${state.feet.right.contact ? '支撑' : '摆动'}`;
    document.querySelector('#scoreHud').textContent = `花瓣 ${state.score}`;
    document.querySelectorAll('[data-action]').forEach(button => button.classList.toggle('active', button.dataset.action === state.action.name));
  }

  function animationFrame(nowMs) {
    if (!state.ready) return requestAnimationFrame(animationFrame);
    const previous = state.lastFrameMs || nowMs;
    const dt = clamp((nowMs - previous) / 1000, 0.001, 0.04);
    state.lastFrameMs = nowMs;
    if (!state.debug.manual) updateRuntime(nowMs, dt, false);
    renderScene(state.debug.manual ? state.debug.timeMs : nowMs);
    updateHud(nowMs);
    requestAnimationFrame(animationFrame);
  }

  function canvasCoordinates(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width * W,
      y: (event.clientY - rect.top) / rect.height * H,
      nx: clamp(((event.clientX - rect.left) / rect.width - .5) * 2, -1, 1),
      ny: clamp(((event.clientY - rect.top) / rect.height - .5) * 2, -1, 1)
    };
  }

  function onPointerMove(event) {
    const point = canvasCoordinates(event);
    const pointer = state.input.pointer;
    pointer.x = point.nx;
    pointer.y = point.ny;
    if (pointer.down) {
      const dx = (point.x - pointer.lastX) / W;
      const dy = (point.y - pointer.lastY) / H;
      const boost = event.shiftKey ? 2 : 1;
      state.physics.wind.dragX = clamp(state.physics.wind.dragX + dx * 7 * boost, -3.5, 3.5);
      state.physics.wind.dragY = clamp(state.physics.wind.dragY + dy * 5 * boost, -2.5, 2.5);
      state.physics.wind.impulseX = clamp(state.physics.wind.impulseX + dx * 2.3 * boost, -4, 4);
      state.physics.wind.impulseY = clamp(state.physics.wind.impulseY + dy * 1.8 * boost, -3, 3);
      pointer.dragging = true;
      pointer.lastX = point.x;
      pointer.lastY = point.y;
    }
  }

  function onPointerDown(event) {
    const point = canvasCoordinates(event);
    Object.assign(state.input.pointer, { down: true, dragging: false, startX: point.x, startY: point.y, lastX: point.x, lastY: point.y });
    canvas.setPointerCapture?.(event.pointerId);
  }

  function onPointerUp(event) {
    const point = canvasCoordinates(event);
    const pointer = state.input.pointer;
    if (!pointer.dragging) {
      let caught = false;
      for (const petal of state.petals) {
        if (Math.hypot(point.x - petal.x, point.y - petal.y) < 24) {
          state.score++;
          petal.x = -30;
          petal.y = 100 + (state.score * 83 % 520);
          caught = true;
          break;
        }
      }
      if (!caught && Math.hypot(point.x - 982, point.y - 390) < 145) {
        state.cranePulse = 1;
        triggerAction('point', 1350, 'crane-interaction');
      }
    }
    pointer.down = false;
    pointer.dragging = false;
    canvas.releasePointerCapture?.(event.pointerId);
  }

  async function startCamera() {
    const button = document.querySelector('#cameraToggle');
    const status = document.querySelector('#cameraStatus');
    if (state.camera.active) {
      state.camera.stream?.getTracks().forEach(track => track.stop());
      state.camera.active = false;
      state.camera.stream = null;
      state.mocap.active = false;
      video.srcObject = null;
      video.classList.remove('active');
      button.classList.remove('active');
      button.textContent = '启用摄像头动捕';
      status.textContent = '摄像头已关闭；角色平滑回到自动待机。';
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      status.textContent = '当前浏览器不支持摄像头访问；仍可使用操偶和编排演出。';
      return;
    }
    try {
      status.textContent = '正在请求摄像头权限…';
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
      state.camera.stream = stream;
      state.camera.active = true;
      state.camera.frame = null;
      video.srcObject = stream;
      await video.play();
      video.classList.add('active');
      button.classList.add('active');
      button.textContent = '关闭摄像头动捕';
      status.textContent = '本地视觉动捕运行中：头部和左右肩臂运动会映射到角色；键盘动作可局部覆盖。';
      setMode('mocap');
    } catch (error) {
      status.textContent = `无法启用摄像头：${error.name || '权限被拒绝'}。可继续使用人工操偶或编排演出。`;
    }
  }

  const motionCanvas = document.createElement('canvas');
  motionCanvas.width = 64;
  motionCanvas.height = 48;
  const motionContext = motionCanvas.getContext('2d', { willReadFrequently: true });
  function sampleCameraMotion(nowMs) {
    state.camera.lastSampleMs = nowMs;
    if (!state.camera.active || video.readyState < 2) return;
    motionContext.save();
    motionContext.translate(64, 0); motionContext.scale(-1, 1);
    motionContext.drawImage(video, 0, 0, 64, 48);
    motionContext.restore();
    const pixels = motionContext.getImageData(0, 0, 64, 48).data;
    const frame = new Uint8Array(64 * 48);
    let energy = 0, weightedX = 0, weightedY = 0, leftEnergy = 0, rightEnergy = 0;
    for (let index = 0; index < frame.length; index++) {
      const offset = index * 4;
      const luma = (pixels[offset] * 3 + pixels[offset + 1] * 6 + pixels[offset + 2]) / 10;
      frame[index] = luma;
      if (state.camera.frame) {
        const diff = Math.abs(luma - state.camera.frame[index]);
        if (diff > 8) {
          const x = index % 64, y = Math.floor(index / 64);
          energy += diff;
          weightedX += x * diff;
          weightedY += y * diff;
          if (x < 32) leftEnergy += diff; else rightEnergy += diff;
        }
      }
    }
    state.camera.frame = frame;
    const confidence = clamp(energy / 105000, 0, 1);
    state.camera.confidence = confidence;
    if (energy > 1) {
      const centerX = weightedX / energy / 63 * 2 - 1;
      const centerY = weightedY / energy / 47 * 2 - 1;
      state.mocap.active = true;
      state.mocap.source = 'camera-optical-motion';
      state.mocap.confidence = Math.max(0.18, confidence);
      state.mocap.pose.headX = clamp(centerX * 0.65, -0.65, 0.65);
      state.mocap.pose.headY = clamp(centerY * 0.38, -0.4, 0.4);
      state.mocap.pose.armL = clamp((leftEnergy / Math.max(1, energy) - .5) * 1.5, -.6, .6);
      state.mocap.pose.armR = clamp((rightEnergy / Math.max(1, energy) - .5) * -1.5, -.6, .6);
      state.mocap.pose.hipX = clamp(centerX * .25, -.3, .3);
      state.mocap.face.eyeLOpen = 1 - blinkClosure(nowMs);
      state.mocap.face.eyeROpen = 1 - blinkClosure(nowMs);
    }
  }

  function plainSpringGroup(group) {
    return Object.fromEntries(Object.entries(group).map(([name, spring]) => [name, {
      offset: Number(spring.x.toFixed(4)), velocity: Number(spring.velocity.toFixed(4)), target: Number(spring.target.toFixed(4))
    }]));
  }

  function getSnapshot() {
    return {
      timeMs: Number(state.timeMs.toFixed(3)),
      mode: state.mode,
      input: {
        keys: [...state.input.keys].sort(),
        pointer: {
          x: Number(state.input.pointer.x.toFixed(4)), y: Number(state.input.pointer.y.toFixed(4)),
          down: state.input.pointer.down, dragging: state.input.pointer.dragging
        },
        gamepad: {
          connected: state.input.gamepad.connected, index: state.input.gamepad.index,
          axes: state.input.gamepad.axes.map(value => Number((Number(value) || 0).toFixed(4))),
          buttons: state.input.gamepad.buttons.map(button => ({ index: Number(button.index), pressed: Boolean(button.pressed), value: Number(button.value) || 0 }))
        },
        camera: { active: state.camera.active, confidence: Number(state.camera.confidence.toFixed(4)) }
      },
      driver: {
        activeSources: [...state.driver.activeSources],
        activeMode: state.driver.activeMode,
        priority: [...state.driver.priority],
        channelBlend: { face: state.mocap.active ? 'mocap' : 'auto', arms: state.action.source, body: state.mode, physics: 'secondary-physics' }
      },
      params: Object.fromEntries(Object.entries(state.params).map(([key, value]) => [key, Number(value.toFixed(5))])),
      feet: {
        left: { contact: state.feet.left.contact, anchor: { ...state.feet.left.anchor }, slidePx: Number(state.feet.left.slidePx.toFixed(4)), liftPx: Number(state.feet.left.liftPx.toFixed(4)) },
        right: { contact: state.feet.right.contact, anchor: { ...state.feet.right.anchor }, slidePx: Number(state.feet.right.slidePx.toFixed(4)), liftPx: Number(state.feet.right.liftPx.toFixed(4)) }
      },
      physics: {
        wind: Object.fromEntries(Object.entries(state.physics.wind).map(([key, value]) => [key, Number(Number(value).toFixed(5))])),
        hair: plainSpringGroup(state.physics.hair),
        cloth: plainSpringGroup(state.physics.cloth)
      },
      action: { name: state.action.name, amount: Number(state.action.amount.toFixed(4)), source: state.action.source },
      expression: { ...state.expression },
      options: { blink: state.blinkEnabled, highlights: state.highlights, motionScale: state.motionScale, debugRig: state.debugRig }
    };
  }

  function dispatchInput(event = {}) {
    if (!event || typeof event !== 'object') return false;
    if (event.type === 'gamepad') {
      state.input.gamepad = {
        connected: event.connected !== false,
        index: Number(event.index) || 0,
        axes: Array.isArray(event.axes) ? event.axes.slice(0, 4).map(value => clamp(Number(value) || 0, -1, 1)) : [0, 0, 0, 0],
        buttons: Array.isArray(event.buttons) ? event.buttons.map((button, index) => ({ index: Number(button.index ?? index), pressed: Boolean(button.pressed), value: Number(button.value) || 0 })) : [],
        injected: event.connected !== false
      };
      return true;
    }
    if (event.type === 'mocap') {
      if (event.active === false) {
        state.mocap.active = false;
        state.mocap.confidence = 0;
        state.mocap.source = null;
        return true;
      }
      state.mocap.active = true;
      state.mocap.source = String(event.source || 'external-mocap');
      state.mocap.confidence = clamp(Number(event.confidence ?? 1), 0, 1);
      state.mocap.face = { ...state.mocap.face, ...(event.face || {}) };
      state.mocap.pose = { ...state.mocap.pose, ...(event.pose || {}) };
      return true;
    }
    if (event.type === 'key') {
      const key = String(event.key || '').toLowerCase();
      if (event.down === false) state.input.keys.delete(key); else state.input.keys.add(key);
      return true;
    }
    if (event.type === 'action') return triggerAction(String(event.name || 'wave'), Number(event.duration) || 1100, String(event.source || 'automation'));
    if (event.type === 'mode') return setMode(String(event.mode));
    if (event.type === 'expression') { setExpression(Number(event.index) || 0); return true; }
    return false;
  }

  function getBindings() {
    return {
      keyboard: {
        movement: ['W', 'A', 'S', 'D'], turn: ['Q', 'E'],
        actions: { Z: 'wave', X: 'sleeve', C: 'bow', V: 'point' },
        expressions: { 1: 'neutral', 2: 'smile', 3: 'surprised', 4: 'focused' }
      },
      pointer: { move: 'gaze/head', drag: 'directional wind', shiftDrag: '2x wind', clickPetal: 'catch', clickCrane: 'crane response' },
      gamepad: { leftStick: 'movement', rightStick: 'head/arm', buttons: ['wave', 'bow', 'sleeve', 'point'], leftTrigger: 'gust' },
      drivers: ['auto', 'puppet', 'mocap', 'show'],
      priority: [...state.driver.priority]
    };
  }

  window.live2dControl = {
    version: '2.0.0',
    getSnapshot,
    dispatchInput,
    reset: async () => resetRuntime(),
    tick: async ms => {
      const delta = clamp(Number(ms) || 16.667, 0, 1000);
      const now = state.timeMs + delta;
      updateRuntime(now, delta / 1000, false);
      renderScene(now);
      return getSnapshot();
    },
    getBindings
  };

  window.__LIVE2D_DEBUG__ = {
    version: '2.0',
    ready: readyPromise,
    getCapabilities() {
      return {
        states: ['idle', 'wind', 'arm', 'step', 'blink'],
        regions: {
          hair: { x: .30, y: .07, width: .43, height: .34, normalized: true },
          face: { x: .42, y: .17, width: .16, height: .18, normalized: true },
          eyeLeft: { x: .45, y: .20, width: .05, height: .06, normalized: true },
          eyeRight: { x: .50, y: .195, width: .05, height: .06, normalized: true },
          arms: { x: .23, y: .25, width: .54, height: .36, normalized: true },
          cloth: { x: .17, y: .40, width: .81, height: .56, normalized: true },
          legsFeet: { x: .30, y: .70, width: .38, height: .30, normalized: true },
          anchors: { x: .487, y: .443, width: .024, height: .024, normalized: true }
        }
      };
    },
    async reset() { resetRuntime(); },
    async setState(name, options = {}) {
      if (!['idle', 'wind', 'arm', 'step', 'blink'].includes(name)) throw new Error(`不支持验收状态：${name}`);
      state.debug.manual = true;
      state.debug.state = name;
      state.debug.options = { ...options };
      state.mode = 'auto';
      state.action.name = 'idle';
      state.action.amount = 0;
      return true;
    },
    async renderAt(timeMs) {
      state.debug.manual = true;
      state.debug.timeMs = Number(timeMs) || 0;
      updateRuntime(state.debug.timeMs, 1 / 60, true);
      renderScene(state.debug.timeMs);
      return true;
    },
    async getTelemetry() {
      return {
        activeState: state.debug.manual ? state.debug.state : state.mode,
        activeDrivers: [...state.driver.activeSources],
        anchors: { neck: { x: rigX(565), y: rigY(330) }, waist: { x: rigX(558), y: rigY(585) }, leftFoot: { ...state.feet.left.anchor }, rightFoot: { ...state.feet.right.anchor } },
        footContacts: { left: state.feet.left.contact, right: state.feet.right.contact },
        footSlidePx: { left: state.feet.left.slidePx, right: state.feet.right.slidePx },
        fps: state.metrics.fps,
        capabilities: ['hair', 'eyes', 'arms', 'cloth', 'legsFeet', 'anchors']
      };
    },
    async captureReference() {
      ctx.clearRect(0, 0, W, H);
      drawBackground(true);
      return canvas.toDataURL('image/png');
    },
    async captureBackground() {
      ctx.clearRect(0, 0, W, H);
      drawBackground(false);
      return canvas.toDataURL('image/png');
    }
  };

  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', event => {
    if (!state.input.pointer.down) {
      state.input.pointer.x = 0;
      state.input.pointer.y = 0;
    } else {
      onPointerUp(event);
    }
  });

  window.addEventListener('keydown', event => {
    const key = event.key.toLowerCase();
    if (/^[wasdqezxcv1-4]$/.test(key)) event.preventDefault();
    if (/^[wasdqezxcv]$/.test(key)) state.input.keys.add(key);
    if (/^[1-4]$/.test(key) && !event.repeat) setExpression(Number(key) - 1);
    if (key === 'v' && !event.repeat) {
      state.physics.wind.impulseX += 1.2;
      state.cranePulse = 1;
    }
  });
  window.addEventListener('keyup', event => state.input.keys.delete(event.key.toLowerCase()));
  window.addEventListener('blur', () => state.input.keys.clear());

  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
    if (state.mode === 'reference') setMode(state.lastLiveMode);
    triggerAction(button.dataset.action, button.dataset.action === 'gust' ? 1600 : 1200, 'ui-action');
  }));
  document.querySelector('#cameraToggle').addEventListener('click', startCamera);
  document.querySelector('#wind').addEventListener('input', event => {
    state.physics.wind.base = Number(event.target.value);
    const output = document.querySelector('#windValue');
    output.value = `${state.physics.wind.base.toFixed(1)} m/s`;
    output.textContent = output.value;
  });
  document.querySelector('#turbulence').addEventListener('input', event => {
    state.physics.wind.turbulence = Number(event.target.value);
    const output = document.querySelector('#turbValue');
    output.value = `${Math.round(state.physics.wind.turbulence * 100)}%`;
    output.textContent = output.value;
  });
  document.querySelector('#motionScale').addEventListener('input', event => {
    state.motionScale = Number(event.target.value);
    const output = document.querySelector('#motionValue');
    output.value = `${Math.round(state.motionScale * 100)}%`;
    output.textContent = output.value;
  });
  document.querySelector('#blink').addEventListener('change', event => { state.blinkEnabled = event.target.checked; });
  document.querySelector('#highlights').addEventListener('change', event => { state.highlights = event.target.checked; });
  document.querySelector('#debugRig').addEventListener('change', event => { state.debugRig = event.target.checked; });
  document.querySelector('#snapshot').addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = `bamboo-crane-fullbody-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  });

  Promise.all(Object.entries(paths).map(async ([key, src]) => [key, await loadImage(src)]))
    .then(entries => {
      state.images = Object.fromEntries(entries);
      state.ready = true;
      state.timeMs = performance.now();
      state.lastFrameMs = state.timeMs;
      loadLabel.classList.add('hidden');
      readyResolve();
      requestAnimationFrame(animationFrame);
    })
    .catch(error => {
      loadLabel.textContent = `素材载入失败：${error.message}`;
      console.error(error);
    });
})();
