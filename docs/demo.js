// Interactive demo for the landing page.
//
// It runs the CLI's own layout templates (docs/templates/*.js are copies of
// src/templates/*.js) through Satori in the browser, and reuses the social and
// browser-tab mockups from src/preview.html. Nothing here talks to a server.

import { layoutA } from './templates/layout-a.js';
import { layoutB } from './templates/layout-b.js';
import { layoutC } from './templates/layout-c.js';

const SATORI_URL = 'https://esm.sh/satori@0.12.2';
const FONT_URLS = {
  400: 'https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.16/files/inter-latin-400-normal.woff',
  700: 'https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.16/files/inter-latin-700-normal.woff',
};

const TEMPLATES = { A: layoutA, B: layoutB, C: layoutC };
const LAYOUTS = ['A', 'B', 'C'];
const FALLBACK_IMAGES = { A: 'og-a.png', B: 'og-b.png', C: 'og-c.png' };
const DEFAULT_HEADING_SIZES = { A: 64, B: 56, C: 72 };
const DEFAULT_TAGLINE_SIZES = { A: 28, B: 26, C: 22 };
const DEFAULT_ALIGN = { A: 'left', B: 'center', C: 'left' };
const DEFAULT_TEXT_WIDTHS = { A: 1040, B: 900, C: 1000 };

// Seeded with what `metadata-gen init` found for this repo.
const state = {
  title: 'Metadata Gen',
  description: "Generate metadata images and favicon sets from your project's existing assets and config",
  url: 'https://metadata-gen.micka.design',
  colors: { background: '#0f0f0f', foreground: '#ffffff', accent: '#888888' },
  layout: 'A',
  overrides: { A: {}, B: {}, C: {} },
  images: { ...FALLBACK_IMAGES },
  platform: 'x',
};

const fav = {
  letter: 'M',
  background: '#0f0f0f',
  darkBg: '#000000',
  accent: '#888888',
  darkAccent: '#888888',
  radius: 19,
  letterSize: 60,
  weight: 700,
  transparent: false,
  customBg: '#6B97FF',
};

const $ = (id) => document.getElementById(id);

// >>> ported from src/preview.html — do not edit here, run `npm run sync-docs`

function normalizeHex(v) {
  if (typeof v !== 'string') return '#000000';
  const h = v.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(h)) return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`.toLowerCase();
  if (/^#[0-9a-fA-F]{6}/.test(h)) return h.slice(0, 7).toLowerCase();
  return '#000000';
}

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') node.className = v;
      else if (k === 'textContent') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
      else node.setAttribute(k, v);
    }
  }
  for (const child of children) {
    if (child == null) continue;
    if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  }
  return node;
}

function ffSlider(value, min, max, unit, onChange) {
  const container = el('div', { className: 'ff-slider' });
  const fill = el('div', { className: 'ff-slider-fill' });
  const handle = el('div', { className: 'ff-slider-handle' });
  const valueEl = el('div', { className: 'ff-slider-value', textContent: `${value}${unit}` });
  const input = el('input', { type: 'range', min: String(min), max: String(max), value: String(value) });

  function update(v) {
    const pct = ((v - min) / (max - min)) * 100;
    fill.style.width = `${pct}%`;
    handle.style.left = `calc(${pct}% - 9px)`;
    valueEl.textContent = `${v}${unit}`;
  }

  update(value);
  // Fire on `input` so the preview follows the drag. Every consumer
  // debounces and aborts in-flight renders, so this can't pile up.
  input.addEventListener('input', () => {
    update(input.value);
    onChange(parseInt(input.value));
  });

  container.append(fill, handle, valueEl, input);
  return container;
}

function ffColor(label, value, onChange) {
  const hexLabel = el('span', { className: 'ff-color-hex', textContent: value });
  const swatch = el('input', { type: 'color', className: 'ff-color-swatch', value: normalizeHex(value) });
  // Fire on `input` so the preview follows the picker. Consumers debounce
  // and abort in-flight renders, so dragging doesn't pile up requests.
  swatch.addEventListener('input', () => {
    hexLabel.textContent = swatch.value;
    onChange(swatch.value);
  });
  const wrap = el('div', { className: 'ff-color-wrap' });
  wrap.addEventListener('click', () => swatch.click());
  wrap.append(swatch, hexLabel);
  return el('div', { className: 'refine-row' },
    el('span', { className: 'refine-label', textContent: label }),
    wrap
  );
}

function ffSelect(label, options, selectedValue, onChange) {
  // options: [{ value, label }]
  const container = el('div', { className: 'ff-select' });

  const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chevron.setAttribute('viewBox', '0 0 16 16');
  chevron.setAttribute('fill', 'none');
  chevron.classList.add('ff-select-chevron');
  chevron.innerHTML = '<path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';

  const selectedLabel = options.find(o => o.value === selectedValue)?.label || options[0]?.label || '';
  const triggerText = el('span', { textContent: selectedLabel });
  const trigger = el('div', { className: 'ff-select-trigger' });
  trigger.append(triggerText, chevron);

  const nativeSelect = document.createElement('select');
  options.forEach(opt => {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === selectedValue) o.selected = true;
    nativeSelect.appendChild(o);
  });
  nativeSelect.addEventListener('change', () => {
    const opt = options.find(o => o.value === nativeSelect.value);
    triggerText.textContent = opt?.label || nativeSelect.value;
    onChange(nativeSelect.value);
  });

  container.append(trigger, nativeSelect);
  return el('div', { className: 'refine-row' },
    el('span', { className: 'refine-label', textContent: label }),
    container
  );
}

function ffToggle(label, initial, onChange) {
  const track = el('button', {
    type: 'button',
    className: `ff-toggle-track${initial ? ' active' : ''}`,
  });
  track.setAttribute('role', 'switch');
  track.setAttribute('aria-checked', initial ? 'true' : 'false');
  track.setAttribute('aria-label', label);
  const thumb = el('div', { className: 'ff-toggle-thumb' });
  track.appendChild(thumb);
  let state = initial;
  const labelText = el('span', { textContent: label });
  const wrap = el('label', { className: 'ff-toggle' });
  track.addEventListener('click', () => {
    state = !state;
    track.classList.toggle('active', state);
    track.setAttribute('aria-checked', state ? 'true' : 'false');
    onChange(state);
  });
  labelText.addEventListener('click', () => track.click());
  wrap.append(track, labelText);
  return wrap;
}

const SOCIAL_LIMITS = {
  facebook:  { title: 60,  desc: 120 },
  x:         { title: 70,  desc: 0   },   // X hides desc on large card
  linkedin:  { title: 70,  desc: 100 },
  whatsapp:  { title: 65,  desc: 155 },
  discord:   { title: 100, desc: 350 },
  slack:     { title: 90,  desc: 150 },
  reddit:    { title: 120, desc: 0   },   // Reddit rarely shows desc
  telegram:  { title: 65,  desc: 160 },
  imessage:  { title: 50,  desc: 0   },
  google:    { title: 60,  desc: 160 },
};

function truncate(str, max) {
  if (!str) return '';
  if (!max || str.length <= max) return str;
  return str.slice(0, max - 1).trimEnd() + '\u2026';
}

function domainFromUrl(url) {
  if (!url) return 'yourdomain.com';
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url.replace(/^https?:\/\//, '').split('/')[0] || 'yourdomain.com'; }
}

const PLATFORM_ICON_SVGS = {
  facebook: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.198 21.5h4v-8.01h3.604l.396-3.98h-4V7.5a1 1 0 0 1 1-1h3v-4h-3a5 5 0 0 0-5 5v2.01h-2l-.396 3.98h2.396v8.01Z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.451-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.5 21.5h-5v-13h5v13ZM4 6.5C2.5 6.5 1.5 5.3 1.5 4s1-2.4 2.5-2.4c1.6 0 2.5 1 2.6 2.4 0 1.4-1 2.5-2.6 2.5Zm18.5 15h-5v-7c0-1.9-.7-3.1-2.4-3.1-1.3 0-2.1.9-2.4 1.8-.1.3-.1.7-.1 1.1v7h-5s.1-12.7 0-13h5v2c.7-1 1.8-2.4 4.3-2.4 3.2 0 5.6 2.1 5.6 6.5v7Z"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.554-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24Zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981Zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.074-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.371-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414Z"/></svg>',
  discord: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.08.08 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.03ZM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z"/></svg>',
  slack: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52Zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313ZM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834Zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312Zm10.122 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834Zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312Zm-2.523 10.122a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52Zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313Z"/></svg>',
  reddit: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0Zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.11 3.11 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701ZM9.25 12c-.687 0-1.25.561-1.25 1.25 0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249Zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249Zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095Z"/></svg>',
  telegram: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0Zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635Z"/></svg>',
  imessage: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C5.925 2 1 6.142 1 11.252c0 2.946 1.621 5.573 4.137 7.284l-.982 3.15a.36.36 0 0 0 .547.402l3.55-2.214c1.174.306 2.436.472 3.748.472 6.075 0 11-4.142 11-9.252C23 6.142 18.075 2 12 2Z"/></svg>',
  google: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.545 10.24v3.82h5.44c-.71 2.32-2.64 3.98-5.44 3.98a6.03 6.03 0 1 1 0-12.07c1.5 0 2.87.55 3.92 1.46l2.82-2.82A9.97 9.97 0 0 0 12.545 2C7.02 2 2.543 6.48 2.543 12s4.478 10 10.002 10c8.4 0 10.25-7.85 9.43-11.75l-9.43-.01Z"/></svg>',
};

function platformIcon(id) {
  const span = el('span', { className: 'platform-icon', 'data-platform': id });
  span.innerHTML = PLATFORM_ICON_SVGS[id] || '';
  return span;
}

const SOCIAL_PLATFORMS = [
  {
    id: 'x', label: 'X (Twitter)', iconLetter: '𝕏', iconBg: '#000',
    render: ({ title, domain, ogImage }) => el('div', { className: 'mk-x' },
      el('div', { className: 'mk-x-card' },
        el('div', { className: 'mk-x-img' },
          ogImage ? el('img', { src: ogImage }) : null,
          el('div', { className: 'mk-x-title-pill truncate-1', textContent: truncate(title, SOCIAL_LIMITS.x.title) })
        )
      ),
      el('div', { className: 'mk-x-from', textContent: `From ${domain}` })
    ),
  },
  {
    id: 'slack', label: 'Slack', iconLetter: 'S', iconBg: '#4a154b',
    render: ({ title, description, domain, ogImage, faviconImage }) => el('div', { className: 'mk-sl' },
      el('div', { className: 'mk-sl-body' },
        el('div', { className: 'mk-sl-title truncate-2', textContent: truncate(title, SOCIAL_LIMITS.slack.title) }),
        el('div', { className: 'mk-sl-desc truncate-3', textContent: truncate(description, SOCIAL_LIMITS.slack.desc) }),
        el('div', { className: 'mk-sl-site' },
          faviconImage ? el('img', { src: faviconImage, alt: '' }) : null,
          el('span', { textContent: domain })
        )
      ),
      el('div', { className: 'mk-sl-img' }, ogImage ? el('img', { src: ogImage }) : null)
    ),
  },
  {
    id: 'linkedin', label: 'LinkedIn', iconLetter: 'in', iconBg: '#0a66c2',
    render: ({ title, domain, ogImage }) => el('div', { className: 'mk-li' },
      el('div', { className: 'mk-li-img' }, ogImage ? el('img', { src: ogImage }) : null),
      el('div', { className: 'mk-li-body' },
        el('div', { className: 'mk-li-title truncate-2', textContent: truncate(title, SOCIAL_LIMITS.linkedin.title) }),
        el('div', { className: 'mk-li-domain', textContent: domain })
      )
    ),
  },
  {
    id: 'whatsapp', label: 'WhatsApp', iconLetter: 'W', iconBg: '#25d366',
    render: ({ title, description, domain, url, ogImage }) => el('div', { className: 'mk-wa' },
      el('div', { className: 'mk-wa-bubble' },
        el('div', { className: 'mk-wa-link' },
          el('div', { className: 'thumb' }, ogImage ? el('img', { src: ogImage }) : null),
          el('div', { className: 'meta' },
            el('div', { className: 'title truncate-1', textContent: truncate(title, SOCIAL_LIMITS.whatsapp.title) }),
            el('div', { className: 'desc truncate-2', textContent: truncate(description, SOCIAL_LIMITS.whatsapp.desc) }),
            el('div', { className: 'domain', textContent: domain })
          )
        ),
        el('a', { className: 'mk-wa-url', textContent: url || 'https://' + domain }),
        el('span', { className: 'mk-wa-time', textContent: '9:41 AM \u2713\u2713' })
      )
    ),
  },
  {
    id: 'reddit', label: 'Reddit', iconLetter: 'r', iconBg: '#ff4500',
    render: ({ title, domain, ogImage }) => el('div', { className: 'mk-rd' },
      el('div', { className: 'mk-rd-header', textContent: `${domain} \u2022 submitted by u/you` }),
      el('div', { className: 'mk-rd-title truncate-2', textContent: truncate(title, SOCIAL_LIMITS.reddit.title) }),
      el('div', { className: 'mk-rd-body' },
        el('div', { className: 'mk-rd-img' }, ogImage ? el('img', { src: ogImage }) : null)
      ),
      el('div', { className: 'mk-rd-footer', textContent: '\u25b2 128   \ud83d\udcac 24 comments   \u21aa Share' })
    ),
  },
  {
    id: 'imessage', label: 'iMessage', iconLetter: '\ud83d\udcac', iconBg: '#34c759',
    render: ({ title, domain, ogImage }) => el('div', { className: 'mk-im-wrap' },
      el('div', { className: 'mk-im' },
        el('div', { className: 'mk-im-img' }, ogImage ? el('img', { src: ogImage }) : null),
        el('div', { className: 'mk-im-body' },
          el('div', { className: 'mk-im-title truncate-1', textContent: truncate(title, SOCIAL_LIMITS.imessage.title) }),
          el('div', { className: 'mk-im-domain', textContent: domain })
        )
      )
    ),
  },
  {
    id: 'google', label: 'Google Search', iconLetter: 'G', iconBg: '#4285f4',
    render: ({ title, description, domain, url, faviconImage, ogImage }) => el('div', { className: 'mk-gg' },
      el('div', { className: 'mk-gg-text' },
        el('div', { className: 'mk-gg-site-row' },
          el('div', { className: 'mk-gg-favicon' }, faviconImage ? el('img', { src: faviconImage }) : null),
          el('div', { className: 'mk-gg-site' },
            el('div', { textContent: domain }),
            el('div', { className: 'domain', textContent: url || 'https://' + domain })
          )
        ),
        el('div', { className: 'mk-gg-title truncate-1', textContent: truncate(title, SOCIAL_LIMITS.google.title) }),
        el('div', { className: 'mk-gg-desc truncate-2', textContent: truncate(description, SOCIAL_LIMITS.google.desc) })
      ),
      el('div', { className: 'mk-gg-thumb' }, ogImage ? el('img', { src: ogImage }) : null)
    ),
  },
  {
    id: 'facebook', label: 'Facebook', iconLetter: 'f', iconBg: '#1877f2',
    render: ({ title, description, domain, ogImage }) => el('div', { className: 'mk-fb' },
      el('div', { className: 'mk-fb-img' }, ogImage ? el('img', { src: ogImage }) : null),
      el('div', { className: 'mk-fb-body' },
        el('div', { className: 'mk-fb-domain', textContent: domain.toUpperCase() }),
        el('div', { className: 'mk-fb-title', textContent: truncate(title, SOCIAL_LIMITS.facebook.title) }),
        el('div', { className: 'mk-fb-desc truncate-2', textContent: truncate(description, SOCIAL_LIMITS.facebook.desc) })
      )
    ),
  },
  {
    id: 'discord', label: 'Discord', iconLetter: 'D', iconBg: '#5865f2',
    render: ({ title, description, domain, ogImage }) => el('div', { className: 'mk-dc' },
      el('div', { className: 'mk-dc-sitename', textContent: domain }),
      el('div', { className: 'mk-dc-title', textContent: truncate(title, SOCIAL_LIMITS.discord.title) }),
      el('div', { className: 'mk-dc-desc truncate-3', textContent: truncate(description, SOCIAL_LIMITS.discord.desc) }),
      el('div', { className: 'mk-dc-img' }, ogImage ? el('img', { src: ogImage }) : null)
    ),
  },
];

// <<< end ported

// ---------------------------------------------------------------------------
// Copy variants (mirrors src/copy.js)
// ---------------------------------------------------------------------------

function copyFor(layout) {
  const title = state.title || 'Untitled';
  const tagline = state.description || '';
  const variants = [
    { headline: title, tagline },
    { headline: title, tagline: truncate(tagline, 60) },
    { headline: tagline || title, tagline: tagline ? title : '' },
  ];
  return variants[LAYOUTS.indexOf(layout) % variants.length];
}

// ---------------------------------------------------------------------------
// OG image rendering: Satori + Inter, loaded on demand
// ---------------------------------------------------------------------------

let enginePromise = null;
function loadEngine() {
  if (!enginePromise) {
    enginePromise = Promise.all([
      import(SATORI_URL).then((m) => m.default),
      fetch(FONT_URLS[400]).then((r) => r.arrayBuffer()),
      fetch(FONT_URLS[700]).then((r) => r.arrayBuffer()),
    ]).then(([satori, regular, bold]) => ({
      satori,
      fonts: [
        { name: 'Inter', data: regular, weight: 400, style: 'normal' },
        { name: 'Inter', data: bold, weight: 700, style: 'normal' },
      ],
    })).catch((err) => {
      console.warn('Live rendering unavailable, showing pre-rendered images.', err);
      enginePromise = null;
      return null;
    });
  }
  return enginePromise;
}

const renderSeq = { A: 0, B: 0, C: 0 };
async function renderLayout(layout) {
  const engine = await loadEngine();
  if (!engine) return;
  const seq = ++renderSeq[layout];
  const o = state.overrides[layout];
  const copy = copyFor(layout);
  const cfg = {
    headline: o.headline ?? copy.headline,
    tagline: o.tagline ?? copy.tagline,
    colors: {
      background: o.background ?? state.colors.background,
      foreground: o.foreground ?? state.colors.foreground,
      accent: state.colors.accent,
      tagline: o.taglineColor ?? null,
    },
    logoBase64: null,
    headingSize: o.headingSize,
    taglineSize: o.taglineSize,
    textWidth: o.textWidth,
    align: o.align,
  };
  let svg;
  try {
    svg = await engine.satori(TEMPLATES[layout](cfg), { width: 1200, height: 630, fonts: engine.fonts });
  } catch (err) {
    console.warn('Render failed:', err);
    return;
  }
  if (seq !== renderSeq[layout]) return; // superseded by a newer render
  state.images[layout] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const tile = document.querySelector(`.tile[data-layout="${layout}"] img`);
  if (tile) tile.src = state.images[layout];
  if (layout === state.layout) renderSocialCard();
}

const renderTimers = {};
function scheduleRender(layout, delay = 150) {
  clearTimeout(renderTimers[layout]);
  renderTimers[layout] = setTimeout(() => renderLayout(layout), delay);
}
// Selected layout first; the other tiles catch up once typing pauses.
function scheduleAll() {
  scheduleRender(state.layout, 150);
  for (const l of LAYOUTS) if (l !== state.layout) scheduleRender(l, 700);
}

// ---------------------------------------------------------------------------
// Favicon rendering: canvas lettermark, same knobs as the CLI
// ---------------------------------------------------------------------------

let favCache = {};
function faviconDataUrl(mode, size) {
  const bg = fav.transparent ? null : (mode === 'dark' ? fav.darkBg : fav.background);
  const color = mode === 'dark' ? fav.darkAccent : fav.accent;
  const key = [mode, size, bg, color, fav.letter, fav.radius, fav.letterSize, fav.weight].join('|');
  if (favCache[key]) return favCache[key];

  const px = size * 2; // 2x for retina, displayed at 1x
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (bg) {
    const r = px * (fav.radius / 100);
    ctx.fillStyle = bg;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, 0, px, px, r);
    else ctx.rect(0, 0, px, px);
    ctx.fill();
  }
  const fontSize = Math.round(px * (fav.letterSize / 100));
  ctx.font = `${fav.weight} ${fontSize}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(fav.letter);
  const glyphHeight = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  const y = px / 2 + glyphHeight / 2 - m.actualBoundingBoxDescent;
  ctx.fillText(fav.letter, px / 2, y);
  return (favCache[key] = canvas.toDataURL('image/png'));
}

const FAVICON_DISPLAY = [[16, 16], [32, 32], [96, 64], [180, 96]];

function buildFaviconGrid(host, mode) {
  host.innerHTML = '';
  for (const [size, display] of FAVICON_DISPLAY) {
    host.appendChild(el('div', { className: 'fav-item' },
      el('img', { src: faviconDataUrl(mode, display), width: display, height: display, alt: '' }),
      el('span', { textContent: `${size}px` })
    ));
  }
}

function renderFavicons() {
  favCache = {};
  $('favTabLight').src = faviconDataUrl('light', 32);
  $('favTabDark').src = faviconDataUrl('dark', 32);
  $('favVLight').src = faviconDataUrl('light', 32);
  $('favVDark').src = faviconDataUrl('dark', 32);
  buildFaviconGrid($('favGridLight'), 'light');
  buildFaviconGrid($('favGridDark'), 'dark');
  buildFaviconGrid($('favGridCustom'), 'light');
  $('favGridCustom').style.background = fav.customBg;
  renderSocialCard(); // Google mockup shows the favicon
}

// ---------------------------------------------------------------------------
// Social previews
// ---------------------------------------------------------------------------

const SOCIAL_DEFAULTS = {
  title: 'Your site title',
  description: 'A short description of what this page is about.',
  url: 'https://yourdomain.com',
};

function socialCtx() {
  const url = state.url || SOCIAL_DEFAULTS.url;
  return {
    title: state.title || SOCIAL_DEFAULTS.title,
    description: state.description || SOCIAL_DEFAULTS.description,
    url,
    domain: domainFromUrl(url),
    ogImage: state.images[state.layout],
    faviconImage: faviconDataUrl('light', 96),
  };
}

function renderPlatformPills() {
  const row = $('platformPills');
  row.innerHTML = '';
  for (const p of SOCIAL_PLATFORMS) {
    const btn = el('button', { type: 'button', className: 'pill' + (p.id === state.platform ? ' active' : '') },
      platformIcon(p.id), document.createTextNode(p.label));
    btn.setAttribute('aria-pressed', String(p.id === state.platform));
    btn.addEventListener('click', () => {
      state.platform = p.id;
      renderPlatformPills();
      renderSocialCard();
    });
    row.appendChild(btn);
  }
}

function renderSocialCard() {
  const host = $('socialViewport');
  const platform = SOCIAL_PLATFORMS.find((p) => p.id === state.platform) || SOCIAL_PLATFORMS[0];
  host.innerHTML = '';
  host.appendChild(platform.render(socialCtx()));
}

// ---------------------------------------------------------------------------
// Settings panels
// ---------------------------------------------------------------------------

function row(label, control, extraClass = '') {
  return el('div', { className: 'refine-row' + (extraClass ? ' ' + extraClass : '') },
    el('span', { className: 'refine-label', textContent: label }), control);
}

// Text input that fires on every keystroke (ffInput only fires on blur).
function liveInput(label, value, onInput, { multiline = false } = {}) {
  const input = multiline
    ? el('textarea', { className: 'ff-textarea', rows: 3 })
    : el('input', { type: 'text', className: 'ff-input' });
  input.value = value || '';
  input.placeholder = label;
  input.addEventListener('input', () => onInput(input.value));
  return row(label, input, multiline ? 'textarea' : '');
}

function buildContentPanel() {
  const panel = $('metaContent');
  panel.innerHTML = '';
  panel.append(
    liveInput('title', state.title, (v) => {
      state.title = v;
      $('favVTitleLight').textContent = v;
      $('favVTitleDark').textContent = v;
      renderSocialCard();
      scheduleAll();
    }),
    liveInput('description', state.description, (v) => {
      state.description = v;
      renderSocialCard();
      scheduleAll();
    }, { multiline: true }),
    liveInput('site url', state.url, (v) => {
      state.url = v;
      renderSocialCard();
    }),
  );
}

function buildTiles() {
  const host = $('tiles');
  host.innerHTML = '';
  LAYOUTS.forEach((layout, i) => {
    const tile = el('div', { className: 'tile' + (layout === state.layout ? ' selected' : ''), 'data-layout': layout },
      el('div', { className: 'tile-img' }, el('img', { src: state.images[layout], alt: `Option ${i + 1}` })),
      el('div', { className: 'tile-label', textContent: `Option ${i + 1}` })
    );
    tile.setAttribute('role', 'radio');
    tile.setAttribute('tabindex', '0');
    tile.setAttribute('aria-checked', String(layout === state.layout));
    const select = () => selectLayout(layout);
    tile.addEventListener('click', select);
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); }
    });
    host.appendChild(tile);
  });
}

function selectLayout(layout) {
  state.layout = layout;
  document.querySelectorAll('.tile').forEach((t) => {
    const on = t.dataset.layout === layout;
    t.classList.toggle('selected', on);
    t.setAttribute('aria-checked', String(on));
  });
  buildSettingsPanel();
  renderSocialCard();
}

function buildSettingsPanel() {
  const layout = state.layout;
  const o = state.overrides[layout];
  const copy = copyFor(layout);
  const set = (key, value) => { o[key] = value; scheduleRender(layout); };
  const alignOpts = [
    { value: 'left', label: 'Left' },
    { value: 'center', label: 'Center' },
    { value: 'right', label: 'Right' },
  ];
  const panel = $('metaSettings');
  panel.innerHTML = '';
  panel.append(
    liveInput('headline', o.headline ?? copy.headline, (v) => set('headline', v)),
    liveInput('tagline', o.tagline ?? copy.tagline, (v) => set('tagline', v)),
    ffColor('background color', o.background ?? state.colors.background, (v) => set('background', v)),
    ffColor('headline color', o.foreground ?? state.colors.foreground, (v) => set('foreground', v)),
    ffColor('tagline color', o.taglineColor ?? state.colors.foreground, (v) => set('taglineColor', v)),
    row('headline size', ffSlider(o.headingSize ?? DEFAULT_HEADING_SIZES[layout], 24, 96, 'px', (v) => set('headingSize', v))),
    row('tagline size', ffSlider(o.taglineSize ?? DEFAULT_TAGLINE_SIZES[layout], 14, 48, 'px', (v) => set('taglineSize', v))),
    row('text width', ffSlider(o.textWidth ?? DEFAULT_TEXT_WIDTHS[layout], 320, 1040, 'px', (v) => set('textWidth', v))),
    ffSelect('alignment', alignOpts, o.align ?? DEFAULT_ALIGN[layout], (v) => set('align', v)),
  );
}

function buildFaviconPanel() {
  const panel = $('favSettings');
  panel.innerHTML = '';
  const update = () => renderFavicons();

  const letterInput = el('input', { type: 'text', className: 'ff-input', value: fav.letter, maxLength: '4' });
  letterInput.style.width = '80px';
  letterInput.style.flex = 'none';
  letterInput.addEventListener('input', () => {
    fav.letter = letterInput.value.trim() || 'A';
    update();
  });

  const opaqueRows = [
    ffColor('background', fav.background, (v) => { fav.background = v; update(); }),
    ffColor('dark bg', fav.darkBg, (v) => { fav.darkBg = v; update(); }),
    row('corner radius', ffSlider(fav.radius, 0, 50, '%', (v) => { fav.radius = v; update(); })),
  ];

  panel.append(
    row('transparent', ffToggle('Transparent background', fav.transparent, (v) => {
      fav.transparent = v;
      opaqueRows.forEach((r) => { r.style.display = v ? 'none' : ''; });
      update();
    })),
    ...opaqueRows,
    ffColor('letter color', fav.accent, (v) => { fav.accent = v; update(); }),
    ffColor('dark letter color', fav.darkAccent, (v) => { fav.darkAccent = v; update(); }),
    row('letter', letterInput),
    row('letter size', ffSlider(fav.letterSize, 20, 80, '%', (v) => { fav.letterSize = v; update(); })),
    ffSelect('font weight', [{ value: '400', label: 'Regular' }, { value: '700', label: 'Bold' }], String(fav.weight), (v) => {
      fav.weight = parseInt(v, 10);
      update();
    }),
  );

  // Custom background tint picker (client-side only, like the CLI).
  const hex = el('span', { className: 'ff-color-hex', textContent: fav.customBg });
  const swatch = el('input', { type: 'color', className: 'ff-color-swatch', value: fav.customBg });
  swatch.addEventListener('input', () => {
    fav.customBg = swatch.value;
    hex.textContent = swatch.value;
    $('favGridCustom').style.background = swatch.value;
  });
  const wrap = el('div', { className: 'ff-color-wrap' });
  wrap.addEventListener('click', () => swatch.click());
  wrap.append(swatch, hex);
  $('favCustomPicker').appendChild(wrap);
}

// ---------------------------------------------------------------------------
// Tabs and mode toggles
// ---------------------------------------------------------------------------

function wireToggles(groupId, attr, panelSelector, onChange) {
  const buttons = document.querySelectorAll(`#${groupId} [${attr}]`);
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const value = btn.getAttribute(attr);
      buttons.forEach((b) => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      document.querySelectorAll(panelSelector).forEach((p) => {
        p.classList.toggle('active', p.getAttribute(attr) === value);
      });
      if (onChange) onChange(value);
    });
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function init() {
  renderPlatformPills();
  renderSocialCard();
  buildContentPanel();
  buildTiles();
  buildSettingsPanel();
  buildFaviconPanel();
  wireToggles('metaTabs', 'data-tab', '#demoMeta .panel');
  wireToggles('favModes', 'data-mode', '.fav-panel');
  $('favVTitleLight').textContent = state.title;
  $('favVTitleDark').textContent = state.title;

  renderFavicons();
  // Redraw once Inter is available so the lettermark uses the right font.
  document.fonts.load('700 32px Inter').then(renderFavicons).catch(() => {});

  // Load Satori when the demo scrolls into view, or on first interaction.
  const demo = document.querySelector('.demo');
  const warm = () => {
    for (const l of LAYOUTS) scheduleRender(l, l === state.layout ? 0 : 400);
  };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); warm(); }
    }, { rootMargin: '400px' });
    io.observe(demo);
  } else {
    warm();
  }
}

init();
