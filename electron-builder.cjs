

const hasCert = process.env.MAC_SIGN === "1";
const canNotarize =
  hasCert &&
  !!process.env.APPLE_ID &&
  !!process.env.APPLE_APP_SPECIFIC_PASSWORD &&
  !!process.env.APPLE_TEAM_ID;

module.exports = {
  appId: "com.ghostpilot.app",
  productName: "GhostPilot",
  asar: true,
  publish: [{ provider: "github", owner: "z12ob", repo: "GhostPilot" }],
  artifactName: "${productName}-${version}-${os}-${arch}.${ext}",

  files: ["main.js", "preload.js", "src/**/*", "renderer/**/*"],
  directories: { buildResources: "build-resources" },
  afterPack: "scripts/after-pack.js",
  mac: {
    icon: "build-resources/icon.svg",
    target: [{ target: "zip", arch: ["x64", "arm64"] }],
    category: "public.app-category.productivity",

    identity: hasCert ? undefined : null,
    hardenedRuntime: hasCert,
    gatekeeperAssess: false,
    entitlements: "build-resources/entitlements.mac.plist",
    entitlementsInherit: "build-resources/entitlements.mac.plist",

    notarize: canNotarize,
    extendInfo: {
      LSUIElement: true,
      NSMicrophoneUsageDescription:
        "GhostPilot transcribes your microphone so it can help you in conversations.",
      NSCameraUsageDescription: "GhostPilot does not use the camera.",
      NSAudioCaptureUsageDescription:
        "GhostPilot captures system audio to transcribe the other participant in a call.",
    },
  },
  win: {
    icon: "build-resources/icon.svg",
    target: [
      { target: "nsis", arch: ["x64"] },
      { target: "zip", arch: ["x64"] }
    ],
    artifactName: "${productName}-win-${arch}.${ext}",
  },

  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    shortcutName: "GhostPilot",
  },
  linux: {
    icon: "build-resources/icon.svg",
    target: [{ target: "AppImage", arch: ["x64", "arm64"] }],
    category: "Utility",
  },
};
