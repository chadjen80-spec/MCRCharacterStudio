/* MCR Character Studio — core: rig, 2D mesh skinning, vector wardrobe art, image part cutting, animation clips.
   World units: y up, feet on y=0, character faces +x, about 2.6 units tall. Needs THREE + vfx-engine.js (clamp, lerp, D2R, rng). */
'use strict';
const PPU=220; // texture pixels per world unit for drawn parts

/* ============================================================ rig */
const DEFAULT_BONES=[
 ['root',null,[0,1.0],[0,1.25],'สะโพก'],
 ['chest','root',[0,1.25],[0,1.6],'ลำตัว'],
 ['head','chest',[0.02,1.6],[0.02,2.6],'หัว'],
 ['uarmB','chest',[-0.15,1.52],[-0.2,1.28],'ต้นแขนหลัง'],
 ['larmB','uarmB',[-0.2,1.28],[-0.17,1.05],'แขนล่างหลัง'],
 ['handB','larmB',[-0.17,1.05],[-0.16,0.95],'มือหลัง'],
 ['thighB','root',[-0.1,1.0],[-0.12,0.58],'ต้นขาหลัง'],
 ['shinB','thighB',[-0.12,0.58],[-0.13,0.16],'แข้งหลัง'],
 ['footB','shinB',[-0.13,0.16],[0.04,0.06],'เท้าหลัง'],
 ['thighF','root',[0.1,1.0],[0.13,0.58],'ต้นขาหน้า'],
 ['shinF','thighF',[0.13,0.58],[0.15,0.16],'แข้งหน้า'],
 ['footF','shinF',[0.15,0.16],[0.32,0.06],'เท้าหน้า'],
 ['uarmF','chest',[0.15,1.52],[0.21,1.28],'ต้นแขนหน้า'],
 ['larmF','uarmF',[0.21,1.28],[0.27,1.05],'แขนล่างหน้า'],
 ['handF','larmF',[0.27,1.05],[0.29,0.95],'มือหน้า'],
 ['weapon','handF',[0.28,1.0],[0.28,1.6],'อาวุธ'],
 ['cape1','chest',[-0.1,1.56],[-0.2,1.25],'ผ้า 1'],
 ['cape2','cape1',[-0.2,1.25],[-0.3,0.95],'ผ้า 2'],
 ['cape3','cape2',[-0.3,0.95],[-0.42,0.62],'ผ้า 3']];
const BONE_IDS=DEFAULT_BONES.map(b=>b[0]);
const BONE_LABEL=Object.fromEntries(DEFAULT_BONES.map(b=>[b[0],b[4]]));
function defaultRig(){return DEFAULT_BONES.map(([id,parent,h,t])=>({id,parent,h:[...h],t:[...t]}));}
const rigMap=rig=>Object.fromEntries(rig.map(b=>[b.id,b]));
// Joint limits (degrees, relative to rest). Positive = counter-clockwise; facing right, so + swings a limb forward/up.
const LIMITS={head:[-40,40],chest:[-60,60],larmB:[-5,155],larmF:[-5,155],shinB:[-155,5],shinF:[-155,5],footB:[-45,45],footF:[-45,45],handB:[-70,70],handF:[-70,70],thighB:[-120,120],thighF:[-120,120],cape1:[-70,70],cape2:[-70,70],cape3:[-70,70]};
const CHAIN_CHILD={root:'chest',uarmB:'larmB',uarmF:'larmF',thighB:'shinB',thighF:'shinF',cape1:'cape2',cape2:'cape3'};
const PARENT_BLEND={chest:.5,uarmB:.3,uarmF:.3,thighB:.3,thighF:.3,larmB:.5,larmF:.5,shinB:.5,shinF:.5};

/* 2D affine [a,b,c,d,e,f]: x' = a x + c y + e, y' = b x + d y + f */
const AF={
  mul:(m,n)=>[m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]],
  rotAbout:(x,y,r)=>{const c=Math.cos(r),s=Math.sin(r);return[c,s,-s,c,x-c*x+s*y,y-s*x-c*y];},
  T:(x,y)=>[1,0,0,1,x,y],S:(sx,sy)=>[sx,0,0,sy,0,0],
  ap:(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]};
function poseMatrices(rig,pose){const W={};for(const B of rig){const r=(pose.rot[B.id]||0)*D2R;let m=AF.rotAbout(B.h[0],B.h[1],r);
    if(!B.parent){m=AF.mul(AF.mul(AF.T(pose.x||0,pose.y||0),AF.S(pose.sx||1,pose.sy||1)),m);W[B.id]=m;}else W[B.id]=AF.mul(W[B.parent],m);}return W;}
const restPose=()=>({x:0,y:0,sx:1,sy:1,rot:{}});

/* ============================================================ part mesh (CPU skinning) */
function segDist(px,py,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],L2=dx*dx+dy*dy||1e-9;let t=((px-a[0])*dx+(py-a[1])*dy)/L2;t=clamp(t,0,1);return Math.hypot(px-a[0]-dx*t,py-a[1]-dy*t);}
function vertexWeights(R,part,x,y){
  if(part.chain){const ds=part.chain.map(id=>({id,d:segDist(x,y,R[id].h,R[id].t)})).sort((a,b)=>a.d-b.d);const w0=1/Math.pow(ds[0].d+.04,4),w1=ds[1]?1/Math.pow(ds[1].d+.04,4):0;return[[ds[0].id,w0/(w0+w1)],...(ds[1]?[[ds[1].id,w1/(w0+w1)]]:[])];}
  const B=R[part.bone];if(!part.soft||!B)return[[part.bone,1]];
  const dx=B.t[0]-B.h[0],dy=B.t[1]-B.h[1],L2=dx*dx+dy*dy||1e-6,t=((x-B.h[0])*dx+(y-B.h[1])*dy)/L2,out=[];let wo=1;
  if(B.parent&&PARENT_BLEND[B.id]){const wp=clamp(PARENT_BLEND[B.id]-t/.4*PARENT_BLEND[B.id]*1.2,0,PARENT_BLEND[B.id]);if(wp>0){out.push([B.parent,wp]);wo-=wp;}}
  const ch=CHAIN_CHILD[B.id];if(ch&&R[ch]){const wc=clamp(.5-(1-t)/.4*.6,0,.5);if(wc>0){out.push([ch,wc]);wo-=wc;}}
  out.push([B.id,wo]);return out;}
class PartMesh{
  constructor(part,rig){this.part=part;const [x0,y0,x1,y1]=part.bbox,[nx,ny]=part.grid,R=rigMap(rig);this.nx=nx;this.ny=ny;
    const n=(nx+1)*(ny+1);this.rest=new Float32Array(n*2);this.w=[];const uv=new Float32Array(n*2),idx=[];
    for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){const k=j*(nx+1)+i,u=i/nx,v=j/ny,x=lerp(x0,x1,u),y=lerp(y0,y1,v);this.rest[k*2]=x;this.rest[k*2+1]=y;uv[k*2]=u;uv[k*2+1]=v;this.w.push(vertexWeights(R,part,x,y));
      if(i<nx&&j<ny){const a=k,b=k+1,c=k+nx+1,d=c+1;idx.push(a,b,c,b,d,c);}}
    this.pos=new Float32Array(n*3);const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(this.pos,3));g.setAttribute('uv',new THREE.BufferAttribute(uv,2));g.setIndex(idx);
    this.tex=new THREE.CanvasTexture(part.canvas);this.tex.minFilter=THREE.LinearFilter;this.tex.generateMipmaps=false;
    this.mat=new THREE.MeshBasicMaterial({map:this.tex,transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide,premultipliedAlpha:false});
    this.mesh=new THREE.Mesh(g,this.mat);this.mesh.frustumCulled=false;this.mesh.renderOrder=20+part.z*10;this.geo=g;}
  update(W){const n=this.w.length;for(let k=0;k<n;k++){const x=this.rest[k*2],y=this.rest[k*2+1];let X=0,Y=0;for(const [id,wt] of this.w[k]){const m=W[id];if(!m){X+=x*wt;Y+=y*wt;continue;}X+=(m[0]*x+m[2]*y+m[4])*wt;Y+=(m[1]*x+m[3]*y+m[5])*wt;}this.pos[k*3]=X;this.pos[k*3+1]=Y;this.pos[k*3+2]=0;}this.geo.attributes.position.needsUpdate=true;}
  dispose(){this.geo.dispose();this.mat.dispose();this.tex.dispose();}
}
class CharRig{ // a character instance in a three.js scene
  constructor(parts,rig){this.group=new THREE.Group();this.rig=rig;this.meshes=parts.filter(p=>!p.hidden).map(p=>new PartMesh(p,rig));this.meshes.forEach(m=>this.group.add(m.mesh));this.W=poseMatrices(rig,restPose());this.apply(restPose());}
  apply(pose){this.W=poseMatrices(this.rig,pose);for(const m of this.meshes)m.update(this.W);}
  joint(id,end='h'){const B=this.rig.find(b=>b.id===id);if(!B)return[0,0];const p=B[end];return AF.ap(this.W[id],p[0],p[1]);}
  setTint(op){for(const m of this.meshes){m.mat.opacity=op;}}
  wire(on){for(const m of this.meshes)m.mat.wireframe=false;if(this.wires){this.wires.forEach(w=>this.group.remove(w));this.wires=null;}
    if(on){this.wires=this.meshes.map(m=>{const w=new THREE.Mesh(m.geo,new THREE.MeshBasicMaterial({color:0x7ef0ff,wireframe:true,transparent:true,opacity:.45,depthTest:false}));w.renderOrder=900;w.frustumCulled=false;this.group.add(w);return w;});}}
  dispose(){this.meshes.forEach(m=>m.dispose());if(this.wires)this.wires.forEach(w=>w.material.dispose());}
}

/* ============================================================ vector wardrobe */
const WARDROBE={
 hair:[['spiky','ผมตั้งแหลม'],['messy','ผมยุ่ง'],['long','ผมยาว'],['bob','ผมบ็อบ'],['ponytail','หางม้า'],['bald','ไม่มีผม']],
 hat:[['none','ไม่ใส่'],['headband','ผ้าคาดหัวนินจา'],['bandana','ผ้าโพกหัว'],['hood','ฮู้ด'],['wizard','หมวกพ่อมด'],['helm','หมวกเหล็ก'],['crown','มงกุฎ']],
 face:[['calm','สงบ'],['fierce','ดุดัน'],['happy','ยิ้ม'],['closed','หลับตา']],
 top:[['tunic','ทูนิค'],['gi','ชุดนินจา'],['armor','เกราะ'],['robe','เสื้อคลุมยาว'],['hoodie','ฮู้ดดี้']],
 bottom:[['pants','กางเกงขายาว'],['shorts','ขาสั้น'],['skirt','กระโปรง'],['greaves','เกราะขา']],
 shoes:[['boots','บูท'],['sneakers','ผ้าใบ'],['sandals','รองเท้าแตะ']],
 weapon:[['none','มือเปล่า'],['sword','ดาบ'],['katana','คาตานะ'],['dagger','คุไน'],['staff','คทา'],['axe','ขวาน'],['spear','หอก']],
 back:[['none','ไม่มี'],['scarf','ผ้าพันคอ'],['cape','ผ้าคลุม'],['wings','ปีก']]};
const SLOT_LABEL={hair:'ทรงผม',hat:'หมวก',face:'หน้า',top:'เสื้อ',bottom:'กางเกง',shoes:'รองเท้า',weapon:'อาวุธ',back:'ด้านหลัง'};
const COLOR_KEYS=[['skin','ผิว'],['hair','ผม'],['eyes','ตา'],['top','เสื้อ'],['trim','ขอบ/ลาย'],['bottom','กางเกง'],['shoes','รองเท้า'],['metal','โลหะ'],['accent','ผ้า/สีเน้น']];
const ARCHETYPES={
 ninja:{n:'นินจา',slots:{hair:'messy',hat:'headband',face:'fierce',top:'gi',bottom:'pants',shoes:'boots',weapon:'dagger',back:'scarf'},colors:{skin:'#ffdcc6',hair:'#1f1b24',eyes:'#e2452b',top:'#25222c',trim:'#d6a23c',bottom:'#25222c',shoes:'#2c2831',metal:'#cfd4dc',accent:'#d6202e'}},
 knight:{n:'อัศวิน',slots:{hair:'spiky',hat:'none',face:'calm',top:'armor',bottom:'greaves',shoes:'boots',weapon:'sword',back:'cape'},colors:{skin:'#ffe0c8',hair:'#f2c84b',eyes:'#4a7be0',top:'#e9e4da',trim:'#d9a632',bottom:'#5b4a3a',shoes:'#6b5040',metal:'#d8dde6',accent:'#b8202c'}},
 mage:{n:'จอมเวท',slots:{hair:'long',hat:'wizard',face:'calm',top:'robe',bottom:'pants',shoes:'sandals',weapon:'staff',back:'none'},colors:{skin:'#ffe2cf',hair:'#c9d4ff',eyes:'#8d5cff',top:'#3b2a7a',trim:'#f0c75a',bottom:'#2a2050',shoes:'#5a3b2a',metal:'#d8dde6',accent:'#7a3cff'}},
 samurai:{n:'ซามูไร',slots:{hair:'ponytail',hat:'none',face:'fierce',top:'gi',bottom:'pants',shoes:'sandals',weapon:'katana',back:'none'},colors:{skin:'#ffdcc2',hair:'#2a1d1a',eyes:'#3a2a24',top:'#e8e2d4',trim:'#9b2230',bottom:'#2b2f44',shoes:'#4a3020',metal:'#dfe3ea',accent:'#9b2230'}},
 rogue:{n:'โจร',slots:{hair:'messy',hat:'hood',face:'fierce',top:'hoodie',bottom:'shorts',shoes:'sneakers',weapon:'dagger',back:'none'},colors:{skin:'#f6cfb4',hair:'#6b3a2a',eyes:'#3fd08a',top:'#2f4a3a',trim:'#a8834a',bottom:'#3a3328',shoes:'#2a2420',metal:'#c9ced8',accent:'#2f4a3a'}},
 valkyrie:{n:'วาลคิรี',slots:{hair:'long',hat:'helm',face:'calm',top:'armor',bottom:'skirt',shoes:'boots',weapon:'spear',back:'wings'},colors:{skin:'#ffe4d2',hair:'#ffe3a1',eyes:'#4aa8e0',top:'#f1ede4',trim:'#e0b23e',bottom:'#3a63b8',shoes:'#e0e4ec',metal:'#e3e7ee',accent:'#ffffff'}},
 berserker:{n:'นักรบขวาน',slots:{hair:'spiky',hat:'bandana',face:'fierce',top:'tunic',bottom:'pants',shoes:'boots',weapon:'axe',back:'cape'},colors:{skin:'#efc09e',hair:'#b5401f',eyes:'#2a2a2a',top:'#6a4a32',trim:'#c9a24a',bottom:'#3a2c24',shoes:'#2b221c',metal:'#b8bec8',accent:'#2f6a3a'}},
 priest:{n:'นักบวช',slots:{hair:'bob',hat:'crown',face:'happy',top:'robe',bottom:'pants',shoes:'sandals',weapon:'staff',back:'none'},colors:{skin:'#ffe6d6',hair:'#f4e6c0',eyes:'#3a7bd0',top:'#f4f1ea',trim:'#d9a632',bottom:'#e7e2d6',shoes:'#b08850',metal:'#f0d070',accent:'#ffcf4a'}}};

const OL='#1b1320',LW=.022;
function shadeCol(hex,k){const c=new THREE.Color(hex);if(k<0)c.multiplyScalar(1+k);else c.lerp(new THREE.Color('#ffffff'),k);return'#'+c.getHexString();}
function smooth(x,pts,closed=true){const n=pts.length;x.moveTo(pts[0][0],pts[0][1]);for(let i=0;i<(closed?n:n-1);i++){const p0=pts[(i-1+n)%n],p1=pts[i],p2=pts[(i+1)%n],p3=pts[(i+2)%n];
  x.bezierCurveTo(p1[0]+(p2[0]-p0[0])/6,p1[1]+(p2[1]-p0[1])/6,p2[0]-(p3[0]-p1[0])/6,p2[1]-(p3[1]-p1[1])/6,p2[0],p2[1]);}if(closed)x.closePath();}
const poly=pts=>x=>{x.moveTo(pts[0][0],pts[0][1]);for(let i=1;i<pts.length;i++)x.lineTo(pts[i][0],pts[i][1]);x.closePath();};
const blob=pts=>x=>smooth(x,pts);
const ell=(cx,cy,rx,ry,r=0)=>x=>x.ellipse(cx,cy,rx,ry,r,0,Math.PI*2);
function capsule(a,b,w0,w1){return x=>{const dx=b[0]-a[0],dy=b[1]-a[1],L=Math.hypot(dx,dy)||1e-6,nx=-dy/L,ny=dx/L,an=Math.atan2(dy,dx);
  x.moveTo(a[0]+nx*w0/2,a[1]+ny*w0/2);x.lineTo(b[0]+nx*w1/2,b[1]+ny*w1/2);x.arc(b[0],b[1],w1/2,an+Math.PI/2,an-Math.PI/2,true);x.lineTo(a[0]-nx*w0/2,a[1]-ny*w0/2);x.arc(a[0],a[1],w0/2,an-Math.PI/2,an+Math.PI/2,true);x.closePath();};}
function paint(x,path,fill,o={}){x.save();x.beginPath();path(x);if(o.evenodd)x.fill;x.fillStyle=fill;x.fill(o.evenodd?'evenodd':'nonzero');
  if(o.shade!==false){x.save();x.clip(o.evenodd?'evenodd':'nonzero');const b=x.__box,g=x.createLinearGradient(b[2],b[3],b[0],b[1]);g.addColorStop(0,'rgba(255,255,255,.2)');g.addColorStop(.42,'rgba(255,255,255,0)');g.addColorStop(.58,'rgba(0,0,0,0)');g.addColorStop(1,'rgba(10,0,20,.3)');x.fillStyle=g;x.fillRect(b[0]-1,b[1]-1,b[2]-b[0]+2,b[3]-b[1]+2);x.restore();}
  if(o.stroke!==false){x.lineWidth=o.lw||LW;x.strokeStyle=o.ol||OL;x.stroke();}x.restore();}
function line(x,pts,col,w){x.save();x.beginPath();x.moveTo(pts[0][0],pts[0][1]);for(let i=1;i<pts.length;i++)x.lineTo(pts[i][0],pts[i][1]);x.strokeStyle=col;x.lineWidth=w;x.stroke();x.restore();}
const L2=(a,b,t)=>[lerp(a[0],b[0],t),lerp(a[1],b[1],t)];
function mkCanvas(bbox){const [x0,y0,x1,y1]=bbox,c=document.createElement('canvas');c.width=Math.max(4,Math.ceil((x1-x0)*PPU));c.height=Math.max(4,Math.ceil((y1-y0)*PPU));const x=c.getContext('2d');x.setTransform(PPU,0,0,-PPU,-x0*PPU,y1*PPU);x.lineJoin='round';x.lineCap='round';x.__box=bbox;return[c,x];}
function vpart(id,bone,z,bbox,draw,o={}){const [c,x]=mkCanvas(bbox);draw(x);if(o.back){x.setTransform(1,0,0,1,0,0);x.globalCompositeOperation='source-atop';x.fillStyle='rgba(22,10,34,.3)';x.fillRect(0,0,c.width,c.height);}
  return{id,bone,z,canvas:c,bbox,soft:o.soft!==false,grid:o.grid||[2,4],chain:o.chain||null};}

function buildVectorParts(dna,rig){const R=rigMap(rig),C=dna.colors,S=dna.slots,P=[],J=id=>R[id].h,Tl=id=>R[id].t,rnd=rng(dna.seed||7);
  const bb=(a,b,p=.16)=>[Math.min(a[0],b[0])-p,Math.min(a[1],b[1])-p,Math.max(a[0],b[0])+p,Math.max(a[1],b[1])+p];
  // back items
  if(S.back==='cape')P.push(vpart('cape','cape1',0,[-.85,.3,.35,1.8],x=>{paint(x,blob([[-.18,1.64],[.12,1.62],[.04,1.2],[-.04,.76],[.02,.44],[-.2,.52],[-.38,.4],[-.56,.54],[-.64,.9],[-.44,1.32]]),C.accent);line(x,[[-.12,1.4],[-.3,.7]],shadeCol(C.accent,-.35),.02);line(x,[[-.02,1.3],[-.1,.6]],shadeCol(C.accent,-.35),.018);},{chain:['cape1','cape2','cape3'],grid:[3,8]}));
  if(S.back==='scarf')P.push(vpart('scarfTail','cape1',0,[-1.0,.75,.15,1.8],x=>{paint(x,blob([[-.12,1.6],[-.4,1.42],[-.7,1.12],[-.86,.96],[-.62,1.2],[-.32,1.36],[-.06,1.5]]),C.accent);paint(x,blob([[-.12,1.52],[-.36,1.24],[-.52,.92],[-.6,.82],[-.44,1.0],[-.24,1.3],[-.04,1.46]]),shadeCol(C.accent,-.15));},{chain:['cape1','cape2','cape3'],grid:[3,6]}));
  if(S.back==='wings')P.push(vpart('wings','chest',0,[-1.35,.85,.25,2.55],x=>{const w=C.trim==='#ffffff'?'#f4f2ff':shadeCol(C.accent,.55);
    for(const k of [0,1]){const o=k*.18;paint(x,blob([[-.05-o*.3,1.5],[-.5-o,2.35-o*.6],[-1.2-o*.3,2.35-o*.9],[-1.1-o*.2,2.0-o],[-.95-o*.2,1.7-o],[-.7-o*.2,1.45-o*.5],[-.4,1.25]]),k?shadeCol(w,-.15):w);
      for(let i=0;i<4;i++)line(x,[[-.3-i*.2-o*.3,1.4-i*.02],[-.5-i*.18-o*.4,1.75+i*.1-o*.6]],shadeCol(w,-.3),.014);}},{soft:false}));
  // hair back (+ hood bulk)
  P.push(vpart('hairB','head',1,[-.95,.95,.8,2.8],x=>drawHairBack(x,S,C),{soft:false}));
  const limbs=(s)=>{const back=s==='B';
    const zl=back?3:5,za=back?2:11;
    P.push(vpart('thigh'+s,'thigh'+s,zl,bb(J('thigh'+s),Tl('thigh'+s)),x=>{const a=J('thigh'+s),b=Tl('thigh'+s);paint(x,capsule(a,b,.22,.18),S.bottom==='skirt'?C.skin:C.bottom);
        if(S.bottom==='shorts')paint(x,capsule(L2(a,b,.6),b,.17,.17),C.skin);if(S.bottom==='greaves')paint(x,ell(b[0]+.02,b[1]+.03,.1,.08),C.metal);},{back}));
    P.push(vpart('shin'+s,'shin'+s,zl+.1,bb(J('shin'+s),Tl('shin'+s)),x=>{const a=J('shin'+s),b=Tl('shin'+s),bare=S.bottom==='shorts'||S.bottom==='skirt';
        paint(x,capsule(a,b,.17,.14),S.bottom==='greaves'?C.metal:bare?C.skin:C.bottom);
        if(S.shoes==='boots'){paint(x,capsule(L2(a,b,.42),b,.18,.16),C.shoes);line(x,[L2(a,b,.44).map((v,i)=>v+(i?0:-.09)),L2(a,b,.44).map((v,i)=>v+(i?0:.09))],C.trim,.025);}
        if(S.top==='gi'&&S.shoes!=='boots')for(let i=0;i<3;i++){const p=L2(a,b,.35+i*.18);line(x,[[p[0]-.08,p[1]+.02],[p[0]+.08,p[1]-.02]],C.trim,.02);}},{back}));
    P.push(vpart('foot'+s,'foot'+s,zl+.2,bb(J('foot'+s),Tl('foot'+s),.2),x=>{const a=J('foot'+s),b=Tl('foot'+s);
        if(S.shoes==='sandals'){paint(x,blob([[a[0]-.07,a[1]+.04],[a[0]+.04,a[1]+.05],[b[0]+.04,b[1]+.01],[b[0]+.03,b[1]-.04],[a[0]-.08,b[1]-.04]]),C.skin);line(x,[[a[0]-.02,a[1]],[b[0]-.04,b[1]+.02]],C.shoes,.035);paint(x,poly([[a[0]-.1,b[1]-.06],[b[0]+.06,b[1]-.06],[b[0]+.06,b[1]-.03],[a[0]-.1,b[1]-.03]]),C.shoes,{shade:false});}
        else{paint(x,blob([[a[0]-.09,a[1]+.07],[a[0]+.05,a[1]+.08],[b[0]+.07,b[1]+.03],[b[0]+.07,b[1]-.05],[a[0]-.1,b[1]-.05]]),S.shoes==='sneakers'?'#f3f1f4':C.shoes);
          paint(x,poly([[a[0]-.11,b[1]-.07],[b[0]+.08,b[1]-.07],[b[0]+.08,b[1]-.035],[a[0]-.11,b[1]-.035]]),S.shoes==='sneakers'?C.accent:shadeCol(C.shoes,-.4),{shade:false});}},{back,soft:false}));
    const sleeve=S.top==='robe'?[.2,.25]:[.16,.14];
    P.push(vpart('uarm'+s,'uarm'+s,za,bb(J('uarm'+s),Tl('uarm'+s),.2),x=>{const a=J('uarm'+s),b=Tl('uarm'+s);paint(x,capsule(a,b,sleeve[0],sleeve[1]),C.top);
        if(S.top==='armor')paint(x,ell(a[0]+.01,a[1]-.02,.13,.1,-.3),C.metal);if(S.top==='tunic')line(x,[[b[0]-.07,b[1]+.04],[b[0]+.07,b[1]+.02]],C.trim,.025);},{back}));
    P.push(vpart('larm'+s,'larm'+s,za+.1,bb(J('larm'+s),Tl('larm'+s),.2),x=>{const a=J('larm'+s),b=Tl('larm'+s);
        if(S.top==='robe'){const d=[b[0]-a[0],b[1]-a[1]];paint(x,poly([[a[0]-.08,a[1]],[a[0]+.08,a[1]],[b[0]+.15+d[0]*.2,b[1]],[b[0]-.13,b[1]-.02]]),C.top);line(x,[[b[0]-.13,b[1]-.01],[b[0]+.15,b[1]+.01]],C.trim,.03);}
        else{paint(x,capsule(a,b,.14,.12),S.top==='tunic'?C.skin:S.top==='armor'?C.metal:C.top);
          if(S.top==='gi')for(let i=0;i<3;i++){const p=L2(a,b,.3+i*.22);line(x,[[p[0]-.075,p[1]+.01],[p[0]+.075,p[1]-.01]],C.trim,.022);}
          if(S.top==='tunic')paint(x,capsule(L2(a,b,.55),b,.14,.13),C.trim);if(S.top==='hoodie')line(x,[L2(a,b,.85).map((v,i)=>v+(i?0:-.06)),L2(a,b,.85).map((v,i)=>v+(i?0:.06))],shadeCol(C.top,-.3),.03);}},{back}));
    P.push(vpart('hand'+s,'hand'+s,back?2.2:14,bb(J('hand'+s),Tl('hand'+s),.14),x=>{const a=J('hand'+s),b=Tl('hand'+s),c=L2(a,b,.35);paint(x,ell(c[0],c[1],.078,.072),S.top==='gi'?shadeCol(C.top,.08):C.skin);
        if(S.top==='gi')paint(x,ell(c[0]+.03,c[1]+.02,.04,.03),C.skin,{shade:false});},{back,soft:false}));};
  limbs('B');limbs('F');
  // pelvis
  P.push(vpart('pelvis','root',4,[-.42,.55,.42,1.42],x=>{paint(x,blob([[-.21,.95],[0,.92],[.21,.95],[.23,1.15],[.2,1.3],[-.2,1.3],[-.23,1.15]]),C.bottom);
      if(S.bottom==='skirt'){paint(x,poly([[-.24,1.26],[.24,1.26],[.32,.8],[-.32,.8]]),C.bottom);for(let i=-2;i<=2;i++)line(x,[[i*.08,1.2],[i*.12,.82]],shadeCol(C.bottom,-.3),.012);}
      paint(x,poly([[-.25,1.12],[.25,1.12],[.25,1.24],[-.25,1.24]]),S.top==='gi'?C.accent:C.trim);
      if(S.top==='gi'){paint(x,blob([[.12,1.14],[.2,1.0],[.16,.86],[.11,1.0]]),C.accent);paint(x,blob([[.16,1.14],[.28,1.04],[.27,.9],[.2,1.02]]),shadeCol(C.accent,-.15));}},{grid:[2,3]}));
  if(S.top==='robe')P.push(vpart('robeSkirt','root',5.5,[-.6,.25,.6,1.4],x=>{paint(x,poly([[-.25,1.28],[.25,1.28],[.36,.42],[-.36,.42]]),C.top);line(x,[[-.36,.45],[.36,.45]],C.trim,.04);line(x,[[.04,1.26],[.06,.45]],C.trim,.03);},{grid:[2,3]}));
  // torso
  P.push(vpart('torso','chest',6,[-.45,1.0,.45,1.9],x=>{paint(x,capsule([0,1.56],[.03,1.74],.14,.13),C.skin);
      paint(x,blob([[-.22,1.16],[.22,1.16],[.26,1.38],[.22,1.6],[0,1.66],[-.22,1.6],[-.26,1.38]]),C.top);
      if(S.top==='tunic'){paint(x,poly([[-.05,1.65],[.12,1.65],[.04,1.48]]),C.skin);line(x,[[-.22,1.2],[.22,1.2]],C.trim,.04);}
      if(S.top==='gi'){line(x,[[-.12,1.63],[.11,1.36]],C.trim,.035);line(x,[[.11,1.63],[.0,1.5]],C.trim,.03);for(let i=0;i<5;i++)paint(x,ell(-.12+i*.06,1.3+(i%2)*.08,.012,.012),C.trim,{shade:false,stroke:false});}
      if(S.top==='armor'){paint(x,blob([[-.18,1.22],[.18,1.22],[.21,1.45],[.15,1.6],[-.15,1.6],[-.21,1.45]]),C.metal);line(x,[[.0,1.58],[.01,1.26]],shadeCol(C.metal,-.3),.015);for(const p of [[-.15,1.25],[.15,1.25],[-.17,1.55],[.17,1.55]])paint(x,ell(p[0],p[1],.018,.018),C.trim,{shade:false});}
      if(S.top==='robe'){line(x,[[-.1,1.65],[.06,1.4],[.16,1.65]],C.trim,.035);line(x,[[.05,1.4],[.05,1.17]],C.trim,.03);}
      if(S.top==='hoodie'){paint(x,blob([[-.12,1.2],[.14,1.2],[.12,1.33],[-.1,1.33]]),shadeCol(C.top,-.12));line(x,[[.02,1.62],[.0,1.45]],'#f2eee8',.016);line(x,[[.09,1.62],[.1,1.46]],'#f2eee8',.016);}},{grid:[3,4]}));
  if(S.back==='scarf')P.push(vpart('scarf','chest',7,[-.38,1.35,.4,1.85],x=>{paint(x,blob([[-.22,1.62],[0,1.56],[.24,1.6],[.24,1.7],[0,1.68],[-.22,1.72]]),C.accent);paint(x,blob([[-.2,1.62],[-.28,1.48],[-.16,1.5]]),shadeCol(C.accent,-.2));},{soft:false}));
  // head + face
  P.push(vpart('head','head',8,[-.62,1.5,.7,2.7],x=>{paint(x,ell(-.2,2.0,.08,.1),C.skin);paint(x,ell(.05,2.1,.44,.42),C.skin);drawFace(x,S.face,C);},{soft:false}));
  P.push(vpart('hairF','head',9,[-.72,1.55,.78,2.85],x=>drawHairFront(x,S,C,rnd),{soft:false}));
  if(S.hat!=='none')P.push(vpart('hat','head',10,[-1.15,1.6,.95,3.45],x=>drawHat(x,S,C),{soft:false}));
  if(S.weapon!=='none')P.push(vpart('weapon','weapon',13,[-.12,.3,.72,2.85],x=>drawWeapon(x,S.weapon,C),{soft:false}));
  return P;}
function drawFace(x,f,C){const eye=(cx,cy,sc)=>{
    if(f==='happy'){x.save();x.beginPath();x.moveTo(cx-.05*sc,cy-.01);x.quadraticCurveTo(cx,cy+.07,cx+.05*sc,cy-.01);x.strokeStyle=OL;x.lineWidth=.026;x.stroke();x.restore();return;}
    if(f==='closed'){x.save();x.beginPath();x.moveTo(cx-.05*sc,cy+.01);x.quadraticCurveTo(cx,cy-.04,cx+.05*sc,cy+.01);x.strokeStyle=OL;x.lineWidth=.024;x.stroke();x.restore();return;}
    x.save();x.beginPath();x.ellipse(cx,cy,.052*sc,.088,0,0,Math.PI*2);x.fillStyle=OL;x.fill();x.clip();x.beginPath();x.ellipse(cx,cy-.035,.05*sc,.06,0,0,Math.PI*2);x.fillStyle=C.eyes;x.fill();x.restore();
    x.save();x.fillStyle='#fff';x.beginPath();x.arc(cx+.016*sc,cy+.035,.02,0,7);x.fill();x.beginPath();x.arc(cx-.015*sc,cy-.04,.01,0,7);x.fill();x.restore();
    if(f==='fierce'){line(x,[[cx-.07*sc,cy+.1],[cx+.06*sc,cy+.07]],OL,.03);line(x,[[cx-.07*sc,cy+.155],[cx+.06*sc,cy+.115]],shadeCol(C.hair,-.2),.025);}};
  eye(.13,2.02,.8);eye(.35,2.02,1);
  x.save();x.fillStyle='rgba(255,110,125,.32)';x.beginPath();x.ellipse(.4,1.9,.06,.03,0,0,7);x.fill();x.restore();
  if(f==='happy')paint(x,x2=>{x2.moveTo(.22,1.85);x2.quadraticCurveTo(.27,1.74,.33,1.85);x2.closePath();},'#8a2030',{shade:false,lw:.015});
  else line(x,f==='fierce'?[[.23,1.82],[.3,1.84]]:[[.24,1.83],[.3,1.83]],OL,.018);}
function drawHairBack(x,S,C){const H=C.hair;
  if(S.hat==='hood'||(S.top==='hoodie'&&S.hat==='none'))paint(x,blob([[-.5,2.3],[-.58,1.8],[-.42,1.45],[-.1,1.5],[.2,1.6],[.3,2.3],[.0,2.62]]),S.hat==='hood'?C.top:C.top);
  if(S.hair==='bald')return;
  if(S.hair==='long')paint(x,blob([[-.46,2.25],[-.52,1.7],[-.45,1.2],[-.18,1.12],[.12,1.25],[.28,1.7],[.38,2.2],[0,2.56]]),shadeCol(H,-.12));
  else if(S.hair==='bob')paint(x,blob([[-.48,2.22],[-.5,1.82],[-.32,1.7],[.1,1.75],[.36,1.85],[.4,2.2],[0,2.56]]),shadeCol(H,-.12));
  else if(S.hair==='ponytail'){paint(x,blob([[-.48,2.2],[-.46,1.92],[.1,1.9],[.38,2.2],[0,2.56]]),shadeCol(H,-.12));paint(x,blob([[-.36,2.36],[-.72,2.2],[-.86,1.7],[-.78,1.3],[-.66,1.62],[-.58,1.98],[-.36,2.22]]),shadeCol(H,-.06));paint(x,ell(-.4,2.3,.07,.06),C.accent);}
  else paint(x,blob([[-.48,2.2],[-.5,1.92],[-.2,1.84],[.2,1.9],[.38,2.2],[0,2.56]]),shadeCol(H,-.12));}
function drawHairFront(x,S,C,R){if(S.hair==='bald')return;const H=C.hair,cx=.05,cy=2.1,top=[];
  const spikes=S.hair==='spiky'?.14:S.hair==='messy'?.07:0;
  for(let i=0;i<=10;i++){const a=(165-i*15)*D2R,r=.47+(i%2?spikes:0)*(S.hair==='messy'?.6+R()*.8:1);top.push([cx+Math.cos(a)*r*(i%2&&spikes?1.05:1),cy+Math.sin(a)*r+(i%2&&spikes?.02:0)]);}
  const bang=S.hair==='long'||S.hair==='bob'||S.hair==='ponytail'?[[.49,2.05],[.4,2.02],[.32,2.13],[.22,1.98],[.12,2.12],[0,2.0],[-.14,2.12],[-.3,1.96],[-.42,1.86],[-.48,2.0]]:[[.5,2.05],[.44,1.96],[.36,2.1],[.26,1.94],[.18,2.1],[.06,1.96],[-.04,2.12],[-.18,1.98],[-.32,2.1],[-.45,1.98]];
  paint(x,poly([...top,...bang]),H);
  x.save();x.beginPath();x.ellipse(.12,2.4,.2,.05,-.25,0,Math.PI*2);x.fillStyle='rgba(255,255,255,.28)';x.fill();x.restore();
  if(S.hair==='long'||S.hair==='bob')paint(x,blob([[-.46,2.1],[-.5,1.76],[-.4,1.62],[-.34,1.9]]),H);}
function drawHat(x,S,C){const h=S.hat;
  if(h==='headband'){paint(x,blob([[-.62,2.18],[-.92,2.0],[-.78,2.16],[-.95,2.28],[-.6,2.26]]),C.top);
    paint(x,blob([[-.44,2.22],[.05,2.31],[.49,2.26],[.5,2.13],[.05,2.18],[-.44,2.08]]),C.top);
    paint(x,blob([[.12,2.3],[.44,2.28],[.45,2.13],[.12,2.15]]),C.metal);x.save();x.beginPath();x.arc(.29,2.22,.045,.3,5.6);x.strokeStyle=C.accent;x.lineWidth=.022;x.stroke();x.restore();}
  if(h==='bandana'){paint(x,blob([[-.46,2.18],[-.4,2.42],[0,2.58],[.36,2.48],[.5,2.2],[.05,2.26]]),C.accent);for(const p of [[-.2,2.4],[.05,2.45],[.25,2.38],[-.05,2.32]])paint(x,ell(p[0],p[1],.025,.025),'#fff',{shade:false,stroke:false});paint(x,blob([[-.44,2.22],[-.7,2.12],[-.62,2.28]]),C.accent);}
  if(h==='hood'){paint(x,x2=>{x2.ellipse(0,2.12,.56,.53,0,0,Math.PI*2);x2.moveTo(.56,2.04);x2.ellipse(.16,2.04,.4,.4,0,0,Math.PI*2,true);},C.top,{evenodd:true});}
  if(h==='wizard'){paint(x,ell(.02,2.42,.64,.12),C.top);paint(x,blob([[-.36,2.45],[.38,2.45],[.18,2.8],[-.1,3.1],[-.5,3.3],[-.28,2.95]]),C.top);line(x,[[-.33,2.5],[.35,2.5]],C.trim,.05);}
  if(h==='helm'){paint(x,x2=>{x2.moveTo(-.48,2.06);x2.ellipse(.04,2.1,.52,.5,0,Math.PI,0,true);x2.lineTo(.56,1.9);x2.lineTo(.42,1.9);x2.lineTo(.42,2.06);x2.closePath();},C.metal);line(x,[[-.47,2.12],[.55,2.12]],C.trim,.04);paint(x,blob([[-.1,2.58],[-.42,2.82],[-.6,2.7],[-.3,2.56]]),C.accent);}
  if(h==='crown')paint(x,poly([[-.24,2.44],[.36,2.48],[.38,2.7],[.26,2.56],[.18,2.74],[.08,2.56],[-.02,2.74],[-.1,2.56],[-.22,2.68]]),C.metal);}
function drawWeapon(x,w,C){const gx=.28,wood='#6b4a2e',dark='#2a2026';
  if(w==='sword'){paint(x,capsule([gx,.88],[gx,1.12],.06,.06),dark);paint(x,ell(gx,.86,.04,.04),C.trim);paint(x,poly([[gx-.045,1.17],[gx-.04,1.95],[gx,2.08],[gx+.04,1.95],[gx+.045,1.17]]),C.metal);line(x,[[gx,1.2],[gx,1.95]],'rgba(255,255,255,.6)',.012);paint(x,blob([[gx-.15,1.12],[gx+.15,1.12],[gx+.15,1.18],[gx-.15,1.18]]),C.trim);}
  if(w==='katana'){paint(x,capsule([gx,.84],[gx,1.14],.055,.055),dark);paint(x,ell(gx,1.16,.075,.025),C.trim);const pts=[];for(let i=0;i<=12;i++){const t=i/12,y=1.18+t*1.05;pts.push([gx-.05*t*t+.025*(1-t),y]);}for(let i=12;i>=0;i--){const t=i/12,y=1.18+t*1.02;pts.push([gx-.05*t*t-.025*(1-t)-.004,y]);}paint(x,poly(pts),C.metal);}
  if(w==='dagger'){x.save();x.beginPath();x.arc(gx,.82,.04,0,7);x.lineWidth=.02;x.strokeStyle=C.metal;x.stroke();x.restore();paint(x,capsule([gx,.87],[gx,1.04],.05,.05),dark);paint(x,poly([[gx,1.03],[gx+.07,1.18],[gx,1.5],[gx-.07,1.18]]),C.metal);line(x,[[gx,1.06],[gx,1.44]],'rgba(255,255,255,.55)',.01);}
  if(w==='staff'){paint(x,capsule([gx,.42],[gx,2.15],.07,.07),wood);x.save();x.beginPath();x.arc(gx,2.28,.17,Math.PI*.15,Math.PI*1.25);x.lineWidth=.05;x.strokeStyle=wood;x.stroke();x.restore();paint(x,ell(gx,2.27,.1,.1),C.accent);paint(x,ell(gx+.03,2.31,.03,.03),'rgba(255,255,255,.85)',{shade:false,stroke:false});}
  if(w==='axe'){paint(x,capsule([gx,.7],[gx,1.98],.07,.07),wood);paint(x,blob([[gx,1.98],[gx+.2,2.06],[gx+.36,1.98],[gx+.38,1.78],[gx+.3,1.66],[gx+.14,1.7],[gx,1.76]]),C.metal);paint(x,poly([[gx,1.94],[gx-.14,1.86],[gx,1.8]]),C.metal);}
  if(w==='spear'){paint(x,capsule([gx,.38],[gx,2.36],.05,.05),wood);paint(x,poly([[gx,2.32],[gx+.08,2.46],[gx,2.76],[gx-.08,2.46]]),C.metal);paint(x,blob([[gx-.05,2.32],[gx+.05,2.32],[gx+.06,2.18],[gx,2.12],[gx-.06,2.18]]),C.accent);}}

/* ============================================================ image import: cut parts from one pose */
const KP=['top','neck','pelvis','sB','eB','wB','sF','eF','wF','hB','kB','aB','tB','hF','kF','aF','tF','tip'];
const KP_LABEL={top:'ยอดหัว',neck:'คอ',pelvis:'สะโพก',sB:'ไหล่หลัง',eB:'ศอกหลัง',wB:'ข้อมือหลัง',sF:'ไหล่หน้า',eF:'ศอกหน้า',wF:'ข้อมือหน้า',hB:'สะโพกขาหลัง',kB:'เข่าหลัง',aB:'ข้อเท้าหลัง',tB:'ปลายเท้าหลัง',hF:'สะโพกขาหน้า',kF:'เข่าหน้า',aF:'ข้อเท้าหน้า',tF:'ปลายเท้าหน้า',tip:'ปลายอาวุธ'};
function defaultKP(){const R=rigMap(defaultRig());return{top:R.head.t,neck:R.head.h,pelvis:R.root.h,sB:R.uarmB.h,eB:R.uarmB.t,wB:R.larmB.t,sF:R.uarmF.h,eF:R.uarmF.t,wF:R.larmF.t,hB:R.thighB.h,kB:R.thighB.t,aB:R.shinB.t,tB:R.footB.t,hF:R.thighF.h,kF:R.thighF.t,aF:R.shinF.t,tF:R.footF.t,tip:null};}
function rigFromKP(K){const v=(a,b,t)=>[lerp(a[0],b[0],t),lerp(a[1],b[1],t)],ext=(a,b,k)=>[b[0]+(b[0]-a[0])*k,b[1]+(b[1]-a[1])*k];
  const mid=v(K.pelvis,K.neck,.35),R={root:[K.pelvis,mid],chest:[mid,K.neck],head:[K.neck,K.top],uarmB:[K.sB,K.eB],larmB:[K.eB,K.wB],handB:[K.wB,ext(K.eB,K.wB,.4)],thighB:[K.hB,K.kB],shinB:[K.kB,K.aB],footB:[K.aB,K.tB],thighF:[K.hF,K.kF],shinF:[K.kF,K.aF],footF:[K.aF,K.tF],uarmF:[K.sF,K.eF],larmF:[K.eF,K.wF],handF:[K.wF,ext(K.eF,K.wF,.4)],weapon:[K.wF,K.tip||[K.wF[0],K.wF[1]+.6]]};
  const back=[K.neck[0]-.12,K.neck[1]-.04];R.cape1=[back,[back[0]-.1,back[1]-.32]];R.cape2=[R.cape1[1],[back[0]-.2,back[1]-.62]];R.cape3=[R.cape2[1],[back[0]-.32,back[1]-.95]];
  return DEFAULT_BONES.map(([id,parent])=>({id,parent,h:[...R[id][0]],t:[...R[id][1]]}));}
function kpFromRig(rig){const R=rigMap(rig);return{top:R.head.t,neck:R.head.h,pelvis:R.root.h,sB:R.uarmB.h,eB:R.uarmB.t,wB:R.larmB.t,sF:R.uarmF.h,eF:R.uarmF.t,wF:R.larmF.t,hB:R.thighB.h,kB:R.thighB.t,aB:R.shinB.t,tB:R.footB.t,hF:R.thighF.h,kF:R.thighF.t,aF:R.shinF.t,tF:R.footF.t,tip:R.weapon.t};}
function alphaBox(c){const x=c.getContext('2d'),d=x.getImageData(0,0,c.width,c.height).data;let x0=c.width,y0=c.height,x1=-1,y1=-1;for(let y=0;y<c.height;y++)for(let i=0;i<c.width;i++)if(d[(y*c.width+i)*4+3]>24){if(i<x0)x0=i;if(i>x1)x1=i;if(y<y0)y0=y;if(y>y1)y1=y;}return x1<0?null:[x0,y0,x1,y1];}
// image pixel <-> world: feet on y=0, centred on x=0, height 2.6
function imgMap(c){const b=alphaBox(c)||[0,0,c.width-1,c.height-1],s=2.6/Math.max(1,b[3]-b[1]+1),cx=(b[0]+b[2]+1)/2;return{s,cx,by:b[3]+1,box:b,toW:(px,py)=>[(px-cx)*s,(b[3]+1-py)*s],toP:(wx,wy)=>[wx/s+cx,b[3]+1-wy/s]};}
// Fit the template skeleton to the silhouette without AI: find the neck (narrowest row under the head) and the body width,
// then stretch the template piecewise (below / above the neck) and sideways.
function fitKPToBox(map,c){const D=defaultKP(),out={};for(const k of KP)out[k]=D[k]?[D[k][0],D[k][1]]:null;if(!c)return out;
  const W=c.width,H=c.height,d=c.getContext('2d').getImageData(0,0,W,H).data,b=map.box,rows=[];
  for(let y=b[1];y<=b[3];y++){let x0=-1,x1=-1;for(let x=b[0];x<=b[2];x++)if(d[(y*W+x)*4+3]>40){if(x0<0)x0=x;x1=x;}rows.push(x0<0?0:x1-x0+1);}
  const n=rows.length,from=Math.floor(n*.3),to=Math.floor(n*.62);let neckI=Math.floor(n*.38),best=1e9;
  for(let i=from;i<to;i++){const w=(rows[i-1]+rows[i]+rows[i+1])/3;if(w<best*.97){best=w;neckI=i;}}
  const neckY=(n-neckI)*map.s,bodyW=Math.max(...rows.slice(neckI,Math.floor(n*.85)))*map.s;
  const ky=neckY/1.6,kh=(2.6-neckY)/1.0,kx=clamp(bodyW/.62,.6,2.2);
  for(const k of KP){if(!out[k])continue;const [x,y]=out[k];out[k]=[x*kx,y<=1.6?y*ky:neckY+(y-1.6)*kh];}return out;}
const SEG_R={head:2.6,chest:1.7,root:1.5,thighB:1.15,thighF:1.15,uarmB:1,uarmF:1,larmB:1,larmF:1,handB:1.15,handF:1.15,shinB:1,shinF:1,footB:1,footF:1,weapon:.75};
const SEG_Z={uarmB:2,larmB:2.1,handB:2.2,thighB:3,shinB:3.1,footB:3.2,root:4,thighF:5,shinF:5.1,footF:5.2,chest:6,head:8,uarmF:11,larmF:11.1,weapon:13,handF:14};
function segmentImage(c,rig,map,hasWeapon){const W=c.width,H=c.height,src=c.getContext('2d').getImageData(0,0,W,H).data,bones=rig.filter(b=>SEG_R[b.id]&&(b.id!=='weapon'||hasWeapon));
  const N=W*H,l1=new Int8Array(N).fill(-1),l2=new Int8Array(N).fill(-1),d1=new Float32Array(N),d2=new Float32Array(N);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const k=y*W+x;if(src[k*4+3]<16)continue;const [wx,wy]=map.toW(x+.5,y+.5);let b1=-1,b2=-1,m1=1e9,m2=1e9;
    for(let i=0;i<bones.length;i++){const B=bones[i],d=segDist(wx,wy,B.h,B.t)/SEG_R[B.id];if(d<m1){m2=m1;b2=b1;m1=d;b1=i;}else if(d<m2){m2=d;b2=i;}}l1[k]=b1;l2[k]=b2;d1[k]=m1;d2[k]=m2;}
  const parts=[];
  bones.forEach((B,bi)=>{let x0=W,y0=H,x1=-1,y1=-1,cnt=0;const inc=new Uint8Array(N);
    for(let k=0;k<N;k++){if(l1[k]===bi||(l2[k]===bi&&d2[k]<d1[k]*1.12+.012)){inc[k]=1;cnt++;const x=k%W,y=(k/W)|0;if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}}
    if(cnt<12)return;x0=Math.max(0,x0-2);y0=Math.max(0,y0-2);x1=Math.min(W-1,x1+2);y1=Math.min(H-1,y1+2);const pw=x1-x0+1,ph=y1-y0+1,pc=document.createElement('canvas');pc.width=pw;pc.height=ph;const px=pc.getContext('2d'),out=px.createImageData(pw,ph);
    for(let y=0;y<ph;y++)for(let x=0;x<pw;x++){const k=(y+y0)*W+(x+x0);if(!inc[k])continue;const o=(y*pw+x)*4;out.data[o]=src[k*4];out.data[o+1]=src[k*4+1];out.data[o+2]=src[k*4+2];out.data[o+3]=src[k*4+3];}
    // fill the area hidden behind the front arm so the torso has no hole when the arm moves
    if(B.id==='chest'||B.id==='root'){const own=[],holes=[];for(let y=0;y<ph;y++)for(let x=0;x<pw;x++){const k=(y+y0)*W+(x+x0),o=(y*pw+x)*4;if(inc[k])continue;if(src[k*4+3]<16)continue;const lb=bones[l1[k]].id;if(!/F$/.test(lb))continue;const [wx,wy]=map.toW(x+x0+.5,y+y0+.5);if(segDist(wx,wy,B.h,B.t)/SEG_R[B.id]<.2)holes.push(o);}
      for(let it=0;it<40&&holes.length;it++){for(let i=holes.length-1;i>=0;i--){const o=holes[i],p=o/4,x=p%pw,y=(p/pw)|0;let r=0,g=0,b=0,n=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=pw||yy>=ph)continue;const q=(yy*pw+xx)*4;if(out.data[q+3]>200){r+=out.data[q];g+=out.data[q+1];b+=out.data[q+2];n++;}}
          if(n>=2){out.data[o]=r/n;out.data[o+1]=g/n;out.data[o+2]=b/n;out.data[o+3]=255;holes.splice(i,1);}}}}
    px.putImageData(out,0,0);const [wx0,wy1]=map.toW(x0,y0),[wx1,wy0]=map.toW(x1+1,y1+1);
    const soft=!['head','handB','handF','weapon','footB','footF'].includes(B.id);
    parts.push({id:'p_'+B.id,bone:B.id,z:SEG_Z[B.id]??6,canvas:pc,bbox:[wx0,wy0,wx1,wy1],soft,grid:soft?[2,4]:[1,1]});});
  return parts;}
function removeBgCanvas(c,tol=38){const W=c.width,H=c.height,x=c.getContext('2d'),id=x.getImageData(0,0,W,H),d=id.data,N=W*H;
  let opaque=0;for(let i=0;i<N;i+=7)if(d[i*4+3]>250)opaque++;if(opaque<N/7*.6)return c; // already transparent
  const cs=[0,W-1,(H-1)*W,N-1];let br=0,bg=0,bb=0;cs.forEach(i=>{br+=d[i*4];bg+=d[i*4+1];bb+=d[i*4+2];});br/=4;bg/=4;bb/=4;
  const dist=i=>Math.abs(d[i*4]-br)+Math.abs(d[i*4+1]-bg)+Math.abs(d[i*4+2]-bb),near=new Uint8Array(N),mark=new Uint8Array(N),st=new Int32Array(N);
  for(let i=0;i<N;i++)near[i]=d[i*4+3]<10||dist(i)<tol;
  const fill=(seed,lab)=>{let sp=0;st[sp++]=seed;mark[seed]=lab;const list=[];while(sp){const i=st[--sp];list.push(i);const p=i%W;
      if(p>0&&near[i-1]&&!mark[i-1]){mark[i-1]=lab;st[sp++]=i-1;}if(p<W-1&&near[i+1]&&!mark[i+1]){mark[i+1]=lab;st[sp++]=i+1;}if(i>=W&&near[i-W]&&!mark[i-W]){mark[i-W]=lab;st[sp++]=i-W;}if(i<N-W&&near[i+W]&&!mark[i+W]){mark[i+W]=lab;st[sp++]=i+W;}}return list;};
  for(let i=0;i<W;i++){if(near[i]&&!mark[i])fill(i,1);if(near[N-W+i]&&!mark[N-W+i])fill(N-W+i,1);}for(let y=0;y<H;y++){const a=y*W,b=a+W-1;if(near[a]&&!mark[a])fill(a,1);if(near[b]&&!mark[b])fill(b,1);}
  const minP=Math.max(40,N/4000);for(let i=0;i<N;i++)if(near[i]&&!mark[i]){const l=fill(i,2);if(l.length>=minP)l.forEach(j=>mark[j]=1);}
  for(let i=0;i<N;i++)if(mark[i]===1)d[i*4+3]=0;
  for(let i=0;i<N;i++){if(mark[i]===1)continue;const p=i%W,e=(p>0&&mark[i-1]===1)||(p<W-1&&mark[i+1]===1)||(i>=W&&mark[i-W]===1)||(i<N-W&&mark[i+W]===1);if(e)d[i*4+3]=Math.round(d[i*4+3]*Math.max(.25,clamp(dist(i)/(tol*2.5),0,1)));}
  x.putImageData(id,0,0);return c;}

/* ============================================================ clips */
// A clip: {id,name,frames,fps,loop,hit, tracks:{boneId:[[f,deg,ease?]], pos:[[f,x,y]], squash:[[f,sx,sy]]}, vfx:[layers]}
const EASE={smooth:t=>t*t*(3-2*t),linear:t=>t,fast:t=>1-Math.pow(1-t,3),slow:t=>t*t*t,step:t=>0};
function sampleTrack(keys,f,dim){if(!keys||!keys.length)return null;if(f<=keys[0][0])return keys[0].slice(1,1+dim);const last=keys[keys.length-1];if(f>=last[0])return last.slice(1,1+dim);
  for(let i=0;i<keys.length-1;i++){const a=keys[i],b=keys[i+1];if(f>=a[0]&&f<=b[0]){const e=EASE[b[1+dim]]||EASE.smooth,t=e((f-a[0])/Math.max(1e-6,b[0]-a[0]));const out=[];for(let d=1;d<=dim;d++)out.push(lerp(a[d],b[d],t));return out;}}return last.slice(1,1+dim);}
function clipPose(clip,f,rig){const p=restPose();if(!clip)return p;const ff=clip.loop?((f%clip.frames)+clip.frames)%clip.frames:clamp(f,0,clip.frames);
  for(const id in clip.tracks){if(id==='pos'){const v=sampleTrack(clip.tracks.pos,ff,2);if(v){p.x=v[0];p.y=v[1];}continue;}if(id==='squash'){const v=sampleTrack(clip.tracks.squash,ff,2);if(v){p.sx=v[0];p.sy=v[1];}continue;}
    const v=sampleTrack(clip.tracks[id],ff,1);if(v)p.rot[id]=v[0];}
  // secondary motion for cloth bones: lag behind body movement
  const prev=clip.tracks.pos?sampleTrack(clip.tracks.pos,Math.max(0,ff-3),2):null,vx=prev?(p.x-prev[0]):0,vy=prev?(p.y-prev[1]):0,ch=(p.rot.chest||0)+(p.rot.root||0);
  const sw=Math.sin(f*.13)*7,base=clamp(vx*260,-45,45)+clamp(-vy*120,-30,30)-ch*.6;
  if(!clip.tracks.cape1){p.rot.cape1=base+sw;p.rot.cape2=base*.5+Math.sin(f*.13+.9)*9;p.rot.cape3=base*.3+Math.sin(f*.13+1.8)*11;}
  return p;}
function K(f,...v){return[f,...v];}
const CLIP_GEN={
 idle:{n:'ยืนหายใจ',ic:'IDL',make:(sp=1)=>{const F=Math.round(48/sp);return{frames:F,loop:true,tracks:{pos:[K(0,0,0),K(F/2,0,-.025),K(F,0,0)],chest:[K(0,0),K(F/2,2.5),K(F,0)],head:[K(0,0),K(F/2,-3),K(F,0)],uarmF:[K(0,4),K(F/2,8),K(F,4)],uarmB:[K(0,-4),K(F/2,-8),K(F,-4)],larmF:[K(0,14),K(F/2,20),K(F,14)],larmB:[K(0,10),K(F/2,16),K(F,10)],weapon:[K(0,-8),K(F/2,-10),K(F,-8)]}};}},
 walk:{n:'เดิน',ic:'WLK',make:(sp=1)=>{const F=Math.round(32/sp),q=F/4;return{frames:F,loop:true,tracks:{pos:[K(0,0,0),K(q,0,.04),K(2*q,0,0),K(3*q,0,.04),K(F,0,0)],chest:[K(0,-5),K(F,-5)],head:[K(0,3),K(2*q,1),K(F,3)],
   thighF:[K(0,28),K(q,2),K(2*q,-26),K(3*q,0),K(F,28)],thighB:[K(0,-26),K(q,0),K(2*q,28),K(3*q,2),K(F,-26)],shinF:[K(0,-6),K(q,-12),K(2*q,-18),K(3*q,-55),K(F,-6)],shinB:[K(0,-18),K(q,-55),K(2*q,-6),K(3*q,-12),K(F,-18)],
   footF:[K(0,8),K(2*q,-12),K(F,8)],footB:[K(0,-12),K(2*q,8),K(F,-12)],uarmF:[K(0,-24),K(2*q,24),K(F,-24)],uarmB:[K(0,24),K(2*q,-24),K(F,24)],larmF:[K(0,20),K(2*q,35),K(F,20)],larmB:[K(0,35),K(2*q,20),K(F,35)]}};}},
 run:{n:'วิ่ง',ic:'RUN',make:(sp=1)=>{const F=Math.round(20/sp),q=F/4;return{frames:F,loop:true,tracks:{pos:[K(0,0,0),K(q,0,.1),K(2*q,0,0),K(3*q,0,.1),K(F,0,0)],chest:[K(0,-14),K(F,-14)],head:[K(0,8),K(F,8)],
   thighF:[K(0,50),K(q,5),K(2*q,-40),K(3*q,10),K(F,50)],thighB:[K(0,-40),K(q,10),K(2*q,50),K(3*q,5),K(F,-40)],shinF:[K(0,-20),K(q,-30),K(2*q,-40),K(3*q,-100),K(F,-20)],shinB:[K(0,-40),K(q,-100),K(2*q,-20),K(3*q,-30),K(F,-40)],
   uarmF:[K(0,-50),K(2*q,55),K(F,-50)],uarmB:[K(0,55),K(2*q,-50),K(F,55)],larmF:[K(0,80),K(F,80)],larmB:[K(0,80),K(F,80)],weapon:[K(0,-40),K(F,-40)]}};}},
 slash:{n:'ฟันอาวุธ',ic:'ATK',make:(sp=1)=>{const s=f=>Math.round(f/sp),F=s(32);return{frames:F,loop:false,hit:s(12),tracks:{pos:[K(0,0,0),K(s(8),-.08,-.04),K(s(12),.3,-.06,'fast'),K(s(20),.28,-.04),K(F,0,0)],
   chest:[K(0,0),K(s(8),18),K(s(12),-28,'fast'),K(s(20),-22),K(F,0)],head:[K(0,0),K(s(8),-6),K(s(12),10),K(F,0)],
   uarmF:[K(0,10),K(s(8),160),K(s(12),-40,'fast'),K(s(20),-55),K(F,10)],larmF:[K(0,20),K(s(8),50),K(s(12),5,'fast'),K(s(20),10),K(F,20)],weapon:[K(0,-10),K(s(8),30),K(s(12),-60,'fast'),K(s(20),-70),K(F,-10)],
   uarmB:[K(0,-10),K(s(8),-40),K(s(12),40,'fast'),K(F,-10)],larmB:[K(0,20),K(s(8),60),K(F,20)],
   thighF:[K(0,5),K(s(8),-5),K(s(12),40,'fast'),K(s(20),38),K(F,5)],shinF:[K(0,-5),K(s(12),-30),K(F,-5)],thighB:[K(0,-5),K(s(8),10),K(s(12),-30,'fast'),K(s(20),-28),K(F,-5)],shinB:[K(0,-10),K(s(12),-25),K(F,-10)]}};}},
 kick:{n:'เตะ',ic:'KCK',make:(sp=1)=>{const s=f=>Math.round(f/sp),F=s(30);return{frames:F,loop:false,hit:s(11),tracks:{pos:[K(0,0,0),K(s(6),-.05,-.06),K(s(11),.12,.05,'fast'),K(s(20),.1,0),K(F,0,0)],
   chest:[K(0,0),K(s(6),-10),K(s(11),28,'fast'),K(s(20),20),K(F,0)],thighF:[K(0,0),K(s(6),30),K(s(11),105,'fast'),K(s(18),95),K(F,0)],shinF:[K(0,0),K(s(6),-90),K(s(11),-5,'fast'),K(s(18),-10),K(F,0)],footF:[K(0,0),K(s(11),-30),K(F,0)],
   thighB:[K(0,0),K(s(11),-15),K(F,0)],uarmF:[K(0,0),K(s(11),-60,'fast'),K(F,0)],uarmB:[K(0,0),K(s(11),70,'fast'),K(F,0)],larmF:[K(0,30),K(s(11),70),K(F,30)],larmB:[K(0,30),K(s(11),40),K(F,30)],head:[K(0,0),K(s(11),-12),K(F,0)]}};}},
 cast:{n:'ร่ายเวท',ic:'CST',make:(sp=1)=>{const s=f=>Math.round(f/sp),F=s(44);return{frames:F,loop:false,hit:s(24),tracks:{pos:[K(0,0,0),K(s(14),0,.08),K(s(24),.05,0,'fast'),K(F,0,0)],
   chest:[K(0,0),K(s(14),12),K(s(24),-12,'fast'),K(F,0)],head:[K(0,0),K(s(14),14),K(s(24),-4),K(F,0)],uarmF:[K(0,10),K(s(14),165),K(s(24),85,'fast'),K(s(34),80),K(F,10)],larmF:[K(0,20),K(s(14),20),K(s(24),5),K(F,20)],
   uarmB:[K(0,-10),K(s(14),-160),K(s(24),-40,'fast'),K(F,-10)],larmB:[K(0,20),K(s(14),30),K(F,20)],weapon:[K(0,-10),K(s(14),10),K(s(24),-80,'fast'),K(F,-10)],thighF:[K(0,0),K(s(24),25),K(F,0)],thighB:[K(0,0),K(s(24),-15),K(F,0)]}};}},
 jump:{n:'กระโดด',ic:'JMP',make:(sp=1)=>{const s=f=>Math.round(f/sp),F=s(38);return{frames:F,loop:false,tracks:{pos:[K(0,0,0),K(s(7),0,-.16),K(s(13),0,.9,'fast'),K(s(19),0,1.15,'fast'),K(s(28),0,.1,'slow'),K(s(30),0,-.12),K(F,0,0)],squash:[K(0,1,1),K(s(7),1.08,.9),K(s(13),.93,1.1),K(s(19),1,1),K(s(29),1,1),K(s(31),1.1,.88),K(F,1,1)],
   thighF:[K(0,0),K(s(7),45),K(s(13),-10),K(s(19),70),K(s(28),20),K(s(31),45),K(F,0)],shinF:[K(0,0),K(s(7),-80),K(s(13),-10),K(s(19),-110),K(s(28),-20),K(s(31),-80),K(F,0)],thighB:[K(0,0),K(s(7),40),K(s(13),-20),K(s(19),40),K(s(31),40),K(F,0)],shinB:[K(0,0),K(s(7),-80),K(s(13),-20),K(s(19),-100),K(s(31),-80),K(F,0)],
   uarmF:[K(0,0),K(s(7),-40),K(s(13),150),K(s(28),60),K(F,0)],uarmB:[K(0,0),K(s(7),-50),K(s(13),140),K(s(28),50),K(F,0)],chest:[K(0,0),K(s(7),-18),K(s(13),5),K(s(31),-15),K(F,0)]}};}},
 hurt:{n:'โดนโจมตี',ic:'HIT',make:(sp=1)=>{const s=f=>Math.round(f/sp),F=s(22);return{frames:F,loop:false,tracks:{pos:[K(0,0,0),K(s(3),-.22,.02,'fast'),K(F,0,0)],chest:[K(0,0),K(s(3),24,'fast'),K(s(10),16),K(F,0)],head:[K(0,0),K(s(3),22,'fast'),K(F,0)],
   uarmF:[K(0,0),K(s(3),50,'fast'),K(F,0)],uarmB:[K(0,0),K(s(3),-60,'fast'),K(F,0)],larmF:[K(0,20),K(s(3),60),K(F,20)],thighF:[K(0,0),K(s(3),20),K(F,0)],shinF:[K(0,0),K(s(3),-30),K(F,0)]}};}},
 die:{n:'ล้มลง',ic:'DIE',make:(sp=1)=>{const s=f=>Math.round(f/sp),F=s(46);return{frames:F,loop:false,tracks:{pos:[K(0,0,0),K(s(8),-.1,-.15),K(s(22),-.75,-.62,'slow'),K(s(26),-.8,-.56),K(s(30),-.82,-.62),K(F,-.82,-.62)],root:[K(0,0),K(s(8),8),K(s(22),88,'slow'),K(s(26),84),K(s(30),90),K(F,90)],
   head:[K(0,0),K(s(8),20),K(s(22),-10),K(F,-5)],uarmF:[K(0,0),K(s(10),60),K(s(22),110),K(F,100)],uarmB:[K(0,0),K(s(10),-40),K(s(22),-80),K(F,-70)],thighF:[K(0,0),K(s(8),40),K(s(22),10),K(F,15)],shinF:[K(0,0),K(s(8),-70),K(s(22),-10),K(F,-12)],thighB:[K(0,0),K(s(8),30),K(F,-5)],shinB:[K(0,0),K(s(8),-60),K(F,-6)]}};}},
 victory:{n:'ดีใจ',ic:'WIN',make:(sp=1)=>{const s=f=>Math.round(f/sp),F=s(40);return{frames:F,loop:true,tracks:{pos:[K(0,0,0),K(s(8),0,-.08),K(s(16),0,.35,'fast'),K(s(24),0,0,'slow'),K(F,0,0)],squash:[K(0,1,1),K(s(8),1.06,.92),K(s(16),.96,1.06),K(s(25),1.06,.93),K(F,1,1)],
   uarmF:[K(0,170),K(s(16),175),K(F,170)],larmF:[K(0,10),K(s(16),-5),K(F,10)],uarmB:[K(0,-20),K(s(16),-60),K(F,-20)],head:[K(0,8),K(s(16),14),K(F,8)],thighF:[K(0,0),K(s(8),30),K(s(16),-5),K(s(25),30),K(F,0)],shinF:[K(0,0),K(s(8),-55),K(s(16),-30),K(s(25),-55),K(F,0)],thighB:[K(0,0),K(s(8),28),K(s(16),10),K(s(25),28),K(F,0)],shinB:[K(0,0),K(s(8),-55),K(s(16),-40),K(s(25),-55),K(F,0)],weapon:[K(0,20),K(s(16),40),K(F,20)]}};}}};
function makeClip(type,sp=1){const g=CLIP_GEN[type].make(sp);return{id:'c_'+Math.random().toString(36).slice(2,8),name:CLIP_GEN[type].n,type,fps:30,vfx:[],hit:g.hit??null,...g};}
function clampClip(clip){for(const id in clip.tracks){if(id==='pos'||id==='squash')continue;if(!BONE_IDS.includes(id)){delete clip.tracks[id];continue;}const lim=LIMITS[id]||[-200,200];
    clip.tracks[id]=clip.tracks[id].filter(k=>Array.isArray(k)&&isFinite(k[0])&&isFinite(k[1])).map(k=>[clamp(Math.round(k[0]),0,clip.frames),clamp(+k[1],lim[0],lim[1]),...(EASE[k[2]]?[k[2]]:[])]).sort((a,b)=>a[0]-b[0]);}
  for(const id of ['pos','squash'])if(clip.tracks[id])clip.tracks[id]=clip.tracks[id].filter(k=>Array.isArray(k)&&k.length>=3&&k.slice(0,3).every(isFinite)).map(k=>[clamp(Math.round(k[0]),0,clip.frames),clamp(+k[1],-3,3),clamp(+k[2],id==='squash'?.5:-1,id==='squash'?1.5:3)]).sort((a,b)=>a[0]-b[0]);
  return clip;}
