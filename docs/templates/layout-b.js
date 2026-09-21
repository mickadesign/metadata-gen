/**
 * Layout B — Centered stack: logo, headline, tagline.
 * Customizable via align, logoSize, logoGap, logoPosition.
 */
export function layoutB(config) {
  const {
    headline,
    tagline,
    colors,
    logoBase64,
    headingSize = 56,
    taglineSize = 26,
    align = 'center',
    logoSize = 80,
    logoGap = 32,
    logoPosition = 'top',
    headingFont = 'Inter',
    taglineFont = 'Inter',
  } = config;

  const isLogoTop = logoPosition === 'top' && logoBase64;
  const crossAlign =
    align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';

  const logoImg = logoBase64
    ? {
        type: 'img',
        props: {
          src: logoBase64,
          width: logoSize,
          height: logoSize,
          style: {
            [isLogoTop ? 'marginBottom' : 'marginRight']: `${logoGap}px`,
            flexShrink: 0,
          },
        },
      }
    : null;

  const textBlock = {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: crossAlign,
        maxWidth: '900px',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              fontSize: headingSize,
              fontWeight: 700,
              color: colors.foreground,
              textAlign: align,
              lineHeight: 1.15,
              fontFamily: headingFont,
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
                  textAlign: align,
                  marginTop: '20px',
                  maxWidth: '700px',
                  lineHeight: 1.4,
                  fontFamily: taglineFont,
                },
                children: tagline,
              },
            }
          : null,
      ].filter(Boolean),
    },
  };

  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: isLogoTop ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        backgroundColor: colors.background,
        padding: '60px 80px',
        fontFamily: 'Inter',
      },
      children: [logoImg, textBlock].filter(Boolean),
    },
  };
}
