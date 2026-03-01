import AVFoundation
import Foundation
import Speech
internal import React

@objc(VoiceIO)
class VoiceIO: RCTEventEmitter {
  private let audioEngine = AVAudioEngine()
  private var isCapturing = false
  private var converter: AVAudioConverter?

  private var localSttEnabled = false
  private var speechRecognizer: SFSpeechRecognizer?
  private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
  private var recognitionTask: SFSpeechRecognitionTask?
  private var lastPartialTranscript = ""
  private var lastFinalTranscript = ""

  private static let targetSampleRate: Double = 16000

  override static func requiresMainQueueSetup() -> Bool {
    false
  }

  override func supportedEvents() -> [String]! {
    ["voiceIO.chunk", "voiceIO.sttPartial", "voiceIO.sttFinal", "voiceIO.sttError"]
  }

  @objc
  func requestPermission(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      self.requestMicrophoneAndSpeechPermissions { micGranted in
        resolve(micGranted ? "granted" : "denied")
      }
    }
  }

  @objc
  func startCapture(
    _ options: NSDictionary?,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async { [weak self] in
      self?.startCaptureOnMain(options: options, resolve: resolve, reject: reject)
    }
  }

  private func startCaptureOnMain(
    options: NSDictionary?,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard !isCapturing else {
      resolve(nil)
      return
    }

    let status = AVAudioSession.sharedInstance().recordPermission
    guard status == .granted else {
      reject("no_permission", "Microphone permission is not granted.", nil)
      return
    }

    let enableLocalStt = (options?["enableLocalStt"] as? Bool) ?? false
    beginCapture(enableLocalStt: enableLocalStt, resolve: resolve, reject: reject)
  }

  private func beginCapture(
    enableLocalStt: Bool,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard !isCapturing else {
      resolve(nil)
      return
    }
    isCapturing = true
    localSttEnabled = enableLocalStt

    do {
      try AVAudioSession.sharedInstance().setCategory(
        .playAndRecord, mode: .voiceChat,
        options: [.defaultToSpeaker, .allowBluetoothHFP])
      try AVAudioSession.sharedInstance().setActive(true)
    } catch {
      isCapturing = false
      localSttEnabled = false
      reject("audio_session_error", "Failed to configure iOS audio session.", error)
      return
    }

    if localSttEnabled {
      guard startLocalRecognition(reject: reject) else {
        stopCaptureOnMain()
        return
      }
    }

    let input = audioEngine.inputNode
    let hwFormat = input.outputFormat(forBus: 0)

    // Some simulator/device states can report an invalid hardware format
    // (e.g. 0 Hz / 0 channels), which would crash installTap.
    guard hwFormat.sampleRate > 0, hwFormat.channelCount > 0 else {
      isCapturing = false
      localSttEnabled = false
      reject("invalid_hw_format", "Invalid microphone hardware format.", nil)
      return
    }

    // Target format: 16 kHz mono PCM Float32 (intermediate for conversion)
    guard let targetFormat = AVAudioFormat(
      commonFormat: .pcmFormatFloat32,
      sampleRate: VoiceIO.targetSampleRate,
      channels: 1,
      interleaved: false
    ) else {
      isCapturing = false
      localSttEnabled = false
      reject("invalid_hw_format", "Unable to initialize microphone conversion format.", nil)
      return
    }

    converter = AVAudioConverter(from: hwFormat, to: targetFormat)

    input.removeTap(onBus: 0)
    input.installTap(onBus: 0, bufferSize: 1024, format: hwFormat) { [weak self] buffer, _ in
      guard let self, let converter = self.converter else { return }

      let ratio = VoiceIO.targetSampleRate / hwFormat.sampleRate
      let outputFrameCount = AVAudioFrameCount(Double(buffer.frameLength) * ratio)
      guard let convertedBuffer = AVAudioPCMBuffer(
        pcmFormat: targetFormat,
        frameCapacity: outputFrameCount
      ) else { return }

      var error: NSError?
      var inputConsumed = false
      converter.convert(to: convertedBuffer, error: &error) { _, outStatus in
        if inputConsumed {
          outStatus.pointee = .noDataNow
          return nil
        }
        inputConsumed = true
        outStatus.pointee = .haveData
        return buffer
      }

      if error == nil {
        let audioData = self.pcmBufferToData(buffer: convertedBuffer)
        let base64 = audioData.base64EncodedString()
        self.sendEvent(withName: "voiceIO.chunk", body: base64)

        if self.localSttEnabled {
          self.recognitionRequest?.append(convertedBuffer)
        }
      }
    }

    do {
      try audioEngine.start()
      resolve(nil)
    } catch {
      stopCaptureOnMain()
      reject("engine_start_failed", "Failed to start microphone audio engine.", error)
    }
  }

  @objc
  func stopCapture() {
    DispatchQueue.main.async { [weak self] in
      self?.stopCaptureOnMain()
    }
  }

  private func stopCaptureOnMain() {
    guard isCapturing else { return }
    isCapturing = false
    audioEngine.inputNode.removeTap(onBus: 0)
    audioEngine.stop()
    converter = nil
    stopLocalRecognition()
    localSttEnabled = false
  }

  private func startLocalRecognition(reject: @escaping RCTPromiseRejectBlock) -> Bool {
    let speechStatus = SFSpeechRecognizer.authorizationStatus()
    guard speechStatus == .authorized else {
      reject("speech_permission_denied", "Speech recognition permission is not granted.", nil)
      return false
    }

    guard let recognizer = SFSpeechRecognizer(locale: Locale.current), recognizer.isAvailable else {
      reject("speech_unavailable", "Speech recognizer is unavailable on this device.", nil)
      return false
    }

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true

    speechRecognizer = recognizer
    recognitionRequest = request
    lastPartialTranscript = ""
    lastFinalTranscript = ""

    recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
      guard let self else { return }

      if let error {
        self.sendEvent(withName: "voiceIO.sttError", body: [
          "code": "speech_recognition_error",
          "message": error.localizedDescription
        ])
        return
      }

      guard let result else {
        return
      }

      let text = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
      if text.isEmpty {
        return
      }

      if result.isFinal {
        if text != self.lastFinalTranscript {
          self.lastFinalTranscript = text
          self.lastPartialTranscript = ""
          self.sendEvent(withName: "voiceIO.sttFinal", body: text)
        }
      } else if text != self.lastPartialTranscript {
        self.lastPartialTranscript = text
        self.sendEvent(withName: "voiceIO.sttPartial", body: text)
      }
    }

    return true
  }

  private func stopLocalRecognition() {
    recognitionRequest?.endAudio()
    recognitionTask?.cancel()
    recognitionTask = nil
    recognitionRequest = nil
    speechRecognizer = nil
    lastPartialTranscript = ""
    lastFinalTranscript = ""
  }

  private func requestMicrophoneAndSpeechPermissions(_ completion: @escaping (Bool) -> Void) {
    requestMicrophonePermission { micGranted in
      self.requestSpeechPermission {
        completion(micGranted)
      }
    }
  }

  private func requestMicrophonePermission(_ completion: @escaping (Bool) -> Void) {
    let session = AVAudioSession.sharedInstance()
    let status = session.recordPermission

    switch status {
    case .granted:
      completion(true)
    case .denied:
      completion(false)
    case .undetermined:
      session.requestRecordPermission { granted in
        completion(granted)
      }
    @unknown default:
      completion(false)
    }
  }

  private func requestSpeechPermission(_ completion: @escaping () -> Void) {
    switch SFSpeechRecognizer.authorizationStatus() {
    case .authorized, .denied, .restricted:
      completion()
    case .notDetermined:
      SFSpeechRecognizer.requestAuthorization { _ in
        completion()
      }
    @unknown default:
      completion()
    }
  }

  /// Converts Float32 PCM samples to Int16 (pcm_s16le) Data
  private func pcmBufferToData(buffer: AVAudioPCMBuffer) -> Data {
    guard let floatData = buffer.floatChannelData else {
      return Data()
    }
    let frameCount = Int(buffer.frameLength)
    let samples = UnsafeBufferPointer(start: floatData[0], count: frameCount)

    var int16Data = Data(count: frameCount * 2)
    int16Data.withUnsafeMutableBytes { rawBuffer in
      let int16Buffer = rawBuffer.bindMemory(to: Int16.self)
      for i in 0..<frameCount {
        let clamped = max(-1.0, min(1.0, samples[i]))
        int16Buffer[i] = Int16(clamped * 32767)
      }
    }
    return int16Data
  }
}
