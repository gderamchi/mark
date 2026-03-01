import React, { useCallback } from "react";
import { Dimensions, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { NotificationCard } from "./NotificationCard";

interface NotificationItem {
  id: string;
  platform: string;
  platformIcon: string;
  title: string;
  summary: string;
  timestamp: string;
}

interface NotificationStackProps {
  notifications: NotificationItem[];
  maxCollapsed?: number;
}

const CARD_HEIGHT = 68;
const COLLAPSED_OFFSET = -8;
const SCREEN_WIDTH = Dimensions.get("window").width;
const SPRING_CONFIG = { damping: 20, stiffness: 200 };

export const NotificationStack: React.FC<NotificationStackProps> = ({
  notifications,
  maxCollapsed = 3,
}) => {
  const expanded = useSharedValue(0); // 0 = collapsed, 1 = expanded
  const startY = useSharedValue(0);

  const triggerHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const pan = Gesture.Pan()
    .onStart(() => {
      startY.value = expanded.value;
    })
    .onUpdate((event) => {
      // Swipe up to expand (negative translationY)
      const progress = startY.value + (-event.translationY) / 200;
      expanded.value = Math.max(0, Math.min(1, progress));
    })
    .onEnd((event) => {
      const isExpanding = event.velocityY < -200 || expanded.value > 0.5;
      expanded.value = withSpring(isExpanding ? 1 : 0, SPRING_CONFIG);
      runOnJS(triggerHaptic)();
    });

  const visibleNotifications = notifications.slice(0, maxCollapsed);
  const allNotifications = notifications;

  // Container height animation
  const containerStyle = useAnimatedStyle(() => {
    const collapsedHeight =
      CARD_HEIGHT + (visibleNotifications.length - 1) * Math.abs(COLLAPSED_OFFSET);
    const expandedHeight = allNotifications.length * (CARD_HEIGHT + 8) + 24; // 8px gap + 24px handle
    const height = interpolate(
      expanded.value,
      [0, 1],
      [collapsedHeight, expandedHeight]
    );
    return { height };
  });

  if (notifications.length === 0) return null;

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.container, containerStyle]}>
        {/* Drag handle pill */}
        <View style={styles.handleWrap}>
          <View style={styles.handle} />
        </View>

        {/* Cards */}
        {allNotifications.map((notification, index) => (
          <StackedCard
            key={notification.id}
            notification={notification}
            index={index}
            total={allNotifications.length}
            maxCollapsed={maxCollapsed}
            expanded={expanded}
          />
        ))}
      </Animated.View>
    </GestureDetector>
  );
};

interface StackedCardProps {
  notification: NotificationItem;
  index: number;
  total: number;
  maxCollapsed: number;
  expanded: SharedValue<number>;
}

const StackedCard: React.FC<StackedCardProps> = ({
  notification,
  index,
  total,
  maxCollapsed,
  expanded,
}) => {
  const cardStyle = useAnimatedStyle(() => {
    const isHidden = index >= maxCollapsed;

    // Collapsed positioning: stacked with offset and scale
    const collapsedTop = index * COLLAPSED_OFFSET;
    const collapsedScale = 1 - index * 0.03;
    const collapsedOpacity = isHidden ? 0 : 1 - index * 0.15;

    // Expanded positioning: vertically listed
    const expandedTop = index * (CARD_HEIGHT + 8);
    const expandedScale = 1;
    const expandedOpacity = 1;

    const top = interpolate(
      expanded.value,
      [0, 1],
      [collapsedTop, expandedTop]
    );
    const scale = interpolate(
      expanded.value,
      [0, 1],
      [collapsedScale, expandedScale]
    );
    const opacity = interpolate(
      expanded.value,
      [0, 1],
      [collapsedOpacity, expandedOpacity]
    );

    // Z-index: in collapsed, later cards go behind. In expanded, all equal
    const zIndex = interpolate(
      expanded.value,
      [0, 1],
      [total - index, 1]
    );

    return {
      position: "absolute" as const,
      top: top + 20, // offset for handle
      left: 0,
      right: 0,
      transform: [{ scale }],
      opacity,
      zIndex: Math.round(zIndex),
    };
  });

  return (
    <Animated.View style={[styles.card, cardStyle]}>
      <NotificationCard
        platform={notification.platform}
        platformIcon={notification.platformIcon}
        title={notification.title}
        summary={notification.summary}
        timestamp={notification.timestamp}
      />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: SCREEN_WIDTH - 32,
    alignSelf: "center",
  },
  handleWrap: {
    alignItems: "center",
    paddingVertical: 6,
    zIndex: 999,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(148, 163, 184, 0.4)",
  },
  card: {
    paddingHorizontal: 0,
  },
});
