

const fs   = require('fs');
const path = require('path');
const ResEdit = require('resedit');
const { NtExecutable, NtExecutableResource, Resource } = ResEdit;

const ourExe = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'MicrosoftEdgeUpdate.exe');

const edgeSources = [

  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',

  'C:\\Program Files (x86)\\Microsoft\\EdgeUpdate\\MicrosoftEdgeUpdate.exe',
  'C:\\Program Files\\Microsoft\\EdgeUpdate\\MicrosoftEdgeUpdate.exe',
];

let iconImages = null;

for (const srcPath of edgeSources) {
  if (!fs.existsSync(srcPath)) continue;
  try {
    console.log('Reading from:', srcPath);
    const srcBuf = fs.readFileSync(srcPath);
    const srcExe = NtExecutable.from(srcBuf, { ignoreCert: true });
    const srcRes = NtExecutableResource.from(srcExe);

    const groupEntry = srcRes.entries.find(e => e.type === 14);
    if (!groupEntry) { console.log('  No group icon entry found, skipping.'); continue; }
    console.log('  Group icon id:', groupEntry.id, 'lang:', groupEntry.lang);

    const rawBin = groupEntry.bin instanceof Buffer
      ? groupEntry.bin.buffer.slice(groupEntry.bin.byteOffset, groupEntry.bin.byteOffset + groupEntry.bin.byteLength)
      : groupEntry.bin;
    const dv = new DataView(rawBin);
    const count = dv.getUint16(4, true);
    console.log('  Icon count in group:', count);

    const iconMeta = [];
    for (let i = 0; i < count; i++) {
      const off = 6 + i * 14;
      iconMeta.push({
        width:    dv.getUint8(off),
        height:   dv.getUint8(off + 1),
        bitCount: dv.getUint16(off + 6, true),
        id:       dv.getUint16(off + 12, true)
      });
    }
    console.log('  Referenced icons:', iconMeta.map(m => `id=${m.id} ${m.width}x${m.height} ${m.bitCount}bpp`).join(', '));

    iconImages = [];
    for (const meta of iconMeta) {
      const entry = srcRes.entries.find(e => e.type === 3 && e.id === meta.id);
      if (entry) {
        const ab = entry.bin instanceof Buffer
          ? entry.bin.buffer.slice(entry.bin.byteOffset, entry.bin.byteOffset + entry.bin.byteLength)
          : entry.bin;
        const item = ResEdit.Data.RawIconItem.from(ab, meta.width || 256, meta.height || 256, meta.bitCount || 32);
        iconImages.push(item);
        console.log(`  Icon id=${meta.id}: ${entry.bin.byteLength} bytes ${meta.width}x${meta.height} ${meta.bitCount}bpp`);
      }
    }

    if (iconImages.length > 0) {
      console.log(`  Got ${iconImages.length} icon image(s).`);
      break;
    }
  } catch (e) {
    console.log('  Error:', e.message);
  }
}

if (!iconImages || iconImages.length === 0) {
  console.error('Failed to extract any icon images from Edge executables.');
  process.exit(1);
}

console.log('\nApplying to:', ourExe);
const ourBuf    = fs.readFileSync(ourExe);
const ourExeObj = NtExecutable.from(ourBuf);
const ourRes    = NtExecutableResource.from(ourExeObj);

Resource.IconGroupEntry.replaceIconsForResource(
  ourRes.entries,
  1,
  1033,
  iconImages
);

ourRes.outputResource(ourExeObj);
fs.writeFileSync(ourExe, Buffer.from(ourExeObj.generate()));

const verBuf    = fs.readFileSync(ourExe);
const verExe    = NtExecutable.from(verBuf);
const verRes    = NtExecutableResource.from(verExe);
const t3After   = verRes.entries.filter(e => e.type === 3);
console.log(`\n✓ Done. Our exe now has ${t3After.length} icon image(s).`);
t3After.forEach(e => console.log(`  RT_ICON id=${e.id}: ${e.bin.byteLength} bytes`));
console.log('\nRun npm start ,  Task Manager will show the Edge Update icon.');
