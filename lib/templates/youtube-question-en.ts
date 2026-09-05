// YouTube v2 fallback (en). See youtube-question-es.ts.

import type { TemplateBuilder } from "./types";
import { esc, signatureHtml } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => {
  const name = esc(channelName);
  return {
    subject: `${channelName} shorts`,
    html: [
      `<p>Hi,</p>`,
      `<p>A question about ${name}: who cuts the shorts today? If the answer is nobody, or an editor you wait days for, try this: upload the video to Clipzi, it flags the best moments, and five minutes later you have the shorts, vertical and captioned.</p>`,
      `<p>Try it free at clipzi.app.</p>`,
      signatureHtml(fromName),
    ].join(""),
  };
};
