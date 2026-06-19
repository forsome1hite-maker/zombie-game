/* =========================================================
   좀비 슈팅 게임 — 1인칭 FPS (Three.js)
   - WASD 이동 / 마우스 시점 / 클릭 사격
   - 큰 좀비 처치 시 아이템 드롭 → 획득 시 무기 업그레이드
   - 3웨이브마다 안전가옥 문이 열려 보상 / 5웨이브마다 상점 오픈
   ========================================================= */

(() => {
  'use strict';

  // ---------- 무기 정의 ----------
  // 아이템을 먹거나 상점에서 강화하면 weaponLevel이 1씩 올라가며 더 강한 총으로 바뀐다.
  const WEAPONS = [
    { name: '피스톨',     damage: 26,  fireRate: 0.34, pellets: 1, spread: 0.0,  range: 60,  color: 0xffd45e, auto: false },
    { name: '듀얼 피스톨', damage: 22,  fireRate: 0.16, pellets: 1, spread: 0.03, range: 60,  color: 0xffe08a, auto: true  },
    { name: 'SMG',        damage: 20,  fireRate: 0.10, pellets: 1, spread: 0.02, range: 60,  color: 0x7ef0ff, auto: true  },
    { name: '샷건',       damage: 16,  fireRate: 0.62, pellets: 7, spread: 0.10, range: 40,  color: 0xff8a3b, auto: false },
    { name: '라이플',     damage: 70,  fireRate: 0.16, pellets: 1, spread: 0.01, range: 90,  color: 0x9b7bff, auto: true  },
    { name: '저격총',     damage: 230, fireRate: 0.85, pellets: 1, spread: 0.0,  range: 200, color: 0xff4d6d, auto: false },
    { name: '미니건',     damage: 26,  fireRate: 0.05, pellets: 1, spread: 0.055,range: 80,  color: 0xffa733, auto: true  },
    { name: '플라즈마건',  damage: 130, fireRate: 0.12, pellets: 1, spread: 0.0,  range: 100, color: 0x5effa0, auto: true  },
  ];

  // ---------- 사운드 (Web Audio로 합성, 외부 파일 없음) ----------
  const Sound = {
    ctx: null,
    master: null,
    noiseBuffer: null,

    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
      // 1초짜리 화이트노이즈 버퍼 (총성/타격음 재료)
      const len = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;
    },
    resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },

    // 필터링한 노이즈 한 방
    _noise(dur, type, freq, q, gain) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const filt = ctx.createBiquadFilter();
      filt.type = type;
      filt.frequency.value = freq;
      if (q) filt.Q.value = q;
      const g = ctx.createGain();
      const t = ctx.currentTime;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(filt); filt.connect(g); g.connect(this.master);
      src.start(t); src.stop(t + dur);
    },
    // 오실레이터 톤 (필요하면 주파수 스윕)
    _tone(freq, dur, type, gain, freqEnd, when) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = type || 'sine';
      const g = ctx.createGain();
      const t = (when || ctx.currentTime);
      o.frequency.setValueAtTime(freq, t);
      if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur);
    },

    shoot(level) {
      if (!this.ctx) return;
      this._tone(130 + level * 22, 0.12, 'square', 0.22, 40);  // 묵직한 발사
      this._noise(0.12, 'lowpass', 1900, 1, 0.32);             // 총성
      this._noise(0.05, 'highpass', 3200, 1, 0.14);            // 날카로운 끝맛
    },
    hit() {
      if (!this.ctx) return;
      this._noise(0.10, 'bandpass', 420, 2, 0.4);   // 퍽 하는 타격
      this._tone(170, 0.10, 'sawtooth', 0.12, 80);
    },
    headshot() {
      if (!this.ctx) return;
      this._noise(0.06, 'highpass', 2600, 1, 0.3);          // 날카로운 크랙
      this._tone(950, 0.08, 'square', 0.2, 320);
      this._tone(210, 0.13, 'sawtooth', 0.16, 60);
    },
    death() {
      if (!this.ctx) return;
      this._tone(230, 0.5, 'sawtooth', 0.3, 45);    // 끄으윽 하강 신음
      this._noise(0.4, 'lowpass', 700, 0.5, 0.25);
    },
    pickup() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      [523.25, 659.25, 783.99].forEach((f, i) => {   // 도-미-솔 상승 아르페지오
        this._tone(f, 0.16, 'sine', 0.28, null, t + i * 0.07);
      });
    },
    buy() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this._tone(880, 0.10, 'triangle', 0.25, null, t);
      this._tone(1320, 0.12, 'triangle', 0.22, null, t + 0.08);  // 까랑~ 결제음
    },
  };

  // ---------- 전역 상태 ----------
  let scene, camera, renderer, clock;
  let yawObject, pitchObject;            // 카메라 회전용
  let gun, muzzleFlash;                  // 손에 든 총 + 총구 섬광
  const zombies = [];
  const items = [];
  const tracers = [];                    // 총알 궤적
  const obstacles = [];                  // 충돌체 (상자=원형, 집 벽=박스)

  // 안전 가옥 / 상점 — 위치/크기 + 문·조명 참조를 함께 보관
  const HOUSE = { x: 0,  z: -38, half: 4.5, isShop: false };
  const SHOP  = { x: 34, z: -30, half: 4.5, isShop: true  };

  let restAvailable = false;             // 안전가옥 이용 가능(문이 열림)
  let resting = false;                   // 안전가옥 안에서 휴식 중
  let shopAvailable = false;             // 상점 이용 가능(문이 열림)
  let shopping = false;                  // 상점 안에서 쇼핑 중

  const keys = {};
  let locked = false;
  let running = false;
  let gameOver = false;

  const BASE_SPEED = 6.2, BASE_SPRINT = 9.5;

  const player = {
    health: 100,
    maxHealth: 100,
    speed: BASE_SPEED,
    sprint: BASE_SPRINT,
    speedMul: 1,
    radius: 0.5,
    weaponLevel: 0,
    score: 0,
    wave: 1,
    coins: 0,
    armor: 0,            // 받는 피해 감소 비율 (0 ~ 0.6)
    shield: 0,           // 보호막 — 체력보다 먼저 소모
    maxShield: 0,
    invuln: 0,           // 상점 보호막(무적) 남은 시간(초)
    bought: {},          // 상점 아이템 구매 횟수 (가격 상승용)
    lastHouseWave: 0,    // 마지막으로 연 안전가옥 웨이브
    lastShopWave: 0,     // 마지막으로 연 상점 웨이브
  };

  let fireCooldown = 0;
  let wantFire = false;                   // 마우스 누르고 있는지 (자동사격용)
  let spawnTimer = 0;
  let spawnInterval = 2.2;
  let waveTimer = 0;
  const MAP_SIZE = 100;                   // 바닥 절반 크기

  // 재사용 객체
  const raycaster = new THREE.Raycaster();
  const _dir = new THREE.Vector3();
  const _v = new THREE.Vector3();

  // DOM
  const el = (id) => document.getElementById(id);
  const dom = {
    overlay: el('overlay'),
    gameover: el('gameover'),
    startBtn: el('startBtn'),
    restartBtn: el('restartBtn'),
    healthFill: el('healthFill'),
    healthText: el('healthText'),
    weaponName: el('weaponName'),
    score: el('score'),
    wave: el('wave'),
    coins: el('coins'),
    defense: el('defense'),
    finalScore: el('finalScore'),
    finalWave: el('finalWave'),
    finalCoins: el('finalCoins'),
    toast: el('toast'),
    shieldTimer: el('shieldTimer'),
    damageFlash: el('damageFlash'),
    // 안전가옥
    house: el('house'),
    houseWave: el('houseWave'),
    chestBtn: el('chestBtn'),
    rewardText: el('rewardText'),
    leaveBtn: el('leaveBtn'),
    // 상점
    shop: el('shop'),
    shopCoins: el('shopCoins'),
    shopItems: el('shopItems'),
    shopMsg: el('shopMsg'),
    shopLeaveBtn: el('shopLeaveBtn'),
  };

  // ============================================================
  // 초기화
  // ============================================================
  function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x10131a);
    scene.fog = new THREE.Fog(0x10131a, 25, 90);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 500);

    // 1인칭 회전 구조: yaw(좌우) > pitch(상하) > camera
    pitchObject = new THREE.Object3D();
    pitchObject.add(camera);
    yawObject = new THREE.Object3D();
    yawObject.position.set(0, 1.6, 0);   // 눈높이
    yawObject.add(pitchObject);
    scene.add(yawObject);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.getElementById('game').appendChild(renderer.domElement);

    // 조명
    const hemi = new THREE.HemisphereLight(0x9099b0, 0x202028, 0.9);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(20, 40, 10);
    scene.add(dir);
    const moon = new THREE.PointLight(0x88aaff, 0.5, 200);
    moon.position.set(-30, 50, -20);
    scene.add(moon);

    buildWorld();
    buildGun();

    clock = new THREE.Clock();

    // 이벤트
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', (e) => { keys[e.code] = true; });
    document.addEventListener('keyup', (e) => { keys[e.code] = false; });
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mousedown', (e) => { if (e.button === 0) wantFire = true; });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) wantFire = false; });
    document.addEventListener('pointerlockchange', onPointerLockChange);

    dom.startBtn.addEventListener('click', startGame);
    dom.restartBtn.addEventListener('click', restartGame);
    dom.chestBtn.addEventListener('click', openChest);
    dom.leaveBtn.addEventListener('click', leaveHouse);
    dom.shopLeaveBtn.addEventListener('click', leaveShop);

    animate();
  }

  // ---------- 월드(바닥 + 장애물) ----------
  function buildWorld() {
    // 바닥
    const groundGeo = new THREE.PlaneGeometry(MAP_SIZE * 2, MAP_SIZE * 2, 40, 40);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 1 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // 격자 느낌
    const grid = new THREE.GridHelper(MAP_SIZE * 2, 60, 0x2b3550, 0x222a3a);
    grid.position.y = 0.02;
    scene.add(grid);

    // 외벽
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a3346, roughness: 0.9 });
    const wallH = 6;
    const walls = [
      [0, wallH / 2, -MAP_SIZE, MAP_SIZE * 2, wallH, 1],
      [0, wallH / 2, MAP_SIZE, MAP_SIZE * 2, wallH, 1],
      [-MAP_SIZE, wallH / 2, 0, 1, wallH, MAP_SIZE * 2],
      [MAP_SIZE, wallH / 2, 0, 1, wallH, MAP_SIZE * 2],
    ];
    walls.forEach(([x, y, z, w, h, d]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      m.position.set(x, y, z);
      scene.add(m);
    });

    // 흩어진 상자(엄폐물 겸 분위기) — 충돌체로 등록
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x3a4252, roughness: 0.8 });
    for (let i = 0; i < 26; i++) {
      const s = 1.4 + Math.random() * 2.2;
      const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
      c.position.set(
        (Math.random() - 0.5) * MAP_SIZE * 1.6,
        s / 2,
        (Math.random() - 0.5) * MAP_SIZE * 1.6
      );
      // 시작 지점 근처는 비워둠
      if (c.position.length() < 8) c.position.x += 12;
      // 안전가옥/상점과 겹치면 비켜둠
      [HOUSE, SHOP].forEach((b) => {
        if (Math.hypot(c.position.x - b.x, c.position.z - b.z) < b.half + 4) {
          c.position.x += b.half + 8;
        }
      });
      c.rotation.y = Math.random() * Math.PI;
      scene.add(c);
      // 충돌체: 회전한 정육면체를 원으로 근사
      obstacles.push({ x: c.position.x, z: c.position.z, r: s * 0.55 });
    }

    // 안전가옥(초록) + 상점(파랑)
    buildSafeBuilding(HOUSE, {
      wall: 0x6b5743, floor: 0x4a3b2c, roof: 0x3a2b20,
      doorClosed: 0x4a3326, doorEmitOff: 0x0a0603,
      doorOpenCol: 0x46ff8c, doorEmitOn: 0x1f7a40,
      sign: 0x2f9d52, lightOff: 0xff5544, lightOn: 0x46ff8c,
    });
    buildSafeBuilding(SHOP, {
      wall: 0x3a4a6b, floor: 0x2c3850, roof: 0x223044,
      doorClosed: 0x263a55, doorEmitOff: 0x06080a,
      doorOpenCol: 0x4ad0ff, doorEmitOn: 0x1f6a8a,
      sign: 0xffc83b, lightOff: 0x4466ff, lightOn: 0x4ad0ff,
    });
  }

  // ---------- 안전 가옥 / 상점 (공통 건물) ----------
  function buildSafeBuilding(b, opts) {
    const cx = b.x, cz = b.z, h = b.half;
    const wallMat = new THREE.MeshStandardMaterial({ color: opts.wall, roughness: 0.9 });
    const floorMat = new THREE.MeshStandardMaterial({ color: opts.floor, roughness: 1 });
    const roofMat = new THREE.MeshStandardMaterial({ color: opts.roof, roughness: 0.95 });
    const wallH = 4, t = 0.5;

    // 바닥
    const floor = new THREE.Mesh(new THREE.BoxGeometry(h * 2, 0.1, h * 2), floorMat);
    floor.position.set(cx, 0.05, cz);
    scene.add(floor);

    // 벽 추가 헬퍼 (시각 메쉬 + AABB 충돌체)
    const addWall = (x, z, w, d) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
      m.position.set(x, wallH / 2, z);
      scene.add(m);
      obstacles.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    };

    addWall(cx, cz - h, h * 2, t);            // 뒷벽
    addWall(cx - h, cz, t, h * 2);            // 왼벽
    addWall(cx + h, cz, t, h * 2);            // 오른벽
    // 앞벽(+z) — 가운데 문 구멍
    const gap = 1.25;
    const segW = h - gap;                      // 한쪽 벽 길이
    addWall(cx - (gap + segW / 2), cz + h, segW, t);
    addWall(cx + (gap + segW / 2), cz + h, segW, t);

    // 지붕
    const roof = new THREE.Mesh(new THREE.BoxGeometry(h * 2 + 0.6, 0.3, h * 2 + 0.6), roofMat);
    roof.position.set(cx, wallH + 0.15, cz);
    scene.add(roof);

    // 여닫이 문 — 닫히면 충돌체로 입구를 막고, 열리면 위로 슬라이드되어 통과 가능
    const doorMat = new THREE.MeshStandardMaterial({
      color: opts.doorClosed, emissive: opts.doorEmitOff, emissiveIntensity: 1, roughness: 0.4,
    });
    const door = new THREE.Mesh(new THREE.BoxGeometry(gap * 2, wallH * 0.92, 0.3), doorMat);
    const closedY = wallH * 0.46;
    door.position.set(cx, closedY, cz + h);
    door.userData.closedY = closedY;
    door.userData.openY = closedY + wallH;   // 위로 사라짐
    scene.add(door);

    // 문 충돌체 (닫혀 있을 때만 enabled)
    const doorObs = { minX: cx - gap, maxX: cx + gap, minZ: cz + h - 0.3, maxZ: cz + h + 0.3, enabled: true };
    obstacles.push(doorObs);

    // 지붕 위 간판
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(h * 1.2, 0.7, 0.15),
      new THREE.MeshStandardMaterial({ color: opts.sign, emissive: opts.sign, emissiveIntensity: 0.6, roughness: 0.4 })
    );
    sign.position.set(cx, wallH + 0.7, cz + h + 0.1);
    scene.add(sign);

    // 문 표시등
    const light = new THREE.PointLight(opts.lightOff, 0, 16);
    light.position.set(cx, 2.4, cz + h + 1.6);
    scene.add(light);

    b.doorMat = doorMat;
    b.door = door;
    b.doorObs = doorObs;
    b.light = light;
    b.opts = opts;
    b.open = false;
    setBuildingGlow(b, false);
  }

  // 건물 이용 가능 상태 토글 (문 빛 + 문 열림/닫힘)
  function setBuildingGlow(b, on) {
    if (!b.doorMat) return;
    const o = b.opts;
    b.doorMat.color.setHex(on ? o.doorOpenCol : o.doorClosed);
    b.doorMat.emissive.setHex(on ? o.doorEmitOn : o.doorEmitOff);
    b.light.color.setHex(on ? o.lightOn : o.lightOff);
    b.light.intensity = on ? 2.6 : 0.0;
    setDoor(b, on);   // 이용 가능하면 문이 열린다
  }

  // 문 개폐 (open=true면 충돌 해제)
  function setDoor(b, open) {
    b.open = open;
    if (b.doorObs) b.doorObs.enabled = !open;
  }

  // 충돌 해소: pos를 모든 (활성) 장애물 밖으로 밀어낸다
  function resolveObstacles(pos, radius) {
    for (const o of obstacles) {
      if (o.enabled === false) continue;   // 열린 문 등은 통과
      if (o.r != null) {
        // 원형(상자)
        const dx = pos.x - o.x, dz = pos.z - o.z;
        let d = Math.hypot(dx, dz);
        const min = o.r + radius;
        if (d < min) {
          if (d < 1e-4) { pos.x += min; continue; }
          const push = min - d;
          pos.x += (dx / d) * push;
          pos.z += (dz / d) * push;
        }
      } else {
        // AABB(집/상점 벽) — 반지름만큼 확장 후 최소 침투 방향으로 밀어냄
        const minX = o.minX - radius, maxX = o.maxX + radius;
        const minZ = o.minZ - radius, maxZ = o.maxZ + radius;
        if (pos.x > minX && pos.x < maxX && pos.z > minZ && pos.z < maxZ) {
          const pxL = pos.x - minX, pxR = maxX - pos.x;
          const pzL = pos.z - minZ, pzR = maxZ - pos.z;
          const m = Math.min(pxL, pxR, pzL, pzR);
          if (m === pxL) pos.x = minX;
          else if (m === pxR) pos.x = maxX;
          else if (m === pzL) pos.z = minZ;
          else pos.z = maxZ;
        }
      }
    }
  }

  // 플레이어가 건물 내부에 있는지 (안전 지대 판정)
  function insideBuilding(b, margin) {
    const p = yawObject.position;
    const lim = b.half - (margin || 0);
    return Math.abs(p.x - b.x) < lim && Math.abs(p.z - b.z) < lim;
  }
  // 좀비 공격이 통하지 않는 안전 상태
  function isPlayerSafe() {
    return resting || shopping || player.invuln > 0 ||
           insideBuilding(HOUSE, 0) || insideBuilding(SHOP, 0);
  }

  // ---------- 총 모델 ----------
  function buildGun() {
    gun = new THREE.Group();

    // 총구 섬광 (무기별로 위치를 옮긴다)
    muzzleFlash = new THREE.PointLight(0xffcc66, 0, 8);
    muzzleFlash.position.set(0, 0.02, -0.7);
    gun.add(muzzleFlash);

    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0 });
    const flashMesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), flashMat);
    flashMesh.position.set(0, 0.02, -0.7);
    gun.add(flashMesh);
    gun.userData.flashMesh = flashMesh;

    // 무기 모델 본체를 담는 그룹 — 업그레이드 시 통째로 교체
    const partsGroup = new THREE.Group();
    gun.add(partsGroup);
    gun.userData.partsGroup = partsGroup;

    // 화면 우하단에 배치, 카메라에 부착
    gun.position.set(0.22, -0.2, -0.45);
    gun.userData.restPos = gun.position.clone();
    camera.add(gun);

    applyWeaponModel(0);
  }

  // 무기 레벨에 맞는 총 모양으로 교체한다.
  function applyWeaponModel(level) {
    const partsGroup = gun.userData.partsGroup;
    gun.userData.core = null;     // 플라즈마 코어 참조 초기화
    gun.userData.barrels = null;  // 미니건 회전 배럴 참조 초기화
    // 기존 파트 정리 (자식까지 재귀 dispose)
    for (let i = partsGroup.children.length - 1; i >= 0; i--) {
      const c = partsGroup.children[i];
      partsGroup.remove(c);
      c.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }

    const w = WEAPONS[level];
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.5, metalness: 0.6 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.6, metalness: 0.5 });
    const accentMat = new THREE.MeshStandardMaterial({
      color: w.color, emissive: w.color, emissiveIntensity: 0.35, roughness: 0.35, metalness: 0.4,
    });
    gun.userData.accent = accentMat;

    const add = (mesh, x, y, z, rx, ry, rz) => {
      mesh.position.set(x || 0, y || 0, z || 0);
      if (rx) mesh.rotation.x = rx;
      if (ry) mesh.rotation.y = ry;
      if (rz) mesh.rotation.z = rz;
      partsGroup.add(mesh);
      return mesh;
    };
    const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || bodyMat);
    const cyl = (r1, r2, h, seg, mat) => new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg || 12), mat || bodyMat);

    let muzzleZ = -0.7;  // 총구 섬광 위치(무기별)

    switch (level) {
      case 0: // 피스톨 — 작고 단순
        add(box(0.12, 0.16, 0.5), 0, 0, -0.1);
        add(cyl(0.035, 0.035, 0.5, 12), 0, 0.02, -0.4, Math.PI / 2);
        add(box(0.1, 0.22, 0.12), 0, -0.16, 0.05, 0.3);
        add(box(0.04, 0.05, 0.08, accentMat), 0, 0.12, -0.05);
        muzzleZ = -0.7;
        break;

      case 1: // 듀얼 피스톨 — 좌우 두 자루
        [-0.13, 0.13].forEach((px) => {
          add(box(0.1, 0.14, 0.42), px, 0, -0.08);
          add(cyl(0.03, 0.03, 0.4, 12), px, 0.02, -0.32, Math.PI / 2);
          add(box(0.09, 0.2, 0.1), px, -0.15, 0.05, 0.3);
          add(box(0.03, 0.04, 0.06, accentMat), px, 0.1, -0.04);
        });
        muzzleZ = -0.58;
        break;

      case 2: // SMG — 길쭉한 몸체 + 탄창 + 짧은 총열
        add(box(0.13, 0.18, 0.62), 0, 0, -0.12);
        add(cyl(0.03, 0.03, 0.34, 12), 0, 0.03, -0.5, Math.PI / 2);
        add(box(0.1, 0.26, 0.12), 0, -0.2, 0.1, 0.25);            // 손잡이
        add(box(0.08, 0.3, 0.14, darkMat), 0, -0.22, -0.18, -0.2); // 탄창
        add(box(0.05, 0.06, 0.18, accentMat), 0, 0.13, -0.1);     // 상부 레일
        muzzleZ = -0.74;
        break;

      case 3: // 샷건 — 굵은 더블 배럴 + 펌프
        add(box(0.16, 0.2, 0.5), 0, 0, -0.05);
        [-0.05, 0.05].forEach((x) => add(cyl(0.055, 0.055, 0.7, 14), x, 0.03, -0.5, Math.PI / 2));
        add(box(0.13, 0.13, 0.22, darkMat), 0, -0.06, -0.42);     // 펌프 핸드가드
        add(box(0.12, 0.26, 0.13), 0, -0.18, 0.12, 0.3);          // 손잡이
        add(box(0.06, 0.05, 0.12, accentMat), 0, 0.14, -0.1);
        muzzleZ = -0.86;
        break;

      case 4: // 라이플 — 긴 총열 + 스코프 + 개머리판
        add(box(0.12, 0.16, 0.8), 0, 0, -0.18);
        add(cyl(0.028, 0.028, 0.7, 12), 0, 0.02, -0.7, Math.PI / 2);
        add(box(0.1, 0.24, 0.12), 0, -0.18, 0.08, 0.28);          // 손잡이
        add(box(0.1, 0.18, 0.26, darkMat), 0, -0.02, 0.32);       // 개머리판
        add(box(0.08, 0.32, 0.13, darkMat), 0, -0.22, -0.05, -0.15); // 탄창
        add(cyl(0.05, 0.05, 0.26, 14, darkMat), 0, 0.16, -0.1, 0, 0, Math.PI / 2);   // 스코프
        add(cyl(0.045, 0.045, 0.04, 14, accentMat), 0, 0.16, -0.24, 0, 0, Math.PI / 2);
        muzzleZ = -1.0;
        break;

      case 5: { // 저격총 — 아주 긴 총열 + 큰 스코프 + 양각대
        add(box(0.12, 0.16, 1.0), 0, 0, -0.22);
        add(cyl(0.025, 0.025, 0.95, 12), 0, 0.03, -0.85, Math.PI / 2);  // 긴 총열
        add(box(0.1, 0.24, 0.12), 0, -0.18, 0.12, 0.28);               // 손잡이
        add(box(0.12, 0.2, 0.3, darkMat), 0, -0.02, 0.4);              // 개머리판
        add(cyl(0.06, 0.06, 0.42, 16, darkMat), 0, 0.18, -0.1, 0, 0, Math.PI / 2);   // 큰 스코프
        add(cyl(0.055, 0.055, 0.05, 16, accentMat), 0, 0.18, -0.31, 0, 0, Math.PI / 2);
        add(cyl(0.055, 0.055, 0.05, 16, accentMat), 0, 0.18, 0.11, 0, 0, Math.PI / 2);
        add(box(0.02, 0.18, 0.02, darkMat), -0.07, -0.1, -0.72, 0, 0, 0.3);   // 양각대
        add(box(0.02, 0.18, 0.02, darkMat), 0.07, -0.1, -0.72, 0, 0, -0.3);
        muzzleZ = -1.28;
        break;
      }

      case 6: { // 미니건 — 회전하는 6연장 배럴
        add(box(0.2, 0.22, 0.5), 0, 0, 0.02);                     // 큰 몸체
        add(box(0.12, 0.28, 0.14), 0, -0.22, 0.18, 0.2);          // 손잡이
        add(box(0.16, 0.16, 0.2, darkMat), 0, 0, 0.26);           // 후미 박스
        add(cyl(0.11, 0.11, 0.14, 18, bodyMat), 0, 0.02, -0.14, Math.PI / 2);  // 배럴 디스크
        const barrels = new THREE.Group();
        const n = 6;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const br = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.72, 10), darkMat);
          br.position.set(Math.cos(a) * 0.07, Math.sin(a) * 0.07, -0.48);
          br.rotation.x = Math.PI / 2;
          barrels.add(br);
        }
        barrels.position.set(0, 0.02, 0);
        partsGroup.add(barrels);
        gun.userData.barrels = barrels;
        add(box(0.04, 0.06, 0.3, accentMat), 0, 0.15, -0.1);
        muzzleZ = -0.92;
        break;
      }

      default: { // 7: 플라즈마건 — 미래형, 빛나는 에너지 코어 + 코일
        add(box(0.16, 0.2, 0.6), 0, 0, -0.1);
        const core = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 16), accentMat);
        add(core, 0, 0.04, 0.02);
        gun.userData.core = core;
        add(cyl(0.04, 0.1, 0.5, 16, darkMat), 0, 0.04, -0.5, Math.PI / 2);   // 노즐
        [-0.32, -0.46, -0.6].forEach((z) => {
          add(new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.018, 8, 18), accentMat), 0, 0.04, z, 0, 0, 0);
        });
        add(box(0.12, 0.26, 0.13), 0, -0.2, 0.12, 0.3);          // 손잡이
        [-0.1, 0.1].forEach((x) => add(box(0.02, 0.1, 0.4, accentMat), x, 0.04, -0.12));
        muzzleZ = -0.82;
        break;
      }
    }

    // 총구 섬광/플래시 위치 갱신
    muzzleFlash.position.z = muzzleZ;
    gun.userData.flashMesh.position.z = muzzleZ;
    muzzleFlash.color.setHex(w.color);
    gun.userData.flashMesh.material.color.setHex(w.color);
  }

  // ============================================================
  // 좀비
  // ============================================================
  const ZOMBIE_TYPES = {
    normal: { scale: 1.0,  skin: 0x4f9d52, baseHp: 60,  speed: 2.6, damage: 8  },
    big:    { scale: 2.2,  skin: 0x2f7d32, baseHp: 320, speed: 1.7, damage: 18 },
    runner: { scale: 0.9,  skin: 0xc6e84a, baseHp: 32,  speed: 6.4, damage: 6  },
    // 여자 좀비 — 웨이브 10 이후 등장. 데미지는 약하지만 빠르게 달려든다.
    female: { scale: 0.95, skin: 0xd98fb0, baseHp: 40,  speed: 5.0, damage: 4  },
  };

  function makeZombie(type) {
    if (type === true) type = 'big';          // 이전 호출 형태 호환
    else if (type === false || !type) type = 'normal';
    const cfg = ZOMBIE_TYPES[type] || ZOMBIE_TYPES.normal;
    const isBig = type === 'big';
    const isRunner = type === 'runner';
    const isFemale = type === 'female';

    const g = new THREE.Group();
    const skin = cfg.skin;
    const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.85 });

    // 러너는 호리호리하게, 여자 좀비는 약간 슬림, 그 외는 보통 체형
    const tw = isRunner ? 0.5 : (isFemale ? 0.56 : 0.7);   // 몸통 너비
    const td = isRunner ? 0.32 : (isFemale ? 0.34 : 0.4);  // 몸통 두께

    // 몸통
    const torso = new THREE.Mesh(new THREE.BoxGeometry(tw, 1.0, td), skinMat);
    torso.position.y = 1.0;
    if (isRunner) torso.rotation.x = 0.28;   // 앞으로 기울인 돌진 자세
    g.add(torso);

    // 머리 (헤드샷 판정 부위)
    const headSize = isRunner ? 0.42 : (isFemale ? 0.46 : 0.5);
    const head = new THREE.Mesh(new THREE.BoxGeometry(headSize, headSize, headSize), skinMat);
    head.position.y = isRunner ? 1.7 : 1.75;
    if (isRunner) head.position.z = 0.18;
    head.userData.isHead = true;
    g.add(head);

    // 눈 — 러너는 주황빛, 여자 좀비는 분홍빛, 그 외 빨강
    const eyeMat = new THREE.MeshBasicMaterial({ color: isRunner ? 0xff7a1a : (isFemale ? 0xff3a8c : 0xff2222) });
    [-0.13, 0.13].forEach((x) => {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.05), eyeMat);
      eye.position.set(x * (isRunner ? 0.8 : 1), isRunner ? 1.74 : 1.8, isRunner ? 0.4 : 0.26);
      eye.userData.isHead = true;
      g.add(eye);
    });

    // 여자 좀비 전용 — 긴 머리(포니테일)와 치마
    if (isFemale) {
      const hairMat = new THREE.MeshStandardMaterial({ color: 0x3a2233, roughness: 0.95 });
      const hair = new THREE.Mesh(new THREE.BoxGeometry(headSize + 0.08, headSize + 0.12, 0.16), hairMat);
      hair.position.set(0, head.position.y + 0.06, -0.16);
      g.add(hair);
      const pony = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.16), hairMat);
      pony.position.set(0, head.position.y - 0.18, -0.26);
      g.add(pony);
      const dressMat = new THREE.MeshStandardMaterial({ color: 0xc85a9c, roughness: 0.85 });
      const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.52, 0.55, 12), dressMat);
      skirt.position.set(0, 0.66, 0);
      g.add(skirt);
    }

    // 팔 (앞으로 뻗음)
    const armMat = skinMat;
    [-0.45, 0.45].forEach((x) => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.7), armMat);
      arm.position.set(x * (isRunner ? 0.75 : 1), 1.2, isRunner ? 0.5 : 0.4);
      g.add(arm);
    });

    // 다리
    [-0.18, 0.18].forEach((x) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.6, 0.22), skinMat);
      leg.position.set(x, 0.3, 0);
      g.add(leg);
      if (x < 0) g.userData.legL = leg; else g.userData.legR = leg;
    });

    g.scale.setScalar(cfg.scale);

    // 스폰 위치: 플레이어 주변 원형 가장자리
    const ang = Math.random() * Math.PI * 2;
    const dist = 45 + Math.random() * 35;
    g.position.set(
      yawObject.position.x + Math.cos(ang) * dist,
      0,
      yawObject.position.z + Math.sin(ang) * dist
    );
    clamp(g.position);

    // ── 난이도: 웨이브가 오를수록 체력 증가 ──
    const wave = player.wave;
    const hpScale = 1 + (wave - 1) * 0.22 + Math.pow(wave - 1, 1.35) * 0.05;
    const hp = Math.round(cfg.baseHp * hpScale);

    const z = {
      mesh: g,
      hp: hp,
      maxHp: hp,
      type: type,
      isBig: isBig,
      isRunner: isRunner,
      isFemale: isFemale,
      damage: cfg.damage,
      speed: cfg.speed * (0.92 + Math.random() * 0.16) + wave * (isRunner || isFemale ? 0.06 : 0.04),
      attackCd: 0,
      hitFlash: 0,
      walkPhase: Math.random() * Math.PI * 2,
      skinMat: skinMat,
      baseColor: new THREE.Color(skin),
    };
    g.traverse((o) => { o.userData.zombie = z; });
    zombies.push(z);
    scene.add(g);
  }

  // ============================================================
  // 아이템 (무기 업그레이드)
  // ============================================================
  // kind: 'weapon' = 무기 강화(금색 상자), 'score' = 보너스 점수(청록 보석)
  function dropItem(pos, kind) {
    kind = kind || 'weapon';
    const g = new THREE.Group();

    if (kind === 'score') {
      // 청록색 보석 — 점수 보너스
      const mat = new THREE.MeshStandardMaterial({
        color: 0x4ad0ff, emissive: 0x1f8ad0, emissiveIntensity: 0.7, roughness: 0.2, metalness: 0.5,
      });
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), mat);
      g.add(gem);
      const glow = new THREE.PointLight(0x4ad0ff, 1.4, 6);
      glow.position.y = 0.3;
      g.add(glow);
    } else {
      // 금색 상자 — 무기 강화
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffd45e, emissive: 0xffaa00, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.4,
      });
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), mat);
      g.add(box);
      const glow = new THREE.PointLight(0xffcc44, 1.4, 6);
      glow.position.y = 0.3;
      g.add(glow);
    }

    g.position.set(pos.x, 0.9, pos.z);
    scene.add(g);
    items.push({ mesh: g, kind: kind, spin: 0, life: 30 }); // 30초 후 사라짐
  }

  // ============================================================
  // 사격
  // ============================================================
  function fire() {
    const w = WEAPONS[player.weaponLevel];

    Sound.shoot(player.weaponLevel);

    // 총구 섬광 + 반동
    muzzleFlash.intensity = 3.5;
    gun.userData.flashMesh.material.opacity = 0.9;
    gun.position.z = gun.userData.restPos.z + 0.08; // 반동(뒤로)
    gun.rotation.x = -0.12;

    for (let p = 0; p < w.pellets; p++) {
      // 카메라 정면 방향 + 산탄 퍼짐
      camera.getWorldDirection(_dir);
      if (w.spread > 0) {
        _dir.x += (Math.random() - 0.5) * w.spread;
        _dir.y += (Math.random() - 0.5) * w.spread;
        _dir.z += (Math.random() - 0.5) * w.spread;
        _dir.normalize();
      }
      const origin = new THREE.Vector3();
      camera.getWorldPosition(origin);

      raycaster.set(origin, _dir);
      raycaster.far = w.range;

      // 좀비 메쉬들과 교차 검사
      const meshes = zombies.map((z) => z.mesh);
      const hits = raycaster.intersectObjects(meshes, true);

      let hitPoint = _v.copy(origin).addScaledVector(_dir, w.range);
      if (hits.length > 0) {
        const hit = hits[0];
        hitPoint = hit.point.clone();
        const z = hit.object.userData.zombie;
        if (z) {
          // 헤드샷 피해 배율 — 웨이브가 오를수록 줄어 한 방에 죽지 않게 됨
          const isHead = !!hit.object.userData.isHead;
          const headMult = Math.max(1.5, 3.0 - (player.wave - 1) * 0.18);
          const dmg = w.damage * (isHead ? headMult : 1.0);
          if (isHead) { Sound.headshot(); showHeadshot(); }
          const killed = damageZombie(z, dmg, _dir);
          if (!killed && !isHead) Sound.hit();   // 죽으면 사망음, 헤드샷이면 위에서 처리
          hitMarker(isHead);
        }
      }
      addTracer(origin, hitPoint, w.color);
    }
  }

  function damageZombie(z, dmg, dir) {
    z.hp -= dmg;
    z.hitFlash = 0.12;
    // 약간 밀려남
    z.mesh.position.addScaledVector(dir, z.isBig ? 0.05 : 0.18);
    clamp(z.mesh.position);

    if (z.hp <= 0) {
      killZombie(z);
      return true;   // 처치됨
    }
    return false;
  }

  function killZombie(z) {
    const idx = zombies.indexOf(z);
    if (idx === -1) return;
    zombies.splice(idx, 1);
    scene.remove(z.mesh);

    Sound.death();
    player.score += z.isBig ? 50 : 10;
    // 처치 시 약간의 코인 (상점 자금)
    player.coins += z.isBig ? 12 : (z.isRunner ? 3 : 4);

    if (z.isBig) {
      // 20% 무기 강화 아이템, 80% 보너스 점수 아이템
      if (Math.random() < 0.20) {
        dropItem(z.mesh.position, 'weapon');
        showToast('큰 좀비 처치! 무기 강화 아이템 ⚡');
      } else {
        dropItem(z.mesh.position, 'score');
        showToast('큰 좀비 처치! 보너스 점수 보석 💎');
      }
    }
    updateHUD();
  }

  // 총알 궤적
  function addTracer(from, to, color) {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const mat = new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.85 });
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    tracers.push({ line: line, life: 0.06 });
  }

  // ============================================================
  // 무기 업그레이드
  // ============================================================
  function pickUpItem(item) {
    const idx = items.indexOf(item);
    if (idx === -1) return;
    items.splice(idx, 1);
    scene.remove(item.mesh);

    Sound.pickup();

    // 보너스 점수 보석 — 무기는 그대로, 점수만 크게 오른다
    if (item.kind === 'score') {
      const bonus = 100 + player.wave * 10;
      player.score += bonus;
      showToast(`보너스 점수 +${bonus} 💎`);
      updateHUD();
      return;
    }

    if (player.weaponLevel < WEAPONS.length - 1) {
      player.weaponLevel++;
      const w = WEAPONS[player.weaponLevel];
      applyWeaponModel(player.weaponLevel);   // 총 모양 자체가 바뀐다
      showToast(`무기 강화! → ${w.name} ⚡`);
    } else {
      // 이미 최강이면 체력 회복
      player.health = Math.min(player.maxHealth, player.health + 30);
      showToast('체력 회복 +30 ❤️');
    }
    updateHUD();
  }

  // ============================================================
  // 안전 가옥 (휴식 + 보상 상자)
  // ============================================================
  function enterHouse() {
    if (resting) return;
    resting = true;
    restAvailable = false;
    setBuildingGlow(HOUSE, false);   // 들어가면 문이 닫힘

    // 좀비 정리 (집 안은 안전)
    zombies.forEach((z) => scene.remove(z.mesh));
    zombies.length = 0;
    wantFire = false;

    try { document.exitPointerLock(); } catch (e) {}

    dom.houseWave.textContent = player.lastHouseWave;
    dom.rewardText.textContent = '';
    dom.chestBtn.disabled = false;
    dom.house.classList.remove('hidden');
  }

  function openChest() {
    if (dom.chestBtn.disabled) return;
    dom.chestBtn.disabled = true;
    Sound.pickup();

    // 코인: 기본 + 웨이브 보너스 (랜덤)
    const coins = 60 + Math.floor(Math.random() * 141) + player.lastHouseWave * 12;
    player.coins += coins;
    let msg = `💰 코인 +${coins}`;

    // 낮은 확률(10%)로 무기 강화
    if (Math.random() < 0.10 && player.weaponLevel < WEAPONS.length - 1) {
      player.weaponLevel++;
      applyWeaponModel(player.weaponLevel);
      msg += `\n🎉 희귀 무기 획득! → ${WEAPONS[player.weaponLevel].name} ⚡`;
      Sound.headshot();
    } else {
      msg += '\n상점에서 장비를 구매해 보세요!';
    }

    dom.rewardText.textContent = msg;
    updateHUD();
  }

  function leaveHouse() {
    resting = false;
    dom.house.classList.add('hidden');
    // 집 문 앞(밖)으로 이동시켜 즉시 재진입을 막음
    yawObject.position.set(HOUSE.x, 1.6, HOUSE.z + HOUSE.half + 3);
    yawObject.rotation.y = Math.PI;   // 바깥(좀비 쪽)을 바라봄
    pitchObject.rotation.x = 0;
    spawnTimer = 1.2;
    requestLock();
  }

  // ============================================================
  // 상점 (코인으로 특수 장비 구매)
  // ============================================================
  const SHOP_ITEMS = [
    {
      id: 'armor', name: '갑옷 🦺', desc: '받는 피해 -15% (최대 60%)', cost: 120,
      can: () => player.armor < 0.6,
      buy: () => { player.armor = Math.min(0.6, player.armor + 0.15); },
    },
    {
      id: 'shield', name: '방패 🛡️', desc: '보호막 +60 (피해를 먼저 흡수)', cost: 90,
      can: () => true,
      buy: () => { player.maxShield += 60; player.shield = player.maxShield; },
    },
    {
      id: 'medkit', name: '구급상자 ❤️', desc: '체력을 최대치까지 회복', cost: 70,
      can: () => player.health < player.maxHealth,
      buy: () => { player.health = player.maxHealth; },
    },
    {
      id: 'boots', name: '신속 부츠 👟', desc: '이동 속도 +12% (최대 +48%)', cost: 100,
      can: () => player.speedMul < 1.479,
      buy: () => { player.speedMul = Math.min(1.48, player.speedMul + 0.12); applySpeed(); },
    },
    {
      id: 'maxhp', name: '체력 강화 💪', desc: '최대 체력 +25', cost: 140,
      can: () => player.maxHealth < 250,
      buy: () => { player.maxHealth += 25; player.health += 25; },
    },
    {
      id: 'weapon', name: '무기 강화 ⚡', desc: '다음 등급 무기로 업그레이드', cost: 220,
      can: () => player.weaponLevel < WEAPONS.length - 1,
      buy: () => { player.weaponLevel++; applyWeaponModel(player.weaponLevel); },
    },
  ];

  // 구매할수록 가격이 오른다 (재구매 가능 아이템)
  function itemCost(it) {
    const n = player.bought[it.id] || 0;
    return Math.round(it.cost * (1 + 0.5 * n));
  }

  function enterShop() {
    if (shopping) return;
    shopping = true;
    shopAvailable = false;
    setBuildingGlow(SHOP, false);   // 들어가면 문이 닫힘

    zombies.forEach((z) => scene.remove(z.mesh));
    zombies.length = 0;
    wantFire = false;

    try { document.exitPointerLock(); } catch (e) {}

    dom.shopMsg.textContent = '';
    renderShop();
    dom.shop.classList.remove('hidden');
  }

  function renderShop() {
    dom.shopCoins.textContent = player.coins;
    dom.shopItems.innerHTML = '';
    SHOP_ITEMS.forEach((it) => {
      const cost = itemCost(it);
      const maxed = !it.can();
      const affordable = player.coins >= cost && !maxed;

      const row = document.createElement('div');
      row.className = 'shop-item';

      const info = document.createElement('div');
      info.className = 'info';
      info.innerHTML = `<div class="nm">${it.name}</div><div class="ds">${it.desc}</div>`;

      const btn = document.createElement('button');
      btn.textContent = maxed ? '최대' : `💰 ${cost}`;
      btn.disabled = !affordable;
      btn.addEventListener('click', () => buyItem(it));

      row.appendChild(info);
      row.appendChild(btn);
      dom.shopItems.appendChild(row);
    });
  }

  function buyItem(it) {
    const cost = itemCost(it);
    if (player.coins < cost || !it.can()) return;
    player.coins -= cost;
    player.bought[it.id] = (player.bought[it.id] || 0) + 1;
    it.buy();
    Sound.buy();
    dom.shopMsg.textContent = `${it.name} 구매 완료!`;
    updateHUD();
    renderShop();
  }

  function leaveShop() {
    shopping = false;
    dom.shop.classList.add('hidden');
    player.invuln = 30;   // 상점에서 나가면 30초 무적
    // 상점 문 앞(밖)으로 이동
    yawObject.position.set(SHOP.x, 1.6, SHOP.z + SHOP.half + 3);
    yawObject.rotation.y = Math.PI;
    pitchObject.rotation.x = 0;
    spawnTimer = 1.2;
    requestLock();
  }

  // ============================================================
  // 루프
  // ============================================================
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);

    if (running && !gameOver && !resting && !shopping) {
      updatePlayer(dt);
      updateBuffs(dt);
      updateZombies(dt);
      updateItems(dt);
      updateSpawning(dt);
      updateShooting(dt);
    }
    updateEffects(dt);
    updateMinimap();

    renderer.render(scene, camera);
  }

  // ---------- 미니맵 ----------
  const miniCanvas = document.getElementById('minimapCanvas');
  const miniCtx = miniCanvas ? miniCanvas.getContext('2d') : null;

  function updateMinimap() {
    if (!miniCtx) return;
    const W = miniCanvas.width, H = miniCanvas.height;
    const ctx = miniCtx;
    const span = MAP_SIZE * 2;
    const toX = (x) => (x + MAP_SIZE) / span * W;
    const toY = (z) => (z + MAP_SIZE) / span * H;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(14, 18, 26, 0.9)';
    ctx.fillRect(0, 0, W, H);

    // 건물 (열려 있으면 밝게)
    const drawBldg = (b, openCol, dimCol, available) => {
      ctx.fillStyle = available ? openCol : dimCol;
      ctx.fillRect(toX(b.x - b.half), toY(b.z - b.half),
                   (b.half * 2) / span * W, (b.half * 2) / span * H);
    };
    drawBldg(HOUSE, '#46ff8c', 'rgba(70, 150, 90, 0.55)', restAvailable);
    drawBldg(SHOP, '#4ad0ff', 'rgba(70, 120, 180, 0.55)', shopAvailable);

    // 좀비
    for (const z of zombies) {
      const m = z.mesh;
      ctx.beginPath();
      ctx.arc(toX(m.position.x), toY(m.position.z), z.isBig ? 4 : 2.2, 0, Math.PI * 2);
      ctx.fillStyle = z.isBig ? '#ff8a3b'
                    : z.isRunner ? '#c6e84a'
                    : z.isFemale ? '#ff7ac0'
                    : '#ff4d4d';
      ctx.fill();
    }

    // 아이템
    for (const it of items) {
      ctx.beginPath();
      ctx.arc(toX(it.mesh.position.x), toY(it.mesh.position.z), 2.4, 0, Math.PI * 2);
      ctx.fillStyle = it.kind === 'score' ? '#4ad0ff' : '#ffd45e';
      ctx.fill();
    }

    // 플레이어 (바라보는 방향을 가리키는 삼각형)
    camera.getWorldDirection(_dir);
    let ux = _dir.x, uz = _dir.z;
    const len = Math.hypot(ux, uz) || 1;
    ux /= len; uz /= len;
    const pxv = -uz, pzv = ux;           // 수직 벡터
    const px = toX(yawObject.position.x), py = toY(yawObject.position.z);
    const s = 6;
    ctx.beginPath();
    ctx.moveTo(px + ux * s, py + uz * s);
    ctx.lineTo(px - ux * s * 0.7 + pxv * s * 0.6, py - uz * s * 0.7 + pzv * s * 0.6);
    ctx.lineTo(px - ux * s * 0.7 - pxv * s * 0.6, py - uz * s * 0.7 - pzv * s * 0.6);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function updatePlayer(dt) {
    const speed = (keys['ShiftLeft'] || keys['ShiftRight']) ? player.sprint : player.speed;

    // 입력 → 이동 방향 (yaw 기준)
    let mx = 0, mz = 0;
    if (keys['KeyW']) mz -= 1;
    if (keys['KeyS']) mz += 1;
    if (keys['KeyA']) mx -= 1;
    if (keys['KeyD']) mx += 1;

    if (mx !== 0 || mz !== 0) {
      const len = Math.hypot(mx, mz);
      mx /= len; mz /= len;
      const sin = Math.sin(yawObject.rotation.y);
      const cos = Math.cos(yawObject.rotation.y);
      const wx = mx * cos + mz * sin;
      const wz = -mx * sin + mz * cos;
      yawObject.position.x += wx * speed * dt;
      yawObject.position.z += wz * speed * dt;
      clamp(yawObject.position);
      resolveObstacles(yawObject.position, player.radius);

      // 걷기 흔들림(뷰 보빙)
      bob += dt * speed * 1.6;
      camera.position.y = Math.sin(bob) * 0.04;
      camera.position.x = Math.cos(bob * 0.5) * 0.03;
    } else {
      camera.position.x += (0 - camera.position.x) * Math.min(1, dt * 8);
      camera.position.y += (0 - camera.position.y) * Math.min(1, dt * 8);
    }

    // 문이 열린 안전가옥/상점 안으로 들어오면 입장
    if (restAvailable && !resting && insideBuilding(HOUSE, 0.8)) enterHouse();
    if (shopAvailable && !shopping && insideBuilding(SHOP, 0.8)) enterShop();
  }
  let bob = 0;

  // 무적 시간 등 버프 갱신
  function updateBuffs(dt) {
    if (player.invuln > 0) {
      player.invuln = Math.max(0, player.invuln - dt);
      dom.shieldTimer.textContent = `🛡️ 상점 보호막 ${Math.ceil(player.invuln)}초`;
      dom.shieldTimer.classList.add('show');
      if (player.invuln === 0) dom.shieldTimer.classList.remove('show');
    } else if (dom.shieldTimer.classList.contains('show')) {
      dom.shieldTimer.classList.remove('show');
    }
  }

  function updateZombies(dt) {
    const px = yawObject.position.x;
    const pz = yawObject.position.z;
    const safe = isPlayerSafe();

    for (const z of zombies) {
      const m = z.mesh;
      const dx = px - m.position.x;
      const dz = pz - m.position.z;
      const distXZ = Math.hypot(dx, dz);

      // 플레이어 바라보기
      m.rotation.y = Math.atan2(dx, dz);

      const reach = (z.isBig ? 2.0 : 1.2);
      if (distXZ > reach) {
        // 접근
        m.position.x += (dx / distXZ) * z.speed * dt;
        m.position.z += (dz / distXZ) * z.speed * dt;
        resolveObstacles(m.position, z.isBig ? 0.9 : (z.isRunner ? 0.35 : 0.45));
        // 다리 흔들기
        z.walkPhase += dt * z.speed * 2.2;
        const sw = Math.sin(z.walkPhase) * 0.5;
        if (z.mesh.userData.legL) z.mesh.userData.legL.rotation.x = sw;
        if (z.mesh.userData.legR) z.mesh.userData.legR.rotation.x = -sw;
      } else if (!safe) {
        // 공격 (플레이어가 안전 지대에 있으면 공격 불가)
        z.attackCd -= dt;
        if (z.attackCd <= 0) {
          z.attackCd = z.isRunner ? 0.7 : (z.isFemale ? 0.8 : 1.0);   // 러너·여자 좀비는 더 빠르게 할퀸다
          damagePlayer(z.damage);
        }
      }

      // 피격 점멸
      if (z.hitFlash > 0) {
        z.hitFlash -= dt;
        z.skinMat.color.setHex(0xffffff);
      } else {
        z.skinMat.color.copy(z.baseColor);
      }
    }
  }

  function updateItems(dt) {
    const px = yawObject.position.x;
    const pz = yawObject.position.z;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      it.spin += dt * 2;
      it.mesh.rotation.y = it.spin;
      it.mesh.position.y = 0.9 + Math.sin(it.spin * 1.5) * 0.15;
      it.life -= dt;

      const d = Math.hypot(px - it.mesh.position.x, pz - it.mesh.position.z);
      if (d < 1.6) {
        pickUpItem(it);
      } else if (it.life <= 0) {
        items.splice(i, 1);
        scene.remove(it.mesh);
      }
    }
  }

  function updateSpawning(dt) {
    // 웨이브 진행: 시간이 지날수록 더 자주, 더 많이
    waveTimer += dt;
    if (waveTimer > 22) {
      waveTimer = 0;
      player.wave++;
      spawnInterval = Math.max(0.7, spawnInterval - 0.18);

      const cleared = player.wave - 1;
      let announced = false;
      // 3웨이브마다 안전가옥 개방
      if (cleared % 3 === 0) {
        restAvailable = true;
        player.lastHouseWave = cleared;
        setBuildingGlow(HOUSE, true);
        showToast(`${cleared}웨이브 클리어! 🏠 안전가옥 문이 열렸어요`);
        announced = true;
      }
      // 5웨이브마다 상점 개방
      if (cleared % 5 === 0) {
        shopAvailable = true;
        player.lastShopWave = cleared;
        setBuildingGlow(SHOP, true);
        showToast(`${cleared}웨이브 클리어! 🛒 상점이 열렸어요 (코인으로 구매)`);
        announced = true;
      }
      if (!announced) showToast(`웨이브 ${player.wave} 시작!`);
      updateHUD();
    }

    spawnTimer -= dt;
    if (spawnTimer <= 0 && zombies.length < 28) {
      spawnTimer = spawnInterval;
      makeZombie(pickZombieType());
      // 가끔 한 번에 둘
      if (player.wave > 2 && Math.random() < 0.4) makeZombie(pickZombieType());
    }
  }

  // 웨이브에 따라 좀비 종류를 확률적으로 결정
  function pickZombieType() {
    const wave = player.wave;
    const bigChance = Math.min(0.30, 0.06 + wave * 0.025);
    const runnerChance = wave < 2 ? 0 : Math.min(0.45, 0.12 + (wave - 1) * 0.04);
    // 여자 좀비는 웨이브 10 초과부터 등장
    const femaleChance = wave <= 10 ? 0 : Math.min(0.35, (wave - 10) * 0.05);
    const r = Math.random();
    let acc = bigChance;
    if (r < acc) return 'big';
    acc += femaleChance;
    if (r < acc) return 'female';
    acc += runnerChance;
    if (r < acc) return 'runner';
    return 'normal';
  }

  function updateShooting(dt) {
    fireCooldown -= dt;
    const w = WEAPONS[player.weaponLevel];
    if (wantFire && locked && fireCooldown <= 0) {
      fire();
      fireCooldown = w.fireRate;
      if (!w.auto) wantFire = false; // 비자동은 한 발씩
    }
  }

  function updateEffects(dt) {
    // 총구 섬광 감쇠
    if (muzzleFlash.intensity > 0) {
      muzzleFlash.intensity = Math.max(0, muzzleFlash.intensity - dt * 30);
      const fm = gun.userData.flashMesh.material;
      fm.opacity = Math.max(0, fm.opacity - dt * 9);
    }
    // 총 반동 복귀
    gun.position.z += (gun.userData.restPos.z - gun.position.z) * Math.min(1, dt * 12);
    gun.rotation.x += (0 - gun.rotation.x) * Math.min(1, dt * 12);

    // 플라즈마건 에너지 코어 맥동
    if (gun.userData.core) {
      const s = 1 + Math.sin(clock.elapsedTime * 6) * 0.18;
      gun.userData.core.scale.setScalar(s);
      gun.userData.accent.emissiveIntensity = 0.35 + Math.sin(clock.elapsedTime * 6) * 0.25;
    }
    // 미니건 배럴 회전 (사격 중엔 빠르게)
    if (gun.userData.barrels) {
      gun.userData.barrels.rotation.z += dt * (muzzleFlash.intensity > 0 ? 40 : 4);
    }

    // 안전가옥/상점 문 슬라이드
    [HOUSE, SHOP].forEach((b) => {
      if (!b.door) return;
      const target = b.open ? b.door.userData.openY : b.door.userData.closedY;
      b.door.position.y += (target - b.door.position.y) * Math.min(1, dt * 6);
    });

    // 궤적 페이드
    for (let i = tracers.length - 1; i >= 0; i--) {
      const t = tracers[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.06) * 0.85;
      if (t.life <= 0) {
        scene.remove(t.line);
        t.line.geometry.dispose();
        t.line.material.dispose();
        tracers.splice(i, 1);
      }
    }
  }

  // ============================================================
  // 플레이어 피해 / HUD
  // ============================================================
  function damagePlayer(dmg) {
    if (gameOver) return;
    if (isPlayerSafe()) return;        // 안전 지대 / 상점 무적 중

    // 갑옷으로 피해 경감
    dmg *= (1 - player.armor);

    // 방패가 먼저 흡수
    if (player.shield > 0) {
      const absorbed = Math.min(player.shield, dmg);
      player.shield -= absorbed;
      dmg -= absorbed;
    }

    if (dmg > 0) {
      player.health -= dmg;
      flashDamage();
    }

    if (player.health <= 0) {
      player.health = 0;
      endGame();
    }
    updateHUD();
  }

  function flashDamage() {
    dom.damageFlash.classList.add('hit');
    setTimeout(() => dom.damageFlash.classList.remove('hit'), 90);
  }

  // 헤드샷 팝업 (연속 헤드샷에도 매번 다시 튀도록 애니메이션 재시작)
  const _headshotEl = document.getElementById('headshot');
  function showHeadshot() {
    _headshotEl.classList.remove('show');
    void _headshotEl.offsetWidth;   // 리플로우 강제 → 애니메이션 리셋
    _headshotEl.classList.add('show');
  }

  // 명중 시 조준점 색 점멸 (헤드샷=금색, 그 외=빨강)
  let hmTimer = null;
  const _chSpans = document.querySelectorAll('#crosshair .ch');
  function hitMarker(isHead) {
    const col = isHead ? 'rgba(255,210,74,0.95)' : 'rgba(255,90,90,0.95)';
    _chSpans.forEach((s) => { s.style.background = col; });
    clearTimeout(hmTimer);
    hmTimer = setTimeout(() => {
      _chSpans.forEach((s) => { s.style.background = 'rgba(255,255,255,0.85)'; });
    }, 110);
  }

  let toastTimer = null;
  function showToast(msg) {
    dom.toast.textContent = msg;
    dom.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dom.toast.classList.remove('show'), 1600);
  }

  function updateHUD() {
    const pct = Math.max(0, player.health) / player.maxHealth * 100;
    dom.healthFill.style.width = pct + '%';
    dom.healthText.textContent = Math.max(0, Math.round(player.health));
    dom.weaponName.textContent = WEAPONS[player.weaponLevel].name;
    dom.score.textContent = player.score;
    dom.wave.textContent = player.wave;
    dom.coins.textContent = player.coins;
    dom.defense.textContent = `🛡️${Math.round(player.shield)} · 🦺${Math.round(player.armor * 100)}%`;
  }

  // ============================================================
  // 게임 흐름
  // ============================================================
  function requestLock() {
    try {
      const p = renderer.domElement.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* 포인터 락 불가 — 게임은 계속 진행 */ }
  }

  function applySpeed() {
    player.speed = BASE_SPEED * player.speedMul;
    player.sprint = BASE_SPRINT * player.speedMul;
  }

  function startGame() {
    Sound.init();        // 오디오는 사용자 클릭 시점에 생성/재개해야 함
    Sound.resume();
    dom.overlay.classList.add('hidden');
    resetState();
    running = true;
    requestLock();
  }

  function restartGame() {
    Sound.init();
    Sound.resume();
    dom.gameover.classList.add('hidden');
    resetState();
    running = true;
    requestLock();
  }

  function resetState() {
    // 좀비/아이템/궤적 정리
    zombies.forEach((z) => scene.remove(z.mesh));
    items.forEach((it) => scene.remove(it.mesh));
    tracers.forEach((t) => scene.remove(t.line));
    zombies.length = 0;
    items.length = 0;
    tracers.length = 0;

    player.health = 100;
    player.maxHealth = 100;
    player.speedMul = 1;
    applySpeed();
    player.weaponLevel = 0;
    player.score = 0;
    player.wave = 1;
    player.coins = 0;
    player.armor = 0;
    player.shield = 0;
    player.maxShield = 0;
    player.invuln = 0;
    player.bought = {};
    player.lastHouseWave = 0;
    player.lastShopWave = 0;

    restAvailable = false;
    resting = false;
    shopAvailable = false;
    shopping = false;
    dom.house.classList.add('hidden');
    dom.shop.classList.add('hidden');
    dom.shieldTimer.classList.remove('show');
    setBuildingGlow(HOUSE, false);
    setBuildingGlow(SHOP, false);
    applyWeaponModel(0);   // 총 모양을 기본 피스톨로 되돌림

    yawObject.position.set(0, 1.6, 0);
    yawObject.rotation.y = 0;
    pitchObject.rotation.x = 0;

    spawnTimer = 0.5;
    spawnInterval = 2.2;
    waveTimer = 0;
    fireCooldown = 0;
    wantFire = false;
    gameOver = false;

    updateHUD();
  }

  function endGame() {
    gameOver = true;
    running = false;
    document.exitPointerLock();
    dom.finalScore.textContent = player.score;
    dom.finalWave.textContent = player.wave;
    dom.finalCoins.textContent = player.coins;
    dom.gameover.classList.remove('hidden');
  }

  // ============================================================
  // 입력 / 유틸
  // ============================================================
  function onMouseMove(e) {
    if (!locked) return;
    const sens = 0.0022;
    yawObject.rotation.y -= e.movementX * sens;
    pitchObject.rotation.x -= e.movementY * sens;
    const limit = Math.PI / 2 - 0.05;
    pitchObject.rotation.x = Math.max(-limit, Math.min(limit, pitchObject.rotation.x));
  }

  function onPointerLockChange() {
    locked = (document.pointerLockElement === renderer.domElement);
    if (!locked) wantFire = false;
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // 맵 경계 안으로 가두기
  function clamp(pos) {
    const lim = MAP_SIZE - 2;
    pos.x = Math.max(-lim, Math.min(lim, pos.x));
    pos.z = Math.max(-lim, Math.min(lim, pos.z));
  }

  // 시작
  init();
})();
