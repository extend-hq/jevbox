export function choiceResponse(body: any): Response {
  return Response.json({
    answers: Object.fromEntries(
      Object.entries(body.questions).map(([id, question]: [string, any]) => {
        const choices = Object.keys(question.criteria).filter(
          (key) => key !== "none",
        );
        return [
          id,
          {
            type: "choice",
            probabilities: {
              ...Object.fromEntries(
                choices.map((key) => [key, 1 / choices.length]),
              ),
              none: 0,
            },
          },
        ];
      }),
    ),
  });
}

export function toolSources(body: any): any[] {
  const lastUser = body.input.findLastIndex(
    (message: any) => message.role === "user",
  );
  const results = body.input
    .slice(lastUser + 1)
    .filter((message: any) => message.type === "function_call_output");
  return results.flatMap(
    (message: any) => JSON.parse(message.output).sources ?? [],
  );
}

export function questionFromRequest(body: any): string {
  const message = body.input.findLast((item: any) => item.role === "user");
  return JSON.parse(message.content[0].text).question;
}

export const responseUsage = {
  input_tokens: 10,
  output_tokens: 10,
  total_tokens: 20,
};

export function textResponse(body: any, text: string): Response {
  return Response.json({
    id: "response",
    created_at: 1,
    model: body.model,
    status: "completed",
    output: [
      {
        id: "message",
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    usage: responseUsage,
  });
}

export function responseEvent(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function searchToolResponse(body: any): Response | undefined {
  if (!body.tools?.some((tool: any) => tool.name === "search_documents"))
    return;
  const lastUser = body.input.findLastIndex(
    (message: any) => message.role === "user",
  );
  const question = questionFromRequest(body);
  const toolResults = body.input
    .slice(lastUser + 1)
    .filter((message: any) => message.type === "function_call_output");
  if (/^(hello|hi|thanks)[!. ]*$/i.test(question) || toolResults.length) return;
  const call = {
    id: "search-call",
    call_id: "search-call",
    type: "function_call",
    name: "search_documents",
    arguments: JSON.stringify({ query: question }),
    status: "completed",
  };
  if (!body.stream)
    return Response.json({
      id: "tool-response",
      created_at: 1,
      model: body.model,
      output: [call],
      usage: responseUsage,
    });
  return new Response(
    responseEvent({
      type: "response.created",
      response: { id: "tool-response", created_at: 1, model: body.model },
    }) +
      responseEvent({
        type: "response.output_item.added",
        output_index: 0,
        item: { ...call, arguments: "" },
      }) +
      responseEvent({
        type: "response.function_call_arguments.delta",
        item_id: call.id,
        output_index: 0,
        delta: call.arguments,
      }) +
      responseEvent({
        type: "response.output_item.done",
        output_index: 0,
        item: call,
      }) +
      responseEvent({
        type: "response.completed",
        response: { usage: responseUsage },
      }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
