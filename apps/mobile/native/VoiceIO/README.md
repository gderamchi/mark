# VoiceIO Native Module Source

This Swift file is the source for the custom `VoiceIO` module used for PCM streaming in dev-client/native builds.

To include it after Expo prebuild:
1. Run `pnpm --filter @mark/mobile run native:prebuild`.
2. Add `native/VoiceIO/VoiceIOModule.swift` into the iOS Xcode project target.
3. Ensure `NSMicrophoneUsageDescription` is present (already in `app.config.ts`).
