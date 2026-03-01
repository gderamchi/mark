import React, { useCallback } from "react";
import { Dimensions, StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { NotificationCard } from "./NotificationCard";

interface SwipeableNotificationCardProps {
  id: string;
  platform: string;
  platformIcon: string;
  title: string;
  summary: string;
  timestamp: string;
  onDismiss: (id: string) => void;
}

const SCREEN_WIDTH = Dimensions.get("window").width;
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.35;
const VELOCITY_THRESHOLD = 800;
const SPRING_CONFIG = { damping: 20, stiffness: 200 };

export const SwipeableNotificationCard: React.FC<SwipeableNotificationCardProps> = ({
  id,
  platform,
  platformIcon,
  title,
  summary,
  timestamp,
  onDismiss,
}) => {
  const translateX = useSharedValue(0);
  const dismissed = useSharedValue(false);

  const handleDismiss = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onDismiss(id);
  }, [id, onDismiss]);

  const pan = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-5, 5])
    .onUpdate((event) => {
      if (!dismissed.value) {
        translateX.value = event.translationX;
      }
    })
    .onEnd((event) => {
      if (dismissed.value) return;

      const shouldDismiss =
        Math.abs(event.translationX) > SWIPE_THRESHOLD ||
        Math.abs(event.velocityX) > VELOCITY_THRESHOLD;

      if (shouldDismiss) {
        dismissed.value = true;
        const direction = event.translationX > 0 ? 1 : -1;
        translateX.value = withTiming(
          direction * SCREEN_WIDTH * 1.2,
          { duration: 250 },
          () => {
            runOnJS(handleDismiss)();
          }
        );
      } else {
        translateX.value = withSpring(0, SPRING_CONFIG);
      }
    });

  const cardStyle = useAnimatedStyle(() => {
    const rotation = interpolate(
      translateX.value,
      [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
      [-5, 0, 5]
    );
    const opacity = interpolate(
      Math.abs(translateX.value),
      [0, SCREEN_WIDTH * 0.5],
      [1, 0.3],
      "clamp"
    );

    return {
      transform: [
        { translateX: translateX.value },
        { rotateZ: `${rotation}deg` },
      ],
      opacity,
    };
  });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.card, cardStyle]}>
        <NotificationCard
          platform={platform}
          platformIcon={platformIcon}
          title={title}
          summary={summary}
          timestamp={timestamp}
        />
      </Animated.View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
});
