/**
 * Truncate a string to a maximum length, adding ellipsis if needed.
 */
function truncate(str, maxLen) {
  if (!str || str.length <= maxLen) return str || '';
  return str.slice(0, maxLen - 1).trim() + '\u2026';
}

/**
 * Generate 3 deterministic copy variants from config.
 *
 * @param {{ title: string, tagline: string }} config
 * @returns {Array<{ headline: string, tagline: string }>}
 */
export function generateCopyVariants(config) {
  const title = config.title || 'Untitled';
  const tagline = config.tagline || '';

  return [
    // Option 1: title + tagline as-is
    {
      headline: title,
      tagline: tagline,
    },
    // Option 2: title styled, tagline truncated
    {
      headline: title,
      tagline: truncate(tagline, 60),
    },
    // Option 3: tagline promoted to headline, title as sub-label
    {
      headline: tagline || title,
      tagline: tagline ? title : '',
    },
  ];
}
