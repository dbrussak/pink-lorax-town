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
let teacherAuthorized=false, teacherMode=false;
function canModify(){return online && (editingEnabled || (teacherAuthorized && teacherMode));}
function canDeleteEntry(entry){return !!entry && online && ((teacherAuthorized && teacherMode) || (editingEnabled && entry.createdBy===authUser?.id));}
function showTeacherStatus(){
 const status=$('teacher-status');
 status.textContent=teacherAuthorized ? (teacherMode ? 'TEACHER MODE ON' : 'Teacher verified') : 'Student / visitor';
 $('teacher-toggle').textContent=teacherAuthorized ? (teacherMode ? 'Exit Teacher Mode' : 'Enter Teacher Mode') : 'Teacher login';
 $('teacher-signout').classList.toggle('hidden',!teacherAuthorized);
 $('teacher-help').textContent=teacherAuthorized ? 'Verified teacher. Enable Teacher Mode to edit or delete any contributed structure, even outside class.' : 'Teachers use their Supabase email and password; students still join without a login.';
}
function updateTeacherControls(){
 showTeacherStatus();
 setEditing(editingEnabled);
}
async function readTeacherPermission(){
 if(!online)return;
 const {data,error}=await supabase.rpc('is_city_teacher');
 teacherAuthorized=!error && data === true;
 teacherMode=teacherAuthorized && teacherMode;
 if(error)console.error('Teacher authorization check failed',error);
 showTeacherStatus();
}

const remoteQueue=new Set();
function showConnection(msg){$('connection-state').textContent=msg;}
function setEditing(enabled){
 editingEnabled=!!enabled;
 const permitted=canModify();
 $('model-files').disabled=!permitted;
 $('build-note').textContent=teacherMode&&teacherAuthorized ? 'Teacher Mode — you can edit or remove any added model, including when class editing is OFF.' : (permitted ? 'Class editing is ON — uploads and placement changes are shared.' : 'Class editing is OFF — you can explore and inspect existing models.');
 $('edit-status').textContent=teacherMode&&teacherAuthorized?'TEACHER EDITING':permitted?'CLASS EDITING ON':'VIEW ONLY';
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
  authUser=session.user;online=true;await readTeacherPermission();showConnection('Connected to shared city');
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
  window.addEventListener('focus',async()=>{await readTeacherPermission();await refreshSettings();await syncAllModels();});
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
 if(selectedId===entry.id){syncHandlePivot();updatePlacementUI();}
}
async function loadRecord(record){
 if(!record?.id||!record.model_path)return;
 if(added.has(record.id)){
  const entry=added.get(record.id);
  if(entry.name!==record.name){entry.name=record.name;updateObjectUI();}
  applyRemoteTransform(entry,record);return;
 }
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
 if(!canModify())return;
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
// Store human-readable filenames while retaining UUID object IDs in the database.
// Client-generated names are NOT security boundaries; Storage policies still isolate users.
function cleanModelLabel(value){
 return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,40);
}
function suggestedModelLabel(fileName){
 const base=String(fileName||'').split('/').pop().replace(/\.(obj|zip)$/i,'');
 const clean=cleanModelLabel(base);
 return /^(tinker|model|untitled|obj|export|design|shape|object|scene)(?:_?\d+)?$/.test(clean)?'model':clean||'model';
}
function uniqueModelSuffix(){
 const values=new Uint8Array(5);crypto.getRandomValues(values);
 return [...values].map(x=>x.toString(36).padStart(2,'0')).join('').slice(0,10);
}
async function uploadShared(name,objText,mtlText){
 if(!canModify()||!authUser)throw new Error('Editing is not enabled for this session.');
 if(new Blob([objText]).size>20*1024*1024||new Blob([mtlText]).size>20*1024*1024)throw new Error('File exceeds the 20 MB limit.');
 if(!/^(?:\s|#|mtllib\s+[^\r\n]*\n)*[vofgs]\s/m.test(objText))throw new Error('The selected OBJ does not look like a valid mesh file.');
 const id=crypto.randomUUID(), slug=cleanModelLabel(name)||'model';
 const stem=`${authUser.id}/${slug}_${uniqueModelSuffix()}`;
 const objPath=`${stem}.obj`;
 const upload=async(ext,body)=>{
  const {error}=await supabase.storage.from('city-models').upload(`${stem}.${ext}`,new Blob([body],{type:'text/plain'}),{upsert:false,contentType:'text/plain'});
  if(error)throw error;
 };
 await upload('obj',objText);
 if(mtlText)await upload('mtl',mtlText);
 // Publish only after both uploads succeed. Partial orphan files can be cleaned by teacher.
 const idLocal=await addModel(name,objText,mtlText,id,null,{remote:true,modelPath:objPath});
 const entry=added.get(idLocal);entry.createdBy=authUser.id;updateDeleteUI();
 const payload={id,name,model_path:objPath,created_by:authUser.id,...serializeTransform(entry)};
 const {error}=await supabase.from('city_objects').insert(payload);
 if(error){removeRemoteModel(idLocal);throw error;}
 toast('Model published to shared city');
 return objPath;
}

const MAX_MODEL_BYTES=20*1024*1024;
const MAX_ZIP_BYTES=25*1024*1024;
async function readTinkercadUpload(files){
 const zips=files.filter(f=>/\.zip$/i.test(f.name));
 const loose=files.filter(f=>/\.(obj|mtl)$/i.test(f.name));
 if(zips.length){
  if(zips.length!==1||loose.length||files.length!==1)throw new Error('Select one ZIP at a time, or select an OBJ and MTL together.');
  const archive=zips[0];
  if(archive.size>MAX_ZIP_BYTES)throw new Error('ZIP is too large (maximum 25 MB).');
  const zip=await JSZip.loadAsync(archive,{checkCRC32:true});
  const entries=Object.values(zip.files).filter(e=>!e.dir&&!e.name.split('/').some(part=>part==='__MACOSX'||part.startsWith('.')));
  const objs=entries.filter(e=>/\.obj$/i.test(e.name));
  const mtls=entries.filter(e=>/\.mtl$/i.test(e.name));
  if(objs.length!==1)throw new Error(`Expected one OBJ file in the ZIP; found ${objs.length}.`);
  if(mtls.length>1)throw new Error('ZIP contains multiple MTL files. Export only one Tinkercad model.');
  const objEntry=objs[0],mtlEntry=mtls[0];
  for(const e of [objEntry,mtlEntry].filter(Boolean)){
   if(e._data?.uncompressedSize>MAX_MODEL_BYTES)throw new Error('An extracted model file exceeds 20 MB.');
  }
  const objText=await objEntry.async('string');
  const mtlText=mtlEntry?await mtlEntry.async('string'):'';
  if(new Blob([objText]).size>MAX_MODEL_BYTES||new Blob([mtlText]).size>MAX_MODEL_BYTES)throw new Error('Extracted model file exceeds 20 MB.');
  return {objText,mtlText,originalName:objEntry.name.split('/').pop(),fromZip:true};
 }
 const objs=loose.filter(f=>/\.obj$/i.test(f.name));
 const mtls=loose.filter(f=>/\.mtl$/i.test(f.name));
 if(objs.length!==1||mtls.length>1||loose.length!==files.length)throw new Error('Select exactly one OBJ and, optionally, one MTL.');
 if(objs[0].size>MAX_MODEL_BYTES||(mtls[0]&&mtls[0].size>MAX_MODEL_BYTES))throw new Error('Model file exceeds 20 MB.');
 return {objText:await objs[0].text(),mtlText:mtls[0]?await mtls[0].text():'',originalName:objs[0].name,fromZip:false};
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
// Independent world-space handle anchor: keep the model's own origin and saved
// position unchanged. OBJ exports often have pivots far from visible geometry.
const handlePivot = new THREE.Group();
scene.add(handlePivot);
let handlePrevious = null;
let handleOffset = 4;
const verticalAxis = new THREE.Vector3(0,1,0);
function boundingHandlePosition(entry){
 entry.group.updateMatrixWorld(true);
 const bounds=new THREE.Box3().setFromObject(entry.group);
 if(bounds.isEmpty())return entry.group.getWorldPosition(new THREE.Vector3());
 const center=bounds.getCenter(new THREE.Vector3());
 return new THREE.Vector3(center.x,bounds.max.y+handleOffset,center.z);
}
function syncHandlePivot(){
 const entry=selected();
 if(!entry||transform.dragging)return;
 handlePivot.position.copy(boundingHandlePosition(entry));
 handlePivot.rotation.set(0,entry.group.rotation.y,0);
 handlePivot.updateMatrixWorld(true);
 handlePrevious={position:handlePivot.position.clone(),yaw:handlePivot.rotation.y};
}
transform.addEventListener('dragging-changed',e=>{
 if(e.value){releaseFly();syncHandlePivot();}
 else {syncHandlePivot();}
});
transform.addEventListener('mouseUp',()=>{syncHandlePivot();saveShared();});
transform.addEventListener('objectChange',()=>{
 const entry=selected();if(!entry||!handlePrevious)return;
 if(transform.getMode()==='translate'){
   entry.group.position.add(handlePivot.position.clone().sub(handlePrevious.position));
 }else if(transform.getMode()==='rotate'){
   // Rotation is restricted to world Y: this matches the database's rotation_y.
   let delta=handlePivot.rotation.y-handlePrevious.yaw;
   delta=Math.atan2(Math.sin(delta),Math.cos(delta));
   if(delta){
     entry.group.position.sub(handlePivot.position).applyAxisAngle(verticalAxis,delta).add(handlePivot.position);
     entry.group.rotation.y+=delta;
   }
 }
 handlePrevious={position:handlePivot.position.clone(),yaw:handlePivot.rotation.y};
 updatePlacementUI();
});
let uniformScaleTool=false;
let scaleDrag=null; // Pointer-drag operation: size only, never translation.


function selected(){return selectedId?added.get(selectedId):null;}
function showTransformHandles(){
 const entry=selected();
 const canShow=mode==='build'&&canModify()&&!!entry&&!uniformScaleTool;
 if(canShow){
   if(transform.object!==handlePivot)transform.attach(handlePivot);
   syncHandlePivot();
 }
 transform.enabled=canShow;
 transformHelper.visible=canShow;
}
function selectObject(id){
 selectedId=id&&added.has(id)?id:null;
 if(!selected()){transform.detach();handlePrevious=null;}
 showTransformHandles();updateObjectUI();
}
function updateDeleteUI(){
 const entry=selected();
 const allowed=mode==='build'&&canDeleteEntry(entry);
 $('delete-btn').disabled=!allowed;
 $('rename-btn').disabled=!(mode==='build'&&online&&teacherAuthorized&&teacherMode&&!!entry);
 $('delete-btn').textContent=teacherMode&&teacherAuthorized?'Delete selected model':'Delete my model';
 $('delete-btn').title=allowed?'Remove selected model from shared city': 'Only a verified teacher or the uploader during class may delete';
}

function updateObjectUI(){
 $('object-select').innerHTML='<option value="">None selected</option>' + [...added.values()].map(e=>`<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join('');
 $('object-select').value=selectedId||'';
 $('object-count').textContent=added.size;
 $('objects-list').innerHTML=added.size?[...added.values()].map(e=>`<div class="object-item ${selectedId===e.id?'selected':''}" data-id="${escapeHtml(e.id)}"><span>${escapeHtml(e.name)}</span><small>●</small></div>`).join(''):'<div class="empty">No models added yet.</div>';
 updateDeleteUI();$('place-btn').disabled=!canModify()||!selected();
 updatePlacementUI();
}
// Direct placement controls are an accessible fallback to dragging 3D transform handles.
const placementFieldIds=['edit-x','edit-y','edit-z','edit-rotation','edit-scale'];
function updatePlacementUI(){
 syncHandlePivot();
 const e=selected();
 $('placement-controls').classList.toggle('disabled-placement',!e||!canModify());
 for(const id of placementFieldIds)$(id).disabled=!e||!canModify();
 for(const id of ['nudge-left','nudge-right','nudge-forward','nudge-back','nudge-up','nudge-down'])$(id).disabled=!e||!canModify();
 $('focus-btn').disabled=!e;
 for(const id of ['scale-plus','scale-minus'])$(id).disabled=!e||!canModify();
 if(!e)return;
 const group=e.group;
 // Keep the active field intact while somebody types.
 const values={'edit-x':group.position.x,'edit-y':group.position.y,'edit-z':group.position.z,'edit-rotation':THREE.MathUtils.radToDeg(group.rotation.y),'edit-scale':group.scale.x};
 for(const [id,value] of Object.entries(values))if(document.activeElement!==$(id))$(id).value=Number(value.toFixed(3));
}
function applyPlacementFields(){
 const entry=selected();if(!entry||!canModify())return;
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
function changeUniformScale(factor){
 const e=selected();if(!e||!canModify())return;
 const current=e.group.scale.x;
 const next=THREE.MathUtils.clamp(current*factor,0.01,100);
 e.group.scale.setScalar(next);
 updatePlacementUI();saveShared();
}
$('scale-plus').onclick=()=>changeUniformScale(1.1);
$('scale-minus').onclick=()=>changeUniformScale(1/1.1);

function nudge(dx,dz){const e=selected();if(!e||!canModify())return;const step=Number($('nudge-step').value)||20;e.group.position.x+=dx*step;e.group.position.z+=dz*step;updatePlacementUI();saveShared();}
$('nudge-left').onclick=()=>nudge(-1,0);
$('nudge-right').onclick=()=>nudge(1,0);
$('nudge-forward').onclick=()=>nudge(0,-1);
$('nudge-back').onclick=()=>nudge(0,1);
$('nudge-up').onclick=()=>nudgeHeight(1);
$('nudge-down').onclick=()=>nudgeHeight(-1);
function nudgeHeight(direction){const e=selected();if(!e||!canModify())return;const step=Number($('nudge-step').value)||20;e.group.position.y+=direction*step;updatePlacementUI();saveShared();}
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
$('handle-offset').addEventListener('change',()=>{
 const value=Number($('handle-offset').value);
 if(!Number.isFinite(value)||value<0||value>500){toast('Handle offset must be between 0 and 500.');$('handle-offset').value=handleOffset;return;}
 handleOffset=value;
 syncHandlePivot();
});
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
 const files=[...event.target.files];
 if(!files.length)return;
 if(!canModify()){statusText('Editing is off.');event.target.value='';return;}
 try{
  statusText('Reading Tinkercad model…');
  const {objText,mtlText,originalName,fromZip}=await readTinkercadUpload(files);
  const labelInput=$('model-description').value.trim();
  const label=cleanModelLabel(labelInput)||suggestedModelLabel(originalName);
  const displayName=label.split('_').map(s=>s.charAt(0).toUpperCase()+s.slice(1)).join(' ');
  statusText('Uploading '+displayName+' to shared city…');
  const path=await uploadShared(displayName,objText,mtlText);
  statusText(`${displayName} added successfully (${path.split('/').pop()})${fromZip?' from ZIP':''}.`);
  $('model-description').value='';
 }catch(err){statusText(`Could not upload model: ${err.message}`);console.error(err);}finally{event.target.value='';}
});
function setTool(tool){
 // A dedicated uniform scale gesture avoids TransformControls' per-axis handles
 // and keeps the database's single scale factor consistent for X/Y/Z.
 uniformScaleTool=tool==='scale';
 transform.setMode(uniformScaleTool?'translate':tool);
 for(const [name,id] of [['translate','tool-move'],['rotate','tool-rotate'],['scale','tool-scale']])$(id).classList.toggle('active',name===tool);
 applyAxis();showTransformHandles();
 renderer.domElement.style.cursor=uniformScaleTool?'ew-resize':'';
 if(uniformScaleTool)toast('Uniform Scale: drag left/right on a model. Hold Shift for fine adjustment.');
}
function applyAxis(){if(transform.getMode()==='rotate'){transform.showX=false;transform.showY=true;transform.showZ=false;return;}const all=$('axis-select').value==='XYZ';transform.showX=true;transform.showY=all;transform.showZ=true;}
$('show-handles-btn').onclick=()=>{showTransformHandles();if(selected()){setTool('translate');focusModel();toast('Movement handles restored.');}else toast('Select an imported model first.');};
$('tool-move').onclick=()=>setTool('translate');$('tool-rotate').onclick=()=>setTool('rotate');$('tool-scale').onclick=()=>setTool('scale');$('axis-select').onchange=applyAxis;
$('object-select').onchange=e=>selectObject(e.target.value);
$('rename-btn').onclick=async()=>{
 const entry=selected();
 if(!entry||!online||!teacherAuthorized||!teacherMode)return;
 const proposed=window.prompt('New display name for this model:',entry.name);
 if(proposed===null)return;
 const name=proposed.trim();
 if(!name||name.length>100){toast('Enter a model name between 1 and 100 characters.');return;}
 if(name===entry.name)return;
 const button=$('rename-btn');button.disabled=true;
 try{
  const {data,error}=await supabase.rpc('rename_city_object',{p_object_id:entry.id,p_new_name:name});
  if(error)throw error;
  if(data!==true)throw new Error('Rename was not permitted.');
  entry.name=name;updateObjectUI();
  toast('Model renamed. The new name will appear for everyone.');
 }catch(e){console.error(e);toast('Rename failed: '+e.message);}
 finally{updateDeleteUI();}
};
$('objects-list').onclick=e=>{const item=e.target.closest('[data-id]');if(item)selectObject(item.dataset.id);};
$('place-btn').onclick=()=>{const e=selected();if(e&&canModify()){positionInFront(e.group);updatePlacementUI();saveShared();focusModel(e);toast('Model moved in front of your camera.');}};
$('delete-btn').onclick=async()=>{
 const entry=selected();
 if(!canDeleteEntry(entry))return;
 if(!window.confirm(`Delete “${entry.name}” from the shared city? This removes it for everyone and cannot be undone.`))return;
 $('delete-btn').disabled=true;
 try{
  let request=supabase.from('city_objects').delete().eq('id',entry.id);
  if(!(teacherAuthorized&&teacherMode))request=request.eq('created_by',authUser.id);
  const {data,error}=await request.select('id');
  if(error)throw error;
  if(!data?.length)throw new Error('Deletion was not permitted or the model was already removed.');
  // Uploaded storage files are deliberately retained: no Storage DELETE policy is granted.
  clearTimeout(saves.get(entry.id));saves.delete(entry.id);
  removeRemoteModel(entry.id);
  toast('Model removed from the shared city.');
 }catch(err){toast('Could not delete: '+err.message);console.error(err);updateDeleteUI();}
};
// Dragging on a contributed model in Scale mode resizes it uniformly.
// Shift adjusts drag sensitivity for precise touchpad/mouse control.
// The active drag is tracked separately, so no axis gizmo can translate it.
renderer.domElement.addEventListener('pointerdown',e=>{
 if(!uniformScaleTool||mode!=='build'||!canModify()||pointerLocked||e.button!==0)return;
 const rect=renderer.domElement.getBoundingClientRect();
 mouse.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
 ray.setFromCamera(mouse,camera);
 const hit=ray.intersectObjects([...added.values()].map(o=>o.group),true)[0];
 if(!hit)return;
 let node=hit.object;
 while(node.parent&&!node.userData.modelId)node=node.parent;
 if(!node.userData.modelId)return;
 if(selectedId!==node.userData.modelId)selectObject(node.userData.modelId);
 const entry=selected();
 if(!entry)return;
 scaleDrag={pointerId:e.pointerId,modelId:entry.id,startX:e.clientX,startScale:entry.group.scale.x};
 renderer.domElement.setPointerCapture?.(e.pointerId);
 e.preventDefault();
 e.stopImmediatePropagation();
},true);
renderer.domElement.addEventListener('pointermove',e=>{
 if(!scaleDrag||e.pointerId!==scaleDrag.pointerId)return;
 if(!uniformScaleTool||mode!=='build'||!canModify())return;
 const entry=added.get(scaleDrag.modelId);
 if(!entry)return;
 const pixels=e.clientX-scaleDrag.startX;
 const sensitivity=e.shiftKey?0.0018:0.009;
 const factor=Math.exp(pixels*sensitivity);
 const next=THREE.MathUtils.clamp(scaleDrag.startScale*factor,0.01,100);
 entry.group.scale.setScalar(next);
 updatePlacementUI();
 e.preventDefault();
});
function finishScaleDrag(e){
 if(!scaleDrag||e.pointerId!==scaleDrag.pointerId)return;
 const completed=scaleDrag;
 scaleDrag=null;
 if(renderer.domElement.hasPointerCapture?.(e.pointerId))renderer.domElement.releasePointerCapture(e.pointerId);
 if(e.type==='pointerup'&&canModify()&&added.has(completed.modelId))saveShared();
}
renderer.domElement.addEventListener('pointerup',finishScaleDrag);
renderer.domElement.addEventListener('pointercancel',finishScaleDrag);

renderer.domElement.addEventListener('pointerdown',e=>{
 if(mode!=='build'||pointerLocked||e.button!==0||transform.dragging)return;
 const box=renderer.domElement.getBoundingClientRect();mouse.set((e.clientX-box.left)/box.width*2-1,-(e.clientY-box.top)/box.height*2+1);ray.setFromCamera(mouse,camera);
 const intersect=ray.intersectObjects([...added.values()].map(o=>o.group),true)[0];
 if(intersect){let target=intersect.object;while(target.parent&&!target.userData.modelId)target=target.parent;if(target.userData.modelId)selectObject(target.userData.modelId);}
});

// Shared Supabase is the canonical source. No local IndexedDB writes in this version.
$('save-btn').onclick=async()=>{if(!canModify())return;saveShared();toast('Placement queued for saving to shared city.');};
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

// Teacher Mode: Supabase email/password login, authorized by the server-side teacher table.
// The public website never stores teacher credentials as an access gate.
$('teacher-toggle').onclick=()=>{
 if(teacherAuthorized){
   teacherMode=!teacherMode;
   updateTeacherControls();
   toast(teacherMode?'Teacher Mode enabled — edit contributed models.':'Teacher Mode exited.');
 }else{
   $('teacher-dialog').classList.remove('hidden');
   $('teacher-email').focus();
 }
};
$('teacher-cancel').onclick=()=>$('teacher-dialog').classList.add('hidden');
$('teacher-email-form').onsubmit=async(e)=>{
 e.preventDefault();
 const email=$('teacher-email').value.trim();
 const password=$('teacher-password').value;
 if(!email||!password)return;
 const btn=$('teacher-login-btn');btn.disabled=true;
 try{
  const {data,error}=await supabase.auth.signInWithPassword({email,password});
  if(error)throw error;
  authUser=data.user;online=true;
  await readTeacherPermission();
  if(!teacherAuthorized){
    await supabase.auth.signOut();
    const a=await supabase.auth.signInAnonymously();
    if(a.error)throw a.error;
    authUser=a.data.user;teacherMode=false;
    await refreshSettings();await syncAllModels();
    throw new Error('Account is not authorized for Teacher Mode.');
  }
  teacherMode=true;
  $('teacher-password').value='';
  $('teacher-dialog').classList.add('hidden');
  await refreshSettings();await syncAllModels();updateTeacherControls();
  toast('Teacher Mode enabled.');
 }catch(err){toast('Teacher sign-in failed: '+err.message);}
 finally{btn.disabled=false;}
};
$('teacher-signout').onclick=async()=>{
 const {error}=await supabase.auth.signOut();
 if(error){toast('Sign out failed: '+error.message);return;}
 teacherAuthorized=false;teacherMode=false;online=false;authUser=null;
 updateTeacherControls();
 // Restore no-login student view with a new anonymous browser session.
 const {data,error:anonError}=await supabase.auth.signInAnonymously();
 if(anonError){toast('Anonymous reconnect failed: '+anonError.message);return;}
 authUser=data.user;online=true;
 await refreshSettings();await syncAllModels();showTeacherStatus();
 toast('Signed out of teacher account.');
};


function showTab(next){releaseFly();mode=next;document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('selected',b.dataset.tab===mode));$('explore-panel').classList.toggle('hidden',mode!=='explore');$('build-panel').classList.toggle('hidden',mode!=='build');$('mode-label').textContent=mode==='explore'?'Explore mode':'Build mode';showTransformHandles();updateDeleteUI();updatePlacementUI();$('crosshair').style.display='none';$('hint').textContent=mode==='explore'?'Click Enter flythrough to fly around':'Select an imported object to move, rotate, or resize it';}
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
$('start-btn').onclick=startFly;$('reset-btn').onclick=resetView;$('overview-btn').onclick=overview;
$('speed').oninput=e=>$('speed-value').textContent=`${e.target.value}×`;
$('height-reset').onchange=resetView;
$('help-close').onclick=()=>$('help-modal').classList.add('hidden');
window.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;keys[e.code]=true;if(pointerLocked&&['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();if(mode==='build'&&canModify()){if(e.code==='KeyG')setTool('translate');if(e.code==='KeyE')setTool('rotate');if(e.code==='KeyT')setTool('scale');}});
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
