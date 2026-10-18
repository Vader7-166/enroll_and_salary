import type { ThemeConfig } from 'antd';
import tokens from '../../docs/config/hrtp-ui-tokens.json';

export const theme: ThemeConfig = {
  token: {
    ...tokens.antd.token,
    colorPrimaryHover: tokens.semantic.brandInk,
    colorPrimaryActive: tokens.semantic.brandInk,
    colorTextDescription: tokens.antd.token.colorTextSecondary,
    colorSuccessBg: tokens.semantic.success.background,
    colorSuccessBorder: tokens.semantic.divider,
    colorSuccessText: tokens.semantic.success.text,
    colorErrorBg: tokens.semantic.error.background,
    colorErrorBorder: tokens.semantic.divider,
    colorErrorText: tokens.semantic.error.text,
    colorWarningBg: tokens.semantic.warning.background,
    colorWarningBorder: tokens.semantic.divider,
    colorWarningText: tokens.semantic.warning.text,
    colorInfoBg: tokens.semantic.info.background,
    colorInfoBorder: tokens.semantic.divider,
    colorInfoText: tokens.semantic.info.text,
  },
  components: { Descriptions: { labelColor: tokens.antd.token.colorTextSecondary } },
};

// Both Ant Design and custom layout consume the repository's single token source.
const variables: Record<string, string> = {
  '--brand': tokens.semantic.brandInk,
  '--surface': tokens.semantic.surface,
  '--canvas': tokens.semantic.canvas,
  '--divider': tokens.semantic.divider,
  '--text': tokens.antd.token.colorText,
  '--secondary': tokens.antd.token.colorTextSecondary,
  '--primary': tokens.antd.token.colorPrimary,
  '--font': tokens.antd.token.fontFamily,
  '--radius': tokens.antd.token.borderRadius + 'px',
  '--header-height': tokens.layout.headerHeightPx + 'px',
  '--page-padding': tokens.layout.desktopPaddingPx + 'px',
};
for (const [key, value] of Object.entries(variables)) document.documentElement.style.setProperty(key, value);
