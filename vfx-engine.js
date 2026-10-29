/* VFX engine — shared by VFX Forge Studio and Forge Character Studio. Needs globals: THREE, ST.comp.fps, ASSETS. */
/* ============================================================ utils */
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)), lerp=(a,b,t)=>a+(b-a)*t, D2R=Math.PI/180;
const ease={
  out:t=>1-Math.pow(1-t,3),
  inOut:t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2,
  expo:t=>t>=1?1:1-Math.pow(2,-10*t),
  back:t=>{const c=1.70158,c3=c+1;return 1+c3*Math.pow(t-1,3)+c*Math.pow(t-1,2);}
};
function rng(seed){let s=(seed*2654435761)>>>0||1;return()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};}
const uid=()=>Math.random().toString(36).slice(2,10);
const V=(x,y,z=0)=>new THREE.Vector3(x,y,z);
const col=c=>new THREE.Color(c);
const pick=a=>a[(Math.random()*a.length)|0];
function h(tag,attrs={},...kids){const e=document.createElement(tag);for(const k in attrs){const v=attrs[k];if(k==='class')e.className=v;else if(k==='style')e.style.cssText=v;else if(k==='value')e.value=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(v===true)e.setAttribute(k,'');else if(v!==false&&v!=null)e.setAttribute(k,v);}for(const c of kids.flat())if(c!=null&&c!==false)e.append(c.nodeType?c:document.createTextNode(c));return e;}
function toast(msg,ms=2600){const t=h('div',{class:'toast',role:'status'},msg);document.body.append(t);setTimeout(()=>t.remove(),ms);}
const store={get(k){try{return JSON.parse(localStorage.getItem(k));}catch(e){return null;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true;}catch(e){return false;}}};

/* ============================================================ shaders */
const VS_UV=`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const VS_RING=`uniform float uR,uW;varying vec2 vUv;void main(){vUv=uv;vec2 d=normalize(position.xy);gl_Position=projectionMatrix*modelViewMatrix*vec4(d*(uR+(uv.y-.5)*uW),0.,1.);}`;
const OUT=`gl_FragColor=vec4(c,clamp(max(c.r,max(c.g,c.b)),0.,1.));`;
const FR_RIB=`uniform vec3 uCore,uGlow;uniform float uHead,uTail,uOp,uSharp,uEdge,uFade;varying vec2 vUv;
void main(){float u=vUv.x;if(u>uHead||u<uTail||uHead<=uTail)discard;
float k=(u-uTail)/max(uHead-uTail,1e-4);
float d=abs(vUv.y*2.-1.-uEdge)/(1.+abs(uEdge));float a=clamp(1.-d,0.,1.);
float core=pow(a,uSharp);float g=a*a;
float f=mix(1.,smoothstep(0.,.55,k)*(1.-.5*smoothstep(.86,1.,k)),uFade);
vec3 c=(uGlow*g*.9+uCore*core*1.6)*f*uOp;${OUT}}`;
const FR_GLOW=`uniform vec3 uCore,uGlow;uniform float uOp,uRays,uRot;varying vec2 vUv;
void main(){vec2 p=vUv*2.-1.;float r=length(p);if(r>1.)discard;
float g=exp(-r*r*6.)*(1.-r);float core=exp(-r*r*50.);float ray=0.;
if(uRays>.5){float an=atan(p.y,p.x)+uRot;ray=pow(abs(cos(an*uRays*.5)),18.+160.*r)*pow(1.-r,1.5);}
vec3 c=(uGlow*(g*.9+ray*.8)+uCore*(core*1.8+ray*.6*(1.-r)))*uOp;${OUT}}`;
const FR_PTS=`varying vec4 vCol;void main(){vec2 q=gl_PointCoord*2.-1.;float d=dot(q,q);if(d>1.)discard;float a=exp(-d*3.5)*(1.-d);float hc=exp(-d*28.);vec3 c=(vCol.rgb*a+vec3(hc)*.55*a)*vCol.a;${OUT}}`;
const VS_PTS=`attribute float aSize;attribute vec4 aCol;varying vec4 vCol;uniform float uPx;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=aSize*uPx/max(.1,-mv.z);vCol=aCol;gl_Position=projectionMatrix*mv;}`;
const FR_CIRC=`uniform sampler2D uTex;uniform vec3 uCore,uGlow;uniform float uOp,uRev;varying vec2 vUv;
void main(){vec4 s=texture2D(uTex,vUv);vec2 p=vUv-.5;float an=atan(p.x,-p.y)/6.28318+.5;float m=uRev>=1.?1.:1.-smoothstep(uRev-.03,uRev,an);
vec3 c=(mix(uGlow,uCore,s.a*s.a)*s.a*1.5+uGlow*s.a*.3)*m*uOp;${OUT}}`;
const FR_SPR=`uniform sampler2D uTex;uniform vec4 uCell;uniform float uOp,uMode,uKey;uniform vec3 uTint;varying vec2 vUv;
void main(){vec2 uv=uCell.xy+clamp(vUv,.002,.998)*uCell.zw;vec4 s=texture2D(uTex,uv);
if(uMode<.5){vec3 c=s.rgb*s.a*uTint*uOp*1.1;${OUT}}
else{float a=s.a;if(uMode>1.5){float l=max(s.r,max(s.g,s.b));a*=smoothstep(uKey,uKey+.06,l);}a*=uOp;if(a<.003)discard;gl_FragColor=vec4(s.rgb*uTint*a,a);}}`;

const ADD={transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneFactor};
const NORM={...ADD,blendDst:THREE.OneMinusSrcAlphaFactor,blendDstAlpha:THREE.OneMinusSrcAlphaFactor};

function ribbonGeo(P,W,N){const n=P.length,pos=new Float32Array(n*6),uv=new Float32Array(n*4),idx=[];
  for(let i=0;i<n;i++){const p=P[i],w=W[i]/2,q=N[i];pos.set([p.x+q.x*w,p.y+q.y*w,p.z+q.z*w,p.x-q.x*w,p.y-q.y*w,p.z-q.z*w],i*6);const u=i/(n-1);uv.set([u,0,u,1],i*4);if(i<n-1){const a=i*2;idx.push(a,a+1,a+2,a+1,a+3,a+2);}}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('uv',new THREE.BufferAttribute(uv,2));g.setIndex(idx);return g;}
function ribMat(L,o={}){return new THREE.ShaderMaterial({uniforms:{uCore:{value:col(L.core)},uGlow:{value:col(L.glow)},uHead:{value:1},uTail:{value:0},uOp:{value:1},uSharp:{value:o.sharp??3},uEdge:{value:o.edge??0},uFade:{value:o.fade??1},uR:{value:1},uW:{value:.2}},vertexShader:o.vs||VS_UV,fragmentShader:FR_RIB,...ADD});}
function glowMat(L,rays=0){return new THREE.ShaderMaterial({uniforms:{uCore:{value:col(L.core)},uGlow:{value:col(L.glow)},uOp:{value:1},uRays:{value:rays},uRot:{value:0}},vertexShader:VS_UV,fragmentShader:FR_GLOW,...ADD});}
const _q=new THREE.Quaternion(),_v=new THREE.Vector3();
function billboard(o,cam){o.parent.getWorldQuaternion(_q);o.quaternion.copy(_q.invert().multiply(cam.quaternion));}
function cylBoard(o,cam){_v.copy(cam.position);o.parent.worldToLocal(_v);o.rotation.set(0,Math.atan2(_v.x,_v.z),0);}
const strand=(u,s,d)=>({u,d});
function sweepUpd(arr,t,e,sweep){for(const s of arr){const tt=clamp((t-s.d)/(1-s.d),0,1);s.u.uHead.value=ease.expo(clamp(tt/sweep,0,1));s.u.uTail.value=(s.eat??1)*ease.inOut(clamp((tt-sweep*.5)/Math.max(.02,1-sweep*.5),0,1));s.u.uOp.value=e;}}

const circCache={};
function circleTex(seed,sides,rings){const key=seed+'_'+sides+'_'+rings;if(circCache[key])return circCache[key];
  const N=512,cv=document.createElement('canvas');cv.width=cv.height=N;const x=cv.getContext('2d'),R=rng(seed);x.translate(N/2,N/2);
  x.strokeStyle='#fff';x.fillStyle='#fff';x.shadowColor='#fff';x.shadowBlur=9;x.lineCap='round';
  const ring=(r,w)=>{x.lineWidth=w;x.beginPath();x.arc(0,0,r,0,Math.PI*2);x.stroke();};
  ring(240,5);ring(226,2);ring(186,3);
  const nG=26;for(let i=0;i<nG;i++){x.save();x.rotate(i/nG*Math.PI*2);x.translate(0,-206);x.lineWidth=2.4;x.beginPath();const segs=2+((R()*3)|0);for(let s=0;s<segs;s++){x.moveTo((R()-.5)*14,(R()-.5)*16);x.lineTo((R()-.5)*14,(R()-.5)*16);}x.stroke();x.beginPath();x.arc(0,10,1.8,0,7);x.fill();x.restore();}
  const poly=(off)=>{const step=sides>=5?2:1;x.lineWidth=3;x.beginPath();for(let i=0;i<=sides;i++){const a=off-Math.PI/2+((i*step)%sides)/sides*Math.PI*2;const px=Math.cos(a)*184,py=Math.sin(a)*184;i?x.lineTo(px,py):x.moveTo(px,py);}x.stroke();};
  poly(0);if(sides<5)poly(Math.PI/sides);
  for(let i=0;i<sides;i++){const a=-Math.PI/2+i/sides*Math.PI*2;x.beginPath();x.arc(Math.cos(a)*186,Math.sin(a)*186,9,0,7);x.lineWidth=2;x.stroke();}
  for(let i=0;i<rings;i++)ring(50+i*(110/Math.max(1,rings))+R()*14,2+R()*2);
  for(let i=0;i<64;i++){x.save();x.rotate(i/64*Math.PI*2);x.lineWidth=i%4?1.2:2.6;x.beginPath();x.moveTo(0,-170);x.lineTo(0,i%4?-162:-152);x.stroke();x.restore();}
  ring(16,3);x.beginPath();x.arc(0,0,5,0,7);x.fill();
  const t=new THREE.CanvasTexture(cv);circCache[key]=t;return t;}
function floorTex(){const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');const g=x.createRadialGradient(128,128,0,128,128,128);g.addColorStop(0,'rgba(48,18,28,.5)');g.addColorStop(.5,'rgba(24,10,16,.3)');g.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=g;x.fillRect(0,0,256,256);return new THREE.CanvasTexture(c);}

/* ============================================================ effect types */
const sel3=(k,l,o,d)=>({k,l,t:'select',o,d}), bool=(k,l,d)=>({k,l,t:'bool',d}), colr=(k,l,d)=>({k,l,t:'color',d});
const TYPES={
slash:{label:'ฟันโค้ง · Slash',ic:'SL',
  params:[['arc','องศาความโค้ง',20,340,1,160],['radius','รัศมี',.2,6,.01,1.7],['width','ความหนา',.02,2,.01,.6],['strands','จำนวนเส้น',1,6,1,3],['crescent','ความเป็นเสี้ยวจันทร์',-1,1,.01,.6],['taper','ความเรียวปลาย',.2,3,.01,.9],['sweep','ช่วงเวลาตวัด',.05,1,.01,.35],['eat','หางไล่หาย',0,1,.01,1],['spin','หมุนตาม (องศา)',-360,360,1,40],['sharp','ความคมของแกน',1,12,.1,4]],
  build(L){const p=L.p,R=rng(L.seed),g=new THREE.Group(),arr=[];
    for(let s=0;s<p.strands;s++){const n=72,rad=p.radius*(s?1+(R()-.5)*.35:1),arc=p.arc*D2R*(s?.55+R()*.4:1),a0=-arc/2+(s?(R()-.5)*.5:0),w=p.width*(s?.16+R()*.24:1),zo=s?(R()-.5)*.12:0;
      const P=[],W=[],N=[];for(let i=0;i<n;i++){const u=i/(n-1),a=a0+arc*u,c=Math.cos(a),si=Math.sin(a);P.push(V(c*rad,si*rad,zo));N.push(V(c,si,0));W.push(w*Math.pow(Math.sin(Math.PI*u),p.taper));}
      const m=new THREE.Mesh(ribbonGeo(P,W,N),ribMat(L,{sharp:p.sharp,edge:p.crescent*(s?.3:1)}));g.add(m);arr.push({u:m.material.uniforms,d:s?R()*.15:0,eat:p.eat});}
    return{obj:g,update(t,e){sweepUpd(arr,t,e,p.sweep);g.rotation.z=-p.spin*D2R*ease.out(t);}};}},
cut:{label:'ฟันตรง · Cut',ic:'CT',
  params:[['length','ความยาว',.3,10,.01,4],['width','ความหนา',.02,1.5,.01,.4],['count','จำนวนรอย',1,8,1,1],['gap','ระยะห่างรอย',0,2,.01,.4],['jitter','ความสุ่มมุม',0,1,.01,.2],['stagger','หน่วงทีละรอย',0,.4,.01,.08],['sweep','ช่วงเวลาตวัด',.05,1,.01,.3],['taper','ความเรียวปลาย',.2,3,.01,.7],['sharp','ความคมของแกน',1,12,.1,5]],
  build(L){const p=L.p,R=rng(L.seed),g=new THREE.Group(),arr=[];
    for(let i=0;i<p.count;i++){const y0=(i-(p.count-1)/2)*p.gap,len=p.length*(1-R()*.3*p.jitter),ang=(R()-.5)*p.jitter*.5,xs=(R()-.5)*p.jitter*len*.3,n=32,P=[],W=[],N=[];
      const dx=Math.cos(ang),dy=Math.sin(ang);
      for(let j=0;j<n;j++){const u=j/(n-1),s=(u-.5)*len;P.push(V(xs+dx*s,y0+dy*s,0));N.push(V(-dy,dx,0));W.push(p.width*(i&&p.count>1?.75:1)*Math.pow(Math.sin(Math.PI*u),p.taper));}
      const m=new THREE.Mesh(ribbonGeo(P,W,N),ribMat(L,{sharp:p.sharp}));g.add(m);arr.push({u:m.material.uniforms,d:Math.min(.8,i*p.stagger)});}
    return{obj:g,update(t,e){sweepUpd(arr,t,e,p.sweep);}};}},
spikes:{label:'แฉกพุ่ง · Spikes',ic:'SP',
  params:[['count','จำนวนแฉก',1,48,1,12],['length','ความยาว',.2,8,.01,2.4],['width','ความหนา',.02,1.2,.01,.24],['jitter','ความสุ่ม',0,1,.01,.5],['spread','มุมกระจาย',5,360,1,360],['dir','ทิศทาง (องศา)',0,360,1,90],['grow','เวลาพุ่งออก',.03,1,.01,.25],['sharp','ความคมของแกน',1,12,.1,3],bool('face','หันเข้ากล้องเสมอ',true)],
  build(L){const p=L.p,R=rng(L.seed),inner=new THREE.Group(),g=new THREE.Group(),arr=[];g.add(inner);
    for(let i=0;i<p.count;i++){let a;if(p.spread>=360)a=(i/p.count+(R()-.5)*p.jitter/p.count)*Math.PI*2+p.dir*D2R;else{const st=p.spread/p.count;a=(p.dir-p.spread/2+st*(i+.5)+(R()-.5)*st*p.jitter)*D2R;}
      const len=p.length*(1-p.jitter*R()*.75),dx=Math.cos(a),dy=Math.sin(a),n=14,P=[],W=[],N=[];
      for(let j=0;j<n;j++){const u=j/(n-1);P.push(V(dx*len*u,dy*len*u,0));N.push(V(-dy,dx,0));W.push(p.width*Math.pow(1-u,.8)*Math.min(1,.25+u*5));}
      const m=new THREE.Mesh(ribbonGeo(P,W,N),ribMat(L,{sharp:p.sharp}));inner.add(m);arr.push({u:m.material.uniforms,d:R()*.12});}
    return{obj:g,update(t,e,f,cam){if(p.face)billboard(inner,cam);else inner.quaternion.identity();
      for(const s of arr){const tt=clamp((t-s.d)/(1-s.d),0,1);s.u.uHead.value=ease.expo(clamp(tt/p.grow,0,1));s.u.uTail.value=ease.inOut(clamp((tt-p.grow)/Math.max(.02,1-p.grow),0,1));s.u.uOp.value=e;}}};}},
flash:{label:'แสงวาบ · Flash',ic:'FL',
  params:[['size','ขนาด',.1,10,.01,2],['rays','จำนวนรังสี',0,16,1,6],['attack','เวลาระเบิดแสง',.01,.6,.01,.12],['decay','ความเร็วจาง',.2,4,.01,1.5],['spin','หมุน (องศา)',-360,360,1,30],['pulse','กะพริบ',0,1,.01,0]],
  build(L){const p=L.p,m=new THREE.Mesh(new THREE.PlaneGeometry(2,2),glowMat(L,p.rays)),g=new THREE.Group(),u=m.material.uniforms;g.add(m);
    return{obj:g,update(t,e,f,cam){billboard(m,cam);const a=p.attack;let s,o;if(t<a){s=ease.back(t/a);o=1;}else{const k=(t-a)/(1-a);s=1+.15*k;o=Math.pow(1-k,p.decay);}
      if(p.pulse)o*=1-p.pulse*.5*(1+Math.sin(f*.9));m.scale.setScalar(Math.max(1e-3,p.size*s));u.uOp.value=e*o;u.uRot.value=p.spin*D2R*t;}};}},
ring:{label:'คลื่นวงแหวน · Shockwave',ic:'RG',
  params:[['r0','รัศมีเริ่ม',0,4,.01,.2],['r1','รัศมีสุดท้าย',.2,12,.01,3],['width','ความหนา',.02,3,.01,.5],['count','จำนวนวง',1,5,1,2],['gap','หน่วงระหว่างวง',0,.5,.01,.14],['thin','บางลงขณะขยาย',0,1,.01,.7],['sharp','ความคมของแกน',1,12,.1,2.5],bool('ground','วางราบบนพื้น',true)],
  build(L){const p=L.p,g=new THREE.Group(),arr=[],n=128,P=[],W=[],N=[];
    for(let i=0;i<n;i++){const a=i/(n-1)*Math.PI*2;P.push(V(Math.cos(a),Math.sin(a),0));N.push(V(0,0,0));W.push(0);}
    const geo=ribbonGeo(P,W,N);for(let i=0;i<p.count;i++){const m=new THREE.Mesh(geo,ribMat(L,{vs:VS_RING,fade:0,sharp:p.sharp}));g.add(m);arr.push(m.material.uniforms);}
    if(p.ground){g.rotation.x=-Math.PI/2;g.position.y=.02;}
    return{obj:g,update(t,e){arr.forEach((u,i)=>{const d=i*p.gap,tt=clamp((t-d)/Math.max(.05,1-d),0,1);u.uR.value=lerp(p.r0,p.r1,ease.out(tt));u.uW.value=p.width*(1-p.thin*tt)*(i?.6:1);u.uOp.value=tt>0?e*Math.pow(1-tt,1.1):0;});}};}},
particles:{label:'ประกายอนุภาค · Particles',ic:'PT',
  params:[['count','จำนวน',4,900,1,120],sel3('mode','รูปแบบการพุ่ง',[['burst','ระเบิดรอบทิศ'],['dome','ระเบิดครึ่งโดม'],['fountain','น้ำพุพุ่งขึ้น'],['ring','วงแนวราบ'],['rise','ลอยขึ้น (ถ่านไฟ)'],['converge','ดูดเข้าศูนย์กลาง'],['line','พุ่งไปข้างหน้า']],'burst'),
    ['speed','ความเร็ว',0,20,.01,5],['spread','การกระจาย',0,8,.01,1],['gravity','แรงโน้มถ่วง',-15,15,.1,3],['drag','แรงต้านอากาศ',0,6,.01,1.5],['size','ขนาดเม็ด',.01,1.5,.01,.12],['life','อายุ',.05,1,.01,.6],['stagger','ทยอยเกิด',0,1,.01,.1]],
  build(L,c){const p=L.p,R=rng(L.seed),n=p.count|0,geo=new THREE.BufferGeometry(),pos=new Float32Array(n*3),sz=new Float32Array(n),cl=new Float32Array(n*4);
    geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('aSize',new THREE.BufferAttribute(sz,1));geo.setAttribute('aCol',new THREE.BufferAttribute(cl,4));
    const c0=col(L.core),c1=col(L.glow),P=[];
    for(let i=0;i<n;i++){const th=R()*Math.PI*2,ph=Math.acos(2*R()-1);const d=V(Math.sin(ph)*Math.cos(th),Math.cos(ph),Math.sin(ph)*Math.sin(th)),o=V(0,0,0);
      switch(p.mode){case'dome':d.y=Math.abs(d.y);break;case'fountain':d.set((R()-.5)*p.spread*.5,1,(R()-.5)*p.spread*.5).normalize();break;case'ring':d.set(Math.cos(th),(R()-.5)*.08,Math.sin(th));break;
        case'rise':o.set((R()-.5)*2*p.spread,R()*.3,(R()-.5)*2*p.spread);d.set((R()-.5)*.3,1,(R()-.5)*.3).normalize();break;case'converge':o.copy(d).multiplyScalar(p.spread*(.6+R()*.6)+.3);break;case'line':d.set(1,(R()-.5)*p.spread*.3,(R()-.5)*p.spread*.3).normalize();break;}
      if(p.mode==='burst'||p.mode==='dome'||p.mode==='ring')o.copy(d).multiplyScalar(R()*.15*p.spread);
      P.push({d,o,v:p.speed*(.35+.65*R()),b:R()*p.stagger,l:p.life*(.5+.5*R()),s:p.size*(.4+.6*R()),w:R()*6.28});}
    const pts=new THREE.Points(geo,new THREE.ShaderMaterial({uniforms:{uPx:c.st.px},vertexShader:VS_PTS,fragmentShader:FR_PTS,...ADD}));
    return{obj:pts,update(t,e){const dur=Math.max(1,L.end-L.start)/ST.comp.fps;
      for(let i=0;i<n;i++){const q=P[i],age=(t-q.b)/Math.max(.01,q.l);if(age<0||age>1){cl[i*4+3]=0;sz[i]=0;continue;}
        const tau=age*q.l*dur;let x,y,z;
        if(p.mode==='converge'){const k=ease.inOut(age);x=q.o.x*(1-k);y=q.o.y*(1-k);z=q.o.z*(1-k);}
        else{const dd=p.drag>0?(1-Math.exp(-p.drag*tau))/p.drag:tau,m=q.v*dd;x=q.o.x+q.d.x*m;y=q.o.y+q.d.y*m-.5*p.gravity*tau*tau;z=q.o.z+q.d.z*m;if(p.mode==='rise'){x+=Math.sin(tau*3+q.w)*.15;z+=Math.cos(tau*2.5+q.w)*.15;}}
        pos[i*3]=x;pos[i*3+1]=y;pos[i*3+2]=z;sz[i]=q.s*(1-.5*age);
        cl[i*4]=lerp(c0.r,c1.r,age);cl[i*4+1]=lerp(c0.g,c1.g,age);cl[i*4+2]=lerp(c0.b,c1.b,age);cl[i*4+3]=Math.min(1,age*10)*Math.pow(1-age,1.3)*e;}
      geo.attributes.position.needsUpdate=geo.attributes.aSize.needsUpdate=geo.attributes.aCol.needsUpdate=true;}};}},
debris:{label:'หินแตก · Debris',ic:'DB',
  params:[['count','จำนวนก้อน',1,120,1,24],['speed','แรงกระเด็น',0,15,.01,5],['size','ขนาด',.02,1,.01,.16],['gravity','แรงโน้มถ่วง',0,30,.1,14],['spread','กระจายจุดเกิด',0,3,.01,.4],colr('rock','สีหิน','#3a2a2e'),['light','แสงสะท้อนบนหิน',0,8,.1,3]],
  build(L){const p=L.p,R=rng(L.seed),n=p.count|0,g=new THREE.Group();
    const im=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),new THREE.MeshStandardMaterial({color:p.rock,roughness:.85,metalness:.05,flatShading:true,emissive:col(L.glow),emissiveIntensity:.14}),n);g.add(im);
    const lt=new THREE.PointLight(L.glow,0,9,2);lt.position.set(0,.7,.5);g.add(lt);
    const P=[];for(let i=0;i<n;i++){const th=R()*6.283,el=.35+R()*.9;P.push({d:V(Math.cos(th)*Math.cos(el),Math.sin(el),Math.sin(th)*Math.cos(el)),o:V((R()-.5)*p.spread,0,(R()-.5)*p.spread),v:p.speed*(.4+.6*R()),s:p.size*(.4+.8*R()),ax:V(R()-.5,R()-.5,R()-.5).normalize(),sp:4+R()*10,b:R()*.08,sq:V(.7+R()*.6,.6+R()*.5,.7+R()*.6)});}
    const M=new THREE.Matrix4(),Q=new THREE.Quaternion(),Sc=new THREE.Vector3(),Pp=new THREE.Vector3();
    return{obj:g,update(t,e){const dur=Math.max(1,L.end-L.start)/ST.comp.fps;
      P.forEach((q,i)=>{const tau=Math.max(0,t-q.b)*dur;let x=q.o.x+q.d.x*q.v*tau,y=q.d.y*q.v*tau-.5*p.gravity*tau*tau,z=q.o.z+q.d.z*q.v*tau,spin=q.sp*tau;
        if(p.gravity>0){const tl=2*q.d.y*q.v/p.gravity;if(tau>tl){x=q.o.x+q.d.x*q.v*tl;z=q.o.z+q.d.z*q.v*tl;spin=q.sp*tl;y=0;}}
        y=Math.max(0,y)+q.s*.45;Pp.set(x,y,z);Q.setFromAxisAngle(q.ax,spin);const k=t>.75?1-(t-.75)/.25:1;Sc.copy(q.sq).multiplyScalar(t<q.b?1e-4:q.s*Math.max(1e-4,k));M.compose(Pp,Q,Sc);im.setMatrixAt(i,M);});
      im.instanceMatrix.needsUpdate=true;lt.intensity=p.light*e*Math.max(0,1-t*1.4);}};}},
beam:{label:'ลำแสง / เสาพลัง · Beam',ic:'BM',
  params:[['height','ความสูง',.2,14,.01,5],['width','ความกว้าง',.05,4,.01,.9],['grow','เวลาพุ่งขึ้น',.02,1,.01,.18],['hold','ค้างไว้',0,1,.01,.6],['wobble','สั่นไหว',0,1,.01,.25],['sharp','ความคมของแกน',1,12,.1,3],bool('face','หันเข้ากล้อง (แกนตั้ง)',true)],
  build(L){const p=L.p,inner=new THREE.Group(),g=new THREE.Group();g.add(inner);
    const mk=(w,sh)=>{const n=32,P=[],W=[],N=[];for(let i=0;i<n;i++){const u=i/(n-1);P.push(V(0,u*p.height,0));N.push(V(1,0,0));W.push(w*(1-.4*u)*Math.min(1,.55+u*8));}const m=new THREE.Mesh(ribbonGeo(P,W,N),ribMat(L,{sharp:sh,fade:0}));inner.add(m);return m.material.uniforms;};
    const us=[mk(p.width,p.sharp),mk(p.width*2.6,1.1)];
    return{obj:g,update(t,e,f,cam){if(p.face)cylBoard(inner,cam);else inner.rotation.set(0,0,0);const hd=ease.expo(clamp(t/p.grow,0,1)),endT=p.grow+(1-p.grow)*p.hold,tail=ease.inOut(clamp((t-endT)/Math.max(.02,1-endT),0,1));
      inner.scale.x=1+p.wobble*(.22*Math.sin(f*.8)+.1*Math.sin(f*2.3));us.forEach((u,i)=>{u.uHead.value=hd;u.uTail.value=tail;u.uOp.value=e*(i?.32:1);});}};}},
circle:{label:'วงเวท · Magic circle',ic:'MC',
  params:[['radius','รัศมี',.2,6,.01,2],['sides','แฉกดาว',3,9,1,6],['rings','วงด้านใน',0,4,1,2],['spin','หมุน (องศา)',-720,720,1,90],['reveal','เวลาวาดวง',.02,1,.01,.3],bool('ground','วางราบบนพื้น',true)],
  build(L){const p=L.p,g=new THREE.Group(),m=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({uniforms:{uTex:{value:circleTex(L.seed%97,p.sides,p.rings)},uCore:{value:col(L.core)},uGlow:{value:col(L.glow)},uOp:{value:1},uRev:{value:1}},vertexShader:VS_UV,fragmentShader:FR_CIRC,...ADD}));
    g.add(m);if(p.ground){g.rotation.x=-Math.PI/2;g.position.y=.03;}const u=m.material.uniforms;
    return{obj:g,update(t,e){m.scale.setScalar(p.radius*(.6+.4*ease.back(clamp(t/.2,0,1))));m.rotation.z=p.spin*D2R*t;u.uRev.value=ease.out(clamp(t/p.reveal,0,1));u.uOp.value=e;}};}},
lightning:{label:'สายฟ้า · Lightning',ic:'LT',
  params:[['length','ความยาว',.5,12,.01,5],['jag','ความหยัก',0,1,.01,.5],['branches','จำนวนกิ่ง',0,8,1,3],['width','ความหนา',.02,.8,.01,.18],['flicker','เปลี่ยนรูปทุกกี่เฟรม',1,12,1,3],['strike','เวลาฟาดลง',.02,1,.01,.12],bool('face','หันเข้ากล้อง (แกนตั้ง)',true)],
  build(L){const p=L.p,inner=new THREE.Group(),g=new THREE.Group();g.add(inner);let last=-1,us=[];
    const bolt=(R,a,b,w)=>{let pts=[a.clone(),b.clone()];const L0=a.distanceTo(b);for(let lv=0;lv<6;lv++){const np=[];for(let i=0;i<pts.length-1;i++){const m=pts[i].clone().lerp(pts[i+1],.5),amp=p.jag*L0*.22/Math.pow(1.9,lv);m.x+=(R()-.5)*amp*2;m.z+=(R()-.5)*amp*.5;np.push(pts[i],m);}np.push(pts[pts.length-1]);pts=np;}
      const n=pts.length,W=[],N=[];for(let i=0;i<n;i++){const u=i/(n-1),T=pts[Math.min(n-1,i+1)].clone().sub(pts[Math.max(0,i-1)]);N.push(V(-T.y,T.x,0).normalize());W.push(w*(1-.5*u)*(.7+R()*.6));}
      const m=new THREE.Mesh(ribbonGeo(pts,W,N),ribMat(L,{sharp:2.5,fade:0}));m.frustumCulled=false;inner.add(m);us.push(m.material.uniforms);return pts;};
    const rebuild=idx=>{inner.children.slice().forEach(c=>{inner.remove(c);c.geometry.dispose();c.material.dispose();});us=[];const R=rng(L.seed*31+idx*7919);
      const main=bolt(R,V(0,p.length,0),V(0,0,0),p.width);for(let b=0;b<p.branches;b++){const s=main[(main.length*(.15+R()*.5))|0];bolt(R,s,s.clone().add(V((R()-.5)*p.length*.7,-p.length*(.15+R()*.25),0)),p.width*.45);}};
    return{obj:g,update(t,e,f,cam){const idx=Math.floor(f/p.flicker);if(idx!==last){rebuild(idx);last=idx;}if(p.face)cylBoard(inner,cam);else inner.rotation.set(0,0,0);
      const hd=ease.expo(clamp(t/p.strike,0,1)),fl=.55+.45*rng(idx*7+3)();us.forEach((u,i)=>{u.uHead.value=i?clamp((hd-.3)/.7,0,1):hd;u.uTail.value=0;u.uOp.value=e*fl;});}};}},
vortex:{label:'พายุหมุน · Vortex',ic:'VX',
  params:[['radius','รัศมี',.1,5,.01,1.4],['height','ความสูง',0,8,.01,2.5],['turns','จำนวนรอบ',.2,8,.01,2],['strands','จำนวนสาย',1,10,1,4],['width','ความหนา',.02,1.5,.01,.25],['taper','บีบ/บานตามความสูง',-1.5,1,.01,.4],['spin','หมุน (องศา)',-1080,1080,1,360],['sweep','ช่วงเวลาวาด',.05,1,.01,.5],['sharp','ความคมของแกน',1,12,.1,3]],
  build(L){const p=L.p,inner=new THREE.Group(),g=new THREE.Group(),arr=[];g.add(inner);const hk=clamp(p.height/(p.radius*2+.001),0,1);
    for(let s=0;s<p.strands;s++){const n=120,P=[],W=[],N=[];for(let i=0;i<n;i++){const u=i/(n-1),a=u*p.turns*Math.PI*2+s/p.strands*Math.PI*2,r=p.radius*Math.max(.02,1-p.taper*u);P.push(V(Math.cos(a)*r,u*p.height,Math.sin(a)*r));N.push(V(Math.cos(a)*(1-hk),hk,Math.sin(a)*(1-hk)).normalize());W.push(p.width*Math.pow(Math.sin(Math.PI*u),.6));}
      const m=new THREE.Mesh(ribbonGeo(P,W,N),ribMat(L,{sharp:p.sharp}));inner.add(m);arr.push({u:m.material.uniforms,d:s*.04});}
    return{obj:g,update(t,e){sweepUpd(arr,t,e,p.sweep);inner.rotation.y=-p.spin*D2R*t;}};}},
trail:{label:'ลูกพลังพุ่ง · Projectile',ic:'PJ',
  params:[['distance','ระยะทาง',.5,14,.01,6],['arcH','ความโค้งวิถี',-4,4,.01,.6],['strands','จำนวนสายหาง',1,6,1,3],['wobble','การส่ายของหาง',0,1.5,.01,.3],['width','ความหนาหาง',.02,1.2,.01,.3],['trail','ความยาวหาง',.05,1,.01,.35],['travel','เวลาเดินทาง',.1,1,.01,.6],['orb','ขนาดลูกพลัง',0,4,.01,1.2],['sharp','ความคมของแกน',1,12,.1,3]],
  build(L){const p=L.p,R=rng(L.seed),g=new THREE.Group(),arr=[];const path=u=>V(-p.distance/2+p.distance*u,p.arcH*Math.sin(Math.PI*u),0);
    for(let s=0;s<p.strands;s++){const n=96,P=[],W=[],N=[],ph=R()*6.28,fr=6+R()*8,amp=s?p.wobble*.35*(.5+R()):0;
      for(let i=0;i<n;i++){const u=i/(n-1),a=path(u),b=path(Math.min(1,u+.01)),T=b.sub(a.clone()).normalize(),nn=V(-T.y,T.x,0);a.addScaledVector(nn,Math.sin(u*fr+ph)*amp);a.z+=Math.cos(u*fr*.8+ph)*amp;P.push(a);N.push(nn);W.push(p.width*(s?.45:1));}
      const m=new THREE.Mesh(ribbonGeo(P,W,N),ribMat(L,{sharp:p.sharp}));g.add(m);arr.push(m.material.uniforms);}
    const orb=new THREE.Mesh(new THREE.PlaneGeometry(2,2),glowMat(L,4));g.add(orb);
    return{obj:g,update(t,e,f,cam){const hd=clamp(t/p.travel,0,1),tail=clamp(t/p.travel-p.trail,0,1);arr.forEach(u=>{u.uHead.value=hd;u.uTail.value=tail;u.uOp.value=e;});
      orb.position.copy(path(hd));billboard(orb,cam);orb.scale.setScalar(Math.max(1e-3,p.orb*(1+.12*Math.sin(f*.7))));orb.material.uniforms.uOp.value=e*(hd<1?1:Math.max(0,1-(t-p.travel)*8));orb.material.uniforms.uRot.value=f*.05;}};}},
sprite:{label:'สไปรต์ / รูปภาพ · Sprite',ic:'IMG',
  params:[{k:'asset',l:'รูป / สไปรต์ชีต',t:'asset',d:''},['cols','คอลัมน์',1,24,1,1],['rows','แถว',1,24,1,1],['from','ช่องเริ่ม',0,575,1,0],['to','ช่องสุดท้าย',0,575,1,0],['hold','ค้างแต่ละช่อง (เฟรม)',1,30,1,4],bool('loop','วนลำดับภาพซ้ำ',true),
    sel3('blend','วิธีผสมภาพ',[['add','Additive · พื้นดำกลายเป็นแสง'],['key','ตัดพื้นดำออก · ตัวละคร'],['normal','ปกติ · PNG โปร่งใส']],'add'),['key','ระดับตัดพื้นดำ',0,.6,.005,.06],
    ['size','ขนาด',.1,10,.01,2.5],['s0','สเกลตอนเริ่ม',0,3,.01,1],['s1','สเกลตอนจบ',0,3,.01,1],['spin','หมุน (องศา)',-720,720,1,0],
    sel3('board','หันเข้ากล้อง',[['cyl','หมุนตามแกนตั้ง'],['full','หันเต็มที่'],['none','ไม่หัน (วางในฉาก)']],'cyl'),sel3('pivot','จุดยึด',[['center','กึ่งกลาง'],['bottom','ด้านล่าง (ยืนบนพื้น)']],'center'),bool('flip','กลับซ้าย-ขวา',false)],
  build(L,c){const p=L.p,A=ASSETS[p.asset],g=new THREE.Group();if(!A||!A.img)return{obj:g,update(){}};
    const tex=c.st.texFor(A),asp=(A.img.width/p.cols)/(A.img.height/p.rows),geo=new THREE.PlaneGeometry(asp,1);if(p.pivot==='bottom')geo.translate(0,.5,0);
    const mode={add:0,normal:1,key:2}[p.blend]??0;
    const mat=new THREE.ShaderMaterial({uniforms:{uTex:{value:tex},uCell:{value:new THREE.Vector4(0,0,1,1)},uOp:{value:1},uMode:{value:mode},uKey:{value:p.key},uTint:{value:col(L.core)}},vertexShader:VS_UV,fragmentShader:FR_SPR,...(mode===0?ADD:NORM)});
    const m=new THREE.Mesh(geo,mat),inner=new THREE.Group();inner.add(m);g.add(inner);const total=Math.max(1,p.cols*p.rows);
    return{obj:g,update(t,e,f,cam){if(p.board==='full')billboard(inner,cam);else if(p.board==='cyl')cylBoard(inner,cam);else inner.quaternion.identity();
      let a=clamp(Math.round(p.from),0,total-1),b=clamp(Math.round(p.to),0,total-1);if(b<a)[a,b]=[b,a];const span=b-a+1;let k=Math.floor(Math.max(0,f)/p.hold);k=p.loop?k%span:Math.min(k,span-1);const idx=a+k;
      mat.uniforms.uCell.value.set((idx%p.cols)/p.cols,1-(Math.floor(idx/p.cols)+1)/p.rows,1/p.cols,1/p.rows);
      const s=Math.max(1e-3,p.size*lerp(p.s0,p.s1,ease.out(t)));m.scale.set(s*(p.flip?-1:1),s,s);m.rotation.z=p.spin*D2R*t;mat.uniforms.uOp.value=e;}};}}
};
for(const k in TYPES)TYPES[k].params=TYPES[k].params.map(d=>Array.isArray(d)?{k:d[0],l:d[1],min:d[2],max:d[3],step:d[4],d:d[5],t:'range'}:d);

/* ============================================================ state */
const PAL={crimson:['#ffe9ec','#ff1e3c'],blood:['#ffd3da','#c4001f'],ember:['#fff3c4','#ff4a12'],gold:['#fff6d8','#ff9d1c'],toxic:['#f4ffe0','#4dff3a'],jade:['#e6fff6','#14d99a'],frost:['#ffffff','#5fe1ff'],azure:['#eafcff','#1d8bff'],violet:['#f6ebff','#9a3cff'],shadow:['#ffd9f4','#7014ff'],earth:['#ffe7c4','#c8691c'],water:['#e6fbff','#1f9bff'],wind:['#f2fff9','#62f5c4']};
function newLayer(type,o={}){const T=TYPES[type],L={id:uid(),type,name:T.label.split(' · ')[1]||T.label,visible:true,start:0,end:60,fadeIn:0,fadeOut:.2,core:PAL.crimson[0],glow:PAL.crimson[1],intensity:1,px:0,py:1,pz:0,rx:0,ry:0,rz:0,scale:1,mirror:false,seed:1+((Math.random()*9998)|0),p:{}};
  for(const d of T.params)L.p[d.k]=d.d;const {p,...rest}=o;Object.assign(L,rest);Object.assign(L.p,p||{});L.id=uid();return L;}
/* ============================================================ presets */
const P=(n,pal,tag,layers,tf=.35)=>({n,pal,tag,layers,tf});
const PRESETS=[
P('Crimson Crescent','crimson','SLASH',[['slash',{end:42,rz:-25,p:{arc:170,radius:1.7,width:.65,strands:3}}],['particles',{start:3,end:50,p:{count:90,speed:6,size:.08,gravity:2}}],['flash',{start:2,end:26,p:{size:1.6,rays:4}}]]),
P('Blood Cross','blood','SLASH',[['cut',{end:34,rz:40,p:{length:4.6,width:.5}}],['cut',{start:6,end:40,rz:-40,p:{length:4.6,width:.5}}],['flash',{start:6,end:34,p:{size:2.6,rays:4,spin:45}}],['particles',{start:6,end:46,p:{count:80,speed:7,size:.07}}]],.3),
P('Triple Fang','crimson','SLASH',[['cut',{end:40,rz:35,p:{count:3,gap:.5,stagger:.08,length:4,width:.42,sweep:.28}}],['particles',{start:4,end:44,p:{mode:'line',count:70,speed:8,spread:2,gravity:0,size:.06}}]],.3),
P('Crimson Eruption','crimson','IMPACT',[['beam',{start:6,end:70,py:0,p:{height:5,width:.8}}],['spikes',{start:4,end:42,py:0,p:{count:9,spread:70,dir:90,length:3.6,width:.3}}],['debris',{start:4,end:80,py:0,p:{count:26}}],['ring',{start:4,end:40,py:0,p:{r1:3}}],['flash',{start:4,end:28,py:.3,p:{size:2.2}}]],.3),
P('Blood Moon','blood','SLASH',[['slash',{end:60,p:{arc:330,strands:4,radius:1.5,sweep:.5,spin:220}}],['ring',{start:4,end:50,py:0,p:{r1:2.8}}],['particles',{start:4,end:60,p:{mode:'ring',count:120,speed:4,gravity:0}}]]),
P('Rending Spiral','crimson','VORTEX',[['vortex',{end:70,py:0,p:{radius:1.3,height:3,turns:2,strands:4}}],['particles',{start:0,end:80,py:0,p:{mode:'rise',count:90,spread:1,speed:3,gravity:-1,life:.5,stagger:.6,size:.08}}],['ring',{start:0,end:40,py:0,p:{r1:2.4,count:1}}]],.4),
P('Star Burst','gold','IMPACT',[['flash',{end:40,p:{size:3,rays:8}}],['spikes',{start:2,end:36,p:{count:16,length:2.8}}],['particles',{start:2,end:50,p:{count:150,speed:8,size:.07}}],['ring',{start:2,end:34,p:{r1:2.6,count:1,ground:false}}]],.25),
P('Ripple Sigil','crimson','MAGIC',[['ring',{end:70,py:0,p:{count:3,gap:.18,r1:3.6}}],['circle',{end:80,py:0,p:{radius:1.6,sides:5}}],['beam',{start:10,end:70,py:0,p:{width:.25,height:4}}]],.45),
P('Earthshatter','gold','IMPACT',[['debris',{end:80,py:0,p:{count:30}}],['ring',{end:44,py:0,p:{r1:3.2}}],['flash',{end:30,py:.6,p:{size:2.4,rays:10}}],['particles',{end:56,py:.2,p:{mode:'dome',speed:7,gravity:6,count:140}}],['spikes',{start:1,end:30,py:.4,p:{count:12,length:2}}]],.28),
P('Storm Lance','azure','PROJECTILE',[['trail',{end:50,py:1.2,p:{distance:7,arcH:.3,strands:3,travel:.5}}],['lightning',{start:26,end:60,px:3.5,py:0,p:{length:4}}],['flash',{start:26,end:52,px:3.5,py:1,p:{size:2.4,rays:6}}],['ring',{start:26,end:60,px:3.5,py:0,p:{r1:2.6}}]],.25),
P('Thunder Strike','violet','THUNDER',[['lightning',{end:44,py:0,p:{length:6,branches:4}}],['flash',{start:4,end:34,py:.4,p:{size:2.6,rays:8}}],['ring',{start:4,end:44,py:0,p:{r1:3}}],['particles',{start:4,end:50,py:.1,p:{mode:'dome',count:100,speed:6,gravity:8}}]],.15),
P('Frost Nova','frost','IMPACT',[['ring',{end:50,py:0,p:{count:2,r1:4}}],['spikes',{end:44,py:.05,rx:-90,p:{count:14,length:3,face:false,width:.3}}],['particles',{start:2,end:56,p:{count:140,speed:6,size:.07,gravity:1}}],['flash',{end:30,p:{size:2.4,rays:6}}]],.3),
P('Arcane Summon','violet','MAGIC',[['circle',{end:90,py:0,p:{radius:2,sides:5,rings:3}}],['beam',{start:20,end:85,py:0,p:{width:.6,height:6}}],['particles',{start:6,end:90,py:0,p:{mode:'rise',count:120,spread:1.5,speed:3,gravity:-1,stagger:.6,size:.08}}]],.45),
P('Ember Comet','ember','PROJECTILE',[['trail',{end:52,py:1,p:{distance:8,arcH:1.5,strands:2,orb:1.4,travel:.55}}],['particles',{start:28,end:70,px:4,py:0,p:{mode:'dome',count:120,speed:6,gravity:7}}],['ring',{start:28,end:64,px:4,py:0,p:{r1:2.6}}],['debris',{start:28,end:84,px:4,py:0,p:{count:16}}]],.3),
P('Holy Pillar','gold','MAGIC',[['beam',{end:80,py:0,p:{width:1.4,height:7}}],['circle',{end:85,py:0,p:{radius:1.8,sides:8,rings:2}}],['particles',{end:90,py:0,p:{mode:'rise',count:140,spread:1.2,speed:4,gravity:-1,stagger:.6,size:.07}}],['flash',{end:30,py:.3,p:{size:3,rays:12}}]],.4),
P('Venom Burst','toxic','IMPACT',[['particles',{end:60,p:{mode:'dome',count:220,speed:7,gravity:6,size:.1}}],['flash',{end:30,p:{size:2.2,rays:5}}],['vortex',{end:50,py:.05,rx:-90,p:{height:0,radius:1.8,turns:1.2,strands:5,taper:.8,width:.3}}],['ring',{end:44,py:0,p:{r1:3}}]],.3),
P('Spirit Wisp','jade','PROJECTILE',[['trail',{end:80,py:1.2,p:{strands:5,wobble:1,arcH:1,orb:.8,distance:6,travel:.9,trail:.5}}],['particles',{end:90,py:.5,p:{mode:'rise',count:60,spread:2,speed:2,gravity:-.5,stagger:.7,size:.06}}]],.5),
P('Whirlwind Slash','crimson','SLASH',[['slash',{end:50,py:.8,rx:-75,p:{arc:300,spin:360,strands:3,radius:1.8,sweep:.45}}],['slash',{start:10,end:56,py:1.3,rx:-60,ry:40,p:{arc:260,spin:-300,strands:2,radius:1.3,width:.4}}],['particles',{start:4,end:56,py:1,p:{mode:'ring',speed:5,gravity:0,count:100}}]],.4),
P('Shadow Rend','shadow','SLASH',[['cut',{end:44,rz:-20,p:{count:5,stagger:.05,gap:.32,length:3.6,jitter:.6,width:.34}}],['flash',{start:8,end:40,p:{size:2,rays:6}}],['particles',{start:6,end:50,p:{mode:'converge',count:80,spread:2.2}}]],.4),
/* ---- ธาตุ: ดิน */
P('Stone Spikes · หนามหินผุด','earth','ดิน',[['spikes',{end:44,py:0,p:{count:7,spread:80,dir:90,length:3,width:.42,sharp:2,grow:.18}}],['debris',{end:80,py:0,p:{count:34,speed:6,size:.2,rock:'#5a3b22',light:4}}],['ring',{end:40,py:0,p:{r1:3,count:2,sharp:1.6}}],['particles',{end:56,py:.1,p:{mode:'dome',count:120,speed:5,gravity:9,size:.1}}]],.3),
P('Quake Fissure · แผ่นดินแยก','earth','ดิน',[['cut',{end:50,py:.03,rx:-90,p:{length:7,width:.35,count:1,sweep:.25,sharp:3,jitter:.3}}],['debris',{start:4,end:84,py:0,p:{count:44,spread:2.6,speed:4,gravity:16,rock:'#4b3220'}}],['ring',{start:4,end:56,py:0,p:{count:3,gap:.16,r1:4.2,sharp:1.8}}],['flash',{start:2,end:26,py:.3,p:{size:1.6,rays:0}}]],.3),
P('Boulder Crash · หินยักษ์ถล่ม','earth','ดิน',[['trail',{end:40,py:1,p:{distance:6,arcH:3,strands:2,orb:1.8,travel:.6,trail:.3,width:.4}}],['debris',{start:24,end:86,px:3,py:0,p:{count:30,speed:7,size:.24,rock:'#5a3b22'}}],['ring',{start:24,end:60,px:3,py:0,p:{r1:3.2}}],['particles',{start:24,end:70,px:3,py:.2,p:{mode:'dome',count:140,speed:6,gravity:9,size:.1}}],['flash',{start:24,end:46,px:3,py:.4,p:{size:2.4,rays:6}}]],.45),
/* ---- ธาตุ: น้ำ */
P('Tidal Wave · คลื่นยักษ์','water','น้ำ',[['slash',{end:56,py:.6,rx:-65,p:{arc:200,radius:2.3,width:.9,strands:5,crescent:.8,sweep:.5,spin:60,sharp:2.5}}],['particles',{start:4,end:64,py:.4,p:{mode:'fountain',count:180,speed:7,spread:2.2,gravity:12,size:.09,life:.7,stagger:.4}}],['ring',{start:8,end:60,py:0,p:{count:2,r1:3.6,sharp:4,thin:.4}}]],.35),
P('Water Spout · เสาน้ำพุ่ง','water','น้ำ',[['vortex',{end:76,py:0,p:{radius:.9,height:4.2,turns:3,strands:5,width:.3,taper:-.35,spin:540,sweep:.35}}],['particles',{end:80,py:0,p:{mode:'fountain',count:220,speed:9,spread:1.2,gravity:11,size:.08,life:.6,stagger:.6}}],['ring',{end:60,py:0,p:{count:3,gap:.14,r1:2.6,sharp:5,thin:.3}}],['beam',{start:4,end:70,py:0,p:{width:.5,height:4,wobble:.5,sharp:2}}]],.4),
P('Aqua Ripple · ระลอกน้ำ','water','น้ำ',[['ring',{end:80,py:0,p:{count:4,gap:.15,r0:.1,r1:3.4,width:.22,thin:.3,sharp:6}}],['particles',{end:40,py:0,p:{mode:'fountain',count:60,speed:5,spread:.8,gravity:14,size:.08,life:.5}}],['flash',{end:24,py:.2,p:{size:1.2,rays:0}}]],.3),
/* ---- ธาตุ: ลม */
P('Tornado · ทอร์นาโด','wind','ลม',[['vortex',{end:84,py:0,p:{radius:.7,height:5,turns:4,strands:6,width:.16,taper:-1.1,spin:1080,sweep:.3,sharp:4}}],['particles',{end:90,py:0,p:{mode:'rise',count:160,spread:1.4,speed:5,gravity:-2,stagger:.6,size:.06,life:.5}}],['ring',{end:50,py:0,p:{count:2,r1:3,sharp:4}}]],.45),
P('Gale Blades · ใบมีดลม','wind','ลม',[['cut',{end:40,rz:-12,p:{count:4,gap:.38,jitter:.7,length:3.6,width:.2,stagger:.06,sweep:.3,sharp:6}}],['slash',{start:6,end:44,rz:-15,p:{arc:120,radius:2.6,width:.25,strands:2,crescent:.2,sharp:6}}],['particles',{start:2,end:46,p:{mode:'line',count:90,speed:11,spread:1.6,gravity:0,drag:.6,size:.05}}]],.3),
P('Cyclone Ring · วงแหวนพายุ','wind','ลม',[['slash',{end:60,py:.7,rx:-80,p:{arc:340,radius:2,width:.28,strands:5,spin:720,sweep:.4,sharp:5}}],['slash',{start:8,end:66,py:1.5,rx:-75,p:{arc:300,radius:1.4,width:.2,strands:3,spin:-540,sweep:.4,sharp:5}}],['particles',{start:4,end:66,py:1,p:{mode:'ring',count:120,speed:4,gravity:-.5,size:.05}}]],.4),
/* ---- ธาตุ: ไฟ */
P('Inferno Pillar · เสาเพลิง','ember','ไฟ',[['beam',{end:76,py:0,p:{width:1.3,height:6,wobble:.7,sharp:2.2}}],['particles',{end:86,py:0,p:{mode:'rise',count:220,spread:.9,speed:5,gravity:-3,stagger:.7,size:.12,life:.5}}],['ring',{end:44,py:0,p:{count:2,r1:3}}],['flash',{end:28,py:.4,p:{size:2.6,rays:8}}]],.4),
P('Fireball · ลูกไฟ','ember','ไฟ',[['trail',{end:44,py:1,p:{distance:7,arcH:.4,strands:4,wobble:.6,orb:1.7,travel:.5,trail:.45,width:.4}}],['flash',{start:22,end:50,px:3.5,py:1,p:{size:3,rays:10}}],['particles',{start:22,end:66,px:3.5,py:.6,p:{mode:'burst',count:180,speed:8,gravity:4,size:.1}}],['particles',{start:24,end:80,px:3.5,py:0,p:{mode:'rise',count:80,spread:1,speed:3,gravity:-2,stagger:.6,size:.08}}],['ring',{start:22,end:56,px:3.5,py:0,p:{r1:2.8}}]],.42),
P('Flame Slash · ฟันเพลิง','ember','ไฟ',[['slash',{end:46,rz:-25,p:{arc:180,radius:1.8,width:.75,strands:4,crescent:.7,sharp:2.5}}],['particles',{start:2,end:70,p:{mode:'rise',count:140,spread:1.6,speed:3,gravity:-2.5,stagger:.4,size:.1,life:.6}}],['flash',{start:2,end:26,p:{size:1.8,rays:6}}]],.32)
];
const ELEM_TAGS=[['all','ทั้งหมด'],['ดิน','ดิน'],['น้ำ','น้ำ'],['ลม','ลม'],['ไฟ','ไฟ']];let presetFilter='all';
function presetLayers(pr){const pal=PAL[pr.pal];return pr.layers.map(([t,o])=>newLayer(t,{core:pal[0],glow:pal[1],...o}));}
