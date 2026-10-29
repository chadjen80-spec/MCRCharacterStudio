/* MSW export: packs the generated sprite frames for MSW Maker.
   MSW references sprites by RUID, so frames are uploaded first (msw-mcp asset_create_resource_storage_item),
   then ForgeSpriteAnimator.mlua swaps SpriteRendererComponent.SpriteRUID frame by frame.
   Needs: JSZip, and from the studio page: QR, S, slugify, saveFile, quickGenerate, toast. */
'use strict';
const MSW_KEY={idle:'stand',walk:'move',run:'run',slash:'attack',kick:'kick',cast:'skill',jump:'jump',hurt:'hit',die:'die',victory:'victory',bounce:'move',hop:'jump',attack:'attack',float:'float',spin:'spin',shake:'shake'};
const MSW_LOOP=['stand','move','run','float','victory','spin'];
const MSW_MLUA=`@Component
script ForgeSpriteAnimator extends Component

	---@description "Frame RUIDs per action: stand=ruid1,ruid2;move=ruid3,ruid4"
	property string FrameTable = ""

	---@description "Frames per second"
	property number Fps = 12

	---@description "Action played when the entity starts"
	property string StartAction = "stand"

	---@description "Switch action when StateComponent changes state (IDLE->stand, MOVE->move, DEAD->die, HIT->hit, ATTACK->attack)"
	property boolean FollowStateComponent = true

	---@description "Actions that loop; the others stop on their last frame"
	property string LoopActions = "stand,move,run,float,victory,spin"

	@HideFromInspector
	property table frames = nil

	@HideFromInspector
	property string action = ""

	@HideFromInspector
	property number index = 1

	@HideFromInspector
	property number elapsed = 0

	@HideFromInspector
	property boolean finished = false

	method void OnBeginPlay()
		self.frames = {}
		for entry in string.gmatch(self.FrameTable, "[^;]+") do
			local key, list = string.match(entry, "^%s*([%w_]+)%s*=%s*(.-)%s*$")
			if key ~= nil then
				local t = {}
				for ruid in string.gmatch(list, "[^,%s]+") do
					table.insert(t, ruid)
				end
				self.frames[key] = t
			end
		end
		self:Play(self.StartAction)
	end

	method void Play(string name)
		if self.frames == nil or self.frames[name] == nil then
			return
		end
		if self.action == name and self.finished == false then
			return
		end
		self.action = name
		self.index = 1
		self.elapsed = 0
		self.finished = false
		self:Apply()
	end

	method void Apply()
		local list = self.frames[self.action]
		local renderer = self.Entity.SpriteRendererComponent
		if list ~= nil and renderer ~= nil and list[self.index] ~= nil then
			renderer.SpriteRUID = list[self.index]
		end
	end

	method string MapState(string s)
		local k = string.lower(s or "")
		if k == "idle" then
			return "stand"
		end
		if k == "dead" then
			return "die"
		end
		return k
	end

	method void OnUpdate(number delta)
		if self.frames == nil then
			return
		end
		if self.FollowStateComponent then
			local sc = self.Entity.StateComponent
			if sc ~= nil then
				local key = self:MapState(sc.CurrentStateName)
				if key ~= self.action and self.frames[key] ~= nil then
					self:Play(key)
				end
			end
		end
		local list = self.frames[self.action]
		if list == nil or self.finished then
			return
		end
		self.elapsed = self.elapsed + delta
		local step = 1 / math.max(1, self.Fps)
		local changed = false
		while self.elapsed >= step do
			self.elapsed = self.elapsed - step
			changed = true
			if self.index < #list then
				self.index = self.index + 1
			elseif string.find("," .. self.LoopActions .. ",", "," .. self.action .. ",", 1, true) ~= nil then
				self.index = 1
			else
				self.finished = true
			end
		end
		if changed then
			self:Apply()
		end
	end
end
`;
const canvasBlob=c=>new Promise(r=>c.toBlob(r,'image/png'));
function mswReadme(m,dirName){const acts=Object.entries(m.animations).map(([k,a])=>`| ${k} | ${a.frames.length} | ${a.loop?'วน':'เล่นครั้งเดียว'} | ${a.source} |`).join('\n');
return `# ${m.name} · สำหรับ MSW

ไฟล์ในชุดนี้
- frames/ — รูปทีละเฟรม ตั้งชื่อตาม action ของ MSW (เช่น stand_00.png)
- sheet.png — sprite sheet รวมทุกท่า (ไว้ดูหรือใช้กับเอนจินอื่น)
- forge-msw.json — ข้อมูลเฟรม ขนาด และช่อง "ruids" ไว้เติม RUID หลังอัปโหลด
- ForgeSpriteAnimator.mlua — คอมโพเนนต์เล่นแอนิเมชันด้วยการสลับ SpriteRUID ทีละเฟรม
- PROMPT-claude-code.txt — ข้อความสั่ง Claude Code ให้อัปโหลดและติดตั้งให้อัตโนมัติ

ขนาด: ช่องละ ${m.frameSize[0]}×${m.frameSize[1]} px = ${m.worldSize[0]}×${m.worldSize[1]} world unit (100 px = 1 unit) · ${m.fps} fps

| action | เฟรม | การเล่น | ท่าต้นทาง |
|---|---|---|---|
${acts}

## วิธีที่ 1 · อัตโนมัติด้วย Claude Code + msw-mcp (แนะนำ)
1. แตกไฟล์ zip นี้ไว้ในโฟลเดอร์โปรเจกต์ MSW ของคุณ เช่น \`import/${dirName}\`
2. เปิด Claude Code ในโปรเจกต์ MSW (ที่ตั้ง msw-mcp ไว้แล้ว)
3. คัดลอกข้อความใน PROMPT-claude-code.txt ไปสั่ง

## วิธีที่ 2 · ทำเองใน MSW Maker
1. อัปโหลดรูปทุกไฟล์ใน frames/ เป็น sprite ในคลังทรัพยากรของ Maker แล้วจด RUID ของแต่ละรูป
2. เพิ่มสคริปต์ ForgeSpriteAnimator.mlua ลงใน MyDesk แล้วใส่เป็นคอมโพเนนต์ของ Entity/Model
3. ตั้งค่า FrameTable เป็น \`stand=RUID1,RUID2,...;move=RUID...;attack=...\` ตามลำดับเฟรม
4. ตั้ง SpriteRendererComponent.SpriteRUID เป็นเฟรมแรกของ stand
5. ตัวละครจะลอยหรือจมถ้าจุดกึ่งกลางรูปไม่ตรงเท้า ให้ปรับตำแหน่ง sprite ขึ้น ${m.spriteOffsetY} unit (เท้าอยู่ต่ำกว่ากึ่งกลางรูป ${Math.round(m.spriteOffsetY*100)} px)

ถ้าใช้ StateComponent: สถานะ IDLE→stand, MOVE→move, HIT→hit, DEAD→die, ATTACK→attack จะสลับท่าให้เอง
`;}
function mswPrompt(m,dirName){return `ในโปรเจกต์ MSW นี้ มีชุดสไปรต์จาก MCR Character Studio อยู่ที่ import/${dirName} (อ่าน forge-msw.json ก่อน)

1. อัปโหลด PNG ทุกไฟล์ใน import/${dirName}/frames เป็น sprite resource ด้วย msw-mcp asset_create_resource_storage_item ตามขั้นตอนอัปโหลดของ skill msw-painter (category "sprite", subcategory "monster" หรือที่เหมาะสม, name ตามชื่อไฟล์) ห้ามแสดง presigned URL
2. เติม RUID ที่ได้ลงใน "ruids" ของ forge-msw.json ตามลำดับเฟรมของแต่ละ action
3. คัดลอก ForgeSpriteAnimator.mlua ไปไว้ที่ RootDesk/MyDesk/
4. สร้างหรือแก้ model "${m.name}" ให้มี SpriteRendererComponent (SpriteRUID = เฟรมแรกของ stand) และคอมโพเนนต์ ForgeSpriteAnimator โดยตั้ง FrameTable เป็น "action=ruid1,ruid2;..." จาก forge-msw.json, Fps = ${m.fps}
5. ขยับ sprite ขึ้น ${m.spriteOffsetY} world unit ให้เท้าอยู่ที่จุดกำเนิดของ entity
6. สรุปให้ฉันว่าได้ RUID กี่รายการ และ model อยู่ที่ไหน
`;}
async function exportMSW(){if(!window.JSZip)return toast('โหลดตัวสร้าง zip ไม่สำเร็จ · ลองรีเฟรชหน้า');if(!QR){await quickGenerate();if(!QR)return;}
  toast('กำลังรวมไฟล์สำหรับ MSW…');const ascii=(S.name||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''),base=ascii||'forge-character',dirName=base+'-msw',zip=new JSZip(),dir=zip.folder(dirName),fr=dir.folder('frames'),anims={},used={};
  for(const t of QR.types){let key=MSW_KEY[t]||t;if(used[key])key=key+'_'+t;used[key]=1;anims[key]={source:t,fps:QR.fps,loop:MSW_LOOP.includes(key),frames:[]};
    for(let i=0;i<QR.n;i++){const name=`${key}_${String(i).padStart(2,'0')}.png`;fr.file(name,await canvasBlob(QR.frames[t][i]));anims[key].frames.push('frames/'+name);}}
  dir.file('sheet.png',await canvasBlob(QR.sheet));
  const m={format:'forge-msw',version:1,name:S.name,frameSize:[QR.cell,QR.cell],pixelsPerUnit:100,worldSize:[QR.cell/100,QR.cell/100],fps:QR.fps,pixelArt:QR.pixel,
    spriteOffsetY:+((QR.feet-.5)*QR.cell/100).toFixed(3),animations:anims,ruids:Object.fromEntries(Object.entries(anims).map(([k,a])=>[k,a.frames.map(()=>'')])),
    frameTableTemplate:Object.entries(anims).map(([k,a])=>k+'='+a.frames.map((_,i)=>`<${k}_${String(i).padStart(2,'0')}>`).join(',')).join(';')};
  dir.file('forge-msw.json',JSON.stringify(m,null,1));dir.file('ForgeSpriteAnimator.mlua',MSW_MLUA);dir.file('README-MSW.md',mswReadme(m,dirName));dir.file('PROMPT-claude-code.txt',mswPrompt(m,dirName));
  const blob=await zip.generateAsync({type:'blob'});saveFile(dirName+'.zip',blob);return{m,blob};}
