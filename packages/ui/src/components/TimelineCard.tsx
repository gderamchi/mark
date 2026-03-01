import React from "react";
import { StyleSheet, Text, View } from "react-native";

import type { TimelineCard as TimelineCardContract } from "@mark/contracts";

interface TimelineCardProps {
  card: TimelineCardContract;
}

const statusColor: Record<TimelineCardContract["status"], string> = {
  pending: "#6b7280",
  success: "#10b981",
  warning: "#f59e0b",
  error: "#ef4444"
};

export const TimelineCard: React.FC<TimelineCardProps> = ({ card }) => {
  return (
    <View style={styles.container}>
      <View style={[styles.dot, { backgroundColor: statusColor[card.status] }]} />
      <View style={styles.content}>
        <Text style={styles.title}>{card.title}</Text>
        <Text style={styles.body}>{card.body}</Text>
        <Text style={styles.meta}>{new Date(card.timestamp).toLocaleTimeString()}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    backgroundColor: "rgba(17, 24, 39, 0.9)",
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(75, 85, 99, 0.45)"
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
    marginRight: 10
  },
  content: {
    flex: 1
  },
  title: {
    color: "#f9fafb",
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 4
  },
  body: {
    color: "#d1d5db",
    fontSize: 13,
    lineHeight: 18
  },
  meta: {
    color: "#9ca3af",
    fontSize: 11,
    marginTop: 8
  }
});
