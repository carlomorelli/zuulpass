export default {
  async fetch(_request: Request): Promise<Response> {
    return new Response(JSON.stringify({ ok: true, service: "zuulpass" }), {
      headers: { "content-type": "application/json" },
    });
  },
} satisfies ExportedHandler;
