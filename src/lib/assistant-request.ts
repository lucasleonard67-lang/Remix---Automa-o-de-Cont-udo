interface AssistantTransport {
  getAccessToken: () => Promise<string | null>;
  invoke: (options: {
    body: Record<string, unknown>;
    headers: { Authorization: string };
  }) => Promise<{ data: unknown; error: unknown }>;
}

/** Check again at dispatch time: sign-out can occur after a query is enabled. */
export async function requestAssistant(body: Record<string, unknown>, transport: AssistantTransport) {
  const accessToken = await transport.getAccessToken();
  if (!accessToken) return { status: "signed_out" } as const;

  const response = await transport.invoke({ body, headers: { Authorization: `Bearer ${accessToken}` } });
  return { status: "completed", ...response } as const;
}