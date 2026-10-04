"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { Message, MessageReaction } from "@/types";
import {
  Clock,
  Check,
  CheckCheck,
  XCircle,
  MapPin,
  LayoutTemplate,
  CornerDownLeft,
  Sparkles,
} from "lucide-react";
import { format } from "date-fns";
import { ReplyQuote } from "./reply-quote";
import { MessageReactions } from "./message-reactions";
import {
  MediaAudioBubble,
  MediaDocumentBubble,
  MediaImageBubble,
  MediaUnavailable,
  MediaVideoBubble,
} from "./message-media";
import { InteractivePreview } from "@/components/interactive/interactive-preview";
import { useTranslations } from "next-intl";

interface MessageBubbleProps {
  message: Message;
  /** Pre-computed quote info for messages that reply to another. */
  reply?: { authorLabel: string; preview: string } | null;
  reactions?: MessageReaction[];
  currentUserId?: string;
  onToggleReaction?: (emoji: string) => void;
  /**
   * Opens the thread's media viewer on this message. Only images and videos
   * call it; omitted when the parent renders no viewer, in which case media
   * stays inline and non-clickable.
   */
  onOpenMedia?: (messageId: string) => void;
  isEditing?: boolean;
  onSaveEdit?: (newText: string) => void;
  onCancelEdit?: () => void;
}

/**
 * "[title] — [details]" for a failed message, or null when the row
 * predates migration 042 / Meta sent no reason. Shared by the status
 * icon's tooltip and the line under the bubble.
 */
function failureReason(message: Message): string | null {
  if (message.status !== "failed" || !message.error_title) return null;
  return message.error_details
    ? `${message.error_title} — ${message.error_details}`
    : message.error_title;
}

function StatusIcon({
  status,
  title,
}: {
  status: Message["status"];
  /** Tooltip for the failed state — Meta's reason, when we have one. */
  title?: string | null;
}) {
  switch (status) {
    case "sending":
      return <Clock className="h-3 w-3 text-muted-foreground" />;
    case "sent":
      return <Check className="h-3 w-3 text-muted-foreground" />;
    case "delivered":
      return <CheckCheck className="h-3 w-3 text-muted-foreground" />;
    case "read":
      return <CheckCheck className="h-3 w-3 text-blue-400" />;
    case "failed":
      return (
        <span className="inline-flex" title={title ?? undefined}>
          <XCircle className="h-3 w-3 text-red-400" />
        </span>
      );
    default:
      return null;
  }
}

function MessageContent({
  message,
  t,
  isAgent,
  onOpenMedia,
}: {
  message: Message;
  t: ReturnType<typeof useTranslations>;
  /** Outbound bubbles sit on the primary fill — badges must invert. */
  isAgent: boolean;
  onOpenMedia?: (messageId: string) => void;
}) {
  // Passed to the media bubbles as a no-arg callback; `undefined` when the
  // parent wired up no viewer, which is what makes them non-clickable.
  const openMedia = onOpenMedia ? () => onOpenMedia(message.id) : undefined;

  switch (message.content_type) {
    case "text":
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text}
        </p>
      );

    case "image":
      return (
        <div>
          {message.media_url ? (
            <MediaImageBubble message={message} onOpen={openMedia} t={t} />
          ) : (
            <MediaUnavailable label={t("photo")} t={t} />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "video":
      return (
        <div>
          {message.media_url ? (
            <MediaVideoBubble message={message} onOpen={openMedia} t={t} />
          ) : (
            <MediaUnavailable label={t("video")} t={t} />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "audio":
      return (
        <div>
          {message.media_url ? (
            <MediaAudioBubble message={message} t={t} />
          ) : (
            <MediaUnavailable label={t("audio")} t={t} />
          )}
        </div>
      );

    case "document":
      if (!message.media_url) {
        return <MediaUnavailable label={message.content_text || t("document")} t={t} />;
      }
      return <MediaDocumentBubble message={message} t={t} />;

    case "template":
      // Templates are almost always outbound, where the bubble fill IS
      // `primary` — so the old `bg-primary/20 text-primary` chip was
      // primary-on-primary and invisible. Paired with a null
      // content_text (issue #483) that rendered a bubble with nothing
      // in it at all. Invert on the primary fill, and fall back to the
      // template's name when we have no stored body (legacy rows sent
      // before the fix).
      return (
        <div>
          <span
            className={cn(
              "mb-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
              isAgent
                ? "bg-primary-foreground/20 text-primary-foreground"
                : "bg-primary/20 text-primary",
            )}
          >
            <LayoutTemplate className="h-3 w-3" />
            {t("template")}
          </span>
          {message.content_text ? (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          ) : (
            message.template_name && (
              <p className="mt-1 break-words text-sm italic opacity-80">
                {message.template_name}
              </p>
            )
          )}
        </div>
      );

    case "location":
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{message.content_text || t("locationShared")}</span>
        </div>
      );

    case "interactive": {
      // Three cases share content_type='interactive':
      //  - OUTBOUND with payload (composer / automation / Flow send after
      //    migration 035): render the buttons/list as they appear on the phone.
      //  - INBOUND tap (customer chose an option, sender_type='customer'):
      //    no payload; show the tapped option's title with a reply affordance
      //    so agents can tell it's a tap, not the customer typing.
      //  - OUTBOUND with NO payload (legacy bot/Flow sends from before
      //    migration 035 backfilled the column): show the body text plainly —
      //    it is our own message, NOT a customer tap.
      if (message.interactive_payload) {
        return <InteractivePreview payload={message.interactive_payload} />;
      }
      if (message.sender_type === "customer") {
        return (
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <CornerDownLeft className="h-3 w-3" />
              {t("buttonReply")}
            </span>
            <p className="whitespace-pre-wrap break-words text-sm">
              {message.content_text || t("interactiveReply")}
            </p>
          </div>
        );
      }
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || t("interactiveReply")}
        </p>
      );
    }

    default:
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || t("unsupported")}
        </p>
      );
  }
}

export function MessageBubble({
  message,
  reply,
  reactions,
  currentUserId,
  onToggleReaction,
  onOpenMedia,
  isEditing = false,
  onSaveEdit,
  onCancelEdit,
}: MessageBubbleProps) {
  const t = useTranslations("Inbox.bubble");
  const tActions = useTranslations("Inbox.actions");

  const [editText, setEditText] = useState(message.content_text ?? "");

  useEffect(() => {
    setEditText(message.content_text ?? "");
  }, [message.content_text, isEditing]);

  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";
  const time = format(new Date(message.created_at), "HH:mm");
  const failure = isAgent ? failureReason(message) : null;

  const handleSave = () => {
    const trimmed = editText.trim();
    if (!trimmed) return;
    onSaveEdit?.(trimmed);
  };

  // Row alignment + width cap are owned by <MessageActions> so its hover
  // group matches the bubble's content area, not the full row.
  return (
    <div
      className={cn(
        "flex flex-col",
        isAgent ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "relative rounded-2xl px-3 py-2",
          isAgent
            ? "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md bg-muted text-foreground",
        )}
      >
        {isEditing ? (
          <div className="flex flex-col gap-2 min-w-[220px] sm:min-w-[280px] py-0.5">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleSave();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onCancelEdit?.();
                }
              }}
              rows={Math.min(8, Math.max(2, editText.split("\n").length))}
              className={cn(
                "w-full rounded-md border p-2 text-sm focus:outline-none focus:ring-1 resize-y",
                isAgent
                  ? "border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground placeholder:text-primary-foreground/60 focus:ring-primary-foreground/50"
                  : "border-border bg-background text-foreground focus:ring-ring"
              )}
              autoFocus
            />
            <div className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  "text-[10px]",
                  isAgent
                    ? "text-primary-foreground/70"
                    : "text-muted-foreground"
                )}
              >
                {tActions("editHint")}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onCancelEdit}
                  className={cn(
                    "rounded px-2 py-1 text-xs font-medium transition-colors",
                    isAgent
                      ? "text-primary-foreground/80 hover:bg-primary-foreground/20 hover:text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {tActions("cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!editText.trim()}
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-semibold shadow-sm transition-colors disabled:opacity-50",
                    isAgent
                      ? "bg-primary-foreground text-primary hover:bg-primary-foreground/90"
                      : "bg-primary text-primary-foreground hover:bg-primary/90"
                  )}
                >
                  <Check className="h-3.5 w-3.5" />
                  {tActions("save")}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {reply && (
              <ReplyQuote
                authorLabel={reply.authorLabel}
                preview={reply.preview}
                onPrimary={isAgent}
              />
            )}
            <MessageContent
              message={message}
              t={t}
              isAgent={isAgent}
              onOpenMedia={onOpenMedia}
            />
            <div
              className={cn(
                "mt-1 flex items-center gap-1",
                isAgent ? "justify-end" : "justify-start",
              )}
            >
              {/* AI badge — only on replies the auto-reply bot generated
                  (always outbound, so it sits on the primary fill). Lets
                  agents tell an AI reply from their own / a Flow's at a
                  glance. */}
              {message.ai_generated && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-full bg-primary-foreground/20 px-1.5 py-px text-[9px] font-semibold uppercase leading-none tracking-wide text-primary-foreground"
                  title={t("aiBadgeTitle")}
                >
                  <Sparkles className="h-2.5 w-2.5" />
                  {t("aiBadge")}
                </span>
              )}
              <span
                className={cn(
                  "text-[10px]",
                  // Outbound bubbles sit on the primary fill, so the
                  // timestamp must read against that (not the neutral
                  // foreground) — otherwise it goes low-contrast in light
                  // mode. Inbound bubbles use the muted surface.
                  isAgent ? "text-primary-foreground/70" : "text-muted-foreground",
                )}
              >
                {time}
              </span>
              {isAgent && <StatusIcon status={message.status} title={failure} />}
            </div>
          </>
        )}
      </div>
      {failure && (
        <p
          className="mt-0.5 px-1 text-[10px] leading-tight text-muted-foreground"
          title={failure}
        >
          {t("notDelivered")}: {failure}
        </p>
      )}
      {reactions && reactions.length > 0 && onToggleReaction && (
        <MessageReactions
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      )}
    </div>
  );
}
