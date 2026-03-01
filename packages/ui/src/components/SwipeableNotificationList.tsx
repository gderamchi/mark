import React from "react";
import { StyleSheet } from "react-native";
import Animated, { FadeOut, LinearTransition } from "react-native-reanimated";

import { SwipeableNotificationCard } from "./SwipeableNotificationCard";

export interface SwipeableNotificationItem {
  id: string;
  platform: string;
  platformIcon: string;
  title: string;
  summary: string;
  timestamp: string;
}

interface SwipeableNotificationListProps {
  notifications: SwipeableNotificationItem[];
  onDismiss: (id: string) => void;
}

export const SwipeableNotificationList: React.FC<SwipeableNotificationListProps> = ({
  notifications,
  onDismiss,
}) => {
  if (notifications.length === 0) return null;

  return (
    <Animated.View style={styles.container} layout={LinearTransition}>
      {notifications.map((notification) => (
        <Animated.View
          key={notification.id}
          layout={LinearTransition}
          exiting={FadeOut.duration(200)}
        >
          <SwipeableNotificationCard
            id={notification.id}
            platform={notification.platform}
            platformIcon={notification.platformIcon}
            title={notification.title}
            summary={notification.summary}
            timestamp={notification.timestamp}
            onDismiss={onDismiss}
          />
        </Animated.View>
      ))}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingBottom: 8,
  },
});
