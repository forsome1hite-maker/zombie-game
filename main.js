/* =========================================================
   좀비 슈팅 게임 — 1인칭 FPS (Three.js)
   - WASD 이동 / 마우스 시점 / 클릭 사격
   - 큰 좀비 처치 시 아이템 드롭 → 획득 시 무기 업그레이드
   ========================================================= */

(() => {
  'use strict';

  // ---------- 무기 정의 ----------
  // level이 오를수록 강해진다. 아이템을 먹으면 level이 1씩 올라감.
  const WEAPONS = [
    { name: '피스톨',   damage: 26,  fireRate: 0.34, pellets: 1, spread: 0.0,  range: 60, color: 0xffd45e, auto: false },
    { name: 'SMG',      damage: 20,  fireRate: 0.10, pellets: 1, spread: 0.02, range: 60, color: 0x7ef0ff, auto: true  },
    { name: '샷건',     damage: 16,  fireRate: 0.62, pellets: 7, spread: 0.10, range: 40, color: 0xff8a3b, auto: false },
    { name: '라이플',   damage: 70,  fireRate: 0.16, pellets: 1, spread: 0.01, range: 90, color: 0x9b7bff, auto: true  },
    { name: '플라즈마건', damage: 130, fireRate: 0.12, pellets: 1, spread: 0.0,  range: 100, color: 0x5effa0, auto: true  },
  ];

  // ---------- 전역 상태 ----------
  let scene, camera, renderer, clock;
  let yawObject, pitchObject;            // 카메라 회전용
  let gun, muzzleFlash;                  // 손에 든 총 + 총구 섬광
  const zombies = [];
  const items = [];
  const tracers = [];                    // 총알 궤적

  const keys = {};
  let locked = false;
  let running = false;
  let gameOver = false;

  const player = {
    health: 100,
    maxHealth: 100,
    speed: 6.2,
    sprint: 9.5,
    radius: 0.5,
    weaponLevel: 0,
    score: 0,
    wave: 1,
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
    finalScore: el('finalScore'),
    finalWave: el('finalWave'),
    toast: el('toast'),
    damageFlash: el('damageFlash'),
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

    // 흩어진 상자(엄폐물 겸 분위기)
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
      c.rotation.y = Math.random() * Math.PI;
      scene.add(c);
    }
  }

  // ---------- 총 모델 ----------
  function buildGun() {
    gun = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.5, metalness: 0.6 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xffd45e, roughness: 0.4, metalness: 0.3 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.5), bodyMat);
    body.position.set(0, 0, -0.1);
    gun.add(body);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 12), bodyMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.4);
    gun.add(barrel);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.12), bodyMat);
    grip.position.set(0, -0.16, 0.05);
    grip.rotation.x = 0.3;
    gun.add(grip);

    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.08), accentMat);
    sight.position.set(0, 0.12, -0.05);
    gun.add(sight);
    gun.userData.accent = accentMat; // 무기별 색 변경용

    // 총구 섬광
    muzzleFlash = new THREE.PointLight(0xffcc66, 0, 8);
    muzzleFlash.position.set(0, 0.02, -0.7);
    gun.add(muzzleFlash);

    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0 });
    const flashMesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), flashMat);
    flashMesh.position.set(0, 0.02, -0.7);
    gun.add(flashMesh);
    gun.userData.flashMesh = flashMesh;

    // 화면 우하단에 배치, 카메라에 부착
    gun.position.set(0.22, -0.2, -0.45);
    gun.userData.restPos = gun.position.clone();
    camera.add(gun);
  }

  // ============================================================
  // 좀비
  // ============================================================
  function makeZombie(isBig) {
    const g = new THREE.Group();
    const scale = isBig ? 2.2 : 1;
    const skin = isBig ? 0x2f7d32 : 0x4f9d52;
    const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.85 });

    // 몸통
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.4), skinMat);
    torso.position.y = 1.0;
    g.add(torso);

    // 머리
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), skinMat);
    head.position.y = 1.75;
    g.add(head);

    // 눈 (빨간색)
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
    [-0.13, 0.13].forEach((x) => {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.05), eyeMat);
      eye.position.set(x, 1.8, 0.26);
      g.add(eye);
    });

    // 팔 (앞으로 뻗음)
    const armMat = skinMat;
    [-0.45, 0.45].forEach((x) => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.7), armMat);
      arm.position.set(x, 1.2, 0.4);
      g.add(arm);
    });

    // 다리
    [-0.18, 0.18].forEach((x) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.6, 0.22), skinMat);
      leg.position.set(x, 0.3, 0);
      g.add(leg);
      if (x < 0) g.userData.legL = leg; else g.userData.legR = leg;
    });

    g.scale.setScalar(scale);

    // 스폰 위치: 플레이어 주변 원형 가장자리
    const ang = Math.random() * Math.PI * 2;
    const dist = 45 + Math.random() * 35;
    g.position.set(
      yawObject.position.x + Math.cos(ang) * dist,
      0,
      yawObject.position.z + Math.sin(ang) * dist
    );
    clamp(g.position);

    const baseHp = isBig ? 320 : 60;
    const z = {
      mesh: g,
      hp: baseHp + (player.wave - 1) * (isBig ? 50 : 12),
      maxHp: baseHp + (player.wave - 1) * (isBig ? 50 : 12),
      isBig: isBig,
      speed: (isBig ? 1.7 : 2.6) + Math.random() * 0.6 + player.wave * 0.04,
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
  function dropItem(pos) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffd45e, emissive: 0xffaa00, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.4,
    });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), mat);
    g.add(box);
    // 빛나는 후광
    const glow = new THREE.PointLight(0xffcc44, 1.4, 6);
    glow.position.y = 0.3;
    g.add(glow);

    g.position.set(pos.x, 0.9, pos.z);
    scene.add(g);
    items.push({ mesh: g, spin: 0, life: 30 }); // 30초 후 사라짐
  }

  // ============================================================
  // 사격
  // ============================================================
  function fire() {
    const w = WEAPONS[player.weaponLevel];

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
        if (z) damageZombie(z, w.damage, _dir);
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

    if (z.hp <= 0) killZombie(z);
  }

  function killZombie(z) {
    const idx = zombies.indexOf(z);
    if (idx === -1) return;
    zombies.splice(idx, 1);
    scene.remove(z.mesh);

    player.score += z.isBig ? 50 : 10;

    if (z.isBig) {
      dropItem(z.mesh.position);
      showToast('큰 좀비 처치! 아이템 드롭 💎');
    }
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

    if (player.weaponLevel < WEAPONS.length - 1) {
      player.weaponLevel++;
      const w = WEAPONS[player.weaponLevel];
      gun.userData.accent.color.setHex(w.color);
      muzzleFlash.color.setHex(w.color);
      showToast(`무기 강화! → ${w.name} ⚡`);
    } else {
      // 이미 최강이면 체력 회복
      player.health = Math.min(player.maxHealth, player.health + 30);
      showToast('체력 회복 +30 ❤️');
    }
    updateHUD();
  }

  // ============================================================
  // 루프
  // ============================================================
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);

    if (running && !gameOver) {
      updatePlayer(dt);
      updateZombies(dt);
      updateItems(dt);
      updateSpawning(dt);
      updateShooting(dt);
    }
    updateEffects(dt);

    renderer.render(scene, camera);
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
      // 로컬 → 월드
      const wx = mx * cos - mz * sin;
      const wz = mx * sin + mz * cos;
      yawObject.position.x += wx * speed * dt;
      yawObject.position.z += wz * speed * dt;
      clamp(yawObject.position);

      // 걷기 흔들림(뷰 보빙)
      bob += dt * speed * 1.6;
      camera.position.y = Math.sin(bob) * 0.04;
      camera.position.x = Math.cos(bob * 0.5) * 0.03;
    } else {
      // 멈추면 흔들림을 중앙으로 복귀
      camera.position.x += (0 - camera.position.x) * Math.min(1, dt * 8);
      camera.position.y += (0 - camera.position.y) * Math.min(1, dt * 8);
    }
  }
  let bob = 0;

  function updateZombies(dt) {
    const px = yawObject.position.x;
    const pz = yawObject.position.z;

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
        // 다리 흔들기
        z.walkPhase += dt * z.speed * 2.2;
        const sw = Math.sin(z.walkPhase) * 0.5;
        if (z.mesh.userData.legL) z.mesh.userData.legL.rotation.x = sw;
        if (z.mesh.userData.legR) z.mesh.userData.legR.rotation.x = -sw;
      } else {
        // 공격
        z.attackCd -= dt;
        if (z.attackCd <= 0) {
          z.attackCd = 1.0;
          damagePlayer(z.isBig ? 18 : 8);
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
      showToast(`웨이브 ${player.wave} 시작!`);
      updateHUD();
    }

    spawnTimer -= dt;
    if (spawnTimer <= 0 && zombies.length < 28) {
      spawnTimer = spawnInterval;
      // 웨이브가 오를수록 큰 좀비 확률 증가
      const bigChance = Math.min(0.35, 0.08 + player.wave * 0.03);
      makeZombie(Math.random() < bigChance);
      // 가끔 한 번에 둘
      if (player.wave > 2 && Math.random() < 0.4) makeZombie(false);
    }
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
    player.health -= dmg;
    flashDamage();
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
  }

  // ============================================================
  // 게임 흐름
  // ============================================================
  function startGame() {
    dom.overlay.classList.add('hidden');
    renderer.domElement.requestPointerLock();
    resetState();
    running = true;
  }

  function restartGame() {
    dom.gameover.classList.add('hidden');
    renderer.domElement.requestPointerLock();
    resetState();
    running = true;
  }

  function resetState() {
    // 좀비/아이템/궤적 정리
    zombies.forEach((z) => scene.remove(z.mesh));
    items.forEach((it) => scene.remove(it.mesh));
    tracers.forEach((t) => scene.remove(t.line));
    zombies.length = 0;
    items.length = 0;
    tracers.length = 0;

    player.health = player.maxHealth;
    player.weaponLevel = 0;
    player.score = 0;
    player.wave = 1;
    gun.userData.accent.color.setHex(WEAPONS[0].color);
    muzzleFlash.color.setHex(WEAPONS[0].color);

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
    // 위아래 시점 제한
    const limit = Math.PI / 2 - 0.05;
    pitchObject.rotation.x = Math.max(-limit, Math.min(limit, pitchObject.rotation.x));
  }

  function onPointerLockChange() {
    locked = (document.pointerLockElement === renderer.domElement);
    // 잠금이 풀리면(예: ESC) 게임 진행 중이면 자동 일시정지 느낌으로 사격만 멈춤
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
