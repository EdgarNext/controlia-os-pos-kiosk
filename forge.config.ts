import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import fs from 'node:fs';
import path from 'node:path';

const appRoot = __dirname;
const iconBasePath = path.join(appRoot, 'assets', 'icon');
const iconPngPath = `${iconBasePath}.png`;
const iconIcoPath = `${iconBasePath}.ico`;
const iconIcnsPath = `${iconBasePath}.icns`;
const hasAnyPackagedIcon = [iconPngPath, iconIcoPath, iconIcnsPath].some((filePath) => fs.existsSync(filePath));
const extraResourcePaths = fs.existsSync(path.join(appRoot, 'assets')) ? [path.join(appRoot, 'assets')] : [];

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: hasAnyPackagedIcon ? iconBasePath : undefined,
    extraResource: extraResourcePaths,
    ignore: (file: string) => {
      if (!file) return false;
      return !(file.startsWith('/.vite') || file.startsWith('/node_modules') || file === '/package.json');
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      ...(fs.existsSync(iconIcoPath) ? { setupIcon: iconIcoPath } : {}),
    }),
    new MakerZIP({}, ['darwin']),
    //new MakerRpm({}),
    new MakerDeb({
      ...(fs.existsSync(iconPngPath)
        ? {
            options: {
              icon: iconPngPath,
            },
          }
        : {}),
    }),
  ],
   publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'EdgarNext',
          name: 'controlia-os-pos-kiosk',
        },
        prerelease: true
      }
    }
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
        {
          entry: 'src/main/sync/sync-worker.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
