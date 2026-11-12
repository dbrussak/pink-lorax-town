import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import JSZip from 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';

const $ = id => document.getElementById(id);
const SB_URL = 'https://xpldpzhujfdsnhxgirof.supabase.co';
const SB_KEY = 'sb_publishable_QaE7NRUJCI36xpkaKErwUA_wyt-y8Yd';
const supabase = createClient(SB_URL, SB_KEY, {auth:{autoRefreshToken:true,persistSession:true}});
let authUser=null, editingEnabled=false, online=false, loadingShared=false;
const remoteQueue=new Set();
function showConnection(msg){$('connection-state').textContent=msg;}
function setEditing(enabled){
 editingEnabled=!!enabled;
 const permitted=editingEnabled&&online;
 $('model-files').disabled=!permitted;
 $('build-note').textContent=permitted ? 'Class editing is ON — uploads and placement changes are shared.' : 'Class editing is OFF — you can explore and inspect existing models.';
 $('edit-status').textContent=permitted?'CLASS EDITING ON':'VIEW ONLY';
 $('edit-status').classList.toggle('live',permitted);
 $('save-btn').disabled=!permitted;
 $('place-btn').disabled=!permitted||!selected();
 updateDeleteUI();
 transform.enabled=permitted&&mode==='build';
 showTransformHandles();
 updateDeleteUI();
 updatePlacementUI();
}
async function initSupabase(){
 try{
  let {data:{session},error}=await supabase.auth.getSession(); if(error)throw error;
  if(!session){const response=await supabase.auth.signInAnonymously();if(response.error)throw response.error;session=response.data.session;}
  authUser=session.user;online=true;showConnection('Connected to shared city');
  const {error:readError}=await refreshSettings();if(readError)throw readError;
  await syncAllModels();
  supabase.channel('pink-lorax-city-live')
   .on('postgres_changes',{event:'*',schema:'public',table:'city_objects'},payload=>{
      if(payload.eventType==='DELETE'){removeRemoteModel(payload.old?.id);return;}
      if(payload.new?.id)refreshOneModel(payload.new.id);
   })
   .on('postgres_changes',{event:'*',schema:'public',table:'city_settings'},()=>refreshSettings())
   .subscribe(status=>{showConnection(status==='SUBSCRIBED'?'Shared city connected':'Shared city: '+status);if(status==='SUBSCRIBED')syncAllModels();});
  // Recover after backgrounding Chromebook / dropped websocket; also detect teacher switch.
  window.addEventListener('focus',async()=>{await refreshSettings();await syncAllModels();});
 }catch(e){online=false;setEditing(false);showConnection('Connection failed');toast('Supabase connection failed: '+e.message);console.error(e);}
}
async function refreshSettings(){
 const {data,error}=await supabase.from('city_settings').select('editing_enabled').eq('id',1).single();
 if(!error)setEditing(data?.editing_enabled===true);
 else {setEditing(false);console.error('Settings read failed',error);}
 return {data,error};
}
function serializeTransform(entry){
 const g=entry.group;
 return {position_x:g.position.x,position_y:g.position.y,position_z:g.position.z,rotation_y:g.rotation.y,scale:g.scale.x};
}
function applyRemoteTransform(entry,record){
 // A model being dragged locally should not jump before local save.
 if(transform.dragging && selectedId===entry.id)return;
 const g=entry.group;
 g.position.set(record.position_x,record.position_y,record.position_z);
 g.rotation.y=record.rotation_y;
 g.scale.setScalar(record.scale);
 if(selectedId===entry.id)updatePlacementUI();
}
async function loadRecord(record){
 if(!record?.id||!record.model_path)return;
 if(added.has(record.id)){applyRemoteTransform(added.get(record.id),record);return;}
 if(remoteQueue.has(record.id))return;
 remoteQueue.add(record.id);
 try{
  const {data:objFile,error:objErr}=await supabase.storage.from('city-models').download(record.model_path);
  if(objErr)throw objErr;
  const objText=await objFile.text();
  const mtlPath=record.model_path.replace(/\.obj$/i,'.mtl');
  const {data:mtlFile,error:mtlErr}=await supabase.storage.from('city-models').download(mtlPath);
  const mtlText=mtlErr?'':await mtlFile.text();
  const id=await addModel(record.name,objText,mtlText,record.id,{
   position:[record.position_x,record.position_y,record.position_z],
   rotation:[0,record.rotation_y,0],scale:[record.scale,record.scale,record.scale]
  },{remote:true,modelPath:record.model_path});
  const entry=added.get(id); if(entry){entry.modelPath=record.model_path;entry.createdBy=record.created_by;updateDeleteUI();}
 }catch(e){console.error('Could not load shared model',record.name,e);toast('Could not load '+record.name+': '+e.message);}finally{remoteQueue.delete(record.id);}
}
async function syncAllModels(){
 if(!online||loadingShared)return;loadingShared=true;
 try{
  const {data,error}=await supabase.from('city_objects').select('*').order('created_at',{ascending:true});
  if(error)throw error;
  for(const item of data)await loadRecord(item);
  const ids=new Set(data.map(r=>r.id));
  for(const id of [...added.keys()])if(!ids.has(id))removeRemoteModel(id);
 }catch(e){console.error('Sync failed',e);toast('Could not load shared city models: '+e.message);}finally{loadingShared=false;}
}
async function refreshOneModel(id){
 const {data,error}=await supabase.from('city_objects').select('*').eq('id',id).maybeSingle();
 if(error){console.error(error);return;}
 if(data)await loadRecord(data);else removeRemoteModel(id);
}
function removeRemoteModel(id){const entry=added.get(id);if(!entry)return;scene.remove(entry.group);added.delete(id);if(selectedId===id)selectObject(null);else updateObjectUI();showTransformHandles();}
const saves=new Map();
function saveShared(){
 if(!editingEnabled||!online)return;
 const entry=selected();if(!entry?.modelPath)return;
 const id=entry.id;
 clearTimeout(saves.get(id));
 saves.set(id,setTimeout(async()=>{
  try{
   const {error}=await supabase.from('city_objects').update(serializeTransform(entry)).eq('id',id);
   if(error)throw error;
  }catch(e){toast('Could not save placement: '+e.message);console.error(e);await refreshOneModel(id);}
 },230));
}
async function uploadShared(name,objText,mtlText){
 if(!editingEnabled||!online||!authUser)throw new Error('Class editing is off.');
 if(new Blob([objText]).size>20*1024*1024||new Blob([mtlText]).size>20*1024*1024)throw new Error('File exceeds the 20 MB limit.');
 const id=crypto.randomUUID(), stem=`${authUser.id}/${id}`;
 const objPath=`${stem}.obj`;
 const upload=async(ext,text)=>{
  const {error}=await supabase.storage.from('city-models').upload(`${stem}.${ext}`,new Blob([text],{type:'text/plain'}),{upsert:false,contentType:'text/plain'});
  if(error)throw error;
 };
 await upload('obj',objText);
 if(mtlText)await upload('mtl',mtlText);
 // Publish only after all necessary files are uploaded. Orphan files can be cleaned by the teacher.
 const idLocal=await addModel(name,objText,mtlText,id,null,{remote:true,modelPath:objPath});
 const entry=added.get(idLocal);entry.createdBy=authUser.id;updateDeleteUI();
 const payload={id,name,model_path:objPath,created_by:authUser.id,...serializeTransform(entry)};
 const {error}=await supabase.from('city_objects').insert(payload);
 if(error){removeRemoteModel(idLocal);throw error;}
 toast('Model published to shared city');
}

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
  await initSupabase();
 }catch(err){$('loading').innerHTML=`<strong>Unable to load the city</strong><span>${escapeHtml(err.message)}</span><span>Open this site through GitHub Pages or a local web server, not by double-clicking index.html.</span>`;console.error(err);}
}
function escapeHtml(str){return String(str).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

const transform = new TransformControls(camera,renderer.domElement);
transform.setMode('translate');transform.setSpace('world');transform.setSize(1.1);
const transformHelper = transform.getHelper();
scene.add(transformHelper);
transformHelper.visible = false;
transform.addEventListener('dragging-changed',e=>{if(e.value)releaseFly();});
transform.addEventListener('mouseUp',()=>saveShared());
transform.addEventListener('objectChange',()=>updatePlacementUI());

function selected(){return selectedId?added.get(selectedId):null;}
function showTransformHandles(){
 const entry=selected();
 const canShow=mode==='build'&&editingEnabled&&online&&!!entry;
 if(canShow && transform.object!==entry.group)transform.attach(entry.group);
 transform.enabled=canShow;
 transformHelper.visible=canShow;
}
function selectObject(id){
 selectedId=id&&added.has(id)?id:null;
 if(!selected())transform.detach();
 showTransformHandles();updateObjectUI();
}
function updateDeleteUI(){
 const entry=selected();
 const own=!!entry&&!!authUser&&entry.createdBy===authUser.id;
 $('delete-btn').disabled=!(mode==='build'&&editingEnabled&&online&&own);
 $('delete-btn').title=own?'Remove your uploaded model from the shared city':'Only the uploader can delete their model during class';
}

function updateObjectUI(){
 $('object-select').innerHTML='<option value="">None selected</option>' + [...added.values()].map(e=>`<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join('');
 $('object-select').value=selectedId||'';
 $('object-count').textContent=added.size;
 $('objects-list').innerHTML=added.size?[...added.values()].map(e=>`<div class="object-item ${selectedId===e.id?'selected':''}" data-id="${escapeHtml(e.id)}"><span>${escapeHtml(e.name)}</span><small>●</small></div>`).join(''):'<div class="empty">No models added yet.</div>';
 updateDeleteUI();$('place-btn').disabled=!editingEnabled||!selected();
 updatePlacementUI();
}
// Direct placement controls are an accessible fallback to dragging 3D transform handles.
const placementFieldIds=['edit-x','edit-y','edit-z','edit-rotation','edit-scale'];
function updatePlacementUI(){
 const e=selected();
 $('placement-controls').classList.toggle('disabled-placement',!e||!editingEnabled);
 for(const id of placementFieldIds)$(id).disabled=!e||!editingEnabled;
 for(const id of ['nudge-left','nudge-right','nudge-forward','nudge-back','nudge-up','nudge-down'])$(id).disabled=!e||!editingEnabled;
 $('focus-btn').disabled=!e;
 if(!e)return;
 const group=e.group;
 // Keep the active field intact while somebody types.
 const values={'edit-x':group.position.x,'edit-y':group.position.y,'edit-z':group.position.z,'edit-rotation':THREE.MathUtils.radToDeg(group.rotation.y),'edit-scale':group.scale.x};
 for(const [id,value] of Object.entries(values))if(document.activeElement!==$(id))$(id).value=Number(value.toFixed(3));
}
function applyPlacementFields(){
 const entry=selected();if(!entry||!editingEnabled)return;
 const get=(id,fallback)=>{const str=$(id).value;return str.trim()===''?fallback:Number(str);};
 const g=entry.group;
 const x=get('edit-x',g.position.x),y=get('edit-y',g.position.y),z=get('edit-z',g.position.z);
 const degrees=get('edit-rotation',THREE.MathUtils.radToDeg(g.rotation.y));
 const scale=get('edit-scale',g.scale.x);
 if(![x,y,z,degrees,scale].every(Number.isFinite)||scale<=0||scale>100){toast('Please enter valid numbers and a size greater than zero.');updatePlacementUI();return;}
 g.position.set(x,y,z);g.rotation.y=THREE.MathUtils.degToRad(degrees);g.scale.setScalar(scale);
 updatePlacementUI();saveShared();
}
for(const id of placementFieldIds)$(id).addEventListener('change',applyPlacementFields);
function nudge(dx,dz){const e=selected();if(!e||!editingEnabled)return;const step=Number($('nudge-step').value)||20;e.group.position.x+=dx*step;e.group.position.z+=dz*step;updatePlacementUI();saveShared();}
$('nudge-left').onclick=()=>nudge(-1,0);
$('nudge-right').onclick=()=>nudge(1,0);
$('nudge-forward').onclick=()=>nudge(0,-1);
$('nudge-back').onclick=()=>nudge(0,1);
$('nudge-up').onclick=()=>nudgeHeight(1);
$('nudge-down').onclick=()=>nudgeHeight(-1);
function nudgeHeight(direction){const e=selected();if(!e||!editingEnabled)return;const step=Number($('nudge-step').value)||20;e.group.position.y+=direction*step;updatePlacementUI();saveShared();}
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
// Place a new object where the camera is aiming at the city's ground plane.
// New-world models are normalized so their lowest vertex starts at local Y=0;
// after scaling, world-space group Y=0 therefore puts the base flush with ground.
function positionInFront(group){
 camera.updateMatrixWorld(true);
 const direction=new THREE.Vector3();
 camera.getWorldDirection(direction).normalize();
 const origin=camera.getWorldPosition(new THREE.Vector3());
 // Intersect view ray with y=0 whenever looking downward. If looking level/up,
 // use a point in the forward direction instead of sending the model to infinity.
 let distance=70;
 if(direction.y < -0.015 && origin.y > 0){
   const intersectionDistance=-origin.y/direction.y;
   if(intersectionDistance>0)distance=THREE.MathUtils.clamp(intersectionDistance,12,180);
 }
 const point=origin.clone().addScaledVector(direction,distance);
 group.position.set(point.x,0,point.z);
 // Correct any small numerical errors: make the *scaled* object's lowest
 // world-space point exactly coincide with the ground plane.
 group.updateMatrixWorld(true);
 const bounds=new THREE.Box3().setFromObject(group);
 if(!bounds.isEmpty())group.position.y-=bounds.min.y;
}
async function addModel(name,objText,mtlText,id,transformData,options={}){
 const group=newWorldModel(objText,mtlText);
 const initialBounds=new THREE.Box3().setFromObject(group);const maxDim=initialBounds.getSize(new THREE.Vector3()).length();
 // Leave smaller student creations a useful default size, without overriding saved transforms.
 if(!transformData && maxDim>150)group.scale.setScalar(100/maxDim);
 if(transformData){group.position.fromArray(transformData.position);group.rotation.fromArray(transformData.rotation);group.scale.fromArray(transformData.scale);}else{positionInFront(group);}
 const uuid=id||crypto.randomUUID();group.userData.modelId=uuid;scene.add(group);added.set(uuid,{id:uuid,name,objText,mtlText,group,modelPath:options.modelPath||null,createdBy:options.createdBy||null});if(options.remote&&transformData){updateObjectUI();}else{selectObject(uuid);if(!transformData&&mode==='build')toast('Model placed on the ground near your view. Use Focus to inspect or edit it.');}return uuid;
}
$('model-files').addEventListener('change',async event=>{
 const files=[...event.target.files];const obj=files.find(f=>f.name.toLowerCase().endsWith('.obj'));const mtl=files.find(f=>f.name.toLowerCase().endsWith('.mtl'));
 if(!obj){statusText('Please select an OBJ file.');return;}
 if(!editingEnabled){statusText('Class editing is off.');return;}
 try{statusText('Uploading to shared city…');const objText=await obj.text();const mtlText=mtl?await mtl.text():'';
  await uploadShared(obj.name.replace(/\.obj$/i,''),objText,mtlText);statusText(`${obj.name} added to shared city.`);
 }catch(err){statusText(`Could not upload model: ${err.message}`);console.error(err);}finally{event.target.value='';}
});
function setTool(tool){showTransformHandles();transform.setMode(tool);for(const [name,id] of [['translate','tool-move'],['rotate','tool-rotate'],['scale','tool-scale']])$(id).classList.toggle('active',name===tool);applyAxis();}
function applyAxis(){if(transform.getMode()!=='translate'){transform.showX=true;transform.showY=true;transform.showZ=true;return;}const all=$('axis-select').value==='XYZ';transform.showX=true;transform.showY=all;transform.showZ=true;}
$('show-handles-btn').onclick=()=>{showTransformHandles();if(selected()){setTool('translate');focusModel();toast('Movement handles restored.');}else toast('Select an imported model first.');};
$('tool-move').onclick=()=>setTool('translate');$('tool-rotate').onclick=()=>setTool('rotate');$('tool-scale').onclick=()=>setTool('scale');$('axis-select').onchange=applyAxis;
$('object-select').onchange=e=>selectObject(e.target.value);
$('objects-list').onclick=e=>{const item=e.target.closest('[data-id]');if(item)selectObject(item.dataset.id);};
$('place-btn').onclick=()=>{const e=selected();if(e&&editingEnabled){positionInFront(e.group);updatePlacementUI();saveShared();focusModel(e);toast('Model moved in front of your camera.');}};
$('delete-btn').onclick=async()=>{
 const entry=selected();
 if(!entry||!editingEnabled||!online||entry.createdBy!==authUser?.id)return;
 if(!window.confirm(`Delete “${entry.name}” from the shared city? This removes it for everyone and cannot be undone.`))return;
 $('delete-btn').disabled=true;
 try{
  const {data,error}=await supabase.from('city_objects').delete().eq('id',entry.id).eq('created_by',authUser.id).select('id');
  if(error)throw error;
  if(!data?.length)throw new Error('Deletion was not permitted or the model was already removed.');
  // Uploaded storage files are deliberately retained: no Storage DELETE policy is granted.
  removeRemoteModel(entry.id);
  toast('Model removed from the shared city.');
 }catch(err){toast('Could not delete: '+err.message);console.error(err);updateDeleteUI();}
};
renderer.domElement.addEventListener('pointerdown',e=>{
 if(mode!=='build'||pointerLocked||e.button!==0||transform.dragging)return;
 const box=renderer.domElement.getBoundingClientRect();mouse.set((e.clientX-box.left)/box.width*2-1,-(e.clientY-box.top)/box.height*2+1);ray.setFromCamera(mouse,camera);
 const intersect=ray.intersectObjects([...added.values()].map(o=>o.group),true)[0];
 if(intersect){let target=intersect.object;while(target.parent&&!target.userData.modelId)target=target.parent;if(target.userData.modelId)selectObject(target.userData.modelId);}
});

// Shared Supabase is the canonical source. No local IndexedDB writes in this version.
$('save-btn').onclick=async()=>{if(!editingEnabled)return;saveShared();toast('Placement queued for saving to shared city.');};
// Download a complete, portable snapshot of the live city. Always query the
// database rather than relying on models currently loaded in this browser.
// Read-only operation: permitted with the existing class read policies even
// while editing is switched off. It does not delete or change server data.
let exportingBackup=false;
function setBackupStatus(message){$('backup-status').textContent=message;}
async function downloadCityBackup(){
 if(exportingBackup)return;
 if(!online){toast('Connect to Supabase before exporting.');return;}
 exportingBackup=true;
 $('export-btn').disabled=true;
 try{
  setBackupStatus('Reading saved city layout…');
  const {data:settings,error:settingsError}=await supabase.from('city_settings').select('editing_enabled').eq('id',1).single();
  if(settingsError)throw settingsError;
  const rows=[];
  // PostgREST paginates results. Collect every row, not just the first page.
  for(let offset=0;;offset+=500){
   const {data,error}=await supabase.from('city_objects').select('*').order('created_at',{ascending:true}).order('id',{ascending:true}).range(offset,offset+499);
   if(error)throw error;
   rows.push(...(data||[]));
   if(!data || data.length<500)break;
  }
  const zip=new JSZip();
  const baseline=zip.folder('baseline');
  const assets=[['tinker.obj','assets/tinker.obj'],['obj.mtl','assets/obj.mtl']];
  for(const [name,path] of assets){
    setBackupStatus('Downloading baseline '+name+'…');
    const response=await fetch(path,{cache:'no-store'});
    if(!response.ok)throw new Error('Could not retrieve '+path+' (HTTP '+response.status+')');
    baseline.file(name,await response.blob());
  }
  const models=zip.folder('student_models');
  const manifest=[];
  for(let i=0;i<rows.length;i++){
   const record=rows[i];
   setBackupStatus(`Downloading model ${i+1} of ${rows.length}: ${record.name||record.id}…`);
   // Use UUID as the folder name to keep paths unique; don't use untrusted filenames.
   const folder=models.folder(record.id);
   if(!/^[0-9a-f-]{36}$/i.test(record.id))throw new Error('Invalid model identifier in city database');
   if(!record.model_path || !record.model_path.toLowerCase().endsWith('.obj'))throw new Error('Invalid OBJ path for '+record.id);
   const {data:obj,error:objError}=await supabase.storage.from('city-models').download(record.model_path);
   if(objError)throw new Error('OBJ download failed for '+record.name+': '+objError.message);
   const originalObjText=await obj.text();
   const mtlPath=record.model_path.replace(/\.obj$/i,'.mtl');
   const {data:mtl,error:mtlError}=await supabase.storage.from('city-models').download(mtlPath);
   // A model without an MTL is valid; an MTL download can also fail due to a
   // transient error, so report the missing file rather than silently hiding it.
   if(mtlError && !(/not found|not_found|404/i.test(mtlError.message||'') || mtlError.statusCode==='404')){
     throw new Error('MTL download failed for '+record.name+': '+mtlError.message);
   }
   if(mtl)folder.file('model.mtl',mtl);
   // OBJ files exported by Tinkercad can reference a different MTL filename.
   // Normalize the archived copy so it loads alongside model.mtl.
   let backupObjText=originalObjText;
   if(mtl){
     if(/^mtllib\s+.+$/im.test(backupObjText))backupObjText=backupObjText.replace(/^mtllib\s+.+$/im,'mtllib model.mtl');
     else backupObjText='mtllib model.mtl\n'+backupObjText;
   }
   folder.file('model.obj',backupObjText);
   manifest.push({
    ...record,
    backup_obj:`student_models/${record.id}/model.obj`,
    backup_mtl:mtl?`student_models/${record.id}/model.mtl`:null,
    original_mtl_path:mtlPath,
   });
  }
  const exportedAt=new Date().toISOString();
  zip.file('city_layout.json',JSON.stringify({format:'pink-lorax-complete-city-backup-v1',exported_at:exportedAt,baseline_files:['baseline/tinker.obj','baseline/obj.mtl'],editing_enabled_at_export:settings.editing_enabled,models:manifest},null,2));
  zip.file('README.txt',`Pink Lorax Town — full city backup\nCreated: ${exportedAt}\nStudent models: ${rows.length}\n\nContents:\n  baseline/ — Tinkercad base OBJ and MTL\n  student_models/<UUID>/model.obj and optional model.mtl\n  city_layout.json — Supabase rows including each model's transform\n\nThis is an archive, not a combined, pre-positioned OBJ.\nRestoring placement requires the city layout JSON and a restoration tool.\nNo files were removed from Supabase.\n`);
  setBackupStatus('Compressing ZIP…');
  const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:5}},meta=>{setBackupStatus('Compressing ZIP… '+Math.round(meta.percent)+'%');});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;
  a.download=`Pink_Lorax_Town_Backup_${exportedAt.slice(0,10)}.zip`;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  setBackupStatus(`Backup downloaded: ${rows.length} shared model(s), original city, and placements.`);
  toast('Full city ZIP downloaded.');
 }catch(err){console.error('City backup failed',err);setBackupStatus('Backup failed: '+err.message);toast('Backup failed: '+err.message);}
 finally{exportingBackup=false;$('export-btn').disabled=false;}
}
$('export-btn').onclick=downloadCityBackup;

function showTab(next){releaseFly();mode=next;document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('selected',b.dataset.tab===mode));$('explore-panel').classList.toggle('hidden',mode!=='explore');$('build-panel').classList.toggle('hidden',mode!=='build');$('mode-label').textContent=mode==='explore'?'Explore mode':'Build mode';showTransformHandles();updateDeleteUI();updatePlacementUI();$('crosshair').style.display='none';$('hint').textContent=mode==='explore'?'Click Enter flythrough to fly around':'Select an imported object to move, rotate, or resize it';}
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
$('start-btn').onclick=startFly;$('reset-btn').onclick=resetView;$('overview-btn').onclick=overview;
$('speed').oninput=e=>$('speed-value').textContent=`${e.target.value}×`;
$('height-reset').onchange=resetView;
$('help-close').onclick=()=>$('help-modal').classList.add('hidden');
window.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;keys[e.code]=true;if(pointerLocked&&['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();if(mode==='build'&&editingEnabled){if(e.code==='KeyG')setTool('translate');if(e.code==='KeyE')setTool('rotate');if(e.code==='KeyT')setTool('scale');}});
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
