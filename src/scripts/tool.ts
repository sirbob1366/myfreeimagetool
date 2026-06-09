export interface ToolOptions {
	onImage: (img: HTMLImageElement) => void;
	/** Called before exporting the canvas, e.g. to hide selection overlays. */
	beforeDownload?: () => void;
	/** Called after exporting the canvas, e.g. to restore overlays. */
	afterDownload?: () => void;
	downloadName?: string;
}

export interface Tool {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	/** Convert a pointer event to canvas pixel coordinates. */
	canvasPoint(e: PointerEvent | MouseEvent): { x: number; y: number };
}

export function initTool(options: ToolOptions): Tool {
	const dropzone = document.getElementById('dropzone') as HTMLElement;
	const fileInput = document.getElementById('file-input') as HTMLInputElement;
	const editor = document.getElementById('editor') as HTMLElement;
	const canvas = document.getElementById('canvas') as HTMLCanvasElement;
	const downloadBtn = document.getElementById(
		'download-btn',
	) as HTMLButtonElement;
	const newBtn = document.getElementById('new-image-btn') as HTMLButtonElement;
	const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

	function loadFile(file: File) {
		if (!file.type.startsWith('image/')) return;
		const url = URL.createObjectURL(file);
		const img = new Image();
		img.onload = () => {
			URL.revokeObjectURL(url);
			canvas.width = img.naturalWidth;
			canvas.height = img.naturalHeight;
			dropzone.hidden = true;
			editor.hidden = false;
			options.onImage(img);
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			alert('Could not load that file. Please choose a valid image.');
		};
		img.src = url;
	}

	dropzone.addEventListener('click', (e) => {
		// The programmatic click on the input bubbles back to the dropzone;
		// ignore it to avoid infinite recursion.
		if (e.target === fileInput) return;
		fileInput.click();
	});
	fileInput.addEventListener('change', () => {
		const file = fileInput.files?.[0];
		if (file) loadFile(file);
	});
	dropzone.addEventListener('dragover', (e) => {
		e.preventDefault();
		dropzone.classList.add('dragging');
	});
	dropzone.addEventListener('dragleave', (e) => {
		// Ignore dragleave events fired when moving over child elements.
		if (e.relatedTarget && dropzone.contains(e.relatedTarget as Node)) return;
		dropzone.classList.remove('dragging');
	});
	dropzone.addEventListener('drop', (e) => {
		e.preventDefault();
		dropzone.classList.remove('dragging');
		const file = e.dataTransfer?.files?.[0];
		if (file) loadFile(file);
	});

	downloadBtn.addEventListener('click', () => {
		options.beforeDownload?.();
		canvas.toBlob((blob) => {
			options.afterDownload?.();
			if (!blob) return;
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = options.downloadName ?? 'edited.png';
			a.click();
			URL.revokeObjectURL(a.href);
		}, 'image/png');
	});

	newBtn.addEventListener('click', () => {
		fileInput.value = '';
		editor.hidden = true;
		dropzone.hidden = false;
	});

	function canvasPoint(e: PointerEvent | MouseEvent) {
		const rect = canvas.getBoundingClientRect();
		return {
			x: (e.clientX - rect.left) * (canvas.width / rect.width),
			y: (e.clientY - rect.top) * (canvas.height / rect.height),
		};
	}

	return { canvas, ctx, canvasPoint };
}

/** Clamp a value to the 0–255 byte range. */
export function clampByte(v: number): number {
	return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Bind a range input to a callback, updating its <output> sibling. */
export function bindRange(
	id: string,
	onInput: (value: number) => void,
): HTMLInputElement {
	const input = document.getElementById(id) as HTMLInputElement;
	const output = input
		.closest('.field')
		?.querySelector('output') as HTMLOutputElement | null;
	input.addEventListener('input', () => {
		if (output) output.textContent = input.value;
		onInput(Number(input.value));
	});
	return input;
}
