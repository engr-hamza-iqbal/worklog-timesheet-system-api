import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import nodemailer from "npm:nodemailer@6.9.16";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed. Use POST." }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const payload = await req.json();
    const { to, subject, html, text, from, smtpUser, smtpPass } = payload;

    if (!to || !subject || (!html && !text)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required fields. 'to', 'subject', and 'html' or 'text' are required.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve SMTP credentials (passed in payload from Render or configured via Supabase Edge Function Secrets)
    const user = smtpUser || Deno.env.get("SMTP_USER");
    const pass = smtpPass || Deno.env.get("SMTP_PASS");
    const host = Deno.env.get("SMTP_HOST") || "smtp.gmail.com";
    const fromAddress = from || Deno.env.get("EMAIL_FROM") || (user ? `Work Log <${user}>` : "Work Log <no-reply@localhost>");

    if (!user || !pass) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "SMTP credentials not provided. Provide 'smtpUser' and 'smtpPass' in payload or configure SMTP_USER/SMTP_PASS function secrets.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[send-email] Attempting dispatch to: ${to} | Subject: ${subject}`);

    // Try standard submission port 587 (STARTTLS) first, fallback to 465 (SSL)
    const createTransport = (port: number, secure: boolean) =>
      nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 10000,
      });

    let info;
    try {
      const transporter = createTransport(587, false);
      info = await transporter.sendMail({
        from: fromAddress,
        to,
        subject,
        html,
        text: text || html.replace(/<[^>]+>/g, ""),
      });
      console.log(`[send-email] Delivered via Port 587: ${info.messageId}`);
    } catch (err: any) {
      console.warn(`[send-email] Port 587 dispatch failed (${err.message}). Trying port 465...`);
      const transporter465 = createTransport(465, true);
      info = await transporter465.sendMail({
        from: fromAddress,
        to,
        subject,
        html,
        text: text || html.replace(/<[^>]+>/g, ""),
      });
      console.log(`[send-email] Delivered via Port 465: ${info.messageId}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Email sent successfully",
        messageId: info.messageId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[send-email] Failed to dispatch email:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Failed to dispatch email",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
