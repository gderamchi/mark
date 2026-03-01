import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import type { VoiceState } from "@mark/contracts";

interface AudioWaveformProps {
  level: number; // 0-1 normalized audio amplitude
  state: VoiceState;
  barCount?: number;
}

const BAR_WIDTH = 3;
const BAR_GAP = 4;
const MAX_BAR_HEIGHT = 40;
const MIN_BAR_HEIGHT = 3;

const STATE_INDEX: Record<VoiceState, number> = {
  idle: 0,
  listening: 1,
  thinking: 2,
  speaking: 3,
};

const BAR_COLORS: Record<VoiceState, string> = {
  idle: "#4b5563",
  listening: "#22d3ee",
  thinking: "#fbbf24",
  speaking: "#34d399",
};

const SPRING_CONFIG = { damping: 12, stiffness: 180, mass: 0.5 };

export const AudioWaveform: React.FC<AudioWaveformProps> = ({
  level,
  state,
  barCount = 5,
}) => {
  const animatedLevel = useSharedValue(0);
  const stateIndex = useSharedValue(STATE_INDEX[state]);
  const idlePhase = useSharedValue(0);

  useEffect(() => {
    animatedLevel.value = withSpring(level, SPRING_CONFIG);
  }, [level, animatedLevel]);

  useEffect(() => {
    stateIndex.value = withTiming(STATE_INDEX[state], { duration: 300 });
  }, [state, stateIndex]);

  // Subtle idle breathing when no audio
  useEffect(() => {
    idlePhase.value = 0;
    idlePhase.value = withRepeat(
      withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true
    );
  }, [idlePhase]);

  const totalWidth = barCount * BAR_WIDTH + (barCount - 1) * BAR_GAP;

  return (
    <View style={[styles.container, { width: totalWidth, height: MAX_BAR_HEIGHT }]}>
      {Array.from({ length: barCount }, (_, i) => (
        <Bar
          key={i}
          index={i}
          total={barCount}
          level={animatedLevel}
          stateIndex={stateIndex}
          idlePhase={idlePhase}
        />
      ))}
    </View>
  );
};

interface BarProps {
  index: number;
  total: number;
  level: SharedValue<number>;
  stateIndex: SharedValue<number>;
  idlePhase: SharedValue<number>;
}

const Bar: React.FC<BarProps> = ({ index, total, level, stateIndex, idlePhase }) => {
  // Each bar has a different "sensitivity" based on distance from center
  const centerDistance = Math.abs(index - (total - 1) / 2) / ((total - 1) / 2);
  // Center bars are taller, edge bars shorter
  const sensitivity = 1 - centerDistance * 0.5;
  const barStyle = useAnimatedStyle(() => {
    // Idle breathing: subtle oscillation
    const idleHeight =
      MIN_BAR_HEIGHT +
      interpolate(
        idlePhase.value,
        [0, 1],
        [0, 4 * sensitivity]
      );

    // Active: level drives height
    const activeHeight =
      MIN_BAR_HEIGHT +
      level.value * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT) * sensitivity;

    // Blend: if level is low, show idle breathing; if high, show active
    const effectiveLevel = Math.min(level.value * 3, 1); // amplify for blending
    const height = interpolate(
      effectiveLevel,
      [0, 0.15],
      [idleHeight, activeHeight],
      "clamp"
    );

    const color = interpolateColor(
      stateIndex.value,
      [0, 1, 2, 3],
      [BAR_COLORS.idle, BAR_COLORS.listening, BAR_COLORS.thinking, BAR_COLORS.speaking]
    );

    const opacity = interpolate(
      level.value,
      [0, 0.02, 0.1],
      [0.3, 0.5, 1],
      "clamp"
    );

    return {
      height,
      backgroundColor: color,
      opacity,
    };
  });

  return (
    <Animated.View
      style={[
        styles.bar,
        barStyle,
      ]}
    />
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: BAR_GAP,
  },
  bar: {
    width: BAR_WIDTH,
    borderRadius: BAR_WIDTH / 2,
  },
});
