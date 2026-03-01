-- Add importance classification columns to user_recent_emails.
-- Values: must_know, respond_needed, optional (matches GmailPriorityLlmClassifier categories).
ALTER TABLE public.user_recent_emails
  ADD COLUMN importance text NOT NULL DEFAULT 'optional',
  ADD COLUMN importance_reason text NOT NULL DEFAULT '';
