import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

const $ = id => document.getElementById(id);
const viewport = $('viewport');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#b6d5ea');
scene.fog = new THREE.Fog('#b6d5ea', 1100, 3300);
const camera = new THREE.PerspectiveCamera(70,1,0.1,7500);
const renderer = new THREE.WebGLRenderer({antialias: true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.75;
viewport.prepend(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xfaf9ff,0x8594a1,2.4));
const sunlight = new THREE.DirectionalLight(0xfff0dc,2.4);
sunlight.position.set(-300,500,250);scene.add(sunlight);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(10000,10000),new THREE.MeshStandardMaterial({color:'#91aa8e',roughness:1}));
ground.rotation.x = -Math.PI/2;ground.position.y=-0.12;scene.add(ground);
const grid = new THREE.GridHelper(3000,75,0x759585,0x759585);
grid.position.y=-0.08;grid.material.transparent=true;grid.material.opacity=0.07;scene.add(grid);
const editPlane = new THREE.Mesh(new THREE.PlaneGeometry(10000,10000),new THREE.MeshBasicMaterial({visible:false,side:THREE.DoubleSide}));
editPlane.rotation.x = -Math.PI/2;scene.add(editPlane);
let townBox=null, baseTown=null;
let mode='explore', selectedId=null, pointerLocked=false, yaw=0, pitch=-0.16;
const added=new Map();
const keys={};
const clock=new THREE.Clock();
const ray=new THREE.Raycaster();
const mouse=new THREE.Vector2();
let toastTimer;
function toast(msg){const t=$('toast');t.textContent=msg;t.style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.style.display='none',4500);}
function statusText(msg){$('import-status').textContent=msg;}
function setOrientation(){camera.rotation.order='YXZ';camera.rotation.set(pitch,yaw,0);}
function startFly(){if(mode!=='explore')showTab('explore');renderer.domElement.requestPointerLock?.();}
function releaseFly(){if(document.pointerLockElement)document.exitPointerLock();}
document.addEventListener('pointerlockchange',()=>{pointerLocked=document.pointerLockElement===renderer.domElement;$('crosshair').style.display=pointerLocked?'block':'none';$('hint').textContent=pointerLocked?'Press Esc to release the mouse':'Click Enter flythrough to fly around';});
document.addEventListener('mousemove',e=>{if(!pointerLocked)return;yaw-=e.movementX*0.0023;pitch-=e.movementY*0.0023;pitch=THREE.MathUtils.clamp(pitch,-Math.PI*0.48,Math.PI*0.48);setOrientation();});
function resize(){const w=viewport.clientWidth,h=viewport.clientHeight;camera.aspect=w/Math.max(h,1);camera.updateProjectionMatrix();renderer.setSize(w,h,false)}
window.addEventListener('resize',resize);resize();
function resetView(){if(!townBox)return;const center=townBox.getCenter(new THREE.Vector3());const height=Number($('height-reset').value);camera.position.set(center.x,Math.max(height,6),center.z+Math.max(100,townBox.getSize(new THREE.Vector3()).z*0.26));yaw=0;pitch=-0.15;setOrientation();}
function overview(){releaseFly();if(!townBox)return;const size=townBox.getSize(new THREE.Vector3()),center=townBox.getCenter(new THREE.Vector3());camera.position.set(center.x,Math.max(size.x,size.z)*0.83,center.z+size.z*.58);const target=new THREE.Vector3(center.x,10,center.z);camera.lookAt(target);const euler=new THREE.Euler().setFromQuaternion(camera.quaternion,'YXZ');pitch=euler.x;yaw=euler.y;setOrientation();toast('Overhead view. Enter flythrough to move around.');}

function newWorldModel(objText,mtlText){
 const loader=new OBJLoader();
 if(mtlText){const materialLoader=new MTLLoader();const materialSet=materialLoader.parse(mtlText,'');materialSet.preload();loader.setMaterials(materialSet);}
 const object=loader.parse(objText);
 object.traverse(o=>{if(!o.isMesh)return;const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){m.side=THREE.DoubleSide;if(!mtlText)m.color?.set('#e990be');}o.castShadow=false;o.receiveShadow=false;});
 // OBJ from Tinkercad has Z upward. Three.js uses Y upward.
 const orientation=new THREE.Group();orientation.add(object);object.rotation.x=-Math.PI/2;
 orientation.updateMatrixWorld(true);
 const bounds=new THREE.Box3().setFromObject(orientation);
 if(bounds.isEmpty())throw new Error('Model has no geometry');
 const center=bounds.getCenter(new THREE.Vector3());
 object.position.x-=center.x;object.position.z-=center.z;object.position.y-=bounds.min.y;
 orientation.updateMatrixWorld(true);
 return orientation;
}
async function loadCity(){
 try{
  const [objRes,mtlRes]=await Promise.all([fetch('assets/tinker.obj'),fetch('assets/obj.mtl')]);
  if(!objRes.ok||!mtlRes.ok)throw new Error('Could not fetch city files');
  const [obj,mtl]=await Promise.all([objRes.text(),mtlRes.text()]);
  baseTown=newWorldModel(obj,mtl);baseTown.name='Original city (locked)';
  scene.add(baseTown);townBox=new THREE.Box3().setFromObject(baseTown);
  resetView();$('loading').classList.add('hidden');
  await restoreModels();
 }catch(err){$('loading').innerHTML=`<strong>Unable to load the city</strong><span>${escapeHtml(err.message)}</span><span>Open this site through GitHub Pages or a local web server, not by double-clicking index.html.</span>`;console.error(err);}
}
function escapeHtml(str){return String(str).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

const transform = new TransformControls(camera,renderer.domElement);
transform.setMode('translate');transform.setSpace('world');transform.setSize(1.1);
scene.add(transform.getHelper());
transform.addEventListener('dragging-changed',e=>{if(e.value)releaseFly();});
transform.addEventListener('mouseUp',()=>saveLocal());
transform.addEventListener('objectChange',()=>updatePlacementUI());

function selected(){return selectedId?added.get(selectedId):null;}
function selectObject(id){selectedId=id&&added.has(id)?id:null;const entry=selected();if(entry){transform.attach(entry.group);transform.visible=mode==='build';transform.enabled=mode==='build';}else{transform.detach();}updateObjectUI();}
function updateObjectUI(){
 $('object-select').innerHTML='<option value="">None selected</option>' + [...added.values()].map(e=>`<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join('');
 $('object-select').value=selectedId||'';
 $('object-count').textContent=added.size;
 $('objects-list').innerHTML=added.size?[...added.values()].map(e=>`<div class="object-item ${selectedId===e.id?'selected':''}" data-id="${escapeHtml(e.id)}"><span>${escapeHtml(e.name)}</span><small>●</small></div>`).join(''):'<div class="empty">No models added yet.</div>';
 $('delete-btn').disabled=!selected();$('place-btn').disabled=!selected();
 updatePlacementUI();
}
// Direct placement controls are an accessible fallback to dragging 3D transform handles.
const placementFieldIds=['edit-x','edit-y','edit-z','edit-rotation','edit-scale'];
function updatePlacementUI(){
 const e=selected();
 $('placement-controls').classList.toggle('disabled-placement',!e);
 for(const id of placementFieldIds)$(id).disabled=!e;
 for(const id of ['nudge-left','nudge-right','nudge-forward','nudge-back','nudge-up','nudge-down','focus-btn'])$(id).disabled=!e;
 if(!e)return;
 const group=e.group;
 // Keep the active field intact while somebody types.
 const values={'edit-x':group.position.x,'edit-y':group.position.y,'edit-z':group.position.z,'edit-rotation':THREE.MathUtils.radToDeg(group.rotation.y),'edit-scale':group.scale.x};
 for(const [id,value] of Object.entries(values))if(document.activeElement!==$(id))$(id).value=Number(value.toFixed(3));
}
function applyPlacementFields(){
 const entry=selected();if(!entry)return;
 const get=(id,fallback)=>{const str=$(id).value;return str.trim()===''?fallback:Number(str);};
 const g=entry.group;
 const x=get('edit-x',g.position.x),y=get('edit-y',g.position.y),z=get('edit-z',g.position.z);
 const degrees=get('edit-rotation',THREE.MathUtils.radToDeg(g.rotation.y));
 const scale=get('edit-scale',g.scale.x);
 if(![x,y,z,degrees,scale].every(Number.isFinite)||scale<=0){toast('Please enter valid numbers and a size greater than zero.');updatePlacementUI();return;}
 g.position.set(x,y,z);g.rotation.y=THREE.MathUtils.degToRad(degrees);g.scale.setScalar(scale);
 updatePlacementUI();saveLocal();
}
for(const id of placementFieldIds)$(id).addEventListener('change',applyPlacementFields);
function nudge(dx,dz){const e=selected();if(!e)return;const step=Number($('nudge-step').value)||20;e.group.position.x+=dx*step;e.group.position.z+=dz*step;updatePlacementUI();saveLocal();}
$('nudge-left').onclick=()=>nudge(-1,0);
$('nudge-right').onclick=()=>nudge(1,0);
$('nudge-forward').onclick=()=>nudge(0,-1);
$('nudge-back').onclick=()=>nudge(0,1);
$('nudge-up').onclick=()=>nudgeHeight(1);
$('nudge-down').onclick=()=>nudgeHeight(-1);
function nudgeHeight(direction){const e=selected();if(!e)return;const step=Number($('nudge-step').value)||20;e.group.position.y+=direction*step;updatePlacementUI();saveLocal();}
function focusModel(entry=selected()){
 if(!entry)return;
 releaseFly();
 entry.group.updateMatrixWorld(true);
 const b=new THREE.Box3().setFromObject(entry.group);
 const center=b.getCenter(new THREE.Vector3());
 const size=b.getSize(new THREE.Vector3());
 const distance=Math.max(18,size.length()*2.2);
 camera.position.copy(center).add(new THREE.Vector3(distance*0.55,Math.max(14,distance*0.45),distance*0.75));
 camera.lookAt(center);
 const euler=new THREE.Euler().setFromQuaternion(camera.quaternion,'YXZ');pitch=euler.x;yaw=euler.y;setOrientation();
 toast('Selected model centered. Use Move handles, number fields, or arrow buttons.');
}
$('focus-btn').onclick=()=>focusModel();
function positionInFront(group){const dir=new THREE.Vector3();camera.getWorldDirection(dir);dir.y=0;dir.normalize();if(dir.lengthSq()<0.01)dir.set(0,0,-1);group.position.set(camera.position.x+dir.x*30,0,camera.position.z+dir.z*30);}
async function addModel(name,objText,mtlText,id,transformData){
 const group=newWorldModel(objText,mtlText);
 const initialBounds=new THREE.Box3().setFromObject(group);const maxDim=initialBounds.getSize(new THREE.Vector3()).length();
 // Leave smaller student creations a useful default size, without overriding saved transforms.
 if(!transformData && maxDim>150)group.scale.setScalar(100/maxDim);
 if(transformData){group.position.fromArray(transformData.position);group.rotation.fromArray(transformData.rotation);group.scale.fromArray(transformData.scale);}else{positionInFront(group);}
 const uuid=id||crypto.randomUUID();group.userData.modelId=uuid;scene.add(group);added.set(uuid,{id:uuid,name,objText,mtlText,group});selectObject(uuid);saveLocal();if(!transformData && mode==='build')focusModel(added.get(uuid));return uuid;
}
$('model-files').addEventListener('change',async event=>{
 const files=[...event.target.files];const obj=files.find(f=>f.name.toLowerCase().endsWith('.obj'));const mtl=files.find(f=>f.name.toLowerCase().endsWith('.mtl'));
 if(!obj){statusText('Please select an OBJ file.');return;}
 try{statusText('Loading model…');const objText=await obj.text();const mtlText=mtl?await mtl.text():'';await addModel(obj.name.replace(/\.obj$/i,''),objText,mtlText);statusText(`${obj.name} added. Drag the handles to position it.`);toast('Model added. Select Move, Rotate, or Resize.');}catch(err){statusText(`Could not load model: ${err.message}`);console.error(err);}finally{event.target.value='';}
});
function setTool(tool){transform.setMode(tool);for(const [name,id] of [['translate','tool-move'],['rotate','tool-rotate'],['scale','tool-scale']])$(id).classList.toggle('active',name===tool);applyAxis();}
function applyAxis(){if(transform.getMode()!=='translate'){transform.showX=true;transform.showY=true;transform.showZ=true;return;}const all=$('axis-select').value==='XYZ';transform.showX=true;transform.showY=all;transform.showZ=true;}
$('tool-move').onclick=()=>setTool('translate');$('tool-rotate').onclick=()=>setTool('rotate');$('tool-scale').onclick=()=>setTool('scale');$('axis-select').onchange=applyAxis;
$('object-select').onchange=e=>selectObject(e.target.value);
$('objects-list').onclick=e=>{const item=e.target.closest('[data-id]');if(item)selectObject(item.dataset.id);};
$('place-btn').onclick=()=>{const e=selected();if(e){positionInFront(e.group);updatePlacementUI();saveLocal();focusModel(e);toast('Model moved in front of your camera.');}};
$('delete-btn').onclick=()=>{const e=selected();if(!e)return;if(!confirm(`Delete “${e.name}” from this browser?`))return;scene.remove(e.group);added.delete(e.id);selectObject(null);saveLocal();toast('Model deleted.');};
renderer.domElement.addEventListener('pointerdown',e=>{
 if(mode!=='build'||pointerLocked||e.button!==0||transform.dragging)return;
 const box=renderer.domElement.getBoundingClientRect();mouse.set((e.clientX-box.left)/box.width*2-1,-(e.clientY-box.top)/box.height*2+1);ray.setFromCamera(mouse,camera);
 const intersect=ray.intersectObjects([...added.values()].map(o=>o.group),true)[0];
 if(intersect){let target=intersect.object;while(target.parent&&!target.userData.modelId)target=target.parent;if(target.userData.modelId)selectObject(target.userData.modelId);}
});

// Save model contents to IndexedDB for local continuity. This is NOT collaborative storage.
const dbPromise=new Promise((resolve,reject)=>{const req=indexedDB.open('pink-lorax-city-v1',1);req.onupgradeneeded=()=>req.result.createObjectStore('models',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
function serialize(e){return{id:e.id,name:e.name,objText:e.objText,mtlText:e.mtlText,transform:{position:e.group.position.toArray(),rotation:e.group.rotation.toArray(),scale:e.group.scale.toArray()}};}
async function saveLocal(){try{const db=await dbPromise;const tx=db.transaction('models','readwrite'),store=tx.objectStore('models');store.clear();for(const e of added.values())store.put(serialize(e));}catch(err){console.warn('Local save failed',err);}}
async function restoreModels(){try{const db=await dbPromise;const records=await new Promise((resolve,reject)=>{const req=db.transaction('models').objectStore('models').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});for(const item of records){try{await addModel(item.name,item.objText,item.mtlText,item.id,item.transform);}catch(err){console.error('Cannot restore model',item.name,err);}}selectObject(null);if(records.length)toast(`Restored ${records.length} locally saved models.`);}catch(err){console.warn('Local restore unavailable',err);}}
$('save-btn').onclick=async()=>{await saveLocal();toast('Models and positions saved locally in this browser.');};
$('export-btn').onclick=()=>{const data={format:'pink-lorax-layout-v1',saved:new Date().toISOString(),note:'Transforms only. OBJ and MTL files are not included.',models:[...added.values()].map(e=>{const {objText,mtlText,...meta}=serialize(e);return meta;})};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='pink-lorax-city-layout.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};

function showTab(next){releaseFly();mode=next;document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('selected',b.dataset.tab===mode));$('explore-panel').classList.toggle('hidden',mode!=='explore');$('build-panel').classList.toggle('hidden',mode!=='build');$('mode-label').textContent=mode==='explore'?'Explore mode':'Build mode';transform.enabled=mode==='build';transform.visible=mode==='build'&&!!selected();updatePlacementUI();$('crosshair').style.display='none';$('hint').textContent=mode==='explore'?'Click Enter flythrough to fly around':'Select an imported object to move, rotate, or resize it';}
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
$('start-btn').onclick=startFly;$('reset-btn').onclick=resetView;$('overview-btn').onclick=overview;
$('speed').oninput=e=>$('speed-value').textContent=`${e.target.value}×`;
$('height-reset').onchange=resetView;
$('help-close').onclick=()=>$('help-modal').classList.add('hidden');
window.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;keys[e.code]=true;if(pointerLocked&&['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();if(mode==='build'){if(e.code==='KeyG')setTool('translate');if(e.code==='KeyE')setTool('rotate');if(e.code==='KeyT')setTool('scale');}});
window.addEventListener('keyup',e=>keys[e.code]=false);
window.addEventListener('blur',()=>{for(const k in keys)keys[k]=false;});
function animate(){requestAnimationFrame(animate);let dt=Math.min(clock.getDelta(),.05);
 if(pointerLocked&&mode==='explore'){
  const direction=new THREE.Vector3();camera.getWorldDirection(direction);const forward=new THREE.Vector3(direction.x,0,direction.z).normalize();const right=new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0)).normalize();const move=new THREE.Vector3();
  if(keys.KeyW||keys.ArrowUp)move.add(forward);if(keys.KeyS||keys.ArrowDown)move.sub(forward);if(keys.KeyA||keys.ArrowLeft)move.sub(right);if(keys.KeyD||keys.ArrowRight)move.add(right);if(keys.Space)move.y+=1;if(keys.ShiftLeft||keys.ShiftRight)move.y-=1;
  if(move.lengthSq()>0){const speed=Number($('speed').value)*13;camera.position.addScaledVector(move.normalize(),speed*dt);}camera.position.y=Math.max(1.8,camera.position.y);
 }
 if(townBox){$('coordinates').textContent=`X ${Math.round(camera.position.x)} · Z ${Math.round(camera.position.z)} · Height ${Math.round(camera.position.y)}`;}
 renderer.render(scene,camera);
}
showTab('explore');loadCity();animate();
