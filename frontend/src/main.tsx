import "@ant-design/v5-patch-for-react-19";
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import viVN from 'antd/locale/vi_VN';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource/be-vietnam-pro/latin-400.css';
import '@fontsource/be-vietnam-pro/vietnamese-400.css';
import '@fontsource/be-vietnam-pro/latin-500.css';
import '@fontsource/be-vietnam-pro/vietnamese-500.css';
import '@fontsource/be-vietnam-pro/latin-600.css';
import '@fontsource/be-vietnam-pro/vietnamese-600.css';
import 'antd/dist/reset.css';
import './styles.css';
import { theme } from './theme';
import { App } from './App';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const reducedMotionTheme = { ...theme, token: { ...theme.token, motion: false } };
const getReducedMotion = () => motionPreference.matches;
const subscribeMotionPreference = (onChange: () => void) => {
  motionPreference.addEventListener('change', onChange);
  return () => motionPreference.removeEventListener('change', onChange);
};

function Root() {
  const reducedMotion = React.useSyncExternalStore(subscribeMotionPreference, getReducedMotion);
  return (
    <ConfigProvider theme={reducedMotion ? reducedMotionTheme : theme} locale={viVN}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
