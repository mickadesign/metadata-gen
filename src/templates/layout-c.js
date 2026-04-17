/**
 * Layout C — Dominant headline, small tagline pinned bottom-left,
 * optional logo top-left. Customizable via align, logoSize, logoGap, logoPosition.
 */
export function layoutC(config) {
  const {
    headline,
    tagline,
    colors,
    logoBase64,
    headingSize = 72,
    taglineSize = 22,
    align = 'left',
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

  const headlineNode = {
    type: 'div',
    props: {
      style: {
        fontSize: headingSize,
        fontWeight: 700,
        color: colors.foreground,
        lineHeight: 1.1,
        maxWidth: '1000px',
        textAlign: align,
        fontFamily: headingFont,
      },
      children: headline,
    },
  };

  // Headline + optional logo. Logo=top stacks vertically; logo=left puts logo on the left.
  const hero = {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: isLogoTop ? 'column' : 'row',
        alignItems: isLogoTop ? crossAlign : 'center',
        justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
        flex: 1,
      },
      children: [logoImg, headlineNode].filter(Boolean),
    },
  };

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
        hero,
        tagline
          ? {
              type: 'div',
              props: {
                style: {
                  position: 'absolute',
                  bottom: '40px',
                  left: '80px',
                  fontSize: taglineSize,
                  fontWeight: 600,
                  color: colors.tagline || colors.accent,
                  letterSpacing: '0.05em',
                  fontFamily: taglineFont,
                },
                children: tagline,
              },
            }
          : null,
      ].filter(Boolean),
    },
  };
}
