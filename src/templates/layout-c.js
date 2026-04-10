/**
 * Layout C — Tagline as large headline, title as small label bottom-right, no logo.
 * Placeholder template.
 */
export function layoutC(config) {
  const { headline, tagline, colors } = config;

  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        backgroundColor: colors.background,
        padding: '60px 80px',
        fontFamily: 'Inter',
        position: 'relative',
      },
      children: [
        // Large headline (tagline promoted)
        {
          type: 'div',
          props: {
            style: {
              fontSize: 72,
              fontWeight: 700,
              color: colors.foreground,
              lineHeight: 1.1,
              maxWidth: '1000px',
            },
            children: headline,
          },
        },
        // Small label bottom-right (title as sub-label)
        tagline
          ? {
              type: 'div',
              props: {
                style: {
                  position: 'absolute',
                  bottom: '40px',
                  right: '80px',
                  fontSize: 22,
                  fontWeight: 600,
                  color: colors.accent,
                  letterSpacing: '0.05em',
                },
                children: tagline,
              },
            }
          : null,
        // Accent left border
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute',
              top: 0,
              left: 0,
              width: '6px',
              height: '100%',
              backgroundColor: colors.accent,
            },
          },
        },
      ].filter(Boolean),
    },
  };
}
