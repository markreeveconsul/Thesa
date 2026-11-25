import type { DocumentNode } from "./document";

export const sampleChapters = [
  "Introduction",
  "Literature review",
  "Methodology",
  "Results & discussion",
  "Conclusion",
];

export const STARTER_PROJECT_TITLE = "Social Media Use and Academic Performance";
export const STARTER_RESEARCH_PROBLEM =
  "How do undergraduate students distinguish collaborative study use of social media from passive leisure scrolling in their daily study routines?";

export const starterChapterDocs: Record<string, DocumentNode> = {
  Introduction: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "University students routinely keep messaging apps, video tutorials, and social feeds open alongside their coursework. Yet existing surveys often collapse these distinct behaviors into a single measure of daily screen time, obscuring how intentional peer collaboration differs from fragmented leisure scrolling.",
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Recent mixed-methods studies suggest that students actively separate structured study chats from passive browsing when managing assignment deadlines (Chen et al., 2024, p. 1).",
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "This thesis examines when undergraduate learners rely on social platforms for academic coordination, how they regulate attention switches during independent reading, and what study routines correlate with sustained focus.",
          },
        ],
      },
    ],
  },
  "Literature review": {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Academic collaboration vs. passive browsing" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Prior investigations establish that context-switching imposes measurable cognitive recovery costs during complex reading tasks. However, peer study channels also lower friction when clarifying lecture concepts outside office hours.",
          },
        ],
      },
    ],
  },
};

export const STARTER_SOURCE_FILENAME = "Chen_2024_Study_Routines.txt";
export const STARTER_SOURCE_LINES = [
  "Chen, M., Alvarez, R., & Okafor, T. (2024). Distinguishing Collaborative Study Chats from Passive Scrolling Among Undergraduates.",
  "Journal of Higher Education Digital Habits, 18(2), 112-128.",
  "Finding 1: Across a 14-day diary study of 84 undergraduates, participants separated collaborative study chats from passive scrolling in 78% of logged study blocks.",
  "Finding 2: Purposeful peer messaging around problem sets was associated with higher assignment completion rates when notifications for entertainment feeds were muted.",
  "Limitation: Self-reported diary intervals may undercount brief micro-checks lasting under 30 seconds during late-night writing sessions.",
];
