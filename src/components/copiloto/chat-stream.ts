// Lectura de la respuesta del asistente (Server-Sent Events): cada bloque «event: … / data: …» es un evento
// del contrato (decision, text, clarify, draft, table, done, error…).

export interface StreamEvent {
  event: string;
  data: unknown;
}

export async function* streamEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let cut = buffer.indexOf("\n\n");
    while (cut >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      cut = buffer.indexOf("\n\n");
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const raw = /^data: (.*)$/m.exec(block)?.[1];
      if (event && raw) yield { event, data: JSON.parse(raw) as unknown };
    }
  }
}
