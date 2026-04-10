/**
 * Layout B — Centered title + tagline, logo above, accent background strip.
 * Placeholder template.
 */
export function layoutB(config) {
  const { headline, tagline, colors, logoBase64, headingSize = 56, taglineSize = 26 } = config;

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
        {
          type: 'div',
          props: {
            style: {
              fontSize: headingSize,
              fontWeight: 700,
              color: colors.foreground,
              textAlign: 'center',
              lineHeight: 1.15,
              maxWidth: '900px',
            },
            children: headline,
          },
        },
        tagline
          ? {
              type: 'div',
              props: {
                style: {
                  fontSize: taglineSize,
                  color: colors.tagline || colors.foreground,
                  opacity: colors.tagline ? 1 : 0.6,
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
