/** The declaration step, before a session has been recorded. */
export function formatIntentPrompt(): string[] {
  return [
    "  Intent",
    "  What are you working on?",
    "  Describe the change you want to make.",
    "  Enter to continue · Ctrl-C to cancel",
    "",
    "  › ",
  ];
}
