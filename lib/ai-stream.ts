// Controlled failure for the streaming AI chat routes.
//
// A streamed reply sends its HTTP headers (status 200) with the first byte. If the AI provider fails BEFORE producing any text (unreachable, rejected key, timeout),
// there is still time to answer honestly with a proper error response; once the first text has been sent the status is already 200 and the only honest thing left is
// to finish the reply with a short note. Before this helper the route created the stream inside the response body, so a failure before the first token left the
// client with a 200 and then a dropped connection ("failed to pipe response") and no explanation.
//
//   primeAiStream(stream)  waits until the stream has produced its first text delta (or finished, or failed) WITHOUT having sent anything to the client yet.
//   ok:false               nothing was produced: the caller returns a JSON error (see AI_UNAVAILABLE_*) with a real status code.
//   ok:true                the caller builds the streaming Response and iterates `replay()`, which yields the events already received and then the rest.

export const AI_UNAVAILABLE_MESSAGE = "The AI couldn't answer right now. Nothing was lost; please try again in a moment.";
export const AI_UNAVAILABLE_CODE = "ai_unavailable";

interface TypedEvent {
  type: string;
}

const isTextDelta = (e: TypedEvent) => e.type === "content_block_delta" && (e as { delta?: { type?: string } }).delta?.type === "text_delta";

export type PrimedStream<E> = { ok: true; replay: () => AsyncGenerator<E, void, void> } | { ok: false; error: unknown };

export async function primeAiStream<E extends TypedEvent>(stream: AsyncIterable<E>): Promise<PrimedStream<E>> {
  const iterator = stream[Symbol.asyncIterator]();
  const buffered: E[] = [];
  let finished = false;
  try {
    for (;;) {
      const next = await iterator.next();
      if (next.done) {
        finished = true;
        break;
      }
      buffered.push(next.value);
      if (isTextDelta(next.value)) break;
    }
  } catch (error) {
    return { ok: false, error };
  }
  async function* replay(): AsyncGenerator<E, void, void> {
    for (const e of buffered) yield e;
    if (finished) return;
    for (;;) {
      const next = await iterator.next();
      if (next.done) return;
      yield next.value;
    }
  }
  return { ok: true, replay };
}
