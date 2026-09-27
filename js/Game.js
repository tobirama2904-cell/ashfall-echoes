// @ts-nocheck
// -----------------------------------------------------------------------------
// ASHFALL: ECHOES OF THE BEACON
// A self-contained playable vertical slice built on ArcEngine / Babylon.js.
// The setting and characters are original: Mira must reactivate a beacon in a
// valley where the creatures called the Hush can track loud movement.
// -----------------------------------------------------------------------------

class Game {
    /** @param {{ location: Location3D, camera: CameraController }} app */
    constructor(app) {
        this.app = app;
        this.location = app.location;
        this.view = app.location.view;
        this.scene = this.view.scene;
        this.terrain = app.location.terrain;
        this.canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('world3d'));
        this.clock = 0;
        this.serial = 0;
        this.started = false;
        this.completed = false;
        this.paused = false;
        this.muted = false;
        this.keys = new Set();
        this.touchMove = { x: 0, y: 0 };
        this.touchSprinting = false;
        this.touchCrouching = false;
        this.touchLook = null;
        this.drag = null;
        this.dialogue = null;
        this.toastUntil = 0;
        this.dangerUntil = 0;
        this.timeline = [];
        this.storyFlags = new Set();
        this.obstacles = [];
        this.cells = [];
        this.notes = [];
        this.caches = [];
        this.enemies = [];
        this.lureObjects = [];
        this.ash = [];
        this.mist = [];
        this.pulseWaves = [];
        this.railItems = [];
        this.sleeperItems = [];
        this.treeItems = [];
        this.interactables = [];
        this.currentInteraction = null;
        this.materials = this.createMaterials();
        this.health = 1;
        this.stamina = 1;
        this.noise = 0;
        this.pulseReadyAt = 0;
        this.lureReadyAt = 0;
        this.lures = 2;
        this.cellsCollected = 0;
        this.stepAt = 0;
        this.hurtAt = 0;
        this.player = { x: 338, y: 1770, heading: -0.7, h: 0 };
        this.startPoint = { x: 338, y: 1770 };
        this.objective = 'Выйдите к старому пути';
        this.heroRecord = this.location.findByTag('player')[0] || null;
        this.heroReady = false;
        this.beaconActive = false;

        this.configureCamera();
        this.buildWorld();
        this.bindPresentation();
        this.bindInput();
        this.bindTouchControls();
        this.prepareHero();
        this.updateHud();

        // The scene is attractive even under the title card: a small promise of the world.
        this.emitToast('ПРОЛОГ · ТИХАЯ ДОЛИНА', 8);
    }

    // -------------------------------------------------------------------------
    // Boot, title screen and input
    // -------------------------------------------------------------------------

    configureCamera() {
        const camera = this.app.camera;
        // ArcEngine's editor camera is excellent for authoring, but the game owns WASD.
        camera.detach();
        camera.follow(this.player);
        camera.home();
        // A close, low shoulder camera: readable threats ahead without losing the map route.
        camera.pitch = 0.78;
        camera.zoom = camera.zoomTarget = 1.38;
    }

    bindPresentation() {
        this.titleScreen = document.getElementById('title-screen');
        this.titleContent = document.querySelector('.title-content');
        this.startButton = document.getElementById('start-game');
        this.muteButton = document.getElementById('mute-game');
        if (this.startButton) this.startButton.addEventListener('click', () => this.start());
        if (this.muteButton) this.muteButton.addEventListener('click', () => this.toggleMute());
    }

    bindInput() {
        const movement = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'KeyC', 'KeyQ', 'KeyF', 'KeyE', 'Escape']);
        window.addEventListener('keydown', (event) => {
            if (movement.has(event.code)) event.preventDefault();
            this.keys.add(event.code);
            if (!this.started || event.repeat) return;
            if (event.code === 'KeyE') this.interact();
            if (event.code === 'KeyQ') this.pulse();
            if (event.code === 'KeyF') this.throwLure();
            if (event.code === 'Escape') this.togglePause();
        });
        window.addEventListener('keyup', event => this.keys.delete(event.code));
        window.addEventListener('blur', () => this.keys.clear());

        this.canvas.addEventListener('pointerdown', (event) => {
            if (event.button !== 2 || !this.started) return;
            this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
            try { this.canvas.setPointerCapture(event.pointerId); } catch (_) { /* browser may reject synthetic pointers */ }
        });
        this.canvas.addEventListener('pointermove', (event) => {
            if (!this.drag || this.drag.id !== event.pointerId) return;
            const dx = event.clientX - this.drag.x;
            const dy = event.clientY - this.drag.y;
            this.drag.x = event.clientX;
            this.drag.y = event.clientY;
            const camera = this.app.camera;
            camera.azimuth += dx * ASHFALL_CAMERA_DRAG;
            camera.pitch = Math.max(0.57, Math.min(1.3, camera.pitch + dy * ASHFALL_CAMERA_DRAG));
        });
        const endDrag = event => {
            if (this.drag && this.drag.id === event.pointerId) this.drag = null;
        };
        this.canvas.addEventListener('pointerup', endDrag);
        this.canvas.addEventListener('pointercancel', endDrag);
        this.canvas.addEventListener('wheel', (event) => {
            if (!this.started) return;
            event.preventDefault();
            const camera = this.app.camera;
            const next = camera.zoomTarget * (event.deltaY > 0 ? 0.92 : 1.08);
            camera.zoomTarget = Math.max(0.76, Math.min(1.46, next));
        }, { passive: false });
    }

    bindTouchControls() {
        const coarsePointer = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
        if (!(IS_MOBILE || coarsePointer)) return;
        const controls = document.getElementById('touch-controls');
        const movePad = document.getElementById('touch-move');
        const stick = document.getElementById('touch-stick');
        const lookZone = document.getElementById('touch-look-zone');
        if (!controls || !movePad || !stick || !lookZone) return;
        controls.classList.add('is-active');
        controls.setAttribute('aria-hidden', 'false');
        let movePointer = null;
        const releaseMove = () => {
            movePointer = null;
            this.touchMove.x = 0;
            this.touchMove.y = 0;
            stick.style.transform = 'translate(0, 0)';
        };
        const readMove = (event) => {
            const box = movePad.getBoundingClientRect();
            const limit = box.width * .32;
            let dx = event.clientX - (box.left + box.width / 2);
            let dy = event.clientY - (box.top + box.height / 2);
            const distance = Math.hypot(dx, dy);
            if (distance > limit) { dx = dx / distance * limit; dy = dy / distance * limit; }
            this.touchMove.x = dx / limit;
            this.touchMove.y = -dy / limit;
            stick.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
        };
        movePad.addEventListener('pointerdown', (event) => {
            if (!this.started || this.paused) return;
            event.preventDefault();
            movePointer = event.pointerId;
            try { movePad.setPointerCapture(event.pointerId); } catch (_) { /* harmless */ }
            readMove(event);
        });
        movePad.addEventListener('pointermove', event => {
            if (event.pointerId === movePointer) { event.preventDefault(); readMove(event); }
        });
        movePad.addEventListener('pointerup', event => { if (event.pointerId === movePointer) releaseMove(); });
        movePad.addEventListener('pointercancel', event => { if (event.pointerId === movePointer) releaseMove(); });

        lookZone.addEventListener('pointerdown', (event) => {
            if (!this.started || this.paused) return;
            event.preventDefault();
            this.touchLook = { id: event.pointerId, x: event.clientX, y: event.clientY };
            try { lookZone.setPointerCapture(event.pointerId); } catch (_) { /* harmless */ }
        });
        lookZone.addEventListener('pointermove', (event) => {
            const look = this.touchLook;
            if (!look || event.pointerId !== look.id) return;
            event.preventDefault();
            const camera = this.app.camera;
            camera.azimuth += (event.clientX - look.x) * ASHFALL_CAMERA_DRAG * 1.35;
            camera.pitch = Math.max(.61, Math.min(1.27, camera.pitch + (event.clientY - look.y) * ASHFALL_CAMERA_DRAG * 1.15));
            look.x = event.clientX;
            look.y = event.clientY;
        });
        const releaseLook = event => {
            if (this.touchLook && (!event || event.pointerId === this.touchLook.id)) this.touchLook = null;
        };
        lookZone.addEventListener('pointerup', releaseLook);
        lookZone.addEventListener('pointercancel', releaseLook);

        const byId = id => document.getElementById(id);
        const press = (id, down, up) => {
            const button = byId(id);
            if (!button) return;
            button.addEventListener('pointerdown', event => {
                if (!this.started || this.paused) return;
                event.preventDefault();
                button.classList.add('is-held');
                try { button.setPointerCapture(event.pointerId); } catch (_) { /* harmless */ }
                down();
            });
            const end = event => {
                if (event) event.preventDefault();
                button.classList.remove('is-held');
                if (up) up();
            };
            button.addEventListener('pointerup', end);
            button.addEventListener('pointercancel', end);
        };
        press('touch-sprint', () => { this.touchSprinting = true; }, () => { this.touchSprinting = false; });
        const crouch = byId('touch-crouch');
        if (crouch) crouch.addEventListener('pointerdown', event => {
            if (!this.started || this.paused) return;
            event.preventDefault();
            this.touchCrouching = !this.touchCrouching;
            crouch.classList.toggle('is-held', this.touchCrouching);
        });
        const action = (id, fn) => {
            const button = byId(id);
            if (!button) return;
            button.addEventListener('pointerdown', event => { event.preventDefault(); fn(); });
        };
        action('touch-interact', () => this.interact());
        action('touch-pulse', () => this.pulse());
        action('touch-lure', () => this.throwLure());
        window.addEventListener('blur', () => { releaseMove(); this.touchSprinting = false; this.touchLook = null; });
        window.addEventListener('orientationchange', () => { releaseMove(); this.touchSprinting = false; this.touchLook = null; });
    }

    start() {
        if (this.started || this.completed) return;
        this.started = true;
        if (this.titleScreen) this.titleScreen.classList.add('is-hidden');
        Sound3D.setMuted(this.muted);
        Sound3D.music('assets/sounds/ashfall_ambient.wav', { volume: 0.72 });
        Sound3D.play('assets/sounds/ashfall_click.wav', { volume: 0.65 });
        this.objective = 'Найдите 3 резонансные ячейки';
        this.emitToast('СИГНАЛ ПРИНЯТ', 3.4);
        this.schedule(0.75, 'НАДЯ // РАДИО', 'Мира, приём. Старая станция слышит маяк.\nНо ему нужны три резонансные ячейки.', 6.3);
        this.schedule(8.0, 'МИРА', 'Я видела их на пути. Если Тишина проснётся —\nбуду идти тихо.', 5.0);
        this.schedule(14.0, 'НАДЯ // РАДИО', 'Не беги, когда она рядом. Она слышит даже\nсердце, если дать ему повод.', 5.8);
    }

    toggleMute() {
        this.muted = !this.muted;
        Sound3D.setMuted(this.muted);
        if (this.muteButton) {
            this.muteButton.textContent = this.muted ? 'Звук: выкл' : 'Звук: вкл';
            this.muteButton.setAttribute('aria-pressed', this.muted ? 'true' : 'false');
        }
    }

    togglePause() {
        if (this.completed) return;
        this.paused = !this.paused;
        this.emitToast(this.paused ? 'ПАУЗА · ESC — ПРОДОЛЖИТЬ' : 'ПРОДОЛЖАЕМ', 2);
    }

    // -------------------------------------------------------------------------
    // Materials and low-poly world construction
    // -------------------------------------------------------------------------

    createMaterials() {
        const make = (name, color, opts) => {
            const o = opts || {};
            const material = new BABYLON.StandardMaterial('m_' + name, this.scene);
            material.diffuseColor = BABYLON.Color3.FromHexString(color);
            material.specularColor = new BABYLON.Color3(o.specular || 0, o.specular || 0, o.specular || 0);
            material.emissiveColor = o.emissive ? BABYLON.Color3.FromHexString(o.emissive) : new BABYLON.Color3(0, 0, 0);
            material.alpha = o.alpha == null ? 1 : o.alpha;
            material.backFaceCulling = o.doubleSided ? false : true;
            if (o.unlit) material.disableLighting = true;
            return material;
        };
        return {
            timber: make('timber', '#4a352b', { specular: 0.03 }),
            timberPale: make('timberPale', '#73604b', { specular: 0.02 }),
            metal: make('metal', '#33464b', { specular: 0.12 }),
            rust: make('rust', '#724637', { specular: 0.03 }),
            concrete: make('concrete', '#44545a', { specular: 0.02 }),
            rock: make('rock', '#2b3940', { specular: 0.02 }),
            moss: make('moss', '#25473e', { specular: 0.02 }),
            reed: make('reed', '#6b7451', { specular: 0.01 }),
            leafDark: make('leafDark', '#153d37', { specular: 0.01 }),
            leafLight: make('leafLight', '#245549', { specular: 0.01 }),
            cloth: make('cloth', '#80746a', { specular: 0.01 }),
            hush: make('hush', '#101d27', { specular: 0.08 }),
            hushSpike: make('hushSpike', '#23404a', { specular: 0.12, emissive: '#071318' }),
            eye: make('eye', '#61d8dd', { emissive: '#54e7e3', unlit: true }),
            hostileEye: make('hostileEye', '#f28f77', { emissive: '#e45248', unlit: true }),
            amber: make('amber', '#e8a851', { emissive: '#d36e27', unlit: true }),
            beacon: make('beacon', '#77e5ed', { emissive: '#48d9dd', unlit: true }),
            cell: make('cell', '#9ce6e3', { emissive: '#54c9cc', unlit: true }),
            memory: make('memory', '#b79ce5', { emissive: '#8263bf', unlit: true }),
            fog: make('fog', '#89b9bf', { emissive: '#315967', alpha: 0.1, doubleSided: true, unlit: true }),
            water: make('water', '#1a5864', { emissive: '#0c2732', alpha: 0.42, doubleSided: true }),
            ash: make('ash', '#bdd8d4', { emissive: '#344a4e', alpha: 0.6, unlit: true }),
            flare: make('flare', '#f4df9b', { emissive: '#f0b858', alpha: 0.78, doubleSided: true, unlit: true })
        };
    }

    id(prefix) { this.serial++; return prefix + '_' + this.serial; }
    ground(x, y) { return this.terrain ? this.terrain.heightAt(x, y) : 0; }

    register(mesh, kind, opts) {
        mesh.isPickable = false;
        // The terrain and the animated hero already carry ArcEngine's full ink/shadow
        // treatment. Hundreds of tiny set-dressing pieces do not need their own shadow
        // map and edge pass; keeping those off makes the browser version stay responsive.
        const quality = Object.assign({ castShadow: false, ink: false, outline: false }, opts || {});
        World3D.addObject(this.view, mesh, kind || 'prop', quality);
        return mesh;
    }

    box(name, x, y, width, depth, height, material, heading, opts) {
        const mesh = BABYLON.MeshBuilder.CreateBox(this.id(name), { width: width, depth: depth, height: height }, this.scene);
        mesh.position.set(x, this.ground(x, y) + height / 2, y);
        mesh.rotation.y = -(heading || 0);
        mesh.material = material;
        return this.register(mesh, (opts && opts.kind) || 'prop', opts);
    }

    cylinder(name, x, y, height, diameter, material, opts) {
        const mesh = BABYLON.MeshBuilder.CreateCylinder(this.id(name), {
            height: height,
            diameter: diameter,
            tessellation: (opts && opts.tessellation) || 8
        }, this.scene);
        mesh.position.set(x, this.ground(x, y) + height / 2, y);
        mesh.material = material;
        return this.register(mesh, (opts && opts.kind) || 'prop', opts);
    }

    sphere(name, x, y, diameter, material, opts) {
        const mesh = BABYLON.MeshBuilder.CreateSphere(this.id(name), {
            diameter: diameter,
            segments: (opts && opts.segments) || 8
        }, this.scene);
        mesh.position.set(x, this.ground(x, y) + diameter / 2, y);
        mesh.material = material;
        return this.register(mesh, (opts && opts.kind) || 'prop', opts);
    }

    buildWorld() {
        this.createWater(325, 1260, 510, 760);
        this.createWater(610, 660, 310, 420);
        this.createRailLine(340, 1750, 1070, 1120, 16);
        this.createRailLine(1070, 1120, 1690, 400, 17);
        this.createShelter(312, 1815);
        this.createStation(1080, 1120);
        this.createTower(1715, 365);
        this.createBridge(1336, 805);

        // A deliberate, hand-composed woodland around the route rather than random clutter.
        const trees = [
            [155, 1625, 1.1], [180, 1440, 0.8], [285, 1370, 1.25], [595, 1700, 1.05], [695, 1520, .86],
            [755, 1280, 1.1], [835, 1160, .78], [705, 1000, 1.22], [920, 885, .9], [1165, 1450, .88],
            [1315, 1320, 1.15], [1460, 1180, .9], [1590, 980, 1.14], [1785, 750, .92], [1870, 550, 1.2],
            [1510, 540, .82], [1245, 630, 1.08], [475, 870, .95], [300, 970, 1.17], [1940, 1190, 1.08]
        ];
        for (const t of trees) this.createTree(t[0], t[1], t[2]);
        this.finalizeTrack();
        this.finalizeForest();
        const rocks = [[490,1580,24],[625,1390,34],[744,1115,27],[930,1320,37],[1290,1020,31],[1468,855,42],[1615,620,28],[1830,440,33],[1040,700,26],[385,1150,29]];
        for (const r of rocks) this.createRock(r[0], r[1], r[2]);

        this.createCell('north', 'Ячейка «Север»', 735, 1450,
            'Внутри стекла мерцает старая запись: «Если найдёшь маяк —\nне верь первому голосу в эфире».');
        this.createCell('station', 'Ячейка «Платформа»', 1100, 1045,
            'Ячейка пахнет озоном. На корпусе нацарапано: «Мы не ушли.\nМы просто стали тише».');
        this.createCell('ridge', 'Ячейка «Гребень»', 1515, 610,
            'Последняя ячейка отвечает на твоё касание коротким: «МИРА».\nКто-то знал, что ты придёшь.');

        this.createNote(536, 1540, 'КАРТОЧКА ДИСПЕТЧЕРА',
            'Последний поезд не ушёл из долины. Его выключили,\nчтобы Тишина не услышала город.');
        this.createNote(1230, 920, 'ОБРЫВОК ПИСЬМА',
            'Надя: «Маяк не зовёт помощь. Он отвечает тем,\nкто ещё умеет слушать».');
        this.createNote(1500, 830, 'РАДИОГРАММА 04',
            '«Три ячейки — это не ключ. Это вопрос.\nМаяк решит, кому дать ответ».');
        this.createCache(910, 1240);
        this.createCache(1425, 710);

        this.createHush('hush_rail', 795, 1335, [[795,1335],[885,1275],[840,1170],[740,1215]], true);
        this.createHush('hush_station', 1230, 1080, [[1230,1080],[1300,1010],[1185,950],[1120,1030]], false);
        this.createHush('hush_ridge', 1580, 720, [[1580,720],[1650,640],[1540,545],[1450,650]], false);
        this.createAtmosphere();
    }

    createWater(x, y, width, depth) {
        const water = BABYLON.MeshBuilder.CreateGround(this.id('water'), { width: width, height: depth, subdivisions: 1 }, this.scene);
        water.position.set(x, this.ground(x, y) + 2, y);
        water.material = this.materials.water;
        water.isPickable = false;
        this.mist.push({ mesh: water, kind: 'water', base: water.position.y, phase: this.serial * 0.17 });
    }

    createTree(x, y, scale) {
        // Trees are instanced after the layout is known: 20 pines become four draw calls.
        this.treeItems.push({
            x: x,
            y: y,
            h: this.ground(x, y),
            scale: scale,
            heading: ((x * 13 + y * 7) % 628) / 100
        });
        this.obstacles.push({ x: x, y: y, r: 20 * scale });
    }

    finalizeForest() {
        if (!this.treeItems.length) return;
        const root = new BABYLON.Mesh(this.id('pineSource'), this.scene);
        const trunk = BABYLON.MeshBuilder.CreateCylinder(this.id('trunkSource'), { height: 90, diameterTop: 9, diameterBottom: 15, tessellation: 6 }, this.scene);
        trunk.parent = root; trunk.position.y = 45; trunk.material = this.materials.timber;
        for (let i = 0; i < 3; i++) {
            const cone = BABYLON.MeshBuilder.CreateCylinder(this.id('pineSource'), {
                height: 78 - i * 8,
                diameterTop: 0,
                diameterBottom: 70 - i * 9,
                tessellation: 6
            }, this.scene);
            cone.parent = root;
            cone.position.y = 82 + i * 38;
            cone.material = i === 1 ? this.materials.leafLight : this.materials.leafDark;
        }
        this.treeInstances = World3D.addInstances(this.view, root, 'prop', this.treeItems,
            { castShadow: false, receiveShadows: true, ink: false, outline: false });
    }

    createRock(x, y, size) {
        const rock = BABYLON.MeshBuilder.CreateSphere(this.id('rock'), { diameter: size * 2, segments: 5 }, this.scene);
        rock.position.set(x, this.ground(x, y) + size * .52, y);
        rock.scaling.y = .65;
        rock.rotation.set(.18, (x + y) * .011, .1);
        rock.material = this.materials.rock;
        this.register(rock, 'prop', { outline: false });
        this.obstacles.push({ x: x, y: y, r: size * .76 });
    }

    createRailLine(ax, ay, bx, by, segments) {
        const dx = bx - ax, dy = by - ay;
        const heading = Math.atan2(dy, dx);
        const length = Math.hypot(dx, dy) / segments;
        const nx = -Math.sin(heading), ny = Math.cos(heading);
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const x = ax + dx * t, y = ay + dy * t;
            const railScale = [(length + 7) / 100, 1, 1];
            this.railItems.push({ x: x + nx * 20, y: y + ny * 20, h: this.ground(x + nx * 20, y + ny * 20), heading: heading, scale: railScale });
            this.railItems.push({ x: x - nx * 20, y: y - ny * 20, h: this.ground(x - nx * 20, y - ny * 20), heading: heading, scale: railScale });
            if (i < segments) {
                // Three sleepers per segment read well close up, but are still one instanced draw call.
                for (let sleeper = 0; sleeper < 3; sleeper++) {
                    const q = (sleeper + .5) / 3;
                    const sx = x + dx / segments * q, sy = y + dy / segments * q;
                    this.sleeperItems.push({ x: sx, y: sy, h: this.ground(sx, sy), heading: heading, scale: 1 });
                }
            }
        }
    }

    finalizeTrack() {
        const makeSource = (name, options, material, items) => {
            if (!items.length) return null;
            const root = new BABYLON.Mesh(this.id(name + 'Source'), this.scene);
            const part = BABYLON.MeshBuilder.CreateBox(this.id(name), options, this.scene);
            part.parent = root;
            part.position.y = options.height / 2;
            part.material = material;
            return World3D.addInstances(this.view, root, 'prop', items,
                { castShadow: false, receiveShadows: true, ink: false, outline: false });
        };
        this.railInstances = makeSource('rail', { width: 100, depth: 5, height: 4 }, this.materials.metal, this.railItems);
        this.sleeperInstances = makeSource('sleeper', { width: 12, depth: 62, height: 5 }, this.materials.timberPale, this.sleeperItems);
    }

    createShelter(x, y) {
        this.box('shelterFloor', x, y, 180, 140, 12, this.materials.timber, 0, { outline: false });
        this.box('shelterBack', x - 70, y + 12, 18, 128, 96, this.materials.timber, 0, { outline: false });
        this.box('shelterSide', x, y + 58, 158, 14, 96, this.materials.timber, 0, { outline: false });
        const roof = this.box('shelterRoof', x - 15, y + 4, 190, 156, 12, this.materials.rust, 0, { outline: false });
        roof.rotation.z = .14;
        const fireRoot = new BABYLON.TransformNode(this.id('fireRoot'), this.scene);
        fireRoot.position.set(x + 36, this.ground(x + 36, y - 20) + 8, y - 20);
        for (let i = 0; i < 3; i++) {
            const flame = BABYLON.MeshBuilder.CreateCylinder(this.id('flame'), { height: 23 + i * 7, diameterTop: 0, diameterBottom: 18 - i * 3, tessellation: 5 }, this.scene);
            flame.parent = fireRoot;
            flame.position.set((i - 1) * 5, 14 + i * 3, (i % 2) * 4);
            flame.material = this.materials.amber;
            this.register(flame, 'prop', { castShadow: false, ink: false, outline: false });
        }
        const lantern = this.sphere('shelterLantern', x - 35, y - 30, 17, this.materials.amber, { castShadow: false, ink: false, outline: false });
        lantern.position.y += 24;
        const shelter = { type: 'shelter', x: x + 20, y: y - 20, label: 'Согреться у огня', root: fireRoot, used: false };
        this.interactables.push(shelter);
        this.obstacles.push({ x: x - 55, y: y + 15, w: 20, d: 124 });
    }

    createStation(x, y) {
        this.box('platform', x, y, 400, 260, 17, this.materials.concrete, 0, { outline: false });
        this.box('stationWallA', x - 155, y + 62, 20, 142, 125, this.materials.concrete, 0, { outline: false });
        this.box('stationWallB', x - 40, y + 120, 205, 18, 125, this.materials.concrete, 0, { outline: false });
        this.box('stationWallC', x + 154, y + 60, 18, 142, 125, this.materials.concrete, 0, { outline: false });
        const canopy = this.box('stationCanopy', x - 5, y + 32, 350, 145, 16, this.materials.rust, 0, { outline: false });
        canopy.position.y += 110;
        canopy.rotation.z = .08;
        for (const sx of [-140, -40, 75, 145]) {
            const post = this.cylinder('canopyPost', x + sx, y - 40, 118, 10, this.materials.metal, { tessellation: 6, outline: false });
            post.position.y += 8;
        }
        // A silent derailed carriage, serving both as a landmark and a stealth wall.
        this.box('carriageBody', x + 70, y - 102, 220, 68, 74, this.materials.metal, -.18, { outline: false });
        const carriageTop = this.box('carriageTop', x + 70, y - 102, 230, 78, 13, this.materials.rust, -.18, { outline: false });
        carriageTop.position.y += 42;
        for (const wx of [-68, 0, 68]) {
            const wheel = this.cylinder('wheel', x + wx + 70, y - 102, 23, 25, this.materials.hushSpike, { tessellation: 8, outline: false });
            wheel.rotation.z = Math.PI / 2;
            wheel.position.y = this.ground(x + wx + 70, y - 102) + 20;
        }
        const lamp = this.sphere('stationLamp', x - 116, y - 64, 20, this.materials.amber, { castShadow: false, ink: false, outline: false });
        lamp.position.y += 90;
        this.obstacles.push({ x: x - 154, y: y + 62, w: 24, d: 150 });
        this.obstacles.push({ x: x - 40, y: y + 120, w: 214, d: 22 });
        this.obstacles.push({ x: x + 70, y: y - 102, w: 225, d: 74 });
    }

    createBridge(x, y) {
        this.box('bridgeDeck', x, y, 280, 146, 15, this.materials.timberPale, -.82, { outline: false });
        const heading = -.82;
        const nx = -Math.sin(heading), ny = Math.cos(heading);
        for (const side of [-1, 1]) {
            const rail = this.box('bridgeRail', x + nx * side * 58, y + ny * side * 58, 286, 7, 43, this.materials.metal, heading, { outline: false });
            rail.position.y += 28;
        }
        for (let i = -2; i <= 2; i++) {
            const px = x + Math.cos(heading) * i * 55;
            const py = y + Math.sin(heading) * i * 55;
            const postA = this.cylinder('bridgePost', px + nx * 58, py + ny * 58, 54, 7, this.materials.metal, { tessellation: 6, outline: false });
            const postB = this.cylinder('bridgePost', px - nx * 58, py - ny * 58, 54, 7, this.materials.metal, { tessellation: 6, outline: false });
            postA.position.y += 18; postB.position.y += 18;
        }
    }

    createTower(x, y) {
        const root = new BABYLON.TransformNode(this.id('towerRoot'), this.scene);
        root.position.set(x, this.ground(x, y), y);
        const legs = [[-42,-42],[42,-42],[-42,42],[42,42]];
        for (const leg of legs) {
            const m = BABYLON.MeshBuilder.CreateBox(this.id('towerLeg'), { width: 9, depth: 9, height: 210 }, this.scene);
            m.parent = root; m.position.set(leg[0], 105, leg[1]); m.rotation.z = leg[0] > 0 ? -.08 : .08;
            m.material = this.materials.metal; this.register(m, 'prop', { outline: false });
        }
        for (let h = 45; h < 195; h += 48) {
            const crossA = BABYLON.MeshBuilder.CreateBox(this.id('towerBrace'), { width: 115, depth: 7, height: 6 }, this.scene);
            crossA.parent = root; crossA.position.y = h; crossA.rotation.z = .56; crossA.material = this.materials.rust;
            this.register(crossA, 'prop', { outline: false });
            const crossB = BABYLON.MeshBuilder.CreateBox(this.id('towerBrace'), { width: 115, depth: 7, height: 6 }, this.scene);
            crossB.parent = root; crossB.position.y = h; crossB.rotation.z = -.56; crossB.material = this.materials.rust;
            this.register(crossB, 'prop', { outline: false });
        }
        const beacon = BABYLON.MeshBuilder.CreateSphere(this.id('beacon'), { diameter: 35, segments: 8 }, this.scene);
        beacon.parent = root; beacon.position.y = 230; beacon.material = this.materials.amber;
        this.register(beacon, 'prop', { castShadow: false, ink: false, outline: false });
        const beam = BABYLON.MeshBuilder.CreateCylinder(this.id('towerBeam'), { height: 320, diameterTop: 3, diameterBottom: 34, tessellation: 8 }, this.scene);
        beam.parent = root; beam.position.y = 390; beam.material = this.materials.fog;
        beam.isPickable = false;
        this.tower = { type: 'tower', x: x, y: y, label: 'Активировать маяк', root: root, beacon: beacon, beam: beam, locked: true };
        this.interactables.push(this.tower);
        this.obstacles.push({ x: x, y: y, r: 60 });
    }

    createCell(id, label, x, y, lore) {
        const root = new BABYLON.TransformNode(this.id('cellRoot'), this.scene);
        root.position.set(x, this.ground(x, y) + 42, y);
        const core = BABYLON.MeshBuilder.CreateCylinder(this.id('cellCore'), { height: 42, diameterTop: 9, diameterBottom: 24, tessellation: 6 }, this.scene);
        core.parent = root; core.material = this.materials.cell;
        this.register(core, 'prop', { castShadow: false, ink: false, outline: false });
        const cap = BABYLON.MeshBuilder.CreateSphere(this.id('cellCap'), { diameter: 22, segments: 6 }, this.scene);
        cap.parent = root; cap.position.y = 29; cap.material = this.materials.cell;
        this.register(cap, 'prop', { castShadow: false, ink: false, outline: false });
        const ring = BABYLON.MeshBuilder.CreateTorus(this.id('cellRing'), { diameter: 55, thickness: 3, tessellation: 12 }, this.scene);
        ring.parent = root; ring.rotation.x = Math.PI / 2; ring.position.y = 17; ring.material = this.materials.memory;
        this.register(ring, 'prop', { castShadow: false, ink: false, outline: false });
        const marker = BABYLON.MeshBuilder.CreateCylinder(this.id('cellMarker'), { height: 78, diameterTop: 2, diameterBottom: 10, tessellation: 6 }, this.scene);
        marker.parent = root; marker.position.y = 82; marker.material = this.materials.fog;
        marker.isPickable = false;
        const cell = { type: 'cell', id: id, label: label, x: x, y: y, lore: lore, root: root, core: core, ring: ring, marker: marker, taken: false, phase: this.cells.length * 1.8 };
        this.cells.push(cell);
        this.interactables.push(cell);
    }

    createNote(x, y, title, text) {
        const root = new BABYLON.TransformNode(this.id('noteRoot'), this.scene);
        root.position.set(x, this.ground(x, y) + 18, y);
        const stand = BABYLON.MeshBuilder.CreateBox(this.id('noteStand'), { width: 20, depth: 20, height: 32 }, this.scene);
        stand.parent = root; stand.material = this.materials.metal; this.register(stand, 'prop', { outline: false });
        const crystal = BABYLON.MeshBuilder.CreateSphere(this.id('noteCrystal'), { diameter: 18, segments: 6 }, this.scene);
        crystal.parent = root; crystal.position.y = 28; crystal.material = this.materials.memory;
        this.register(crystal, 'prop', { castShadow: false, ink: false, outline: false });
        const note = { type: 'note', x: x, y: y, title: title, text: text, root: root, crystal: crystal, read: false, label: 'Прослушать запись' };
        this.notes.push(note); this.interactables.push(note);
    }

    createCache(x, y) {
        const root = new BABYLON.TransformNode(this.id('cacheRoot'), this.scene);
        root.position.set(x, this.ground(x, y) + 12, y);
        const base = BABYLON.MeshBuilder.CreateBox(this.id('cache'), { width: 38, depth: 30, height: 24 }, this.scene);
        base.parent = root; base.material = this.materials.timber; this.register(base, 'prop', { outline: false });
        const latch = BABYLON.MeshBuilder.CreateSphere(this.id('cacheLatch'), { diameter: 8, segments: 6 }, this.scene);
        latch.parent = root; latch.position.set(0, 5, -17); latch.material = this.materials.amber;
        this.register(latch, 'prop', { castShadow: false, ink: false, outline: false });
        const cache = { type: 'cache', x: x, y: y, root: root, label: 'Обыскать ящик', opened: false };
        this.caches.push(cache); this.interactables.push(cache);
    }

    createHush(id, x, y, route, active) {
        const root = new BABYLON.TransformNode(this.id(id), this.scene);
        root.position.set(x, this.ground(x, y), y);
        const body = BABYLON.MeshBuilder.CreateCylinder(this.id('hushBody'), { height: 70, diameterTop: 22, diameterBottom: 37, tessellation: 6 }, this.scene);
        body.parent = root; body.position.y = 47; body.material = this.materials.hush; this.register(body, 'actor', { outline: true });
        const head = BABYLON.MeshBuilder.CreateSphere(this.id('hushHead'), { diameter: 34, segments: 7 }, this.scene);
        head.parent = root; head.position.set(0, 88, 2); head.scaling.z = .82; head.material = this.materials.hushSpike; this.register(head, 'actor', { outline: true });
        const eyeL = BABYLON.MeshBuilder.CreateSphere(this.id('hushEye'), { diameter: 6, segments: 5 }, this.scene);
        eyeL.parent = root; eyeL.position.set(-8, 89, -14); eyeL.material = this.materials.eye; this.register(eyeL, 'actor', { castShadow: false, ink: false, outline: false });
        const eyeR = BABYLON.MeshBuilder.CreateSphere(this.id('hushEye'), { diameter: 6, segments: 5 }, this.scene);
        eyeR.parent = root; eyeR.position.set(8, 89, -14); eyeR.material = this.materials.eye; this.register(eyeR, 'actor', { castShadow: false, ink: false, outline: false });
        for (const sx of [-1, 1]) {
            const arm = BABYLON.MeshBuilder.CreateCylinder(this.id('hushArm'), { height: 58, diameterTop: 5, diameterBottom: 10, tessellation: 5 }, this.scene);
            arm.parent = root; arm.position.set(sx * 24, 50, 2); arm.rotation.z = sx * -.5; arm.material = this.materials.hushSpike; this.register(arm, 'actor', { outline: true });
        }
        const enemy = { id: id, x: x, y: y, homeX: x, homeY: y, heading: 0, root: root, eyes: [eyeL, eyeR], route: route, routeIndex: 0, state: 'patrol', awareness: 0, active: !!active, stun: 0, investigateUntil: 0, targetX: x, targetY: y, phase: this.enemies.length * 1.7, lastSound: -10 };
        if (!active) root.setEnabled(false);
        this.enemies.push(enemy);
    }

    createAtmosphere() {
        // Animated ash is another thin-instanced layer rather than dozens of draw calls.
        for (let i = 0; i < 38; i++) {
            const x = 80 + ((i * 173) % 1980), y = 70 + ((i * 311) % 1980);
            this.ash.push({ x: x, y: y, base: this.ground(x, y) + 54 + (i % 7) * 16, phase: i * .73 });
        }
        const ashSource = BABYLON.MeshBuilder.CreateSphere(this.id('ashSource'), { diameter: 2.5, segments: 4 }, this.scene);
        ashSource.material = this.materials.ash;
        this.ashInstances = World3D.addInstances(this.view, ashSource, 'prop', this.ash.map(mote => ({
            x: mote.x, y: mote.y, h: mote.base, scale: .72, heading: 0
        })), { dynamic: true, castShadow: false, receiveShadows: false, ink: false, outline: false });
        const fogPoints = [[520,1290,290,125],[930,910,310,135],[1460,770,270,115],[1760,530,290,122],[420,1610,250,112]];
        for (const p of fogPoints) {
            const plane = BABYLON.MeshBuilder.CreatePlane(this.id('fog'), { width: p[2], height: p[3] }, this.scene);
            plane.position.set(p[0], this.ground(p[0], p[1]) + p[3] * .55, p[1]);
            plane.material = this.materials.fog;
            plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
            plane.isPickable = false;
            this.mist.push({ mesh: plane, kind: 'fog', base: plane.position.y, phase: p[0] * .004 });
        }
    }
    // -------------------------------------------------------------------------
    // Player, collision, stealth tools
    // -------------------------------------------------------------------------

    prepareHero() {
        if (!this.heroRecord || !this.heroRecord.loaded) return;
        this.heroRecord.loaded.then((rec) => {
            this.heroRecord = rec;
            this.heroReady = !!rec.mesh;
            this.syncHero();
        });
    }

    syncHero() {
        if (!this.heroRecord) return;
        const rec = this.heroRecord;
        rec.def.x = this.player.x;
        rec.def.y = this.player.y;
        rec.def.rot = [0, -this.player.heading * 180 / Math.PI, 0];
        if (rec.mesh) {
            rec.mesh.position.set(this.player.x, this.ground(this.player.x, this.player.y), this.player.y);
            rec.mesh.rotationQuaternion = null;
            rec.mesh.rotation.y = -this.player.heading;
        }
    }

    isBlocked(x, y, radius) {
        const r = radius || 16;
        if (x < 45 || y < 45 || x > LOCATION_WIDTH - 45 || y > LOCATION_HEIGHT - 45) return true;
        for (const obstacle of this.obstacles) {
            if (obstacle.r && Math.hypot(x - obstacle.x, y - obstacle.y) < obstacle.r + r) return true;
            if (obstacle.w && obstacle.d) {
                const px = Math.max(obstacle.x - obstacle.w / 2, Math.min(x, obstacle.x + obstacle.w / 2));
                const py = Math.max(obstacle.y - obstacle.d / 2, Math.min(y, obstacle.y + obstacle.d / 2));
                if (Math.hypot(x - px, y - py) < r) return true;
            }
        }
        return false;
    }

    updatePlayer(dt) {
        let forward = this.touchMove.y, right = this.touchMove.x;
        if (this.keys.has('KeyW')) forward += 1;
        if (this.keys.has('KeyS')) forward -= 1;
        if (this.keys.has('KeyD')) right += 1;
        if (this.keys.has('KeyA')) right -= 1;
        const moving = forward !== 0 || right !== 0;
        const crouching = this.keys.has('KeyC') || this.touchCrouching;
        const wantsSprint = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchSprinting) && !crouching && this.stamina > .035;
        const sprinting = moving && wantsSprint;
        const camera = this.app.camera;
        let dx = 0, dy = 0;
        if (moving) {
            const mag = Math.hypot(forward, right);
            forward /= mag; right /= mag;
            const fX = Math.cos(camera.azimuth), fY = Math.sin(camera.azimuth);
            const rX = -Math.sin(camera.azimuth), rY = Math.cos(camera.azimuth);
            dx = fX * forward + rX * right;
            dy = fY * forward + rY * right;
            const speed = crouching ? ASHFALL_PLAYER_CROUCH_SPEED : sprinting ? ASHFALL_PLAYER_SPRINT_SPEED : ASHFALL_PLAYER_WALK_SPEED;
            const nx = this.player.x + dx * speed * dt;
            const ny = this.player.y + dy * speed * dt;
            if (!this.isBlocked(nx, this.player.y, 17)) this.player.x = nx;
            if (!this.isBlocked(this.player.x, ny, 17)) this.player.y = ny;
            this.player.heading = Math.atan2(dy, dx);
        }
        if (sprinting) this.stamina = Math.max(0, this.stamina - ASHFALL_STAMINA_DRAIN * dt);
        else this.stamina = Math.min(1, this.stamina + ASHFALL_STAMINA_RECOVER * dt * (crouching ? .8 : 1));
        if (!moving) this.health = Math.min(1, this.health + ASHFALL_HEALTH_RECOVER * dt);
        const targetNoise = moving ? (sprinting ? 1 : crouching ? .1 : .44) : 0;
        this.noise += (targetNoise - this.noise) * Math.min(1, dt * 6);
        if (moving && this.clock >= this.stepAt) {
            this.stepAt = this.clock + (sprinting ? .28 : crouching ? .72 : .46);
            Sound3D.play('assets/sounds/ashfall_step.wav', { at: this.player, volume: crouching ? .22 : sprinting ? .72 : .42 });
        }
        this.syncHero();
        if (this.heroReady && this.heroRecord && this.heroRecord.mesh) {
            const clips = Model3D.clips(this.heroRecord.mesh);
            if (clips) clips.play(moving ? 'run' : 'idle');
        }
    }

    pulse() {
        if (!this.started || this.paused) return;
        if (this.clock < this.pulseReadyAt) {
            this.emitToast('ИМПУЛЬ ЕЩЁ ЗАРЯЖАЕТСЯ', 1.5);
            return;
        }
        this.pulseReadyAt = this.clock + ASHFALL_PULSE_COOLDOWN;
        Sound3D.play('assets/sounds/ashfall_pulse.wav', { at: this.player, volume: .7 });
        this.app.camera.shake(190, .025);
        const ring = BABYLON.MeshBuilder.CreateTorus(this.id('pulseWave'), { diameter: 24, thickness: 2.5, tessellation: 28 }, this.scene);
        ring.position.set(this.player.x, this.ground(this.player.x, this.player.y) + 6, this.player.y);
        ring.rotation.x = Math.PI / 2;
        ring.material = this.materials.beacon;
        ring.isPickable = false;
        this.pulseWaves.push({ mesh: ring, born: this.clock });
        let stunned = 0;
        for (const enemy of this.enemies) {
            if (!enemy.active) continue;
            if (Math.hypot(enemy.x - this.player.x, enemy.y - this.player.y) < 510) {
                enemy.stun = 3.1;
                enemy.state = 'stunned';
                stunned++;
            }
        }
        this.emitToast(stunned ? 'ИМПУЛЬ: ТИШИНА ДЕЗОРИЕНТИРОВАНА' : 'ИМПУЛЬ: НЕТ ОТКЛИКА', 2.4);
    }

    throwLure() {
        if (!this.started || this.paused) return;
        if (this.lures <= 0) { this.emitToast('ПРИМАНКИ ЗАКОНЧИЛИСЬ', 1.6); return; }
        if (this.clock < this.lureReadyAt) { this.emitToast('ДАЙТЕ ЭФИРУ СТИХНУТЬ', 1.4); return; }
        this.lures--;
        this.lureReadyAt = this.clock + ASHFALL_LURE_COOLDOWN;
        const camera = this.app.camera;
        let x = this.player.x + Math.cos(camera.azimuth) * 180;
        let y = this.player.y + Math.sin(camera.azimuth) * 180;
        if (this.isBlocked(x, y, 4)) { x = this.player.x + Math.cos(this.player.heading) * 110; y = this.player.y + Math.sin(this.player.heading) * 110; }
        const shell = this.sphere('lure', x, y, 13, this.materials.memory, { castShadow: false, ink: false, outline: false });
        shell.position.y += 14;
        const handle = Sound3D.play('assets/sounds/ashfall_lure.wav', { at: { x: x, y: y }, loop: true, volume: .67, falloffMax: 520 });
        this.lureObjects.push({ x: x, y: y, mesh: shell, handle: handle, until: this.clock + 5.4 });
        this.emitToast('ПРИМАНКА БРОШЕНА', 1.7);
    }

    // -------------------------------------------------------------------------
    // Enemy behaviour — intentionally readable stealth, not a black-box AI
    // -------------------------------------------------------------------------

    activateEnemy(index) {
        const enemy = this.enemies[index];
        if (!enemy || enemy.active) return;
        enemy.active = true;
        enemy.root.setEnabled(true);
        this.emitToast('В ДОЛИНЕ ЧТО-ТО ПРОСНУЛОСЬ', 3);
        Sound3D.play('assets/sounds/ashfall_whisper.wav', { at: enemy, volume: .42 });
    }

    updateEnemies(dt) {
        const activeLure = this.lureObjects.find(lure => lure.until > this.clock) || null;
        for (const enemy of this.enemies) {
            if (!enemy.active) continue;
            const playerDistance = Math.hypot(enemy.x - this.player.x, enemy.y - this.player.y);
            if (enemy.stun > 0) {
                enemy.stun -= dt;
                enemy.state = enemy.stun > 0 ? 'stunned' : 'investigate';
                this.setEnemyEyes(enemy, true);
                continue;
            }
            const hearRange = ASHFALL_ENEMY_HEAR_RANGE * Math.max(.08, this.noise);
            const lowProfile = this.keys.has('KeyC') ? .42 : 1;
            const canSee = playerDistance < ASHFALL_ENEMY_SIGHT_RANGE * lowProfile && this.noise > .08;
            const canHear = playerDistance < hearRange;
            if (canSee || canHear) enemy.awareness = Math.min(1.2, enemy.awareness + dt * (canSee ? .68 : .38));
            else enemy.awareness = Math.max(0, enemy.awareness - dt * .12);
            if (enemy.awareness >= 1 && enemy.state !== 'alert') {
                enemy.state = 'alert';
                enemy.lastSound = this.clock;
                Sound3D.play('assets/sounds/ashfall_whisper.wav', { at: enemy, volume: .65 });
                this.emitDanger('Тишина услышала тебя');
            }
            let targetX = enemy.homeX, targetY = enemy.homeY, speed = 44;
            if (enemy.state === 'alert') {
                targetX = this.player.x; targetY = this.player.y; speed = 106;
                this.emitDanger('Тишина рядом — замри или отвлеки её');
                if (playerDistance < ASHFALL_ENEMY_ATTACK_RANGE) this.damage(dt * ASHFALL_ENEMY_ATTACK_DPS);
            } else if (activeLure && Math.hypot(enemy.x - activeLure.x, enemy.y - activeLure.y) < 620) {
                enemy.state = 'investigate';
                enemy.investigateUntil = this.clock + 1.8;
                targetX = activeLure.x; targetY = activeLure.y; speed = 82;
            } else if (enemy.state === 'investigate' && this.clock < enemy.investigateUntil) {
                targetX = enemy.targetX; targetY = enemy.targetY; speed = 60;
            } else {
                enemy.state = 'patrol';
                const point = enemy.route[enemy.routeIndex];
                targetX = point[0]; targetY = point[1]; speed = 42;
                if (Math.hypot(enemy.x - targetX, enemy.y - targetY) < 24) enemy.routeIndex = (enemy.routeIndex + 1) % enemy.route.length;
            }
            const dx = targetX - enemy.x, dy = targetY - enemy.y, distance = Math.hypot(dx, dy);
            if (distance > 2) {
                const step = Math.min(distance, speed * dt);
                enemy.x += dx / distance * step;
                enemy.y += dy / distance * step;
                enemy.heading = Math.atan2(dy, dx);
            }
            enemy.root.position.set(enemy.x, this.ground(enemy.x, enemy.y), enemy.y);
            enemy.root.rotation.y = -enemy.heading;
            this.setEnemyEyes(enemy, enemy.state === 'alert');
        }
    }

    setEnemyEyes(enemy, alert) {
        const material = alert ? this.materials.hostileEye : enemy.stun > 0 ? this.materials.memory : this.materials.eye;
        for (const eye of enemy.eyes) eye.material = material;
        enemy.root.scaling.y = 1 + Math.sin(this.clock * 3.8 + enemy.phase) * .03;
    }

    damage(amount) {
        if (this.clock < this.hurtAt) return;
        this.hurtAt = this.clock + .45;
        this.health = Math.max(0, this.health - amount * 2.8);
        this.app.camera.shake(145, .045);
        Sound3D.play('assets/sounds/ashfall_hurt.wav', { at: this.player, volume: .62 });
        if (this.health <= 0) this.respawn();
    }

    respawn() {
        this.health = .72;
        this.stamina = 1;
        this.player.x = this.startPoint.x;
        this.player.y = this.startPoint.y;
        this.noise = 0;
        for (const enemy of this.enemies) {
            enemy.state = 'patrol'; enemy.awareness = 0; enemy.stun = 0;
            enemy.x = enemy.homeX; enemy.y = enemy.homeY;
        }
        this.say('НАДЯ // РАДИО', 'Я потеряла тебя на секунду. Огонь у убежища\nещё горит. Дыши — и попробуй снова.', 6);
        this.emitToast('ТЫ ВЕРНУЛАСЬ К ОГНЮ', 3);
    }

    // -------------------------------------------------------------------------
    // Interactions, narrative fragments and ending
    // -------------------------------------------------------------------------

    nearestInteraction() {
        let best = null, bestDistance = Infinity;
        for (const item of this.interactables) {
            if (item.taken || item.opened) continue;
            const distance = Math.hypot(item.x - this.player.x, item.y - this.player.y);
            if (distance < ASHFALL_INTERACT_RANGE && distance < bestDistance) {
                best = item; bestDistance = distance;
            }
        }
        return best;
    }

    updateInteractionHint() {
        this.currentInteraction = this.nearestInteraction();
        let text = '';
        if (this.currentInteraction) {
            if (this.currentInteraction.type === 'tower' && this.cellsCollected < 3) text = 'МАЯК МОЛЧИТ · НУЖНО ЯЧЕЕК: ' + (3 - this.cellsCollected);
            else text = 'E  ' + this.currentInteraction.label;
        }
        const hint = UI.get('interaction'), panel = UI.get('interactionPanel');
        if (hint) hint.setText(text).show(!!text);
        if (panel) panel.show(!!text);
    }

    interact() {
        if (!this.started || this.paused) return;
        if (this.dialogue) { this.dialogue.until = this.clock; return; }
        const item = this.currentInteraction || this.nearestInteraction();
        if (!item) { this.emitToast('ЗДЕСЬ НЕЧЕГО ТРОГАТЬ', 1.2); return; }
        if (item.type === 'cell') this.collectCell(item);
        else if (item.type === 'note') this.readNote(item);
        else if (item.type === 'cache') this.openCache(item);
        else if (item.type === 'shelter') this.restAtShelter(item);
        else if (item.type === 'tower') this.activateTower(item);
    }

    collectCell(cell) {
        if (cell.taken) return;
        cell.taken = true;
        cell.root.setEnabled(false);
        this.cellsCollected++;
        Sound3D.play('assets/sounds/ashfall_pickup.wav', { at: this.player, volume: .78 });
        this.emitToast(cell.label.toUpperCase() + ' НАЙДЕНА', 2.8);
        this.say('МИРА', cell.lore, 5.6);
        if (this.cellsCollected === 1) {
            this.activateEnemy(1);
            this.schedule(6.2, 'НАДЯ // РАДИО', 'Первый контур ожил. Слышишь?\nЭто не ветер. Не стой на открытом месте.', 5.4);
        }
        if (this.cellsCollected === 2) {
            this.activateEnemy(2);
            this.schedule(4.8, 'НАДЯ // РАДИО', 'У маяка осталось одно место для ответа.\nТы почти там, Мира.', 5.2);
        }
        if (this.cellsCollected === 3) {
            this.tower.locked = false;
            this.objective = 'Доберитесь до маяка и включите его';
            this.emitToast('МАЯК ПРИНЯЛ ВСЕ ТРИ ЯЧЕЙКИ', 3.2);
            this.schedule(3.8, 'НАДЯ // РАДИО', 'Я вижу питание на гребне.\nИди к свету — он уже знает твоё имя.', 5.4);
        }
    }

    readNote(note) {
        if (note.read) return;
        note.read = true;
        note.crystal.material = this.materials.ash;
        this.say(note.title, note.text, 6);
        this.emitToast('ПАМЯТЬ СОХРАНЕНА', 2);
    }

    openCache(cache) {
        if (cache.opened) return;
        cache.opened = true;
        cache.root.setEnabled(false);
        this.lures = Math.min(5, this.lures + 1);
        this.health = Math.min(1, this.health + .24);
        Sound3D.play('assets/sounds/ashfall_pickup.wav', { at: this.player, volume: .55 });
        this.emitToast('НАЙДЕНО: ПРИМАНКА +1 · ПЕРЕВЯЗКА', 2.5);
    }

    restAtShelter() {
        this.health = 1; this.stamina = 1;
        this.say('МИРА', 'Огонь ещё помнит, как звучал дом.', 3.7);
        this.emitToast('ТЕПЛО ВОССТАНОВЛЕНО', 2.1);
    }

    activateTower(tower) {
        if (this.cellsCollected < 3) { this.emitToast('МАЯКУ НЕ ХВАТАЕТ ЯЧЕЕК', 1.8); return; }
        if (this.completed) return;
        this.completed = true;
        this.started = false;
        this.beaconActive = true;
        tower.beacon.material = this.materials.beacon;
        tower.beam.material = this.materials.beacon;
        tower.beam.scaling.x = tower.beam.scaling.z = 3.2;
        Sound3D.play('assets/sounds/ashfall_beacon.wav', { at: tower, volume: .95, falloffMax: 1500 });
        this.emitToast('МАЯК: ПЕРЕДАЧА НАЧАТА', 4);
        this.say('МАЯК // НЕИЗВЕСТНЫЙ ГОЛОС', 'Мира. Если ты слышишь меня — ты не последняя.\nНе иди на север. Иди туда, где всё началось.', 7.5);
        this.schedule(8.6, 'НАДЯ // РАДИО', 'Это не мой голос… Но это голос твоей сестры.', 5.2);
        this.schedule(15.2, '', '', 0, () => this.showEnding());
    }

    showEnding() {
        if (!this.titleScreen || !this.titleContent) return;
        const art = document.getElementById('title-art');
        if (art) art.style.filter = 'saturate(1.05) brightness(.72) contrast(1.08)';
        this.titleContent.innerHTML = [
            '<p class="eyebrow">Конец пролога</p>',
            '<h1>СИГНАЛ<span>ПРИНЯТ</span></h1>',
            '<div class="title-rule"></div>',
            '<p class="logline">Маяк не просил о спасении. Он передал маршрут — и голос Леи, пропавшей в первый день Тишины.</p>',
            '<div class="start-row"><button id="restart-game" type="button">Пройти ещё раз</button></div>',
            '<p class="title-fineprint">Спасибо за прохождение вертикального среза «Пепел: Эхо маяка». Следующая глава — за северным хребтом.</p>'
        ].join('');
        const restart = document.getElementById('restart-game');
        if (restart) restart.addEventListener('click', () => window.location.reload());
        this.titleScreen.classList.remove('is-hidden');
    }

    // -------------------------------------------------------------------------
    // Dialogue, atmosphere and per-frame update
    // -------------------------------------------------------------------------

    schedule(after, speaker, text, duration, action) {
        this.timeline.push({ at: this.clock + after, speaker: speaker, text: text, duration: duration, action: action || null, done: false });
    }

    say(speaker, text, duration) {
        this.dialogue = { speaker: speaker || '', text: text || '', until: this.clock + (duration || 4.5) };
        const panel = UI.get('dialoguePanel');
        const speakerEl = UI.get('dialogueSpeaker');
        const textEl = UI.get('dialogueText');
        if (panel) panel.show(true);
        if (speakerEl) speakerEl.setText(speaker || 'ЭФИР');
        if (textEl) textEl.setText(this.wrap(text || '', 63));
    }

    wrap(text, width) {
        const lines = [];
        for (const paragraph of String(text).split('\n')) {
            let line = '';
            for (const word of paragraph.split(' ')) {
                const next = line ? line + ' ' + word : word;
                if (next.length > width && line) { lines.push(line); line = word; }
                else line = next;
            }
            if (line) lines.push(line);
        }
        return lines.slice(0, 3).join('\n');
    }

    emitToast(text, duration) {
        const toast = UI.get('toast');
        if (toast) toast.setText(text).show(true);
        this.toastUntil = this.clock + (duration || 2);
    }

    emitDanger(text) {
        const danger = UI.get('danger');
        if (danger) danger.setText(text).show(true);
        this.dangerUntil = this.clock + .8;
    }

    updateDialogue() {
        for (const item of this.timeline) {
            if (!item.done && this.clock >= item.at) {
                item.done = true;
                if (item.action) item.action();
                else this.say(item.speaker, item.text, item.duration);
            }
        }
        if (this.dialogue && this.clock >= this.dialogue.until) {
            this.dialogue = null;
            const panel = UI.get('dialoguePanel');
            if (panel) panel.show(false);
        }
        if (this.clock >= this.toastUntil) {
            const toast = UI.get('toast');
            if (toast) toast.show(false);
        }
        if (this.clock >= this.dangerUntil) {
            const danger = UI.get('danger');
            if (danger) danger.show(false);
        }
    }

    updateAtmosphere(dt) {
        if (this.ashInstances) {
            for (let i = 0; i < this.ash.length; i++) {
                const mote = this.ash[i], t = this.clock + mote.phase;
                this.ashInstances.set(i, {
                    x: mote.x + Math.sin(t * .39) * 27,
                    y: mote.y + Math.cos(t * .31) * 19,
                    h: mote.base + Math.sin(t * .9) * 8,
                    scale: .72,
                    heading: 0
                });
            }
            this.ashInstances.flush();
        }
        for (const thing of this.mist) {
            const t = this.clock + thing.phase;
            if (thing.kind === 'fog') {
                thing.mesh.position.y = thing.base + Math.sin(t * .52) * 7;
                thing.mesh.visibility = .52 + Math.sin(t * .39) * .13;
            } else if (thing.kind === 'water') {
                thing.mesh.position.y = thing.base + Math.sin(t * .65) * .8;
            }
        }
        for (const cell of this.cells) {
            if (cell.taken) continue;
            cell.root.position.y = this.ground(cell.x, cell.y) + 42 + Math.sin(this.clock * 2 + cell.phase) * 6;
            cell.ring.rotation.z = this.clock * .9 + cell.phase;
            cell.marker.visibility = .28 + Math.sin(this.clock * 1.7 + cell.phase) * .12;
        }
        if (this.tower) {
            const pulse = .86 + Math.sin(this.clock * 2.4) * .14;
            this.tower.beacon.scaling.set(pulse, pulse, pulse);
            this.tower.beam.visibility = this.beaconActive ? .55 + Math.sin(this.clock * 3) * .2 : .18 + Math.sin(this.clock * 1.6) * .08;
        }
        for (const lure of this.lureObjects) {
            lure.mesh.position.y = this.ground(lure.x, lure.y) + 20 + Math.sin(this.clock * 9) * 4;
            lure.mesh.scaling.setAll(.8 + Math.sin(this.clock * 8) * .18);
        }
        for (const wave of [...this.pulseWaves]) {
            const age = this.clock - wave.born;
            wave.mesh.scaling.setAll(1 + age * 5.8);
            wave.mesh.visibility = Math.max(0, 1 - age * 1.35);
            if (age > .78) { wave.mesh.dispose(); this.pulseWaves.splice(this.pulseWaves.indexOf(wave), 1); }
        }
        for (const lure of [...this.lureObjects]) {
            if (this.clock >= lure.until) {
                lure.handle.stop(); lure.mesh.dispose();
                this.lureObjects.splice(this.lureObjects.indexOf(lure), 1);
            }
        }
    }

    updateStory() {
        if (!this.storyFlags.has('tracks') && this.player.x > 545) {
            this.storyFlags.add('tracks');
            this.say('НАДЯ // РАДИО', 'Держись рельсов. Они ведут к станции.\nИ не поднимай головы, когда услышишь шёпот.', 5.4);
        }
        if (!this.storyFlags.has('station') && this.player.x > 930 && this.player.y < 1300) {
            this.storyFlags.add('station');
            this.say('МИРА', 'Здесь было слишком много людей, чтобы\nв долине стало так тихо.', 4.5);
        }
        if (!this.storyFlags.has('ridge') && this.player.x > 1420 && this.player.y < 870) {
            this.storyFlags.add('ridge');
            this.say('НАДЯ // РАДИО', 'Гребень впереди. Маяк видит тебя.\nНе давай Тишине выйти первой.', 5.2);
        }
    }

    updateHud() {
        const setBar = (id, value) => { const element = UI.get(id); if (element) element.setValue(value); };
        setBar('health', this.health);
        setBar('stamina', this.stamina);
        setBar('pulse', Math.max(0, Math.min(1, (this.clock - this.pulseReadyAt + ASHFALL_PULSE_COOLDOWN) / ASHFALL_PULSE_COOLDOWN)));
        setBar('noise', this.noise);
        const cells = UI.get('cells');
        if (cells) cells.setText('ЯЧЕЙКИ  ' + this.cellsCollected + ' / 3');
        const lures = UI.get('lures');
        if (lures) lures.setText('F  ПРИМАНКА  ' + this.lures + (this.clock < this.lureReadyAt ? ' · ...' : ''));
        const touchStatus = document.getElementById('touch-hp');
        if (touchStatus) touchStatus.textContent = '♥ ' + Math.ceil(this.health * 100) + '% · ЯЧЕЙКИ ' + this.cellsCollected + '/3';
        const objective = UI.get('objective');
        if (objective) objective.setText(this.objective);
    }

    update(dt) {
        this.clock += dt;
        this.updateAtmosphere(dt);
        this.updateDialogue();
        if (this.paused) { this.updateHud(); return; }
        if (this.started) {
            this.updatePlayer(dt);
            this.updateEnemies(dt);
            this.updateInteractionHint();
            this.updateStory();
        } else {
            this.noise += (0 - this.noise) * Math.min(1, dt * 4);
        }
        this.updateHud();
    }
}
