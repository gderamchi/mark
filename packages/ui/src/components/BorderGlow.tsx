import React, { useEffect } from "react";
import { Dimensions, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";

import type { VoiceState } from "@mark/contracts";

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

interface BorderGlowProps {
  state: VoiceState;
  children: React.ReactNode;
}

const SCREEN = Dimensions.get("window");
const STRIP_THICKNESS = 3;

const STATE_INDEX: Record<VoiceState, number> = {
  idle: 0,
  listening: 1,
  thinking: 2,
  speaking: 3,
};

const SPEED: Record<VoiceState, number> = {
  idle: 6000,
  listening: 3000,
  thinking: 1200,
  speaking: 2000,
};

// Two color palettes per state for crossfade layers
const PALETTE_A: Record<VoiceState, [string, string, string]> = {
  idle: ["#4b5563", "#374151", "#6b7280"],
  listening: ["#22d3ee", "#8b5cf6", "#3b82f6"],
  thinking: ["#fbbf24", "#f97316", "#ef4444"],
  speaking: ["#34d399", "#22d3ee", "#14b8a6"],
};

const PALETTE_B: Record<VoiceState, [string, string, string]> = {
  idle: ["#6b7280", "#4b5563", "#374151"],
  listening: ["#3b82f6", "#22d3ee", "#8b5cf6"],
  thinking: ["#ef4444", "#fbbf24", "#f97316"],
  speaking: ["#14b8a6", "#34d399", "#22d3ee"],
};

const SHADOW_RADIUS: Record<VoiceState, [number, number]> = {
  idle: [8, 12],
  listening: [20, 30],
  thinking: [25, 40],
  speaking: [25, 35],
};

const OPACITY_RANGE: Record<VoiceState, [number, number]> = {
  idle: [0.15, 0.25],
  listening: [0.6, 0.85],
  thinking: [0.5, 0.9],
  speaking: [0.7, 1.0],
};

export const BorderGlow: React.FC<BorderGlowProps> = ({ state, children }) => {
  const stateIndex = useSharedValue(STATE_INDEX[state]);
  const breathe = useSharedValue(0);

  useEffect(() => {
    stateIndex.value = withTiming(STATE_INDEX[state], { duration: 400 });
  }, [state, stateIndex]);

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

  const breathePhaseB = useDerivedValue(() =>
    interpolate(breathe.value, [0, 0.4, 1], [0.4, 1, 0])
  );

  // Layer A opacity: visible for current state, crossfade
  const layerAOpacity = useAnimatedStyle(() => {
    const oMin = interpolate(stateIndex.value, [0, 1, 2, 3], [
      OPACITY_RANGE.idle[0], OPACITY_RANGE.listening[0],
      OPACITY_RANGE.thinking[0], OPACITY_RANGE.speaking[0],
    ]);
    const oMax = interpolate(stateIndex.value, [0, 1, 2, 3], [
      OPACITY_RANGE.idle[1], OPACITY_RANGE.listening[1],
      OPACITY_RANGE.thinking[1], OPACITY_RANGE.speaking[1],
    ]);
    return { opacity: interpolate(breathe.value, [0, 1], [oMin, oMax]) };
  });

  // Layer B opacity: offset phase
  const layerBOpacity = useAnimatedStyle(() => {
    const oMin = interpolate(stateIndex.value, [0, 1, 2, 3], [
      OPACITY_RANGE.idle[0], OPACITY_RANGE.listening[0],
      OPACITY_RANGE.thinking[0], OPACITY_RANGE.speaking[0],
    ]);
    const oMax = interpolate(stateIndex.value, [0, 1, 2, 3], [
      OPACITY_RANGE.idle[1], OPACITY_RANGE.listening[1],
      OPACITY_RANGE.thinking[1], OPACITY_RANGE.speaking[1],
    ]);
    return { opacity: interpolate(breathePhaseB.value, [0, 1], [oMin, oMax]) };
  });

  // Shadow radius animation
  const shadowAnim = useAnimatedStyle(() => {
    const srMin = interpolate(stateIndex.value, [0, 1, 2, 3], [
      SHADOW_RADIUS.idle[0], SHADOW_RADIUS.listening[0],
      SHADOW_RADIUS.thinking[0], SHADOW_RADIUS.speaking[0],
    ]);
    const srMax = interpolate(stateIndex.value, [0, 1, 2, 3], [
      SHADOW_RADIUS.idle[1], SHADOW_RADIUS.listening[1],
      SHADOW_RADIUS.thinking[1], SHADOW_RADIUS.speaking[1],
    ]);
    return { shadowRadius: interpolate(breathe.value, [0, 1], [srMin, srMax]) };
  });

  // Per-state crossfade opacities for gradient layers
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

  const stateOpacities = [idleOpacity, listeningOpacity, thinkingOpacity, speakingOpacity];
  const states: VoiceState[] = ["idle", "listening", "thinking", "speaking"];

  return (
    <View style={styles.root}>
      {children}

      {/* Render strips for each edge, 2 layers (A + B) per edge, each with 4 state gradient sublayers */}
      {EDGES.map((edge) => (
        <View key={edge.key} style={[styles.stripBase, edge.style]} pointerEvents="none">
          {/* Layer A */}
          <Animated.View style={[StyleSheet.absoluteFill, layerAOpacity, shadowAnim, { shadowColor: "#fff", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1 }]}>
            {states.map((s, i) => (
              <AnimatedLinearGradient
                key={`a-${s}`}
                colors={PALETTE_A[s]}
                start={edge.gradientStart}
                end={edge.gradientEnd}
                style={[StyleSheet.absoluteFill, stateOpacities[i]]}
              />
            ))}
          </Animated.View>

          {/* Layer B — phase-offset for shimmer */}
          <Animated.View style={[StyleSheet.absoluteFill, layerBOpacity, shadowAnim, { shadowColor: "#fff", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1 }]}>
            {states.map((s, i) => (
              <AnimatedLinearGradient
                key={`b-${s}`}
                colors={PALETTE_B[s]}
                start={edge.gradientStart}
                end={edge.gradientEnd}
                style={[StyleSheet.absoluteFill, stateOpacities[i]]}
              />
            ))}
          </Animated.View>
        </View>
      ))}
    </View>
  );
};

interface EdgeDef {
  key: string;
  style: object;
  gradientStart: { x: number; y: number };
  gradientEnd: { x: number; y: number };
}

const EDGES: EdgeDef[] = [
  {
    key: "top",
    style: {
      position: "absolute" as const,
      top: 0,
      left: 0,
      right: 0,
      height: STRIP_THICKNESS,
    },
    gradientStart: { x: 0, y: 0.5 },
    gradientEnd: { x: 1, y: 0.5 },
  },
  {
    key: "bottom",
    style: {
      position: "absolute" as const,
      bottom: 0,
      left: 0,
      right: 0,
      height: STRIP_THICKNESS,
    },
    gradientStart: { x: 1, y: 0.5 },
    gradientEnd: { x: 0, y: 0.5 },
  },
  {
    key: "left",
    style: {
      position: "absolute" as const,
      top: 0,
      bottom: 0,
      left: 0,
      width: STRIP_THICKNESS,
    },
    gradientStart: { x: 0.5, y: 1 },
    gradientEnd: { x: 0.5, y: 0 },
  },
  {
    key: "right",
    style: {
      position: "absolute" as const,
      top: 0,
      bottom: 0,
      right: 0,
      width: STRIP_THICKNESS,
    },
    gradientStart: { x: 0.5, y: 0 },
    gradientEnd: { x: 0.5, y: 1 },
  },
];

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000000",
  },
  stripBase: {
    overflow: "visible",
  },
});
