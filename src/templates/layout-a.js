/**
 * Layout A — Logo left, title + tagline right, accent bottom border.
 * Placeholder template. Pure function: (config) => Satori JSX.
 *
 * @param {{ headline: string, tagline: string, colors: { background: string, foreground: string, accent: string }, logoBase64?: string }} config
 * @returns {object} Satori-compatible JSX (React.createElement style)
 */
export function layoutA(config) {
  const { headline, tagline, colors, logoBase64 } = config;

  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        width: '100%',
        height: '100%',
        backgroundColor: colors.background,
        padding: '60px 80px',
        fontFamily: 'Inter',
      },
      children: [
        // Logo (left)
        logoBase64
          ? {
              type: 'img',
              props: {
                src: logoBase64,
                width: 120,
                height: 120,
                style: {
                  marginRight: '60px',
                  flexShrink: 0,
                },
              },
            }
          : null,
        // Text block (right)
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              flex: 1,
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: 64,
                    fontWeight: 700,
                    color: colors.foreground,
                    lineHeight: 1.1,
                  },
                  children: headline,
                },
              },
              tagline
                ? {
                    type: 'div',
                    props: {
                      style: {
                        fontSize: 28,
                        color: colors.foreground,
                        opacity: 0.7,
                        marginTop: '20px',
                        lineHeight: 1.4,
                      },
                      children: tagline,
                    },
                  }
                : null,
            ].filter(Boolean),
          },
        },
        // Accent bottom border
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute',
              bottom: 0,
              left: 0,
              width: '100%',
              height: '6px',
              backgroundColor: colors.accent,
            },
          },
        },
      ].filter(Boolean),
    },
  };
}
