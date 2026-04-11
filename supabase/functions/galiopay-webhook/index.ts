import { createAdminClient, corsHeaders } from "../_shared/supabase.ts";

function parseWebhookDate(value: unknown) {
  if (value == null || value === "") return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const parsed = new Date(ms);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^\d+$/.test(trimmed)) {
      return parseWebhookDate(Number(trimmed));
    }

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  return null;
}

function getApprovedAtFromPayload(payload: Record<string, unknown>) {
  return (
    parseWebhookDate(payload.paidAt) ||
    parseWebhookDate(payload.paid_at) ||
    parseWebhookDate(payload.approvedAt) ||
    parseWebhookDate(payload.approved_at) ||
    parseWebhookDate(payload.dateApproved) ||
    parseWebhookDate(payload.date_approved) ||
    parseWebhookDate(payload.date) ||
    parseWebhookDate(payload.updatedAt) ||
    parseWebhookDate(payload.updated_at) ||
    new Date().toISOString()
  );
}

async function verifyPaymentLinkApproval(paymentLinkId?: string, proofToken?: string) {
  if (!paymentLinkId || !proofToken) {
    return { approved: false, details: { reason: "missing_payment_link_verification_data" } };
  }

  const url = new URL(`https://pay.galio.app/api/payment-links/${paymentLinkId}`);
  url.searchParams.set("proof", proofToken);

  const response = await fetch(url.toString(), {
    headers: {
      "Content-Type": "application/json",
    },
  });

  const details = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      approved: false,
      details: {
        reason: "payment_link_lookup_failed",
        status: response.status,
        body: details,
      },
    };
  }

  return {
    approved: String(details?.status || "").toLowerCase() === "approved",
    details,
  };
}

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
      const paymentLinkId = order.metadata?.galiopay?.paymentLinkId;
      const proofToken = order.metadata?.galiopay?.proofToken;
      const verification = await verifyPaymentLinkApproval(paymentLinkId, proofToken);

      if (!verification.approved) {
        await supabase.from("payment_transactions").insert({
          order_id: order.id,
          provider: "galiopay",
          status: "verification_rejected",
          amount_ars: Number(payload.amount || 0),
          provider_payment_id: payload.id || null,
          provider_external_reference: referenceId,
          raw_payload: {
            webhook: payload,
            verification: verification.details,
          },
        });

        return new Response(JSON.stringify({
          received: true,
          ignored: true,
          reason: "payment_link_not_approved",
        }), {
          status: 202,
          headers: { ...corsHeaders(), "Content-Type": "application/json" },
        });
      }

      const { error: updateError } = await supabase
        .from("orders")
        .update({
          status: "paid",
          provider: "galiopay",
          provider_payment_id: payload.id || null,
          paid_at: getApprovedAtFromPayload(payload),
          metadata: {
            ...(order.metadata || {}),
            webhook: payload,
            payment_link_verification: verification.details,
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
