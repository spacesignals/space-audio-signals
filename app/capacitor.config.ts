import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'net.spacesignals.galaxy',
  appName: 'spacesignals',
  webDir: 'dist-mobile',
  backgroundColor: '#000005',
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'never',
    backgroundColor: '#000005',
  },
};

export default config;
