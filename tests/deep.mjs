/**
 * Deep functional test for the heavy on-device engines (OCR, AI matting,
 * face detection). Slower than smoke.mjs — run when touching those tools.
 * Run: node tests/deep.mjs  (expects `astro preview` on :4321)
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:4321';

let failures = 0;
function check(name, condition, detail = '') {
	if (condition) console.log(`  PASS  ${name}`);
	else { failures++; console.log(`  FAIL  ${name} ${detail}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

// ---------- OCR: render text to a canvas, expect Tesseract to read it ----------
console.log('image-to-text (OCR engine)');
await page.goto(`${BASE}/image-to-text/`);
{
	const buffer = await page.evaluate(() => {
		const c = document.createElement('canvas');
		c.width = 600; c.height = 200;
		const x = c.getContext('2d');
		x.fillStyle = '#fff'; x.fillRect(0, 0, 600, 200);
		x.fillStyle = '#000'; x.font = '700 64px Arial';
		x.fillText('HELLO WORLD', 40, 120);
		return c.toDataURL('image/png').split(',')[1];
	});
	await page.setInputFiles('#file-input', {
		name: 'text.png', mimeType: 'image/png', buffer: Buffer.from(buffer, 'base64'),
	});
	await page.click('#run');
	await page.waitForSelector('.ocr-out:not([style*="none"]) .text-out', { timeout: 120000 });
	const text = await page.locator('.text-out').inputValue();
	check('OCR reads HELLO WORLD', /HELLO\s+WORLD/i.test(text), `got: "${text.trim()}"`);
}

// ---------- Remove background: AI run completes on this device ----------
console.log('remove-background (MODNet via ONNX Runtime)');
await page.goto(`${BASE}/remove-background/`);
{
	const buffer = await page.evaluate(() => {
		// Rough "portrait": dark blob on light background.
		const c = document.createElement('canvas');
		c.width = 320; c.height = 400;
		const x = c.getContext('2d');
		x.fillStyle = '#dfe3ea'; x.fillRect(0, 0, 320, 400);
		x.fillStyle = '#5a3d2b';
		x.beginPath(); x.ellipse(160, 130, 70, 90, 0, 0, Math.PI * 2); x.fill();
		x.fillRect(90, 210, 140, 190);
		return c.toDataURL('image/png').split(',')[1];
	});
	await page.setInputFiles('#file-input', {
		name: 'portrait.png', mimeType: 'image/png', buffer: Buffer.from(buffer, 'base64'),
	});
	await page.waitForSelector('#editor', { state: 'visible' });
	await page.click('#ai-run');
	const ok = await page.waitForFunction(
		() => document.querySelector('.status').textContent.startsWith('Done'),
		undefined, { timeout: 120000 },
	).then(() => true).catch(() => false);
	check('AI matting run completes', ok,
		`status="${await page.locator('.status').textContent()}"`);
}

// ---------- Blur face: detector runs (synthetic image -> "no faces" is fine) ----------
console.log('blur-face (UltraFace via ONNX Runtime)');
await page.goto(`${BASE}/blur-face/`);
{
	const buffer = await page.evaluate(() => {
		const c = document.createElement('canvas');
		c.width = 320; c.height = 240;
		const x = c.getContext('2d');
		x.fillStyle = '#888'; x.fillRect(0, 0, 320, 240);
		return c.toDataURL('image/png').split(',')[1];
	});
	await page.setInputFiles('#file-input', {
		name: 'gray.png', mimeType: 'image/png', buffer: Buffer.from(buffer, 'base64'),
	});
	await page.waitForSelector('#editor', { state: 'visible' });
	await page.click('#detect');
	const ok = await page.waitForFunction(
		() => document.getElementById('face-count').textContent.length > 0,
		undefined, { timeout: 120000 },
	).then(() => true).catch(() => false);
	check('face detector run completes', ok,
		`count="${await page.locator('#face-count').textContent()}"`);
}

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failures === 0 ? '\nDEEP CHECKS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
