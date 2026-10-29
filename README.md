# MCR Character Studio

เว็บสร้างตัวละคร 2D สำหรับเกม: สไปรต์จากรูป, แยกชิ้นส่วน + ต่อกระดูก, แอนิเมชัน, VFX และส่งออก (sprite sheet, rig JSON, ชุดไฟล์ MSW)

| หน้า | ไฟล์ |
|---|---|
| MCR Character Studio | `index.html` |
| VFX Forge Studio (สร้างเอฟเฟกต์อย่างเดียว) | `vfx.html` |

## ไฟล์ในโฟลเดอร์
- `index.html` — หน้าหลัก
- `studio-core.js` — กระดูก, mesh, ตัดชิ้นส่วน, ท่าทาง
- `vfx-engine.js` — ระบบเอฟเฟกต์ (ใช้ร่วมทั้งสองหน้า)
- `char-sample.js` — ตัวละครนินจาตัวอย่าง
- `msw-export.js` — ส่งออกชุดไฟล์สำหรับ MSW
- `vfx.html` + `samples.js` — หน้า VFX Forge Studio และรูปตัวอย่าง
- `.nojekyll` — บอก GitHub Pages ให้เสิร์ฟไฟล์ตามเดิม

ไลบรารี three.js และ JSZip โหลดจาก CDN จึงต้องต่ออินเทอร์เน็ต

## เอาขึ้น GitHub Pages
1. สร้าง repository ใหม่บน github.com (Public)
2. **Add file → Upload files** ลากไฟล์ทั้งหมดในโฟลเดอร์นี้ (รวม `.nojekyll`) แล้ว **Commit changes**
3. **Settings → Pages** → Source: **Deploy from a branch**, branch `main`, โฟลเดอร์ `/ (root)` → Save
4. รอ 1–2 นาที แล้วเปิด `https://<ชื่อผู้ใช้>.github.io/<ชื่อ repository>/`

## ต่างจากเวอร์ชันใน claude.ai
- ผู้ช่วย AI เรียก Claude ไม่ได้ ใช้ได้เฉพาะคำสั่งที่ทำในเครื่อง (เช่น "ผมสีแดง", "วิ่งเร็ว", "pixel art 32 px")
- ปุ่มดาวน์โหลดใช้การดาวน์โหลดปกติของเบราว์เซอร์
- งานที่บันทึกอัตโนมัติเก็บในเบราว์เซอร์ของแต่ละคน
