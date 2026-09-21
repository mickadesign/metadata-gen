/**
 * Layout A — Hero with logo and headline side-by-side (or stacked) plus tagline.
 * Customizable via align, logoSize, logoGap, logoPosition.
 */
export function layoutA(config) {
  const {
    headline,
    tagline,
    colors,
    logoBase64,
    headingSize = 64,
    taglineSize = 28,
    align = 'left',
    logoSize = 120,
    logoGap = 60,
    logoPosition = 'left',
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
        justifyContent: 'center',
        alignItems: crossAlign,
        flex: 1,
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              fontSize: headingSize,
              fontWeight: 700,
              color: colors.foreground,
              lineHeight: 1.1,
              textAlign: align,
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
                  opacity: colors.tagline ? 1 : 0.7,
                  marginTop: '20px',
                  lineHeight: 1.4,
                  textAlign: align,
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
        alignItems: isLogoTop ? crossAlign : 'center',
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
