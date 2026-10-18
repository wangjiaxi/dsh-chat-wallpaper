window.__ModuleLoader__.load({
	id: "dsh-chat-wallpaper",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		const React = require('react');
		const h = React.createElement;

		/** Locale namespace owned by this plugin. */
		const NS = 'dsh-chat-wallpaper';
		/** localStorage key holding the chosen wallpaper and its knobs. */
		const STORAGE_KEY = 'dsh-chat-wallpaper/v1';
		/** Longest edge (px) the image is re-encoded to before it is stored. */
		const MAX_EDGE = 1800;
		/** Hard input limit; larger files are almost certainly not a wallpaper. */
		const MAX_FILE_BYTES = 12 * 1024 * 1024;
		/** WCAG AA for body text — what the auto opacity is solved against. */
		const TARGET_RATIO = 4.5;
		/** Element that paints the wallpaper: the conversation body region. */
		const REGION_SELECTOR = '[data-conversation-region="chat"]';
		/** Knob ranges; also the sanitiser's clamp bounds. */
		const LIMITS = {
			opacity: [0.04, 0.95],
			blur: [0, 14],
			brightness: [0.2, 2.6],
			contrast: [0.1, 1.7],
			saturate: [0, 1.8]
		};
		const DEFAULTS = {
			image: null,
			meta: null,
			auto: true,
			opacity: 0.32,
			blur: 2,
			brightness: 1,
			contrast: 1,
			saturate: 0.72
		};

		// #region i18n
		const zh = {
			nav: '聊天背景',
			title: '聊天背景',
			desc: '上传一张图片作为对话区的背景。图片会按当前主题自动校正亮度（曝光）和对比度，再按正文颜色算出安全的不透明度，使估算对比度不低于 4.5:1。',
			pick: '选择图片',
			replace: '更换图片',
			clear: '清除背景',
			empty: '还没有背景图片',
			auto: '自动校正（亮度 / 对比度 / 不透明度）',
			autoHint: '关闭后，下面四个参数由你手动控制。',
			opacity: '不透明度',
			blur: '模糊',
			brightness: '亮度（曝光）',
			contrast: '对比度',
			saturate: '饱和度',
			readout: '估算正文对比度 {ratio}:1',
			good: '可读性达标（不低于 4.5:1）',
			bad: '可读性偏低，正文可能看不清',
			preview: '预览',
			previewSample: '这是示例正文，用来检查背景是否影响阅读。调节不透明度、模糊或对比度，直到这段文字看起来舒服为止。',
			regionOk: '已检测到聊天区域，背景会画在对话区。',
			regionMissing: '当前页面没有检测到聊天区域。打开一个会话后再回来看看。',
			notImage: '这个文件不是图片。',
			tooBig: '图片超过 12MB，请换一张小一点的。',
			decodeFail: '图片解码失败，换一张试试（支持 PNG / JPEG / WebP）。',
			quota: '浏览器存储空间不足，图片没有保存。请换一张更小的图片。',
			saved: '已保存，这张背景会在此浏览器里保留。',
			tip: '为什么不是只调曝光：影响阅读的是「背景与文字的相对亮度」。亮度把整张图移到主题底色附近，对比度压缩明暗跨度，最后用不透明度兜底——三者都在同一个方向上起作用。'
		};
		const en = {
			nav: 'Chat background',
			title: 'Chat background',
			desc: 'Use an image as the background of the conversation area. The image is auto-corrected for the current theme (brightness and contrast) and the opacity is solved against the body text colour so the estimated contrast stays at or above 4.5:1.',
			pick: 'Choose image',
			replace: 'Replace image',
			clear: 'Clear background',
			empty: 'No background image yet',
			auto: 'Auto-correct (brightness / contrast / opacity)',
			autoHint: 'Turn it off to drive the four knobs below yourself.',
			opacity: 'Opacity',
			blur: 'Blur',
			brightness: 'Brightness (exposure)',
			contrast: 'Contrast',
			saturate: 'Saturation',
			readout: 'Estimated body-text contrast {ratio}:1',
			good: 'Readable (at or above 4.5:1)',
			bad: 'Low contrast — body text may be hard to read',
			preview: 'Preview',
			previewSample: 'Sample body text for checking whether the background gets in the way. Adjust opacity, blur or contrast until this reads comfortably.',
			regionOk: 'Conversation area detected — the wallpaper paints behind it.',
			regionMissing: 'No conversation area on this page. Open a session and check again.',
			notImage: 'That file is not an image.',
			tooBig: 'The image is larger than 12MB. Please pick a smaller one.',
			decodeFail: 'Could not decode that image. Try another one (PNG / JPEG / WebP).',
			quota: 'Browser storage is full, so the image was not saved. Please pick a smaller one.',
			saved: 'Saved — this wallpaper stays in this browser.',
			tip: 'Why not exposure alone: what hurts reading is the relative luminance of background and text. Brightness moves the whole image toward the theme surface, contrast compresses its range, and opacity is the final guard — all three pull in the same direction.'
		};
		// #endregion

		// #region colour + readability maths
		/** sRGB transfer function (0..1 channel -> linear light). */
		function srgbToLinear(channel) {
			return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
		}

		function clamp(value, min, max) {
			return value < min ? min : value > max ? max : value;
		}

		function round2(value) {
			return Math.round(value * 100) / 100;
		}

		/** Parse any CSS colour through a 1×1 canvas (handles rgb/oklch/color()). */
		function parseCssColor(value) {
			if (typeof value !== 'string' || value.trim() === '') return null;
			try {
				const canvas = document.createElement('canvas');
				canvas.width = 1;
				canvas.height = 1;
				const ctx = canvas.getContext('2d', { willReadFrequently: true });
				if (!ctx) return null;
				ctx.fillStyle = '#000000';
				ctx.fillStyle = value;
				ctx.fillRect(0, 0, 1, 1);
				const data = ctx.getImageData(0, 0, 1, 1).data;
				return { r: data[0], g: data[1], b: data[2], a: data[3] / 255 };
			} catch (error) {
				return null;
			}
		}

		/** Resolve one theme custom property to an sRGB triple. */
		function tokenColor(name) {
			const host = document.body || document.documentElement;
			if (!host) return null;
			const probe = document.createElement('span');
			probe.style.cssText = 'position:fixed;left:-99999px;top:0;width:0;height:0;pointer-events:none;color:var(' + name + ')';
			host.appendChild(probe);
			let raw = '';
			try {
				raw = getComputedStyle(probe).color;
			} finally {
				probe.remove();
			}
			return parseCssColor(raw);
		}

		/** WCAG relative luminance of an sRGB triple. */
		function relativeLuminance(color) {
			return 0.2126 * srgbToLinear(color.r / 255) + 0.7152 * srgbToLinear(color.g / 255) + 0.0722 * srgbToLinear(color.b / 255);
		}

		/** WCAG contrast ratio between two relative luminances. */
		function contrastRatio(a, b) {
			const high = Math.max(a, b) + 0.05;
			const low = Math.min(a, b) + 0.05;
			return high / low;
		}

		/**
		 * Read the live theme: the surface colour and the body text colour are the
		 * only two inputs the readability maths needs, and both are theme tokens so
		 * light/dark and any future theme work without special cases.
		 */
		function readTheme() {
			const bg = tokenColor('--dsw-alias-bg-base');
			const fg = tokenColor('--dsw-alias-label-primary');
			const bgLum = bg ? relativeLuminance(bg) : 0.02;
			const fgLum = fg ? relativeLuminance(fg) : 0.9;
			const dark = bg && fg ? fgLum >= bgLum : document.documentElement.hasAttribute('data-ds-dark-theme');
			return { bgLum, fgLum, dark };
		}

		/** How CSS `brightness()` + `contrast()` map the image's luminance spread. */
		function transformedLuminance(luminance, brightness, contrast) {
			const lifted = clamp(luminance * brightness, 0, 1);
			return clamp(0.5 + (lifted - 0.5) * contrast, 0, 1);
		}

		/**
		 * Solve the three knobs from image statistics plus the live theme.
		 *
		 * - brightness (exposure) moves the image's mean luminance onto the theme
		 *   surface, so the wallpaper sits at the same "loudness" as the UI;
		 * - contrast compresses the image's dynamic range, because a wallpaper only
		 *   needs atmosphere, not full-range detail;
		 * - opacity is then solved so the worst pixel (brightest on a dark theme,
		 *   darkest on a light one) still leaves TARGET_RATIO against the text.
		 */
		function solveAuto(meta, theme) {
			const brightness = clamp((theme.bgLum + 0.05) / (meta.mean + 0.05), 0.3, 2.5);
			const spread = Math.max(Math.abs(meta.p99 - meta.p01) * brightness, 1e-3);
			const targetSpread = theme.dark ? 0.18 : 0.15;
			const contrast = clamp(targetSpread / spread, 0.22, 1);
			const hi = transformedLuminance(meta.p99, brightness, contrast);
			const lo = transformedLuminance(meta.p01, brightness, contrast);
			let opacity;
			if (theme.dark) {
				const limit = Math.max((theme.fgLum + 0.05) / TARGET_RATIO - 0.05, 0.02);
				const deviation = Math.max(hi - theme.bgLum, 1e-4);
				opacity = clamp(((limit - theme.bgLum) / deviation) * 0.92, 0.06, 0.85);
			} else {
				const limit = Math.min((theme.fgLum + 0.05) * TARGET_RATIO - 0.05, 0.98);
				const deviation = Math.max(theme.bgLum - lo, 1e-4);
				opacity = clamp(((theme.bgLum - limit) / deviation) * 0.92, 0.06, 0.85);
			}
			return {
				brightness: round2(brightness),
				contrast: round2(contrast),
				opacity: round2(opacity),
				saturate: 0.72,
				blur: theme.dark ? 2 : 1.5
			};
		}

		/** Estimated contrast of body text over the *composited* wallpaper. */
		function estimateContrast(state, theme) {
			if (!state.meta) return null;
			const hi = transformedLuminance(state.meta.p99, state.brightness, state.contrast);
			const lo = transformedLuminance(state.meta.p01, state.brightness, state.contrast);
			const worst = theme.dark
				? theme.bgLum + (hi - theme.bgLum) * state.opacity
				: theme.bgLum + (lo - theme.bgLum) * state.opacity;
			return contrastRatio(theme.fgLum, clamp(worst, 0, 1));
		}
		// #endregion

		// #region image intake
		/** Histogram-friendly summary of the image, computed on a 72×72 sample. */
		function analysePixels(source, width, height) {
			const size = 72;
			const canvas = document.createElement('canvas');
			canvas.width = size;
			canvas.height = size;
			const ctx = canvas.getContext('2d', { willReadFrequently: true });
			if (!ctx) return null;
			ctx.drawImage(source, 0, 0, size, size);
			const data = ctx.getImageData(0, 0, size, size).data;
			const lums = [];
			for (let i = 0; i < data.length; i += 4) {
				if (data[i + 3] / 255 <= 0.06) continue; // transparent areas show the surface, not the image
				lums.push(
					0.2126 * srgbToLinear(data[i] / 255) +
					0.7152 * srgbToLinear(data[i + 1] / 255) +
					0.0722 * srgbToLinear(data[i + 2] / 255)
				);
			}
			if (lums.length === 0) return null;
			lums.sort((a, b) => a - b);
			const pick = (q) => lums[Math.min(lums.length - 1, Math.max(0, Math.round(q * (lums.length - 1))))];
			let sum = 0;
			for (const value of lums) sum += value;
			return { mean: sum / lums.length, p01: pick(0.01), p50: pick(0.5), p99: pick(0.99), width, height };
		}

		async function decodeFile(file) {
			if (typeof createImageBitmap === 'function') {
				try {
					return await createImageBitmap(file);
				} catch (error) {
					/* fall through to the <img> path */
				}
			}
			return await new Promise((resolve, reject) => {
				const url = URL.createObjectURL(file);
				const image = new Image();
				image.onload = () => {
					URL.revokeObjectURL(url);
					resolve(image);
				};
				image.onerror = () => {
					URL.revokeObjectURL(url);
					reject(new Error('decode failed'));
				};
				image.src = url;
			});
		}

		function encodeCanvas(canvas) {
			let url = '';
			try {
				url = canvas.toDataURL('image/webp', 0.82);
			} catch (error) {
				url = '';
			}
			if (!url || url.indexOf('data:image/webp') !== 0) {
				try {
					url = canvas.toDataURL('image/jpeg', 0.85);
				} catch (error) {
					url = '';
				}
			}
			return url && url.indexOf('data:image/') === 0 ? url : null;
		}

		/** Downscale + re-encode + measure one picked file. */
		async function prepareImage(file) {
			const source = await decodeFile(file);
			const sourceWidth = source.width || source.naturalWidth || 0;
			const sourceHeight = source.height || source.naturalHeight || 0;
			if (!sourceWidth || !sourceHeight) throw new Error('empty image');
			const scale = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight));
			const width = Math.max(1, Math.round(sourceWidth * scale));
			const height = Math.max(1, Math.round(sourceHeight * scale));
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext('2d');
			if (!ctx) throw new Error('no 2d context');
			ctx.imageSmoothingQuality = 'high';
			ctx.drawImage(source, 0, 0, width, height);
			if (typeof source.close === 'function') source.close();
			const meta = analysePixels(canvas, width, height);
			const image = encodeCanvas(canvas);
			if (!meta || !image) throw new Error('encode failed');
			return { image, meta };
		}
		// #endregion

		// #region store
		const store = (() => {
			let state = Object.assign({}, DEFAULTS);
			const listeners = new Set();
			let loaded = false;

			function emit() {
				for (const listener of listeners) {
					try {
						listener();
					} catch (error) {
						console.error('[dsh-chat-wallpaper] listener failed', error);
					}
				}
			}

			function sanitise(raw) {
				const out = {};
				if (typeof raw.image === 'string' && raw.image.indexOf('data:image/') === 0) out.image = raw.image;
				if (raw.meta && typeof raw.meta === 'object') {
					const meta = raw.meta;
					const numeric = ['mean', 'p01', 'p50', 'p99'].every((key) => typeof meta[key] === 'number' && Number.isFinite(meta[key]));
					out.meta = numeric
						? { mean: meta.mean, p01: meta.p01, p50: meta.p50, p99: meta.p99, width: Number(meta.width) || 0, height: Number(meta.height) || 0 }
						: null;
				}
				if (typeof raw.auto === 'boolean') out.auto = raw.auto;
				for (const key of Object.keys(LIMITS)) {
					if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) out[key] = clamp(raw[key], LIMITS[key][0], LIMITS[key][1]);
				}
				return out;
			}

			function persist() {
				try {
					localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
					return true;
				} catch (error) {
					console.warn('[dsh-chat-wallpaper] could not persist wallpaper', error);
					return false;
				}
			}

			/** Recompute the auto knobs for the current theme (no-op when disabled). */
			function refreshAuto() {
				if (!state.auto || !state.meta) return;
				const solved = solveAuto(state.meta, readTheme());
				state.brightness = solved.brightness;
				state.contrast = solved.contrast;
				state.opacity = solved.opacity;
				state.saturate = solved.saturate;
				state.blur = solved.blur;
			}

			/** Push the state onto the document — the stylesheet reads only these vars. */
			function apply() {
				const root = document.documentElement;
				if (!root) return;
				if (!state.image) {
					root.removeAttribute('data-dshwp');
					return;
				}
				refreshAuto();
				root.setAttribute('data-dshwp', 'on');
				root.style.setProperty('--dshwp-image', 'url("' + state.image + '")');
				root.style.setProperty('--dshwp-opacity', String(state.opacity));
				root.style.setProperty('--dshwp-blur', state.blur + 'px');
				root.style.setProperty('--dshwp-brightness', String(state.brightness));
				root.style.setProperty('--dshwp-contrast', String(state.contrast));
				root.style.setProperty('--dshwp-saturate', String(state.saturate));
			}

			function load() {
				if (loaded) return;
				loaded = true;
				try {
					const raw = localStorage.getItem(STORAGE_KEY);
					if (!raw) return;
					const parsed = JSON.parse(raw);
					if (parsed && typeof parsed === 'object') state = Object.assign({}, DEFAULTS, sanitise(parsed));
				} catch (error) {
					console.warn('[dsh-chat-wallpaper] could not read saved wallpaper', error);
				}
			}

			return {
				get() {
					return state;
				},
				subscribe(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				/** Patch one or more knobs; `auto` restarts the derived values. */
				update(patch) {
					state = Object.assign({}, state, patch);
					apply();
					persist();
					emit();
				},
				/** Store a freshly prepared image and re-solve every derived knob. */
				setImage(next) {
					state = Object.assign({}, state, { image: next.image, meta: next.meta, auto: true });
					apply();
					const ok = persist();
					emit();
					return ok;
				},
				clear() {
					state = Object.assign({}, DEFAULTS);
					apply();
					persist();
					emit();
				},
				/** Theme switched: re-solve, repaint, and keep the page in sync. */
				refresh() {
					apply();
					emit();
				},
				load,
				apply
			};
		})();
		// #endregion

		// #region stylesheet
		/**
		 * One rule paints the wallpaper: a pseudo-element behind the conversation
		 * body's own (transparent) content, with the theme surface showing through
		 * wherever the image's opacity lets it. `isolation: isolate` gives the
		 * region its own stacking context so `z-index: -1` stays above the panel
		 * background and below every row, bubble and glyph.
		 */
		const STYLE_ROWS = [
			'html[data-dshwp="on"] ' + REGION_SELECTOR + '{isolation:isolate}',
			'html[data-dshwp="on"] ' + REGION_SELECTOR + '::before{',
			'content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;',
			'background-image:var(--dshwp-image);background-position:center center;',
			'background-size:cover;background-repeat:no-repeat;',
			'filter:blur(var(--dshwp-blur,0px)) brightness(var(--dshwp-brightness,1)) contrast(var(--dshwp-contrast,1)) saturate(var(--dshwp-saturate,1));',
			'opacity:var(--dshwp-opacity,.3)}'
		];

		function installStyles() {
			const existing = document.querySelector('style[data-dshwp-style]');
			if (existing) return;
			const tag = document.createElement('style');
			tag.dataset.dshwpStyle = '';
			tag.textContent = STYLE_ROWS.join('');
			document.head.appendChild(tag);
		}
		// #endregion

		// #region settings page
		const buttonStyle = (primary) => ({
			appearance: 'none',
			border: primary ? 'none' : '.5px solid var(--dsw-alias-border-l1)',
			background: primary ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-layer-1)',
			color: primary ? 'var(--dsw-alias-bg-base)' : 'var(--dsw-alias-label-primary)',
			borderRadius: 8,
			padding: '6px 14px',
			fontFamily: 'inherit',
			fontSize: 13,
			lineHeight: '20px',
			cursor: 'pointer'
		});

		const labelStyle = { fontSize: 13, color: 'var(--dsw-alias-label-primary)' };
		const hintStyle = { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' };
		const rowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, padding: '16px 0', borderBottom: '.5px solid var(--dsw-alias-border-l2)' };

		function SliderRow(props) {
			return h(
				'div',
				{ style: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '.5px solid var(--dsw-alias-border-l2)' } },
				h('span', { style: Object.assign({ width: 116, flex: 'none' }, labelStyle) }, props.label),
				h('input', {
					type: 'range',
					min: props.min,
					max: props.max,
					step: props.step,
					value: props.value,
					disabled: props.disabled,
					onChange: (event) => props.onChange(Number(event.target.value)),
					style: { flex: 1, minWidth: 0, accentColor: 'var(--dsw-alias-brand-primary)' }
				}),
				h(
					'span',
					{ style: { width: 60, flex: 'none', textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--dsw-alias-label-secondary)' } },
					props.display
				)
			);
		}

		function WallpaperSection(props) {
			const t = props.t;
			const [state, setState] = React.useState(() => store.get());
			const [busy, setBusy] = React.useState(false);
			const [note, setNote] = React.useState(null);
			const [hasRegion, setHasRegion] = React.useState(false);
			const fileRef = React.useRef(null);

			React.useEffect(() => store.subscribe(() => setState(store.get())), []);

			React.useEffect(() => {
				const check = () => setHasRegion(document.querySelector(REGION_SELECTOR) !== null);
				check();
				const timer = setTimeout(check, 600);
				return () => clearTimeout(timer);
			}, []);

			const theme = readTheme();
			const ratio = estimateContrast(state, theme);
			const ratioText = ratio === null ? '—' : ratio.toFixed(1);
			const ok = ratio === null || ratio >= TARGET_RATIO;

			const onPick = async (event) => {
				const file = event.target.files && event.target.files[0];
				event.target.value = '';
				if (!file) return;
				if (!file.type || file.type.indexOf('image/') !== 0) {
					setNote({ kind: 'error', text: t('notImage') });
					return;
				}
				if (file.size > MAX_FILE_BYTES) {
					setNote({ kind: 'error', text: t('tooBig') });
					return;
				}
				setBusy(true);
				setNote(null);
				try {
					const prepared = await prepareImage(file);
					const saved = store.setImage(prepared);
					setNote(saved ? { kind: 'info', text: t('saved') } : { kind: 'error', text: t('quota') });
				} catch (error) {
					console.error('[dsh-chat-wallpaper] could not read the picked image', error);
					setNote({ kind: 'error', text: t('decodeFail') });
				} finally {
					setBusy(false);
				}
			};

			const preview = state.image
				? h(
						'div',
						{
							style: {
								position: 'relative',
								height: 168,
								margin: '4px 0 8px',
								borderRadius: 12,
								overflow: 'hidden',
								background: 'var(--dsw-alias-bg-base)',
								border: '.5px solid var(--dsw-alias-border-l1)'
							}
						},
						h('div', {
							style: {
								position: 'absolute',
								inset: 0,
								backgroundImage: 'url("' + state.image + '")',
								backgroundSize: 'cover',
								backgroundPosition: 'center center',
								filter:
									'blur(' + state.blur + 'px) brightness(' + state.brightness + ') contrast(' + state.contrast + ') saturate(' + state.saturate + ')',
								opacity: state.opacity
							}
						}),
						h(
							'div',
							{ style: { position: 'relative', padding: '14px 16px', fontSize: 13, lineHeight: '21px', color: 'var(--dsw-alias-label-primary)' } },
							t('previewSample')
						)
					)
				: h('div', { style: Object.assign({ padding: '16px 0' }, hintStyle) }, t('empty'));

			return h(
				'div',
				{ style: { display: 'flex', flexDirection: 'column', paddingTop: 20 } },
				h('div', { style: { fontSize: 15, fontWeight: 600, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' } }, t('title')),
				h('div', { style: Object.assign({ marginTop: 6 }, hintStyle) }, t('desc')),

				h(
					'div',
					{ style: Object.assign({}, rowStyle, { borderBottom: 'none' }) },
					h(
						'div',
						{ style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
						h('input', {
							ref: fileRef,
							type: 'file',
							accept: 'image/*',
							onChange: onPick,
							style: { display: 'none' }
						}),
						h(
							'button',
							{ type: 'button', style: buttonStyle(true), disabled: busy, onClick: () => fileRef.current && fileRef.current.click() },
							busy ? '…' : state.image ? t('replace') : t('pick')
						),
						state.image
							? h('button', { type: 'button', style: buttonStyle(false), onClick: () => store.clear() }, t('clear'))
							: null
					),
					h(
						'div',
						{ style: Object.assign({ textAlign: 'right' }, hintStyle) },
						hasRegion ? t('regionOk') : t('regionMissing')
					)
				),

				note ? h('div', { style: Object.assign({ padding: '8px 0' }, hintStyle, note.kind === 'error' ? { color: 'var(--dsw-alias-state-error-primary)' } : {}) }, note.text) : null,

				preview,

				h(
					'div',
					{ style: rowStyle },
					h(
						'div',
						{ style: { minWidth: 0 } },
						h('div', { style: labelStyle }, t('auto')),
						h('div', { style: hintStyle }, t('autoHint'))
					),
					h('input', {
						type: 'checkbox',
						checked: state.auto,
						onChange: (event) => store.update({ auto: event.target.checked }),
						style: { width: 16, height: 16, accentColor: 'var(--dsw-alias-brand-primary)' }
					})
				),

				SliderRow({
					label: t('opacity'),
					value: state.opacity,
					min: LIMITS.opacity[0],
					max: LIMITS.opacity[1],
					step: 0.01,
					disabled: !state.image,
					display: Math.round(state.opacity * 100) + '%',
					onChange: (value) => store.update({ opacity: value })
				}),
				SliderRow({
					label: t('blur'),
					value: state.blur,
					min: LIMITS.blur[0],
					max: LIMITS.blur[1],
					step: 0.5,
					disabled: !state.image,
					display: state.blur + 'px',
					onChange: (value) => store.update({ blur: value })
				}),
				SliderRow({
					label: t('brightness'),
					value: state.brightness,
					min: LIMITS.brightness[0],
					max: LIMITS.brightness[1],
					step: 0.01,
					disabled: !state.image,
					display: state.brightness.toFixed(2),
					onChange: (value) => store.update({ brightness: value })
				}),
				SliderRow({
					label: t('contrast'),
					value: state.contrast,
					min: LIMITS.contrast[0],
					max: LIMITS.contrast[1],
					step: 0.01,
					disabled: !state.image,
					display: state.contrast.toFixed(2),
					onChange: (value) => store.update({ contrast: value })
				}),
				SliderRow({
					label: t('saturate'),
					value: state.saturate,
					min: LIMITS.saturate[0],
					max: LIMITS.saturate[1],
					step: 0.01,
					disabled: !state.image,
					display: state.saturate.toFixed(2),
					onChange: (value) => store.update({ saturate: value })
				}),

				h(
					'div',
					{ style: { display: 'flex', gap: 12, alignItems: 'baseline', padding: '14px 0 4px', flexWrap: 'wrap' } },
					h(
						'span',
						{ style: { fontSize: 13, color: ok ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-state-warn-primary)' } },
						t('readout', { ratio: ratioText })
					),
					h('span', { style: hintStyle }, ok ? t('good') : t('bad'))
				),
				h('div', { style: Object.assign({ paddingBottom: 16 }, hintStyle) }, t('tip'))
			);
		}
		// #endregion

		// #region plugin
		/** Required client services. */
		const inject = ['slots', 'locale'];

		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-chat-wallpaper: dictionaries');
			ctx.effect(() => {
				installStyles();
				return () => {
					const tag = document.querySelector('style[data-dshwp-style]');
					if (tag) tag.remove();
				};
			}, 'dsh-chat-wallpaper: stylesheet');

			store.load();
			store.apply();
			ctx.effect(() => {
				const root = document.documentElement;
				let previous = signature();
				const observer = new MutationObserver(() => {
					const next = signature();
					if (next === previous) return;
					previous = next;
					store.refresh();
				});
				observer.observe(root, { attributes: true, attributeFilter: ['class', 'style', 'data-ds-dark-theme', 'data-ds-theme-source'] });
				return () => observer.disconnect();
			}, 'dsh-chat-wallpaper: theme sync');

			ctx.slots.inject('settings.section', () =>
				ctx.slots.register(
					{
						name: 'settings.section',
						id: 'chat-wallpaper',
						order: 60,
						label: () => t('nav'),
						locale: NS
					},
					WallpaperSection
				)
			);
		}

		/** Theme changes are detected by the resolved colours, not by class names. */
		function signature() {
			const bg = tokenColor('--dsw-alias-bg-base');
			const fg = tokenColor('--dsw-alias-label-primary');
			return [bg && relativeLuminance(bg).toFixed(3), fg && relativeLuminance(fg).toFixed(3)].join('|');
		}
		// #endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
