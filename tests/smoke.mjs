/**
 * Browser smoke test for all image tools.
 * Run: node tests/smoke.mjs  (expects `astro preview` running on :4321,
 * or pass a base URL as the first argument).
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:4321';

let failures = 0;
function check(name, condition, detail = '') {
	if (condition) {
		console.log(`  PASS  ${name}`);
	} else {
		failures++;
		console.log(`  FAIL  ${name} ${detail}`);
	}
}

/** Build a 240x160 test PNG in-page: left half red, right half blue. */
async function makeTestImage(page) {
	const dataUrl = await page.evaluate(() => {
		const c = document.createElement('canvas');
		c.width = 240;
		c.height = 160;
		const x = c.getContext('2d');
		x.fillStyle = '#ff0000';
		x.fillRect(0, 0, 120, 160);
		x.fillStyle = '#0000ff';
		x.fillRect(120, 0, 120, 160);
		return c.toDataURL('image/png');
	});
	return Buffer.from(dataUrl.split(',')[1], 'base64');
}

async function uploadImage(page) {
	const buffer = await makeTestImage(page);
	await page.setInputFiles('#file-input', {
		name: 'test.png',
		mimeType: 'image/png',
		buffer,
	});
	await page.waitForSelector('#editor:not([hidden])', { timeout: 5000 });
}

/** Read one pixel from the visible canvas. */
function pixelAt(page, x, y) {
	return page.evaluate(
		([px, py]) => {
			const canvas = document.getElementById('canvas');
			const data = canvas
				.getContext('2d')
				.getImageData(px, py, 1, 1).data;
			return Array.from(data);
		},
		[x, y],
	);
}

function canvasSize(page) {
	return page.evaluate(() => {
		const canvas = document.getElementById('canvas');
		return { w: canvas.width, h: canvas.height };
	});
}

async function expectDownload(page, name) {
	const downloadPromise = page
		.waitForEvent('download', { timeout: 8000 })
		.catch(() => null);
	await page.click('#download-btn');
	const download = await downloadPromise;
	check(`${name}: download produced a file`, download !== null);
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

const consoleErrors = [];
page.on('pageerror', (err) => consoleErrors.push(String(err)));
page.on('console', (msg) => {
	if (msg.type() === 'error') consoleErrors.push(msg.text());
});

// ---------- Homepage (restored old site) ----------
console.log('home');
await page.goto(`${BASE}/`);
check(
	'home: MyFreeImageTool homepage loads',
	(await page.title()).includes('MyFreeImageTool'),
);
check('home: hero renders', await page.locator('.hero-title').isVisible());
check(
	'home: 15 tool tiles (8 old + 7 new)',
	(await page.locator('.tile').count()) === 15,
	`count=${await page.locator('.tile').count()}`,
);
for (const href of [
	'/adjust/',
	'/filters/',
	'/text/',
	'/shapes/',
	'/crop/',
	'/resize/',
	'/remove-background/',
	'/editor/',
	'/compress-image/',
]) {
	check(
		`home: links to ${href}`,
		(await page.locator(`a[href="${href}"]`).count()) > 0,
	);
}
check('home: FAQ section present', (await page.locator('#faq').count()) === 1);

// ---------- Old site pages still serve ----------
console.log('old pages');
for (const path of [
	'/editor/',
	'/compress-image/',
	'/resize-image/',
	'/convert-image/',
	'/crop-image/',
	'/rotate-image/',
	'/add-watermark/',
	'/image-to-pdf/',
	'/blur-background/',
	'/about/',
	'/privacy/',
	'/terms/',
	'/contact/',
]) {
	const res = await page.goto(`${BASE}${path}`);
	check(`old page ${path} returns 200`, res !== null && res.status() === 200);
}
// The old editor should boot without errors.
await page.goto(`${BASE}/editor/`);
await page.waitForTimeout(400);
check(
	'old editor page renders its UI',
	(await page.locator('canvas, #file-input, input[type=file]').count()) > 0,
);
const oldSiteErrors = consoleErrors.length;
check(
	'old pages load without console errors',
	oldSiteErrors === 0,
	consoleErrors.slice(0, 5).join(' | '),
);

// ---------- Editor: text on image, draw, eraser, undo/redo/reset ----------
console.log('editor tools');
await page.goto(`${BASE}/editor/`);
{
	const buffer = await makeTestImage(page);
	await page.setInputFiles('#file-input', {
		name: 'test.png',
		mimeType: 'image/png',
		buffer,
	});
	await page.waitForSelector('#image-stage', { state: 'visible' });

	const ePixel = (x, y) =>
		page.evaluate(
			([px, py]) => {
				const c = document.getElementById('img-canvas');
				return Array.from(
					c.getContext('2d').getImageData(px, py, 1, 1).data,
				);
			},
			[x, y],
		);
	const hasWhiteInRegion = () =>
		page.evaluate(() => {
			const c = document.getElementById('img-canvas');
			const d = c.getContext('2d').getImageData(15, 55, 140, 50).data;
			for (let i = 0; i < d.length; i += 4) {
				if (d[i] > 220 && d[i + 1] > 220 && d[i + 2] > 220) return true;
			}
			return false;
		});

	// --- Text tool: type directly on the image ---
	await page.click('[data-tool="text"]');
	await page.waitForSelector('#tx-live');
	check('editor: live text box on image', await page.locator('#tx-live').isVisible());
	check(
		'editor: 14 fonts available',
		(await page.locator('#tx-font option').count()) === 14,
		`count=${await page.locator('#tx-font option').count()}`,
	);
	check(
		'editor: font size slider present',
		(await page.locator('#tx-size[type=range]').count()) === 1,
	);
	await page.waitForTimeout(300);
	await page.keyboard.type('HELLO');
	await page.waitForTimeout(150);
	const sideVal = await page.locator('#tx-text').inputValue();
	check(
		'editor: typing on image syncs to sidebar',
		sideVal === 'HELLO',
		`side="${sideVal}"`,
	);
	await page.click('#tx-go');
	await page.waitForTimeout(700);
	check('editor: applied text baked into image', await hasWhiteInRegion());
	check(
		'editor: undo enabled after apply',
		!(await page.locator('#undo-btn').isDisabled()),
	);
	await page.click('#undo-btn');
	await page.waitForTimeout(500);
	check('editor: undo removes applied text', !(await hasWhiteInRegion()));

	// --- Draw + eraser ---
	await page.click('[data-tool="draw"]');
	await page.waitForSelector('#d-color');
	await page.locator('#d-color').fill('#00ff00');
	const box = await page.locator('#img-canvas').boundingBox();
	const yMid = box.y + box.height / 2;
	async function dragAcross() {
		await page.mouse.move(box.x + box.width * 0.25, yMid);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width * 0.4, yMid, { steps: 6 });
		await page.mouse.up();
		await page.waitForTimeout(150);
	}
	await dragAcross();
	const strokePixel = await ePixel(78, 80);
	check(
		'editor: brush stroke drawn',
		strokePixel[1] > 200 && strokePixel[0] < 80,
		`pixel=${strokePixel}`,
	);

	await page.click('[data-mode="erase"]');
	await dragAcross();
	const erasedPixel = await ePixel(78, 80);
	check(
		'editor: eraser removes stroke',
		erasedPixel[0] > 200 && erasedPixel[1] < 60,
		`pixel=${erasedPixel}`,
	);

	await page.click('#undo-btn'); // undo the erase -> stroke comes back
	await page.waitForTimeout(400);
	const undoneErase = await ePixel(78, 80);
	check(
		'editor: undo restores erased stroke',
		undoneErase[1] > 200,
		`pixel=${undoneErase}`,
	);

	await page.click('#redo-btn'); // redo the erase
	await page.waitForTimeout(400);
	const redone = await ePixel(78, 80);
	check(
		'editor: redo re-applies erase',
		redone[0] > 200 && redone[1] < 60,
		`pixel=${redone}`,
	);

	// --- Reset clears drawings ---
	await page.click('[data-mode="brush"]');
	await dragAcross();
	await page.click('#reset-btn');
	await page.waitForTimeout(500);
	const resetPx = await ePixel(78, 80);
	check(
		'editor: reset clears drawings',
		resetPx[0] > 200 && resetPx[1] < 60,
		`pixel=${resetPx}`,
	);
	check(
		'editor: undo disabled after reset',
		await page.locator('#undo-btn').isDisabled(),
	);

	// --- Preview-style toolbar present ---
	check(
		'editor: top toolbar with 18 tools',
		(await page.locator('.editor-topbar .tool-btn').count()) === 18,
		`count=${await page.locator('.editor-topbar .tool-btn').count()}`,
	);

	// --- Universal converter: GIF/BMP/ICO encode then re-decode ---
	for (const fmt of [
		{ mime: 'image/gif', name: 'GIF' },
		{ mime: 'image/bmp', name: 'BMP' },
		{ mime: 'image/x-icon', name: 'ICO' },
		{ mime: 'image/tiff', name: 'TIFF' },
	]) {
		const result = await page.evaluate(async (mime) => {
			const c = document.createElement('canvas');
			c.width = 60; c.height = 40;
			const x = c.getContext('2d');
			x.fillStyle = '#ff0000'; x.fillRect(0, 0, 30, 40);
			x.fillStyle = '#0000ff'; x.fillRect(30, 0, 30, 40);
			const blob = await new Promise(r => c.toBlob(r, 'image/png'));
			const src = await ImageEngine.loadImage(new File([blob], 't.png', { type: 'image/png' }));
			const out = await ImageEngine.convert(src, { mime });
			if (!out || out.size < 50) return { ok: false, why: 'empty output' };
			if (mime === 'image/tiff') return { ok: out.type === 'image/tiff', why: 'tiff produced ' + out.size + 'B' };
			// re-decode and check a pixel from each half
			const back = await ImageEngine.loadImage(new File([out], 't', { type: out.type }));
			const c2 = document.createElement('canvas');
			c2.width = back.width; c2.height = back.height;
			const x2 = c2.getContext('2d');
			x2.drawImage(back.img, 0, 0);
			// ICO is square-fit; sample relative positions inside the drawn area
			const lx = Math.round(back.width * 0.25), rx = Math.round(back.width * 0.75);
			const my = Math.round(back.height * 0.5);
			const L = x2.getImageData(lx, my, 1, 1).data;
			const R = x2.getImageData(rx, my, 1, 1).data;
			return {
				ok: L[0] > 180 && L[2] < 90 && R[2] > 180 && R[0] < 90,
				why: `L=${[...L]} R=${[...R]}`,
			};
		}, fmt.mime);
		check(`converter: ${fmt.name} round-trip`, result.ok, result.why);
	}

	// --- Adjust panel: presets + new sliders ---
	await page.click('[data-tool="filters"]');
	await page.waitForSelector('#f-presets');
	check(
		'editor: 7 filter presets',
		(await page.locator('#f-presets button').count()) === 7,
	);
	check(
		'editor: temperature/hue/blur/vignette sliders',
		(await page.locator('#f-te, #f-hu, #f-bl, #f-vg').count()) === 4,
	);
	await page.locator('#f-presets button', { hasText: 'Noir' }).click();
	await page.waitForTimeout(250);
	const noirPixel = await ePixel(60, 80);
	check(
		'editor: Noir preset previews grayscale',
		noirPixel[0] === noirPixel[1] && noirPixel[1] === noirPixel[2],
		`pixel=${noirPixel}`,
	);

	// --- Frame tool ---
	await page.click('[data-tool="frame"]');
	await page.waitForSelector('#fr-go');
	await page.locator('#fr-c').fill('#00ff00');
	await page.click('#fr-go');
	await page.waitForTimeout(600);
	const framedSize = await page.evaluate(() => {
		const c = document.getElementById('img-canvas');
		return { w: c.width, h: c.height };
	});
	check(
		'editor: frame grows canvas by border',
		framedSize.w > 240 && framedSize.h > 160,
		JSON.stringify(framedSize),
	);
	// switch tools to clear the frame tool's live preview overlay
	await page.click('[data-tool="layers"]');
	await page.waitForTimeout(200);
	const borderPixel = await ePixel(2, 2);
	check(
		'editor: frame border colour applied',
		borderPixel[1] > 200 && borderPixel[0] < 80,
		`pixel=${borderPixel}`,
	);
	await page.click('#reset-btn');
	await page.waitForTimeout(400);

	// --- Insert image tool ---
	await page.click('[data-tool="insert"]');
	await page.waitForSelector('#ins-pick');
	const insertBuffer = await page.evaluate(() => {
		const c = document.createElement('canvas');
		c.width = 40; c.height = 40;
		const x = c.getContext('2d');
		x.fillStyle = '#ffff00'; x.fillRect(0, 0, 40, 40);
		return c.toDataURL('image/png').split(',')[1];
	});
	await page.setInputFiles('#insert-image-input', {
		name: 'overlay.png',
		mimeType: 'image/png',
		buffer: Buffer.from(insertBuffer, 'base64'),
	});
	await page.waitForTimeout(400);
	const insertedPixel = await ePixel(120, 80);
	check(
		'editor: inserted image drawn at center',
		insertedPixel[0] > 200 && insertedPixel[1] > 200 && insertedPixel[2] < 80,
		`pixel=${insertedPixel}`,
	);
	check(
		'editor: insert is undoable',
		!(await page.locator('#undo-btn').isDisabled()),
	);
	await page.click('#undo-btn');
	await page.waitForTimeout(300);
	const afterInsertUndo = await ePixel(120, 80);
	check(
		'editor: undo removes inserted image',
		!(afterInsertUndo[0] > 200 && afterInsertUndo[1] > 200),
		`pixel=${afterInsertUndo}`,
	);

	// --- Crop aspect presets present ---
	await page.click('[data-tool="crop"]');
	await page.waitForSelector('#crop-aspect');
	check(
		'editor: crop aspect presets',
		(await page.locator('#crop-aspect button').count()) === 5,
	);
}

// ---------- Adjust ----------
console.log('adjust');
await page.goto(`${BASE}/adjust`);
await uploadImage(page);
// Use 50% brightness: 150% can't change a pure-red pixel (already maxed).
await page.locator('#brightness').fill('50');
await page.locator('#brightness').dispatchEvent('input');
await page.waitForTimeout(150);
const afterAdjust = await pixelAt(page, 10, 10);
check(
	'adjust: brightness 50% darkens red pixel',
	afterAdjust[0] > 100 && afterAdjust[0] < 160,
	`pixel=${afterAdjust}`,
);
await page.locator('#brightness').fill('100');
await page.locator('#brightness').dispatchEvent('input');
await page.locator('#temperature').fill('80');
await page.locator('#temperature').dispatchEvent('input');
await page.waitForTimeout(150);
const warmPixel = await pixelAt(page, 130, 10); // blue half
check('adjust: temperature warms blue half', warmPixel[0] > 0);
await page.click('#reset-btn');
await page.waitForTimeout(150);
const resetPixel = await pixelAt(page, 10, 10);
check(
	'adjust: reset restores original',
	resetPixel[0] === 255 && resetPixel[2] === 0,
	`pixel=${resetPixel}`,
);
await expectDownload(page, 'adjust');

// ---------- Filters ----------
console.log('filters');
await page.goto(`${BASE}/filters`);
await uploadImage(page);
check(
	'filters: 12 preset thumbnails',
	(await page.locator('.preset').count()) === 12,
);
await page.locator('.preset', { hasText: 'Grayscale' }).click();
await page.waitForTimeout(150);
const grayPixel = await pixelAt(page, 10, 10);
check(
	'filters: grayscale makes R=G=B',
	grayPixel[0] === grayPixel[1] && grayPixel[1] === grayPixel[2],
	`pixel=${grayPixel}`,
);
await page.locator('#intensity').fill('0');
await page.locator('#intensity').dispatchEvent('input');
await page.waitForTimeout(150);
const intensityZero = await pixelAt(page, 10, 10);
check(
	'filters: intensity 0 restores original',
	intensityZero[0] === 255 && intensityZero[1] === 0,
	`pixel=${intensityZero}`,
);
await expectDownload(page, 'filters');

// ---------- Text ----------
console.log('text');
await page.goto(`${BASE}/text`);
await uploadImage(page);
await page.click('#add-text-btn');
check(
	'text: controls appear',
	await page.locator('#text-controls').isVisible(),
);
check(
	'text: layer listed',
	(await page.locator('.layer-item').count()) === 1,
);
await page.locator('#text-content').fill('HELLO');
await page.waitForTimeout(100);
// White text near center: scan the central region for any near-white pixel
// (a single point can land in the gap between letters).
const hasWhite = await page.evaluate(() => {
	const canvas = document.getElementById('canvas');
	const data = canvas.getContext('2d').getImageData(80, 65, 80, 30).data;
	for (let i = 0; i < data.length; i += 4) {
		if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) return true;
	}
	return false;
});
check('text: white text drawn near center', hasWhite);
// Drag the text layer.
const stage = await page.locator('#canvas').boundingBox();
await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
await page.mouse.down();
await page.mouse.move(
	stage.x + stage.width / 2 + 40,
	stage.y + stage.height / 2 + 20,
	{ steps: 5 },
);
await page.mouse.up();
check('text: drag did not crash', consoleErrors.length === 0);
await expectDownload(page, 'text');

// ---------- Shapes ----------
console.log('shapes');
await page.goto(`${BASE}/shapes`);
await uploadImage(page);
await page.click('[data-shape="rect"]');
check(
	'shapes: controls appear',
	await page.locator('#shape-controls').isVisible(),
);
await page.waitForTimeout(100);
const rectPixel = await pixelAt(page, 120, 80);
// Default fill is #4f46e5.
check(
	'shapes: blue rectangle drawn at center',
	Math.abs(rectPixel[0] - 0x4f) < 12 &&
		Math.abs(rectPixel[1] - 0x46) < 12 &&
		Math.abs(rectPixel[2] - 0xe5) < 12,
	`pixel=${rectPixel}`,
);
await page.click('[data-shape="arrow"]');
check(
	'shapes: two layers listed',
	(await page.locator('.layer-item').count()) === 2,
);
// Delete the arrow.
await page.locator('.layer-item .layer-del').nth(1).click();
check(
	'shapes: delete removes layer',
	(await page.locator('.layer-item').count()) === 1,
);
await expectDownload(page, 'shapes');

// ---------- Crop ----------
console.log('crop');
await page.goto(`${BASE}/crop`);
await uploadImage(page);
const sizeBefore = await canvasSize(page);
check(
	'crop: canvas matches image',
	sizeBefore.w === 240 && sizeBefore.h === 160,
	JSON.stringify(sizeBefore),
);
await page.click('#apply-btn');
await page.waitForTimeout(100);
const sizeAfter = await canvasSize(page);
check(
	'crop: apply crops to 80% selection',
	sizeAfter.w === 192 && sizeAfter.h === 128,
	JSON.stringify(sizeAfter),
);
await page.click('#undo-btn');
await page.waitForTimeout(100);
const sizeReset = await canvasSize(page);
check(
	'crop: reset restores original size',
	sizeReset.w === 240 && sizeReset.h === 160,
	JSON.stringify(sizeReset),
);
// Square aspect.
await page.click('[data-aspect="1"]');
await page.click('#apply-btn');
await page.waitForTimeout(100);
const sizeSquare = await canvasSize(page);
check(
	'crop: 1:1 aspect produces square',
	sizeSquare.w === sizeSquare.h,
	JSON.stringify(sizeSquare),
);
await expectDownload(page, 'crop');

// ---------- Resize ----------
console.log('resize');
await page.goto(`${BASE}/resize`);
await uploadImage(page);
await page.locator('#out-width').fill('120');
await page.locator('#out-width').dispatchEvent('input');
await page.waitForTimeout(100);
const resized = await canvasSize(page);
check(
	'resize: width 120 with locked aspect gives 120x80',
	resized.w === 120 && resized.h === 80,
	JSON.stringify(resized),
);
await page.click('#rotate-right');
await page.waitForTimeout(100);
const rotated = await canvasSize(page);
check(
	'resize: rotate swaps dimensions',
	rotated.w === 80 && rotated.h === 120,
	JSON.stringify(rotated),
);
// After one clockwise rotation, the left (red) half should be on top.
const topPixel = await pixelAt(page, 40, 10);
check(
	'resize: rotation orients red half on top',
	topPixel[0] > 200 && topPixel[2] < 50,
	`pixel=${topPixel}`,
);
await page.click('#flip-v');
await page.waitForTimeout(100);
const flipped = await pixelAt(page, 40, 10);
check(
	'resize: vertical flip moves blue half on top',
	flipped[2] > 200 && flipped[0] < 50,
	`pixel=${flipped}`,
);
await expectDownload(page, 'resize');

// ---------- Remove background (static page: AI + color + brush) ----------
console.log('remove-background');
await page.goto(`${BASE}/remove-background/`);
{
	const buffer = await makeTestImage(page);
	await page.setInputFiles('#file-input', {
		name: 'test.png',
		mimeType: 'image/png',
		buffer,
	});
	await page.waitForSelector('#editor', { state: 'visible', timeout: 5000 });
}
await page.click('[data-mode="color"]');
const rbBox = await page.locator('#canvas').boundingBox();
// Click in the red (left) half.
await page.mouse.click(rbBox.x + rbBox.width * 0.25, rbBox.y + rbBox.height / 2);
await page.waitForTimeout(300);
const removedPixel = await pixelAt(page, 60, 80);
check(
	'remove-bg: clicked red area is transparent',
	removedPixel[3] === 0,
	`pixel=${removedPixel}`,
);
const keptPixel = await pixelAt(page, 180, 80);
check(
	'remove-bg: contiguous click keeps blue half',
	keptPixel[3] === 255,
	`pixel=${keptPixel}`,
);
await page.click('#undo-btn');
await page.waitForTimeout(200);
const undonePixel = await pixelAt(page, 60, 80);
check(
	'remove-bg: undo restores red pixels (not black)',
	undonePixel[3] === 255 && undonePixel[0] > 200,
	`pixel=${undonePixel}`,
);
await expectDownload(page, 'remove-background');

// ---------- Flagship tool pages ----------
console.log('flagship pages');
for (const path of [
	'/image-to-text/',
	'/heic-to-jpg/',
	'/meme-generator/',
	'/upscale-image/',
	'/blur-face/',
]) {
	const res = await page.goto(`${BASE}${path}`);
	check(`flagship ${path} returns 200`, res !== null && res.status() === 200);
	check(
		`flagship ${path} has dropzone`,
		(await page.locator('#dropzone').count()) === 1,
	);
}

// Meme generator: type top text, expect white block letters near the top.
await page.goto(`${BASE}/meme-generator/`);
{
	const buffer = await makeTestImage(page);
	await page.setInputFiles('#file-input', {
		name: 'test.png',
		mimeType: 'image/png',
		buffer,
	});
	await page.waitForSelector('#workbench', { state: 'visible', timeout: 5000 });
	await page.locator('#mm-top').fill('HELLO');
	await page.waitForTimeout(600); // font load + render
	const hasWhiteTop = await page.evaluate(() => {
		const c = document.getElementById('meme-canvas');
		const d = c.getContext('2d').getImageData(0, 0, c.width, 60).data;
		for (let i = 0; i < d.length; i += 4) {
			if (d[i] > 230 && d[i + 1] > 230 && d[i + 2] > 230) return true;
		}
		return false;
	});
	check('meme: top text rendered in white', hasWhiteTop);
}

// Upscale: output dimensions update and the compare preview builds.
await page.goto(`${BASE}/upscale-image/`);
{
	const buffer = await makeTestImage(page);
	await page.setInputFiles('#file-input', {
		name: 'test.png',
		mimeType: 'image/png',
		buffer,
	});
	await page.waitForSelector('#workbench', { state: 'visible', timeout: 5000 });
	const dims = await page.locator('#out-dims').textContent();
	check('upscale: 2x output dims shown', dims.includes('480') && dims.includes('320'), dims);
	await page.waitForSelector('.cmp-stage canvas', { timeout: 10000 });
	check(
		'upscale: before/after compare renders',
		(await page.locator('.cmp-layer canvas').count()) === 2,
	);
}

// ---------- Console errors ----------
check(
	'no console/page errors across all pages',
	consoleErrors.length === 0,
	consoleErrors.slice(0, 5).join(' | '),
);

await browser.close();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
