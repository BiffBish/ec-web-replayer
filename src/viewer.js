/*global
URL,navigator,THREE,Stats,dat,environments,createVignetteBackground,DEFAULT_CAMERA,IS_IOS,MAP_NAMES,Preset
*/
const THREE = window.THREE = require('three');
import { SpriteText2D, textAlign } from 'three-text2d'
const Stats = require('../lib/stats.min');
const dat = require('dat.gui');
const environments = require('../assets/environment/index');
const createVignetteBackground = require('three-vignette-background');
const zlib = require('zlib');
const unzipStream = require('unzip-stream');
const createReadStream = require('filereader-stream');
const readline = require('readline-browser');
const { Slider, Direction, Button, PlayerIcon, FormattedTime } = require('react-player-controls')

// TODO Don't need most of these...
require('three/examples/js/loaders/FBXLoader');
require('three/examples/js/loaders/DDSLoader');
require('three/examples/js/controls/OrbitControls');
require('three/examples/js/loaders/RGBELoader');
require('three/examples/js/loaders/HDRCubeTextureLoader');
require('three/examples/js/pmrem/PMREMGenerator');
require('three/examples/js/pmrem/PMREMCubeUVPacker');

const DEFAULT_CAMERA = '[default]';
const PLAYER_SIZE = 0.4;
const PLAYER_MESH_SEGMENTS = 10;
const NAME_OFFSET_Y = -4.0;
const NAME_SCALE = 0.049;
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

// glTF texture types. `envMap` is deliberately omitted, as it's used internally
// by the loader but not part of the glTF format.
const MAP_NAMES = [
    'map',
    'aoMap',
    'emissiveMap',
    'glossinessMap',
    'metalnessMap',
    'normalMap',
    'roughnessMap',
    'specularMap',
];

const EC_MAPS = {
    'mpl_combat_gauss': {
        'name': "Surge",
        'fileName': 'assets/models/maps/surge_minimap.fbx',
        'offset': {
           'position': {
            'x': 21.8, 'y': -1.37, 'z': 45.7
            },
            "rotation": {
                'x': 0, 'y': 0, 'z': 0
            },
            "scale": {
                'x': 0.56, 'y': 0.56, 'z': 0.56
            } 
        }
        
    },

    'mpl_combat_fission': {
        'name': "Fission",
        'fileName': 'assets/models/maps/fission_minimap.fbx',
        'offset': {
           'position': {
                'x': -0.5, 'y': -12.43, 'z': 21
            },
            "rotation": {
                'x': 0, 'y': 0, 'z': 0
            },
            "scale": {
                'x': 0.588, 'y': 0.588, 'z': 0.588
            } 
        }
    },

    'mpl_combat_dyson': {
        'name': "Dyson",
        'fileName': 'assets/models/maps/dyson_minimap.fbx',
        'offset': {
            'position': {
                'x': 0, 'y': -3.95, 'z': 0
            },
            "rotation": {
                'x': 0, 'y': 0, 'z': 0
            },
            "scale": {
                'x': 0.92377, 'y': 0.92377, 'z': 0.92377
            }   
        }
    },

    'mpl_combat_combustion': {
        'name': "Combustion",
        'fileName': 'assets/models/maps/combustion_minimap.fbx',
        "offset": {
            'position': {
                'x': 0, 'y': -83.3, 'z': 26.2
            },
            "rotation": {
                'x': 0, 'y': 80, 'z': 0
            },
            "scale": {
                'x': -0.588, 'y': 0.588, 'z': -0.588
            } 
        }
    }
}

const Preset = {ASSET_GENERATOR: 'assetgenerator'};

//var gunzip = zlib.createUnzip();
var unzip = unzipStream.Parse();
var rootFile = "";
var lineReader;
var isMapLoaded = false;
var currentTimestamp = 0;
var currentFrame = {};
var totalPlayers = 0;
var lastTotalPlayers = 0;   // Last frame player count
const REALTIME_STEP = 25;  // realtime is actually 350
var step = 1; // Frames to step
var stepCount = 0;
var stepping = false;
var interval;

var blueTeam = new Map();
var orangeTeam = new Map();

var blueTeamNames = new Map();
var orangeTeamNames = new Map();

module.exports = class Viewer {

    constructor(el, options) {
        this.el = el;
        this.options = options;

        this.lights = [];
        this.content = null;
        this.mixer = null;
        this.clips = [];
        this.gui = null;

        this.state = {
            environment: options.preset === Preset.ASSET_GENERATOR
                ? 'Footprint Court (HDR)'
                : environments[1].name,
            background: false,
            playbackSpeed: 1.0,
            actionStates: {},
            camera: DEFAULT_CAMERA,
            wireframe: false,
            skeleton: false,
            grid: false,

            // Lights
            addLights: true,
            exposure: 1.0,
            textureEncoding: 'sRGB',
            ambientIntensity: 0.3,
            ambientColor: 0xFFFFFF,
            directIntensity: 0.8 * Math.PI, // TODO(#116)
            directColor: 0xFFFFFF,
            bgColor1: '#ffffff',
            bgColor2: '#353535'
        };

        this.prevTime = 0;

        this.stats = new Stats();
        this.stats.dom.height = '48px';
        [].forEach.call(this.stats.dom.children, (child) => (child.style.display = ''));

        this.scene = new THREE.Scene();

        const fov = options.preset === Preset.ASSET_GENERATOR
            ? 0.8 * 180 / Math.PI
            : 60;
        this.defaultCamera = new THREE.PerspectiveCamera(fov, el.clientWidth / el.clientHeight, 0.0000001, 1000);
        this.activeCamera = this.defaultCamera;
        this.scene.add(this.defaultCamera);

        this.renderer = window.renderer = new THREE.WebGLRenderer({antialias: true});
        this.renderer.physicallyCorrectLights = true;
        this.renderer.gammaOutput = true;
        this.renderer.gammaFactor = 2.2;
        this.renderer.setClearColor(0xcccccc);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(el.clientWidth, el.clientHeight);

        this.controls = new THREE.OrbitControls(this.defaultCamera, this.renderer.domElement);
        this.controls.autoRotate = false;
        this.controls.autoRotateSpeed = -10;
        this.controls.screenSpacePanning = true;

        this.background = createVignetteBackground({
            aspect: this.defaultCamera.aspect,
            grainScale: IS_IOS ? 0 : 0.001, // mattdesl/three-vignette-background#1
            colors: [this.state.bgColor1, this.state.bgColor2]
        });

        this.el.appendChild(this.renderer.domElement);

        this.cameraCtrl = null;
        this.cameraFolder = null;
        this.animFolder = null;
        this.animCtrls = [];
        this.morphFolder = null;
        this.morphCtrls = [];
        this.skeletonHelpers = [];
        this.gridHelper = null;
        this.axesHelper = null;

        this.addGUI();

        this.animate = this.animate.bind(this);
        requestAnimationFrame(this.animate);
        window.addEventListener('resize', this.resize.bind(this), false);
    }

    animate(time) {

        requestAnimationFrame(this.animate);

        const dt = (time - this.prevTime) / 1000;

        this.controls.update();
        this.stats.update();
        this.mixer && this.mixer.update(dt);
        this.render();

        this.prevTime = time;

    }

    render() {

        this.renderer.render(this.scene, this.activeCamera);

    }

    resize() {

        const {clientHeight, clientWidth} = this.el.parentElement;

        this.defaultCamera.aspect = clientWidth / clientHeight;
        this.defaultCamera.updateProjectionMatrix();
        this.background.style({aspect: this.defaultCamera.aspect});
        this.renderer.setSize(clientWidth, clientHeight);

    }

    stepForward() {
        // console.log("stepped forward");
        // stepping = true;
        // stepCount = 0;
        // lineReader.resume();
    }

    play() {
        console.log("pressed play");   
         interval = setInterval(function() {
            stepping = true;
            stepCount = 0;
            lineReader.resume();
        }, step * REALTIME_STEP);
    }

    pause() {
        console.log("pressed pause");
        clearInterval(interval);
        stepping = false;
        lineReader.pause();
    }

    stepBackward() {
        console.log("stepped backwards");
    }

    rewindToBeginning() {
        console.log("rewindToBeginning");
        lineReader.close();

        createReadStream(rootFile, {start: 0 }).pipe(unzip).on('entry', (entry) => {
            lineReader = readline.createInterface({
                input: entry
            });
            lineReader.pause();
        });

        // lineReader = readline.createInterface({
        //       input: createReadStream(rootFile, {start: 0 }).pipe(unzip).on()
        // });
        
    }

    load(url, rootFile, rootPath, assetMap) {
        this.rootFile = rootFile;
        console.log("Reading file: " + rootFile + " rootPath: " + rootPath + " assetMap: " + assetMap);
        // Load
        return new Promise((resolve, reject) => {
            // Unzip the first file as a stream and pass it to lineReader
            createReadStream(rootFile, {start: 0 }).pipe(unzip).on('entry', (entry) => {
                lineReader = readline.createInterface({
                    input: entry
                });

                console.log("Waiting for data from stream");
                lineReader.on('line', (line) => {
                const timestamp = line.substring(0, line.indexOf("\t"));
                currentFrame = JSON.parse(line.substring(line.indexOf("\t"), line.length));
                //console.log("Timestamp: " + timestamp);
                //console.log("Current frame: " + JSON.stringify(currentFrame));
                if (!isMapLoaded) {
                    isMapLoaded = true;
                    totalPlayers = this.countPlayers(currentFrame.teams);
                    this.loadMap(EC_MAPS[currentFrame.map_name]);
                    lineReader.pause();
                } else {
                    totalPlayers = this.countPlayers(currentFrame.teams);
                    if (totalPlayers > 0 && totalPlayers != lastTotalPlayers) {
                        this.spawnPlayers();
                    } else if (totalPlayers > 0) {
                        this.updatePlayerPositions();
                    }
                    
                    lastTotalPlayers = totalPlayers;
                    
                    if (stepping) {
                        if (stepCount == step) {
                            stepping = false;
                            lineReader.pause();
                        }
                        stepCount += 1;
                    }
                }
             });
            });
            
             
            });
    }

    loadMap(ecMap) {
        const manager = new THREE.LoadingManager();
        const blobURLs = [];

        manager.onLoad = () => {
            console.log("Loaded map: " + ecMap.name);
        }

        manager.onError = (url) => {
             const message = 'Error loading map: ' + ecMap.name;
             console.error('[Echo Combat Viewer] ' + message);
        };

        const loader = new THREE.FBXLoader(manager);
        loader.setCrossOrigin('anonymous');
        
        loader.load(ecMap.fileName, (map) => {
             const clips = map.animations || [];

            // Each map has specific offset from game data
            map.position.set(ecMap.offset.position.z, ecMap.offset.position.y, ecMap.offset.position.x);
            map.scale.set(-ecMap.offset.scale.x, ecMap.offset.scale.y, -ecMap.offset.scale.z);
            map.rotation.set(ecMap.offset.rotation.x, ecMap.offset.rotation.y, ecMap.offset.rotation.z);
             // Original Surge scale + position:
             // map.scale.set(-0.555,0.555,-0.555);
             // map.position.set(45,0,20);

             
             this.setContent(map, clips);

             resolve(map);

        });
    }

    countPlayers(teams) {
        if (!teams[0].hasOwnProperty('players') || !teams[1].hasOwnProperty('players')) {
            console.log("Error: No players!");
            return 0;
        }
        return teams[0].players.length + teams[1].players.length;
    }

    spawnPlayers() {
        console.log("Spawning new players");
        // const manager = new THREE.LoadingManager();
        // const loader = new THREE.FBXLoader(manager);
        // var playersSpawned = 0;

        // manager.onLoad = () => {
        //     playersSpawned += 1;
        //     if (playersSpawned == totalPlayers) {
        //         isMapLoaded = true;
        //         console.log("All players loaded!");
        //     }
        // }

        // manager.onError = (url) => {
        //      const message = 'Error loading player: ' + url;
        //      console.error('[Echo Combat Viewer] ' + message);
        // };

        // Blue team
        currentFrame.teams[0].players.forEach((player) => {
            // Only add players we have no record of
            if (blueTeam.has(player.userid)) {
                return;
            }
            console.log("Adding BLUE TEAM player: " + player.name);
            const geometry = new THREE.SphereGeometry(PLAYER_SIZE, PLAYER_MESH_SEGMENTS, PLAYER_MESH_SEGMENTS);
            const material = new THREE.MeshBasicMaterial({ color: 0x0058cc });
            const model = new THREE.Mesh(geometry, material);
            const text = new SpriteText2D(player.name, { align: textAlign.center, font: '40px Arial', fillStyle: '#0058cc', antialias: false  })
            model.position.set(player.body.position[0], player.body.position[1], player.body.position[2]);
            text.position.set(player.body.position[0], player.body.position[1]-NAME_OFFSET_Y, player.body.position[2]);
            text.scale.set(NAME_SCALE, NAME_SCALE, NAME_SCALE);
            this.scene.add(model);
            this.scene.add(text)
            blueTeam.set(player.userid, model);
            blueTeamNames.set(player.userid, text);

            // loader.load('assets/models/player_blue.fbx', (model) => {
            //     this.scene.add(model);
            //     player.set("model", model);
            // });
        });


        // Orange team
        currentFrame.teams[1].players.forEach((player) => {
            // Only add players we have no record of
            if (orangeTeam.has(player.userid)) {
                return;
            }
            console.log("Adding ORANGE TEAM player: " + player.name);
            const geometry = new THREE.SphereGeometry(PLAYER_SIZE, PLAYER_MESH_SEGMENTS, PLAYER_MESH_SEGMENTS);
            const material = new THREE.MeshBasicMaterial({ color: 0xeb5e34 });
            const model = new THREE.Mesh(geometry, material);
            const text = new SpriteText2D(player.name, { align: textAlign.center, font: '40px Arial', fillStyle: '#eb5e34', antialias: false  })
            model.position.set(player.body.position[0], player.body.position[1], player.body.position[2]);
            text.position.set(player.body.position[0], player.body.position[1]-NAME_OFFSET_Y, player.body.position[2]);
            text.scale.set(NAME_SCALE, NAME_SCALE, NAME_SCALE);
            this.scene.add(model);
            this.scene.add(text)
            orangeTeam.set(player.userid, model);
            orangeTeamNames.set(player.userid, text);
            // loader.load('assets/models/player_orange.fbx', (model) => {
            //     this.scene.add(model);
            //     player.set("model", model);
            // });
        });

        //console.log("Blue team: " + currentFrame.teams[0].players.length + ", Orange team: " + currentFrame.teams[1].players.length);
    }

    updatePlayerPositions() {
        //console.log("Updating player positions");
        currentFrame.teams[0].players.forEach((player) => {
            blueTeam.get(player.userid).position.set(player.body.position[0], player.body.position[1], player.body.position[2]);
            blueTeamNames.get(player.userid).position.set(player.body.position[0], player.body.position[1]-NAME_OFFSET_Y, player.body.position[2]);
        });
        currentFrame.teams[1].players.forEach((player) => {
            orangeTeam.get(player.userid).position.set(player.body.position[0], player.body.position[1], player.body.position[2]);
            orangeTeamNames.get(player.userid).position.set(player.body.position[0], player.body.position[1]-NAME_OFFSET_Y, player.body.position[2]);
        });
    }

    /**
     * @param {THREE.Object3D} object
     * @param {Array<THREE.AnimationClip} clips
     */
    setContent(object, clips) {

        this.clear();

        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3()).length();
        const center = box.getCenter(new THREE.Vector3());

        this.controls.reset();

        // object.position.x += (object.position.x - center.x);
        // object.position.y += (object.position.y - center.y);
        // object.position.z += (object.position.z - center.z);
        // this.controls.maxDistance = size * 10;
        this.defaultCamera.near = size / 100;
        this.defaultCamera.far = size * 100;
        this.defaultCamera.updateProjectionMatrix();

        if (this.options.cameraPosition) {

            this.defaultCamera.position.fromArray(this.options.cameraPosition);
            this.defaultCamera.lookAt(new THREE.Vector3());

        } else {

            this.defaultCamera.position.copy(center);
            this.defaultCamera.position.x += size / 2.0;
            this.defaultCamera.position.y += size / 5.0;
            this.defaultCamera.position.z += size / 2.0;
            this.defaultCamera.lookAt(center);

        }

        this.setCamera(DEFAULT_CAMERA);

        this.controls.saveState();


        this.scene.add(object);
        this.content = object;

        this.state.addLights = true;
        this.content.traverse((node) => {
            if (node.isLight) {
                this.state.addLights = false;
            }
        });

        this.setClips(clips);

        this.updateLights();
        this.updateGUI();
        this.updateEnvironment();
        this.updateTextureEncoding();
        this.updateDisplay();
        this.options.spinner.style.display = 'none'
        window.scene = this.content;
        console.info('[FBX Viewer] THREE.Scene exported as `window.scene`.');
        //this.printGraph(this.content);

    }

    printGraph(node) {

        console.group(' <' + node.type + '> ' + node.name);
        node.children.forEach((child) => this.printGraph(child));
        console.groupEnd();

    }

    /**
     * @param {Array<THREE.AnimationClip} clips
     */
    setClips(clips) {
        if (this.mixer) {
            this.mixer.stopAllAction();
            this.mixer.uncacheRoot(this.mixer.getRoot());
            this.mixer = null;
        }

        this.clips = clips;
        if (!clips.length) {
            return;
        }

        this.mixer = new THREE.AnimationMixer(this.content);
    }

    playAllClips() {
        this.clips.forEach((clip) => {
            this.mixer.clipAction(clip).reset().play();
            this.state.actionStates[clip.name] = true;
        });
    }

    /**
     * @param {string} name
     */
    setCamera(name) {
        if (name === DEFAULT_CAMERA) {
            this.controls.enabled = true;
            this.activeCamera = this.defaultCamera;
        } else {
            this.controls.enabled = false;
            this.content.traverse((node) => {
                if (node.isCamera && node.name === name) {
                    this.activeCamera = node;
                }
            });
        }
    }

    updateTextureEncoding() {
        const encoding = this.state.textureEncoding === 'sRGB'
            ? THREE.sRGBEncoding
            : THREE.LinearEncoding;
        traverseMaterials(this.content, (material) => {
            if (material.map) {
                material.map.encoding = encoding;
            }
            if (material.emissiveMap) {
                material.emissiveMap.encoding = encoding;
            }
            if (material.map || material.emissiveMap) {
                material.needsUpdate = true;
            }
        });
    }

    updateLights() {
        const state = this.state;
        const lights = this.lights;

        if (state.addLights && !lights.length) {
            this.addLights();
        } else if (!state.addLights && lights.length) {
            this.removeLights();
        }

        this.renderer.toneMappingExposure = state.exposure;

        if (lights.length === 2) {
            lights[0].intensity = state.ambientIntensity;
            lights[0].color.setHex(state.ambientColor);
            lights[1].intensity = state.directIntensity;
            lights[1].color.setHex(state.directColor);
        }
    }

    addLights() {
        const state = this.state;

        if (this.options.preset === Preset.ASSET_GENERATOR) {
            const hemiLight = new THREE.HemisphereLight();
            hemiLight.name = 'hemi_light';
            this.scene.add(hemiLight);
            this.lights.push(hemiLight);
            return;
        }

        const light1 = new THREE.AmbientLight(state.ambientColor, state.ambientIntensity);
        light1.name = 'ambient_light';
        this.defaultCamera.add(light1);

        const light2 = new THREE.DirectionalLight(state.directColor, state.directIntensity);
        light2.position.set(0.5, 0, 0.866); // ~60º
        light2.name = 'main_light';
        this.defaultCamera.add(light2);

        this.lights.push(light1, light2);
    }

    removeLights() {

        this.lights.forEach((light) => light.parent.remove(light));
        this.lights.length = 0;

    }

    updateEnvironment() {

        const environment = environments.filter((entry) => entry.name === this.state.environment)[0];

        this.getCubeMapTexture(environment).then(({envMap, cubeMap}) => {

            if ((!envMap || !this.state.background) && this.activeCamera === this.defaultCamera) {
                this.scene.add(this.background);
            } else {
                this.scene.remove(this.background);
            }

            traverseMaterials(this.content, (material) => {
                if (material.isMeshStandardMaterial) {
                    material.envMap = envMap;
                    material.needsUpdate = true;
                }
            });

            this.scene.background = this.state.background ? cubeMap : null;

        });

    }

    getCubeMapTexture(environment) {
        const {path, format} = environment;

        // no envmap
        if (!path) {
            return Promise.resolve({envMap: null, cubeMap: null});
        }

        const cubeMapURLs = [
            path + 'posx' + format, path + 'negx' + format,
            path + 'posy' + format, path + 'negy' + format,
            path + 'posz' + format, path + 'negz' + format
        ];

        // hdr
        if (format === '.hdr') {

            return new Promise((resolve) => {

                new THREE.HDRCubeTextureLoader().load(THREE.UnsignedByteType, cubeMapURLs, (hdrCubeMap) => {

                    const pmremGenerator = new THREE.PMREMGenerator(hdrCubeMap);
                    pmremGenerator.update(this.renderer);

                    const pmremCubeUVPacker = new THREE.PMREMCubeUVPacker(pmremGenerator.cubeLods);
                    pmremCubeUVPacker.update(this.renderer);

                    resolve({
                        envMap: pmremCubeUVPacker.CubeUVRenderTarget.texture,
                        cubeMap: hdrCubeMap
                    });

                });

            });

        }

        // standard
        const envMap = new THREE.CubeTextureLoader().load(cubeMapURLs);
        envMap.format = THREE.RGBFormat;
        return Promise.resolve({envMap, cubeMap: envMap});

    }

    updateDisplay() {
        if (this.skeletonHelpers.length) {
            this.skeletonHelpers.forEach((helper) => this.scene.remove(helper));
        }

        traverseMaterials(this.content, (material) => {
            material.wireframe = this.state.wireframe;
        });

        this.content.traverse((node) => {
            if (node.isMesh && node.skeleton && this.state.skeleton) {
                const helper = new THREE.SkeletonHelper(node.skeleton.bones[0].parent);
                helper.material.linewidth = 3;
                this.scene.add(helper);
                this.skeletonHelpers.push(helper);
            }
        });

        if (this.state.grid !== Boolean(this.gridHelper)) {
            if (this.state.grid) {
                this.gridHelper = new THREE.GridHelper();
                this.axesHelper = new THREE.AxesHelper();
                this.axesHelper.renderOrder = 999;
                this.axesHelper.onBeforeRender = (renderer) => renderer.clearDepth();
                this.scene.add(this.gridHelper);
                this.scene.add(this.axesHelper);
            } else {
                this.scene.remove(this.gridHelper);
                this.scene.remove(this.axesHelper);
                this.gridHelper = null;
                this.axesHelper = null;
            }
        }
    }

    updateBackground() {
        this.background.style({colors: [this.state.bgColor1, this.state.bgColor2]});
    }

    addGUI() {

        const gui = this.gui = new dat.GUI({autoPlace: false, width: 260, hideable: true});

        // Playback controls
        const playbackFolder = gui.addFolder('Playback');
        const playButton = playbackFolder.add(this, "play");
        const pauseButton = playbackFolder.add(this, "pause");
        const stepBackward = playbackFolder.add(this, "stepBackward");
        const stepForward = playbackFolder.add(this, "stepForward");
        const rewindToBeginning = playbackFolder.add(this, "rewindToBeginning");

        // Display controls.
        
        const dispFolder = gui.addFolder('Display');
        const envBackgroundCtrl = dispFolder.add(this.state, 'background');
        envBackgroundCtrl.onChange(() => this.updateEnvironment());
        const wireframeCtrl = dispFolder.add(this.state, 'wireframe');
        wireframeCtrl.onChange(() => this.updateDisplay());
        const skeletonCtrl = dispFolder.add(this.state, 'skeleton');
        skeletonCtrl.onChange(() => this.updateDisplay());
        const gridCtrl = dispFolder.add(this.state, 'grid');
        gridCtrl.onChange(() => this.updateDisplay());
        dispFolder.add(this.controls, 'autoRotate');
        dispFolder.add(this.controls, 'screenSpacePanning');
        const bgColor1Ctrl = dispFolder.addColor(this.state, 'bgColor1');
        const bgColor2Ctrl = dispFolder.addColor(this.state, 'bgColor2');
        bgColor1Ctrl.onChange(() => this.updateBackground());
        bgColor2Ctrl.onChange(() => this.updateBackground());

        // Lighting controls.
        const lightFolder = gui.addFolder('Lighting');
        const encodingCtrl = lightFolder.add(this.state, 'textureEncoding', ['sRGB', 'Linear']);
        encodingCtrl.onChange(() => this.updateTextureEncoding());
        lightFolder.add(this.renderer, 'gammaOutput').onChange(() => {
            traverseMaterials(this.content, (material) => {
                material.needsUpdate = true;
            });
        });
        const envMapCtrl = lightFolder.add(this.state, 'environment', environments.map((env) => env.name));
        envMapCtrl.onChange(() => this.updateEnvironment());
        [
            lightFolder.add(this.state, 'exposure', 0, 2),
            lightFolder.add(this.state, 'addLights').listen(),
            lightFolder.add(this.state, 'ambientIntensity', 0, 2),
            lightFolder.addColor(this.state, 'ambientColor'),
            lightFolder.add(this.state, 'directIntensity', 0, 4), // TODO(#116)
            lightFolder.addColor(this.state, 'directColor')
        ].forEach((ctrl) => ctrl.onChange(() => this.updateLights()));

        // Animation controls.
        this.animFolder = gui.addFolder('Animation');
        this.animFolder.domElement.style.display = 'none';
        const playbackSpeedCtrl = this.animFolder.add(this.state, 'playbackSpeed', 0, 1);
        playbackSpeedCtrl.onChange((speed) => {
            if (this.mixer) {
                this.mixer.timeScale = speed;
            }
        });
        this.animFolder.add({playAll: () => this.playAllClips()}, 'playAll');

        // Morph target controls.
        this.morphFolder = gui.addFolder('Morph Targets');
        this.morphFolder.domElement.style.display = 'none';

        // Camera controls.
        this.cameraFolder = gui.addFolder('Cameras');
        this.cameraFolder.domElement.style.display = 'none';

        // Stats.
        const perfFolder = gui.addFolder('Performance');
        const perfLi = document.createElement('li');
        this.stats.dom.style.position = 'static';
        perfLi.appendChild(this.stats.dom);
        perfLi.classList.add('gui-stats');
        perfFolder.__ul.appendChild(perfLi);

        const guiWrap = document.createElement('div');
        this.el.appendChild(guiWrap);
        guiWrap.classList.add('gui-wrap');
        guiWrap.appendChild(gui.domElement);
        gui.open();

    }

    updateGUI() {
        this.cameraFolder.domElement.style.display = 'none';

        this.morphCtrls.forEach((ctrl) => ctrl.remove());
        this.morphCtrls.length = 0;
        this.morphFolder.domElement.style.display = 'none';

        this.animCtrls.forEach((ctrl) => ctrl.remove());
        this.animCtrls.length = 0;
        this.animFolder.domElement.style.display = 'none';

        const cameraNames = [];
        const morphMeshes = [];
        this.content.traverse((node) => {
            if (node.isMesh && node.morphTargetInfluences) {
                morphMeshes.push(node);
            }
            if (node.isCamera) {
                node.name = node.name || `VIEWER__camera_${cameraNames.length + 1}`;
                cameraNames.push(node.name);
            }
        });

        if (cameraNames.length) {
            this.cameraFolder.domElement.style.display = '';
            if (this.cameraCtrl) {
                this.cameraCtrl.remove();
            }
            const cameraOptions = [DEFAULT_CAMERA].concat(cameraNames);
            this.cameraCtrl = this.cameraFolder.add(this.state, 'camera', cameraOptions);
            this.cameraCtrl.onChange((name) => this.setCamera(name));
        }

        if (morphMeshes.length) {
            this.morphFolder.domElement.style.display = '';
            morphMeshes.forEach((mesh) => {
                if (mesh.morphTargetInfluences.length) {
                    const nameCtrl = this.morphFolder.add({name: mesh.name || 'Untitled'}, 'name');
                    this.morphCtrls.push(nameCtrl);
                }
                for (let i = 0; i < mesh.morphTargetInfluences.length; i++) {
                    const ctrl = this.morphFolder.add(mesh.morphTargetInfluences, i, 0, 1, 0.01).listen();
                    Object.keys(mesh.morphTargetDictionary).forEach((key) => {
                        if (key && mesh.morphTargetDictionary[key] === i) {
                            ctrl.name(key);
                        }
                    });
                    this.morphCtrls.push(ctrl);
                }
            });
        }

        if (this.clips.length) {
            this.animFolder.domElement.style.display = '';
            const actionStates = this.state.actionStates = {};
            this.clips.forEach((clip, clipIndex) => {
                // Autoplay the first clip.
                let action;
                if (clipIndex === 0) {
                    actionStates[clip.name] = true;
                    action = this.mixer.clipAction(clip);
                    action.play();
                } else {
                    actionStates[clip.name] = false;
                }

                // Play other clips when enabled.
                const ctrl = this.animFolder.add(actionStates, clip.name).listen();
                ctrl.onChange((playAnimation) => {
                    action = action || this.mixer.clipAction(clip);
                    action.setEffectiveTimeScale(1);
                    playAnimation ? action.play() : action.stop();
                });
                this.animCtrls.push(ctrl);
            });
        }
    }

    clear() {

        if (!this.content) {
            return;
        }

        this.scene.remove(this.content);

        // dispose geometry
        this.content.traverse((node) => {

            if (!node.isMesh) {
                return;
            }

            node.geometry.dispose();

        });

        // dispose textures
        traverseMaterials(this.content, (material) => {

            MAP_NAMES.forEach((map) => {

                if (material[map]) {
                    material[map].dispose();
                }

            });

        });

    }

};

function traverseMaterials(object, callback) {
    object.traverse((node) => {
        if (!node.isMesh) {
            return;
        }
        const materials = Array.isArray(node.material)
            ? node.material
            : [node.material];
        materials.forEach(callback);
    });
}
