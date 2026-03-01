import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";

import type { VoiceState } from "@mark/contracts";

interface VoiceOrbProps {
  state: VoiceState;
  size?: number;
}

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

const STATE_INDEX: Record<VoiceState, number> = {
  idle: 0,
  listening: 1,
  thinking: 2,
  speaking: 3,
};

const SPEED: Record<VoiceState, number> = {
  idle: 2500,
  listening: 1500,
  thinking: 800,
  speaking: 1000,
};

const GRADIENT_COLORS: Record<VoiceState, [string, string, string]> = {
  idle: ["#374151", "#1f2937", "#111827"],
  listening: ["#22d3ee", "#0891b2", "#0e7490"],
  thinking: ["#fbbf24", "#f59e0b", "#d97706"],
  speaking: ["#34d399", "#10b981", "#059669"],
};

const GLOW_COLORS: Record<VoiceState, string> = {
  idle: "rgba(75, 85, 99, 0.25)",
  listening: "rgba(6, 182, 212, 0.30)",
  thinking: "rgba(245, 158, 11, 0.30)",
  speaking: "rgba(16, 185, 129, 0.30)",
};

const SHADOW_COLORS: Record<VoiceState, string> = {
  idle: "#4b5563",
  listening: "#06b6d4",
  thinking: "#f59e0b",
  speaking: "#10b981",
};

export const VoiceOrb: React.FC<VoiceOrbProps> = ({ state, size = 140 }) => {
  const stateIndex = useSharedValue(STATE_INDEX[state]);
  const breathe = useSharedValue(0);
  const speed = useSharedValue(SPEED[state]);

  // Transition state index smoothly
  useEffect(() => {
    stateIndex.value = withTiming(STATE_INDEX[state], { duration: 400 });
    speed.value = SPEED[state];
  }, [state, stateIndex, speed]);

  // Restart breathing animation when speed changes
  useEffect(() => {
    breathe.value = 0;
    breathe.value = withRepeat(
      withTiming(1, {
        duration: SPEED[state],
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      true
    );
  }, [state, breathe]);

  // Derived breathing values with phase offsets for organic feel
  const breatheMain = useDerivedValue(() => breathe.value);
  const breatheMid = useDerivedValue(() => {
    // Phase offset of ~0.3 for the mid ring
    return interpolate(breathe.value, [0, 0.3, 1], [0.3, 1, 0]);
  });

  // Outer ambient glow animation (1.5x size)
  const outerGlowStyle = useAnimatedStyle(() => {
    const scale = interpolate(breatheMain.value, [0, 1], [1.0, 1.08]);
    const opacity = interpolate(breatheMain.value, [0, 1], [0.3, 0.6]);
    const bgColor = interpolateColor(
      stateIndex.value,
      [0, 1, 2, 3],
      [GLOW_COLORS.idle, GLOW_COLORS.listening, GLOW_COLORS.thinking, GLOW_COLORS.speaking]
    );
    return {
      transform: [{ scale }],
      opacity,
      backgroundColor: bgColor,
    };
  });

  // Mid glow ring animation (1.25x size, phase offset)
  const midGlowStyle = useAnimatedStyle(() => {
    const scale = interpolate(breatheMid.value, [0, 1], [1.0, 1.06]);
    const opacity = interpolate(breatheMid.value, [0, 1], [0.2, 0.5]);
    const bgColor = interpolateColor(
      stateIndex.value,
      [0, 1, 2, 3],
      [GLOW_COLORS.idle, GLOW_COLORS.listening, GLOW_COLORS.thinking, GLOW_COLORS.speaking]
    );
    return {
      transform: [{ scale }],
      opacity,
      backgroundColor: bgColor,
    };
  });

  // Core orb scale animation
  const coreStyle = useAnimatedStyle(() => {
    const scale = interpolate(breatheMain.value, [0, 1], [1.0, 1.04]);
    return {
      transform: [{ scale }],
    };
  });

  // Gradient layer opacities for crossfade between states
  const idleOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(stateIndex.value, [0, 0.5], [1, 0], "clamp"),
  }));
  const listeningOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(stateIndex.value, [0.5, 1, 1.5], [0, 1, 0], "clamp"),
  }));
  const thinkingOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(stateIndex.value, [1.5, 2, 2.5], [0, 1, 0], "clamp"),
  }));
  const speakingOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(stateIndex.value, [2.5, 3], [0, 1], "clamp"),
  }));

  // Shadow color transition
  const shadowStyle = useAnimatedStyle(() => {
    const color = interpolateColor(
      stateIndex.value,
      [0, 1, 2, 3],
      [SHADOW_COLORS.idle, SHADOW_COLORS.listening, SHADOW_COLORS.thinking, SHADOW_COLORS.speaking]
    );
    return {
      shadowColor: color,
    };
  });

  const outerSize = size * 1.5;
  const midSize = size * 1.25;

  return (
    <View style={[styles.wrapper, { width: outerSize, height: outerSize }]}>
      {/* Outer ambient glow */}
      <Animated.View
        style={[
          styles.glowLayer,
          {
            width: outerSize,
            height: outerSize,
            borderRadius: outerSize / 2,
          },
          outerGlowStyle,
        ]}
      />

      {/* Mid glow ring */}
      <Animated.View
        style={[
          styles.glowLayer,
          {
            width: midSize,
            height: midSize,
            borderRadius: midSize / 2,
          },
          midGlowStyle,
        ]}
      />

      {/* Core orb with crossfaded gradients */}
      <Animated.View
        style={[
          styles.core,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
          },
          coreStyle,
          shadowStyle,
          {
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.7,
            shadowRadius: 30,
            elevation: 20,
          },
        ]}
      >
        {/* Idle gradient layer */}
        <AnimatedLinearGradient
          colors={GRADIENT_COLORS.idle}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={[styles.gradientLayer, { borderRadius: size / 2 }, idleOpacity]}
        />
        {/* Listening gradient layer */}
        <AnimatedLinearGradient
          colors={GRADIENT_COLORS.listening}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={[styles.gradientLayer, { borderRadius: size / 2 }, listeningOpacity]}
        />
        {/* Thinking gradient layer */}
        <AnimatedLinearGradient
          colors={GRADIENT_COLORS.thinking}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={[styles.gradientLayer, { borderRadius: size / 2 }, thinkingOpacity]}
        />
        {/* Speaking gradient layer */}
        <AnimatedLinearGradient
          colors={GRADIENT_COLORS.speaking}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={[styles.gradientLayer, { borderRadius: size / 2 }, speakingOpacity]}
        />

        {/* Highlight spec — white reflection top-left */}
        <View
          style={[
            styles.highlight,
            {
              width: size * 0.25,
              height: size * 0.15,
              borderRadius: size * 0.12,
              top: size * 0.15,
              left: size * 0.2,
            },
          ]}
        />
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    justifyContent: "center",
  },
  glowLayer: {
    position: "absolute",
  },
  core: {
    overflow: "hidden",
  },
  gradientLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  highlight: {
    position: "absolute",
    backgroundColor: "rgba(255, 255, 255, 0.18)",
  },
});
