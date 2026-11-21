import { publicSteps } from "./chat-history.ts";
import { readFormulaProposal, type FormulaProposal } from "./formula-proposal.ts";

type ChatReply = { answer: string; proposals: FormulaProposal[] };

function readReply(body: { answer: string; formula_proposals?: unknown }): ChatReply {
  const proposals = Array.isArray(body.formula_proposals)
    ? body.formula_proposals.map(readFormulaProposal).filter((proposal) => proposal !== null)
    : [];
  return { answer: body.answer, proposals };
}

/** Existing JSON replies or newline-delimited public step events followed by one final answer. */
export async function readChatResponse(response: Response, onStep: (label: string) => void): Promise<ChatReply> {
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
    const body = await response.json();
    for (const step of publicSteps(body.public_steps)) onStep(step);
    if (typeof body.answer !== "string") throw new Error("Missing answer");
    return readReply(body);
  }
  if (!response.body) throw new Error("Missing chat stream");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let count = 0;
  let reply: ChatReply | undefined;
  function consume(line: string) {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "error") throw new Error("Chat request failed");
    if (event.type === "step" && !reply && count < 30 && typeof event.label === "string" && event.label.trim()) {
      count++;
      onStep(event.label.slice(0, 500));
    }
    if (event.type === "final" && typeof event.answer === "string") reply = readReply(event);
  }
  try {
    while (!reply) {
      const { value, done } = await reader.read();
      if (done) { consume(buffer); break; }
      const lines = (buffer + value).split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) consume(line);
    }
    if (!reply) throw new Error("Incomplete chat response");
    return reply;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
