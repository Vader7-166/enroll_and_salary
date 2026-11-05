import type { ThemeConfig } from 'antd';
import tokens from '../../docs/config/hrtp-ui-tokens.json';

export const theme: ThemeConfig = {
  token: {
    ...tokens.antd.token,
    fontSizeHeading1: tokens.typographyPx.pageTitle,
    fontSizeHeading2: tokens.typographyPx.sectionTitle,
    lineHeight: 1.6,
    motionDurationFast: `${tokens.motionMs.fast / 1000}s`,
    motionDurationMid: `${tokens.motionMs.normal / 1000}s`,
    motionDurationSlow: `${tokens.motionMs.slow / 1000}s`,
    colorBgElevated: tokens.semantic.surface,
    colorFillAlter: tokens.semantic.table.headerBackground,
    boxShadow: `0 8px 24px ${tokens.semantic.brandInk}14`,
    boxShadowSecondary: `0 12px 32px ${tokens.semantic.brandInk}1F`,
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
    Descriptions: { labelColor: tokens.antd.token.colorTextSecondary, labelBg: tokens.semantic.canvas },
    Layout: { siderBg: tokens.semantic.navigation.background, bodyBg: tokens.semantic.canvas, headerBg: tokens.semantic.surface },
    Menu: {
      darkItemBg: tokens.semantic.navigation.background,
      darkSubMenuItemBg: tokens.semantic.navigation.background,
      darkItemColor: tokens.semantic.navigation.text,
      darkItemHoverColor: tokens.semantic.navigation.text,
      darkItemHoverBg: tokens.semantic.navigation.hoverBackground,
      darkItemSelectedBg: tokens.semantic.navigation.selectedBackground,
      darkItemSelectedColor: tokens.semantic.navigation.selectedText,
      darkGroupTitleColor: tokens.semantic.navigation.text,
      itemHeight: 42,
      itemBorderRadius: 8,
      itemMarginBlock: 4,
      groupTitleFontSize: 12,
    },
    Table: {
      headerBg: tokens.semantic.table.headerBackground,
      headerColor: tokens.semantic.table.headerText,
      rowHoverBg: tokens.semantic.table.rowHover,
      rowSelectedBg: tokens.semantic.table.rowSelected,
      rowSelectedHoverBg: tokens.semantic.table.rowSelected,
      cellPaddingBlock: 10,
      cellPaddingInline: 12,
      cellPaddingBlockMD: 8,
      cellPaddingInlineMD: 10,
    },
    Tabs: { inkBarColor: tokens.antd.token.colorPrimary, itemSelectedColor: tokens.antd.token.colorPrimaryHover, itemHoverColor: tokens.antd.token.colorPrimaryHover, titleFontSize: 14 },
    Modal: { titleFontSize: 20, borderRadiusLG: tokens.layout.surfaceRadiusPx },
    Drawer: { footerPaddingBlock: 16, footerPaddingInline: 24 },
    Empty: { colorTextDescription: tokens.antd.token.colorTextSecondary },
    Pagination: { itemActiveBg: tokens.palette.mint },
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
  '--on-brand': tokens.semantic.surface,
  '--nav-selected-text': tokens.semantic.navigation.selectedText,
  '--nav-bg': tokens.semantic.navigation.background,
  '--nav-text': tokens.semantic.navigation.text,
  '--nav-indicator': tokens.semantic.navigation.indicator,
  '--nav-hover': tokens.semantic.navigation.hoverBackground,
  '--nav-selected-bg': tokens.semantic.navigation.selectedBackground,
  '--secondary-action-bg': tokens.semantic.actionSecondary.background,
  '--secondary-action-text': tokens.semantic.actionSecondary.text,
  '--table-hover': tokens.semantic.table.rowHover,
  '--locked-text': tokens.semantic.locked.text,
  '--locked-bg': tokens.semantic.locked.background,
  '--error-text': tokens.semantic.error.text,
  '--error-bg': tokens.semantic.error.background,
  '--error-border': tokens.semantic.error.border,
  '--control-border': tokens.antd.token.colorBorder,
  '--font': tokens.antd.token.fontFamily,
  '--radius': tokens.antd.token.borderRadius + 'px',
  '--header-height': tokens.layout.headerHeightPx + 'px',
  '--surface-radius': tokens.layout.surfaceRadiusPx + 'px',
  '--page-title-size': tokens.typographyPx.pageTitle + 'px',
  '--sidebar-width': tokens.layout.sidebarWidthPx + 'px',
  '--icon-nav-size': tokens.iconSizePx.navigation + 'px',
  '--icon-page-size': tokens.iconSizePx.page + 'px',
  '--icon-action-size': tokens.iconSizePx.action + 'px',
  '--page-padding': tokens.layout.desktopPaddingPx + 'px',
  '--motion-fast': tokens.motionMs.fast + 'ms',
  '--motion-normal': tokens.motionMs.normal + 'ms',
  '--motion-slow': tokens.motionMs.slow + 'ms',
};
for (const [name, color] of Object.entries(tokens.palette)) {
  variables[`--tone-${name.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())}`] = color;
}
for (const name of ['success', 'warning', 'error', 'info'] as const) {
  const colors = tokens.semantic[name];
  variables[`--status-${name}-text`] = colors.text;
  variables[`--status-${name}-bg`] = colors.background;
  variables[`--status-${name}-border`] = colors.border;
}
for (const [name, colors] of Object.entries(tokens.modules)) {
  variables[`--module-${name}`] = colors.text;
  variables[`--module-${name}-bg`] = colors.background;
  variables[`--module-${name}-canvas`] = colors.canvas;
  variables[`--module-${name}-art`] = colors.ornament;
}
for (const [key, value] of Object.entries(variables)) document.documentElement.style.setProperty(key, value);
