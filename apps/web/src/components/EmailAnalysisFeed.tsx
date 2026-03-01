import type { EmailFeedItem } from "../useElevenLabsVoice";

type EmailAnalysisFeedProps = {
  items: EmailFeedItem[];
  fadeOut: boolean;
};

export function EmailAnalysisFeed({ items, fadeOut }: EmailAnalysisFeedProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className={`email-feed${fadeOut ? " email-feed-fade-out" : ""}`}>
      {items.map((item, index) => (
        <div
          key={`${item.from}-${item.subject}-${index}`}
          className="email-feed-card"
          style={{ animationDelay: `${index * 150}ms` }}
        >
          <span className={`email-feed-dot email-feed-dot-${item.importance}`} />
          <span className="email-feed-sender">{extractName(item.from)}</span>
          <span className="email-feed-sep">&mdash;</span>
          <span className="email-feed-subject">{item.subject}</span>
          {item.hasDraft && (
            <span className="email-feed-draft-badge">draft</span>
          )}
          <span className={`email-feed-badge email-feed-badge-${item.importance}`}>
            {badgeLabel(item.importance)}
          </span>
        </div>
      ))}
    </div>
  );
}

function extractName(from: string): string {
  const match = from.match(/^([^<]+)/);
  if (match?.[1]) {
    return match[1].trim().replace(/^["']|["']$/g, "");
  }
  return from.split("@")[0] ?? from;
}

function badgeLabel(importance: EmailFeedItem["importance"]): string {
  switch (importance) {
    case "must_know":
      return "!";
    case "respond_needed":
      return "\u2192";
    default:
      return "";
  }
}
