// Tool definitions shared by the preview page (WebMCP, document.modelContext)
// and the preview server (MCP over HTTP / stdio). This file is data plus a
// binder: no DOM, no Express, no Node imports, so the browser can load it as
// an ES module and the server can import it.

const LAYOUT_PARAM = {
  type: 'string',
  description: 'Layout letter such as "A". See get_project.layouts.',
};

export const OG_OVERRIDE_PROPERTIES = {
  headline: { type: 'string', maxLength: 500, description: 'Headline text. Omit to use the default copy.' },
  tagline: { type: 'string', maxLength: 500, description: 'Tagline text under the headline.' },
  background: { type: 'string', description: 'Background color as hex, e.g. #0f0f0f.' },
  foreground: { type: 'string', description: 'Headline color as hex.' },
  accent: { type: 'string', description: 'Accent color as hex.' },
  taglineColor: { type: 'string', description: 'Tagline color as hex. Defaults to the headline color at 70% opacity.' },
  headingSize: { type: 'number', minimum: 12, maximum: 120, description: 'Headline font size in px.' },
  taglineSize: { type: 'number', minimum: 12, maximum: 120, description: 'Tagline font size in px.' },
  textWidth: { type: 'number', minimum: 320, maximum: 1040, description: 'Max width of the text block in px. Keep text inside it so square crops still show it.' },
  align: { type: 'string', enum: ['left', 'center', 'right'], description: 'Text alignment.' },
  showLogo: { type: 'boolean', description: 'Whether the logo is drawn.' },
  logoPath: { type: 'string', description: 'Logo file, one of get_project.logoCandidates.' },
  logoPosition: { type: 'string', enum: ['top', 'left'], description: 'Logo above the headline or beside it.' },
  logoSize: { type: 'number', minimum: 24, maximum: 300, description: 'Logo size in px.' },
  logoGap: { type: 'number', minimum: 0, maximum: 160, description: 'Space between logo and headline in px.' },
  headingFont: { type: 'string', description: '"__inter__" or a font path from get_project.fonts.' },
  taglineFont: { type: 'string', description: '"__inter__" or a font path from get_project.fonts.' },
};

export const FAVICON_OPTION_PROPERTIES = {
  letter: { type: 'string', maxLength: 4, description: 'Lettermark text, 1 to 4 characters.' },
  faviconSrc: { type: ['string', 'null'], description: 'Logo file from get_project.logoCandidates, or null for a lettermark.' },
  background: { type: 'string', description: 'Light-mode tile background as hex.' },
  darkBg: { type: 'string', description: 'Dark-mode tile background as hex.' },
  accent: { type: 'string', description: 'Lettermark color as hex.' },
  darkAccent: { type: 'string', description: 'Lettermark color in dark mode as hex.' },
  customBg: { type: 'string', description: 'Page tint behind the custom-background preview as hex.' },
  letterSize: { type: 'number', minimum: 20, maximum: 80, description: 'Letter size as percent of the tile.' },
  borderRadius: { type: 'number', minimum: 0, maximum: 50, description: 'Corner radius as percent of the tile.' },
  transparent: { type: 'boolean', description: 'Transparent tile background.' },
  fontWeight: { type: 'number', enum: [400, 700], description: 'Lettermark weight.' },
};

const SOCIAL_PROPERTIES = {
  title: { type: 'string', maxLength: 500, description: 'Site title used by social cards and as default headline.' },
  tagline: { type: 'string', maxLength: 500, description: 'Site description used by social cards and as default tagline.' },
  url: { type: 'string', maxLength: 500, description: 'Canonical site URL.' },
};

const REVISION_PARAM = {
  type: 'number',
  description: 'Revision from the last render or preview call. Required; the save is refused when the preview changed since.',
};

/** Allow `null` so an agent can reset a key, as the descriptions promise. */
function nullable(schema) {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const out = { ...schema, type: types.includes('null') ? types : [...types, 'null'] };
  if (schema.enum && !schema.enum.includes(null)) out.enum = [...schema.enum, null];
  return out;
}

function nullableAll(properties) {
  return Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, nullable(v)]));
}

function obj(properties, required = []) {
  return { type: 'object', properties, required, additionalProperties: false };
}

// `kind` drives consent in the page: write tools ask the user before running.
// Annotations carry both the WebMCP hints (readOnlyHint, consequentialHint,
// untrustedContentHint) and the MCP ones (destructiveHint, idempotentHint,
// openWorldHint); each consumer ignores the keys it does not know.
export const TOOL_DEFINITIONS = [
  {
    name: 'get_project',
    kind: 'read',
    description: 'Read the project: title, tagline, colors, layouts, logo and font candidates, OG and favicon settings, preview URLs.',
    inputSchema: obj({}),
    annotations: { readOnlyHint: true, untrustedContentHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Get project' },
  },
  {
    name: 'get_og_preview',
    kind: 'read',
    description: 'Get the preview PNG URL and current revision for one OG image layout.',
    inputSchema: obj({ layout: LAYOUT_PARAM }, ['layout']),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Get OG preview' },
  },
  {
    name: 'get_favicon_preview',
    kind: 'read',
    description: 'Get the preview PNG URL for the favicon at one size and color mode.',
    inputSchema: obj({
      mode: { type: 'string', enum: ['light', 'dark', 'custom'], description: 'Color mode.' },
      size: { type: 'number', enum: [16, 32, 96, 180], description: 'Icon size in px.' },
    }, ['mode', 'size']),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Get favicon preview' },
  },
  {
    name: 'select_layout',
    kind: 'render',
    description: 'Select which OG image layout the preview page shows in its social mockups and settings panel.',
    inputSchema: obj({ layout: LAYOUT_PARAM }, ['layout']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Select layout' },
  },
  {
    name: 'set_og_overrides',
    kind: 'render',
    description: 'Change one OG layout: text, colors, sizes, alignment, logo, fonts. Merges, re-renders, updates the page.',
    inputSchema: obj({
      layout: LAYOUT_PARAM,
      overrides: { ...obj(nullableAll(OG_OVERRIDE_PROPERTIES)), description: 'Settings to change. Set a key to null to return it to its default.' },
    }, ['layout', 'overrides']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Set OG overrides' },
  },
  {
    name: 'reset_og_overrides',
    kind: 'render',
    description: 'Return one OG image layout to its default settings and re-render it.',
    inputSchema: obj({ layout: LAYOUT_PARAM }, ['layout']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Reset OG overrides' },
  },
  {
    name: 'set_favicon_options',
    kind: 'render',
    description: 'Change the favicon: lettermark or logo, colors, corner radius, transparency, letter size, weight. Merges and re-renders.',
    inputSchema: obj({
      options: { ...obj(nullableAll(FAVICON_OPTION_PROPERTIES)), description: 'Settings to change. Set a key to null to return it to its default, except faviconSrc where null selects the lettermark.' },
    }, ['options']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Set favicon options' },
  },
  {
    name: 'set_social_text',
    kind: 'render',
    description: 'Change the title, description and URL used by social mockups and default OG copy. Preview only until save_config.',
    inputSchema: obj(SOCIAL_PROPERTIES),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Set social text' },
  },
  {
    name: 'save_config',
    kind: 'write',
    description: 'Write title, tagline and URL to metadata.config.json in the project. Asks the user for confirmation in the preview page.',
    inputSchema: obj(SOCIAL_PROPERTIES),
    annotations: { readOnlyHint: false, consequentialHint: true, destructiveHint: true, idempotentHint: true, openWorldHint: false, title: 'Save config' },
  },
  {
    name: 'save_og_image',
    kind: 'write',
    description: 'Write one layout\'s OG image as og.png in the output folder, overwriting it. Asks the user for confirmation.',
    inputSchema: obj({ layout: LAYOUT_PARAM, revision: REVISION_PARAM }, ['layout', 'revision']),
    annotations: { readOnlyHint: false, consequentialHint: true, destructiveHint: true, idempotentHint: true, openWorldHint: false, title: 'Save OG image' },
  },
  {
    name: 'save_favicon_set',
    kind: 'write',
    description: 'Write the favicon set (ICO, SVG, PNGs, webmanifest) to the output folder, overwriting it. Asks for confirmation.',
    inputSchema: obj({ revision: REVISION_PARAM }, ['revision']),
    annotations: { readOnlyHint: false, consequentialHint: true, destructiveHint: true, idempotentHint: true, openWorldHint: false, title: 'Save favicon set' },
  },
];

const API_METHODS = {
  get_project: 'getProject',
  get_og_preview: 'getOgPreview',
  get_favicon_preview: 'getFaviconPreview',
  select_layout: 'selectLayout',
  set_og_overrides: 'setOgOverrides',
  reset_og_overrides: 'resetOgOverrides',
  set_favicon_options: 'setFaviconOptions',
  set_social_text: 'setSocialText',
  save_config: 'saveConfig',
  save_og_image: 'saveOgImage',
  save_favicon_set: 'saveFaviconSet',
};

/** Format a plain value as a tool result both WebMCP and MCP accept. */
export function toolResult(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const result = { content: [{ type: 'text', text }] };
  if (value && typeof value === 'object') result.structuredContent = value;
  return result;
}

export function toolError(message) {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

/**
 * Attach execute handlers to the definitions. `api` implements one method per
 * tool (see API_METHODS); each returns a plain object or throws an Error whose
 * message tells the agent how to correct the call.
 */
export function bindTools(api) {
  return TOOL_DEFINITIONS.map((def) => {
    const method = API_METHODS[def.name];
    if (typeof api[method] !== 'function') {
      throw new Error(`Tool api is missing ${method}() for ${def.name}`);
    }
    return {
      ...def,
      async execute(input, options = {}) {
        try {
          const value = await api[method](input || {}, options);
          return toolResult(value);
        } catch (err) {
          return toolError(err && err.message ? err.message : String(err));
        }
      },
    };
  });
}

/** The MCP-facing shape of a tool: no execute, no kind. */
export function describeTool(tool) {
  const { name, description, inputSchema, annotations } = tool;
  return { name, description, inputSchema, annotations };
}
