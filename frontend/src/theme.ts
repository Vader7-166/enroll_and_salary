import type { ThemeConfig } from 'antd';
import tokens from '../../docs/config/hrtp-ui-tokens.json';

export const theme: ThemeConfig = {
  token: {
    ...tokens.antd.token,
    colorTextDescription: tokens.antd.token.colorTextSecondary,
    colorSuccessBg: tokens.semantic.success.background,
    colorSuccessBorder: tokens.semantic.success.border,
    colorSuccessText: tokens.semantic.success.text,
    colorErrorBg: tokens.semantic.error.background,
    colorErrorBorder: tokens.semantic.error.border,
    colorErrorText: tokens.semantic.error.text,
    colorWarningBg: tokens.semantic.warning.background,
    colorWarningBorder: tokens.semantic.warning.border,
    colorWarningText: tokens.semantic.warning.text,
    colorInfoBg: tokens.semantic.info.background,
    colorInfoBorder: tokens.semantic.info.border,
    colorInfoText: tokens.semantic.info.text,
    colorTextDisabled: tokens.semantic.disabled.text,
    colorBgContainerDisabled: tokens.semantic.disabled.background,
    controlOutline: tokens.semantic.actionSecondary.background,
  },
  components: {
    Descriptions: { labelColor: tokens.antd.token.colorTextSecondary },
    Layout: { siderBg: tokens.semantic.navigation.background },
    Menu: {
      darkItemBg: tokens.semantic.navigation.background,
      darkSubMenuItemBg: tokens.semantic.navigation.background,
      darkItemColor: tokens.semantic.navigation.text,
      darkItemHoverColor: tokens.semantic.navigation.selectedText,
      darkItemHoverBg: tokens.semantic.navigation.hoverBackground,
      darkItemSelectedBg: tokens.semantic.navigation.selectedBackground,
      darkItemSelectedColor: tokens.semantic.navigation.selectedText,
      darkGroupTitleColor: tokens.semantic.navigation.text,
    },
    Table: {
      headerBg: tokens.semantic.table.headerBackground,
      headerColor: tokens.semantic.table.headerText,
      rowHoverBg: tokens.semantic.table.rowHover,
      rowSelectedBg: tokens.semantic.table.rowSelected,
      rowSelectedHoverBg: tokens.semantic.table.rowSelected,
    },
    Tag: {
      defaultColor: tokens.semantic.neutral.text,
      defaultBg: tokens.semantic.neutral.background,
    },
    Button: {
      defaultColor: tokens.antd.token.colorTextSecondary,
      defaultShadow: 'none',
      primaryShadow: 'none',
      dangerShadow: 'none',
    },
  },
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
  '--primary-hover': tokens.antd.token.colorPrimaryHover,
  '--focus': tokens.semantic.focus,
  '--on-brand': tokens.semantic.navigation.selectedText,
  '--nav-bg': tokens.semantic.navigation.background,
  '--nav-text': tokens.semantic.navigation.text,
  '--nav-indicator': tokens.semantic.navigation.indicator,
  '--secondary-action-bg': tokens.semantic.actionSecondary.background,
  '--secondary-action-text': tokens.semantic.actionSecondary.text,
  '--table-hover': tokens.semantic.table.rowHover,
  '--locked-text': tokens.semantic.locked.text,
  '--locked-bg': tokens.semantic.locked.background,
  '--error-text': tokens.semantic.error.text,
  '--error-bg': tokens.semantic.error.background,
  '--error-border': tokens.semantic.error.border,
  '--font': tokens.antd.token.fontFamily,
  '--radius': tokens.antd.token.borderRadius + 'px',
  '--header-height': tokens.layout.headerHeightPx + 'px',
  '--page-padding': tokens.layout.desktopPaddingPx + 'px',
};
for (const [name, colors] of Object.entries(tokens.modules)) {
  variables[`--module-${name}`] = colors.text;
  variables[`--module-${name}-bg`] = colors.background;
}
for (const [key, value] of Object.entries(variables)) document.documentElement.style.setProperty(key, value);
