import { createAdminClient, corsHeaders } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  try {
    const payload = await req.json();
    const referenceId = payload?.referenceId;
    if (!referenceId) {
      return new Response(JSON.stringify({ error: "referenceId is required" }), {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    const supabase = createAdminClient();
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, status, external_reference, provider, metadata")
      .eq("external_reference", referenceId)
      .limit(1)
      .maybeSingle();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    await supabase.from("payment_transactions").insert({
      order_id: order.id,
      provider: "galiopay",
      status: payload.status || "unknown",
      amount_ars: Number(payload.amount || 0),
      provider_payment_id: payload.id || null,
      provider_external_reference: referenceId,
      raw_payload: payload,
    });

    if (String(payload.status).toLowerCase() === "approved" && order.status !== "paid") {
      const { error: updateError } = await supabase
        .from("orders")
        .update({
          status: "paid",
          provider: "galiopay",
          provider_payment_id: payload.id || null,
          paid_at: payload.date || new Date().toISOString(),
          metadata: {
            ...(order.metadata || {}),
            webhook: payload,
          },
        })
        .eq("id", order.id);

      if (updateError) {
        return new Response(JSON.stringify({ error: updateError.message }), {
          status: 500,
          headers: { ...corsHeaders(), "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unexpected error" }), {
      status: 500,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }
});
