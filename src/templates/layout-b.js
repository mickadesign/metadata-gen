/**
 * Layout B — Centered title + tagline, logo above, accent background strip.
 * Placeholder template.
 */
export function layoutB(config) {
  const { headline, tagline, colors, logoBase64 } = config;

  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        backgroundColor: colors.background,
        fontFamily: 'Inter',
        position: 'relative',
      },
      children: [
        // Accent strip at top
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '8px',
              backgroundColor: colors.accent,
            },
          },
        },
        // Logo
        logoBase64
          ? {
              type: 'img',
              props: {
                src: logoBase64,
                width: 80,
                height: 80,
                style: {
                  marginBottom: '32px',
                },
              },
            }
          : null,
        // Headline
        {
          type: 'div',
          props: {
            style: {
              fontSize: 56,
              fontWeight: 700,
              color: colors.foreground,
              textAlign: 'center',
              lineHeight: 1.15,
              maxWidth: '900px',
            },
            children: headline,
          },
        },
        // Tagline
        tagline
          ? {
              type: 'div',
              props: {
                style: {
                  fontSize: 26,
                  color: colors.foreground,
                  opacity: 0.6,
                  textAlign: 'center',
                  marginTop: '20px',
                  maxWidth: '700px',
                  lineHeight: 1.4,
                },
                children: tagline,
              },
            }
          : null,
      ].filter(Boolean),
    },
  };
}
