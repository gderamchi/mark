import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";

interface NotificationCardProps {
  platform: string;
  platformIcon: string;
  title: string;
  summary: string;
  timestamp: string;
}

export const NotificationCard: React.FC<NotificationCardProps> = ({
  platformIcon,
  title,
  summary,
  timestamp,
}) => {
  const formattedTime = formatRelativeTime(timestamp);

  return (
    <View style={styles.container}>
      <BlurView intensity={40} tint="dark" style={styles.blur}>
        <View style={styles.content}>
          <View style={styles.iconWrap}>
            <Ionicons
              name={platformIcon as keyof typeof Ionicons.glyphMap}
              size={18}
              color="#06b6d4"
            />
          </View>
          <View style={styles.textWrap}>
            <View style={styles.headerRow}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              <Text style={styles.time}>{formattedTime}</Text>
            </View>
            <Text style={styles.summary} numberOfLines={2}>
              {summary}
            </Text>
          </View>
        </View>
      </BlurView>
    </View>
  );
};

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  blur: {
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.12)",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(6, 182, 212, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  textWrap: {
    flex: 1,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 3,
  },
  title: {
    color: "#f8fafc",
    fontSize: 14,
    fontWeight: "700",
    flex: 1,
  },
  time: {
    color: "#94a3b8",
    fontSize: 11,
    marginLeft: 8,
  },
  summary: {
    color: "#94a3b8",
    fontSize: 13,
    lineHeight: 18,
  },
});
