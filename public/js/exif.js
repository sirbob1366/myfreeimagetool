/* exif.js — dependency-free EXIF reader + lossless metadata stripper.
   ExifTool.parse(arrayBuffer)  -> { present, tags: [{tag, value}], gps: {lat, lon} | null,
                                     camera, date, orientation, software }
   ExifTool.stripJpeg(buffer)   -> Blob  (drops APP1/2/13/COM segments, keeps pixels untouched)
   ExifTool.stripPng(buffer)    -> Blob  (drops tEXt/zTXt/iTXt/eXIf/tIME chunks)
*/
(function () {
  'use strict';

  const TAG_NAMES = {
    0x010f: 'Camera make', 0x0110: 'Camera model', 0x0112: 'Orientation',
    0x011a: 'X resolution', 0x011b: 'Y resolution', 0x0131: 'Software',
    0x0132: 'Modified', 0x013b: 'Artist', 0x8298: 'Copyright',
    0x829a: 'Exposure time', 0x829d: 'F-number', 0x8822: 'Exposure program',
    0x8827: 'ISO', 0x9003: 'Taken', 0x9004: 'Digitized',
    0x9201: 'Shutter speed', 0x9202: 'Aperture', 0x9204: 'Exposure bias',
    0x9206: 'Subject distance', 0x9207: 'Metering mode', 0x9208: 'Light source',
    0x9209: 'Flash', 0x920a: 'Focal length', 0xa002: 'Pixel width',
    0xa003: 'Pixel height', 0xa403: 'White balance', 0xa405: 'Focal length (35mm)',
    0xa406: 'Scene type', 0xa408: 'Contrast', 0xa409: 'Saturation', 0xa40a: 'Sharpness',
    0x9286: 'User comment', 0xa430: 'Owner', 0xa431: 'Camera serial', 0xa432: 'Lens specs',
    0xa433: 'Lens make', 0xa434: 'Lens model', 0xa435: 'Lens serial'
  };
  const GPS_NAMES = {
    1: 'GPS latitude ref', 2: 'GPS latitude', 3: 'GPS longitude ref', 4: 'GPS longitude',
    5: 'GPS altitude ref', 6: 'GPS altitude', 7: 'GPS timestamp', 29: 'GPS date'
  };
  const ORIENTATIONS = {
    1: 'Normal', 2: 'Mirrored', 3: 'Rotated 180°', 4: 'Mirrored + 180°',
    5: 'Mirrored + 270°', 6: 'Rotated 90° CW', 7: 'Mirrored + 90°', 8: 'Rotated 270° CW'
  };

  function readValue(view, tiffStart, entryOff, little) {
    const type = view.getUint16(entryOff + 2, little);
    const count = view.getUint32(entryOff + 4, little);
    const SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
    const size = (SIZES[type] || 1) * count;
    let off = entryOff + 8;
    if (size > 4) off = tiffStart + view.getUint32(entryOff + 8, little);
    if (off + size > view.byteLength) return null;

    try {
      if (type === 2) { // ASCII
        let s = '';
        for (let i = 0; i < count - 1; i++) s += String.fromCharCode(view.getUint8(off + i));
        return s.trim() || null;
      }
      if (type === 3) return count === 1 ? view.getUint16(off, little)
        : Array.from({ length: Math.min(count, 8) }, (_, i) => view.getUint16(off + i * 2, little));
      if (type === 4) return count === 1 ? view.getUint32(off, little)
        : Array.from({ length: Math.min(count, 8) }, (_, i) => view.getUint32(off + i * 4, little));
      if (type === 5 || type === 10) { // rational
        const get = i => {
          const n = type === 5 ? view.getUint32(off + i * 8, little) : view.getInt32(off + i * 8, little);
          const d = type === 5 ? view.getUint32(off + i * 8 + 4, little) : view.getInt32(off + i * 8 + 4, little);
          return d ? n / d : 0;
        };
        return count === 1 ? get(0) : Array.from({ length: Math.min(count, 4) }, (_, i) => get(i));
      }
      if (type === 1 || type === 7) return count === 1 ? view.getUint8(off) : '(' + count + ' bytes)';
      if (type === 9) return view.getInt32(off, little);
    } catch (e) { return null; }
    return null;
  }

  function parseIfd(view, tiffStart, ifdOff, little, names, out, follow) {
    if (tiffStart + ifdOff + 2 > view.byteLength) return;
    const n = view.getUint16(tiffStart + ifdOff, little);
    for (let i = 0; i < n; i++) {
      const e = tiffStart + ifdOff + 2 + i * 12;
      if (e + 12 > view.byteLength) break;
      const tag = view.getUint16(e, little);
      if (follow && tag === 0x8769) { // EXIF sub-IFD
        parseIfd(view, tiffStart, view.getUint32(e + 8, little), little, TAG_NAMES, out, false);
        continue;
      }
      if (follow && tag === 0x8825) { // GPS IFD
        parseIfd(view, tiffStart, view.getUint32(e + 8, little), little, GPS_NAMES, out.gpsRaw = out.gpsRaw || {}, false);
        continue;
      }
      const name = names[tag];
      const value = readValue(view, tiffStart, e, little);
      if (name && value != null && value !== '') {
        if (names === GPS_NAMES) out[tag] = value;
        else out.tags.push({ tag: name, value, id: tag });
      }
    }
  }

  function dmsToDec(dms, ref) {
    if (!Array.isArray(dms) || dms.length < 3) return null;
    let d = dms[0] + dms[1] / 60 + dms[2] / 3600;
    if (ref === 'S' || ref === 'W') d = -d;
    return Math.round(d * 1e6) / 1e6;
  }

  function parse(buffer) {
    const view = new DataView(buffer);
    const result = { present: false, tags: [], gps: null, camera: null, date: null, orientation: null, software: null };
    if (view.byteLength < 4) return result;

    // Find the EXIF TIFF block: JPEG APP1 or PNG eXIf chunk.
    let tiffStart = -1;
    if (view.getUint16(0) === 0xffd8) { // JPEG
      let o = 2;
      while (o + 4 < view.byteLength) {
        if (view.getUint8(o) !== 0xff) break;
        const marker = view.getUint8(o + 1);
        const len = view.getUint16(o + 2);
        if (marker === 0xe1 && o + 10 < view.byteLength &&
            view.getUint32(o + 4) === 0x45786966 /* "Exif" */) { tiffStart = o + 10; break; }
        if (marker === 0xda) break; // start of scan
        o += 2 + len;
      }
    } else if (view.getUint32(0) === 0x89504e47) { // PNG
      let o = 8;
      while (o + 8 < view.byteLength) {
        const len = view.getUint32(o);
        const type = view.getUint32(o + 4);
        if (type === 0x65584966 /* eXIf */) { tiffStart = o + 8; break; }
        if (type === 0x49454e44 /* IEND */) break;
        o += 12 + len;
      }
    }
    if (tiffStart < 0 || tiffStart + 8 > view.byteLength) return result;

    const byteOrder = view.getUint16(tiffStart);
    const little = byteOrder === 0x4949;
    if (!little && byteOrder !== 0x4d4d) return result;

    const out = { tags: [], gpsRaw: null };
    parseIfd(view, tiffStart, view.getUint32(tiffStart + 4, little), little, TAG_NAMES, out, true);

    result.present = out.tags.length > 0 || !!out.gpsRaw;
    result.tags = out.tags;
    const find = name => { const t = out.tags.find(t => t.tag === name); return t ? t.value : null; };
    const make = find('Camera make'), model = find('Camera model');
    result.camera = model ? ((make && !String(model).startsWith(make) ? make + ' ' : '') + model) : make;
    result.date = find('Taken') || find('Modified');
    result.software = find('Software');
    const ori = find('Orientation');
    if (ori) result.orientation = ORIENTATIONS[ori] || String(ori);
    if (out.gpsRaw && out.gpsRaw[2] && out.gpsRaw[4]) {
      const lat = dmsToDec(out.gpsRaw[2], out.gpsRaw[1]);
      const lon = dmsToDec(out.gpsRaw[4], out.gpsRaw[3]);
      if (lat != null && lon != null) result.gps = { lat, lon };
    }
    return result;
  }

  // ---------- Lossless strippers ----------
  function stripJpeg(buffer) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    if (view.getUint16(0) !== 0xffd8) return null;
    const parts = [bytes.subarray(0, 2)];
    let o = 2;
    while (o + 4 <= bytes.length) {
      if (view.getUint8(o) !== 0xff) break;
      const marker = view.getUint8(o + 1);
      if (marker === 0xda) { parts.push(bytes.subarray(o)); break; } // scan: copy the rest
      const len = view.getUint16(o + 2);
      const seg = bytes.subarray(o, o + 2 + len);
      // Drop metadata: APP1 (EXIF/XMP), APP2 (ICC kept!), APP13 (IPTC), COM.
      const isMeta = marker === 0xe1 || marker === 0xed || marker === 0xfe;
      const isApp2NonIcc = marker === 0xe2 &&
        !(len > 14 && String.fromCharCode(...bytes.subarray(o + 4, o + 15)) === 'ICC_PROFILE');
      if (!isMeta && !isApp2NonIcc) parts.push(seg);
      o += 2 + len;
    }
    return new Blob(parts, { type: 'image/jpeg' });
  }

  function stripPng(buffer) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    if (view.getUint32(0) !== 0x89504e47) return null;
    const DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
    const parts = [bytes.subarray(0, 8)];
    let o = 8;
    while (o + 8 <= bytes.length) {
      const len = view.getUint32(o);
      const type = String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7]);
      const total = 12 + len;
      if (!DROP.has(type)) parts.push(bytes.subarray(o, o + total));
      if (type === 'IEND') break;
      o += total;
    }
    return new Blob(parts, { type: 'image/png' });
  }

  window.ExifTool = { parse, stripJpeg, stripPng };
})();
