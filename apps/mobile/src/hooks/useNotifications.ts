import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import type { ConnectorView, TimelineCard } from "@mark/contracts";

import { useAppStore } from "../store/useAppStore";

export interface NotificationItem {
  id: string;
  platform: string;
  platformIcon: string;
  title: string;
  summary: string;
  timestamp: string;
}

const CONNECTOR_ICONS: Record<string, string> = {
  gmail: "mail",
  slack: "chatbubbles",
  discord: "game-controller",
  github: "logo-github",
  notion: "document-text",
};

function deriveNotifications(
  connectors: ConnectorView[],
  timelineCards: TimelineCard[]
): NotificationItem[] {
  const connected = connectors.filter((c) => c.connected);

  return connected.map((connector) => {
    // Find the most recent timeline card for this connector
    const latestCard = timelineCards.find(
      (card) => card.source === connector.id
    );

    return {
      id: connector.id,
      platform: connector.name,
      platformIcon: CONNECTOR_ICONS[connector.id] ?? "extension-puzzle",
      title: connector.name,
      summary: latestCard
        ? latestCard.body
        : `${connector.name} connected`,
      timestamp: latestCard
        ? latestCard.timestamp
        : new Date().toISOString(),
    };
  });
}

export function useNotifications(): NotificationItem[] {
  const { connectors, timelineCards } = useAppStore(
    useShallow((s) => ({
      connectors: s.connectors,
      timelineCards: s.timelineCards,
    }))
  );

  return useMemo(
    () => deriveNotifications(connectors, timelineCards),
    [connectors, timelineCards]
  );
}
