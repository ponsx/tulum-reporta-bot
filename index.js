// index.js

import { createClient } from "@supabase/supabase-js";
import express from "express";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

// =======================
//  CONFIG BÁSICA
// =======================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public")); // para mapa.html, editar.html, etc.

// =======================
//  SUPABASE
// =======================

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log("✅ Supabase inicializado");
} else {
  console.warn(
    "⚠️ Supabase NO configurado (faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY)"
  );
}

// =======================
//  CONFIG WHATSAPP
// =======================

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

// Enviar mensaje de WhatsApp usando la Cloud API
async function sendWhatsAppMessage(to, text) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.error("⚠️ Falta WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID");
    return;
  }

  const url = `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const body = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: {
      body: text,
    },
  };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    if (!resp.ok) {
      console.error("❌ Error al enviar mensaje WhatsApp:", JSON.stringify(data));
    } else {
      console.log("✅ Mensaje enviado a", to);
    }
  } catch (e) {
    console.error("❌ Error de red al enviar mensaje WhatsApp:", e);
  }
}

// =======================
//  CONFIG MODERACIÓN
// =======================

const MODERATOR_PHONE = process.env.MODERATOR_PHONE; // número de admin
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL; // p.ej. https://www.tulumreporta.com
const MAP_BASE_URL = process.env.PUBLIC_MAP_BASE_URL; // p.ej. https://www.tulumreporta.com/mapa
const MODERATION_TOKEN = process.env.MODERATION_TOKEN; // token largo para proteger enlaces

const REJECTION_MESSAGES = {
  datos_insuficientes:
    "faltan datos clave (ubicación, descripción o evidencia) para gestionarlo.",
  fuera_de_tulum:
    "el problema reportado está fuera del municipio de Tulum.",
  otro:
    "no cumple con los criterios de Tulum Reporta (problemas del espacio público y servicios).",
};

// Avisar al moderador cuando entra un nuevo incidente
async function notifyModerator(incidente) {
  if (!MODERATOR_PHONE) {
    console.warn("⚠️ MODERATOR_PHONE no configurado; no se envía aviso.");
    return;
  }
  if (!PUBLIC_BASE_URL || !MAP_BASE_URL || !MODERATION_TOKEN) {
    console.warn(
      "⚠️ Faltan PUBLIC_BASE_URL / MAP_BASE_URL / MODERATION_TOKEN para links de moderación"
    );
  }

  const approveUrl = `${PUBLIC_BASE_URL}/moderate/${incidente.id}/approve?token=${MODERATION_TOKEN}`;
  const rejectDatosUrl = `${PUBLIC_BASE_URL}/moderate/${incidente.id}/reject?reason=datos_insuficientes&token=${MODERATION_TOKEN}`;
  const rejectFueraUrl = `${PUBLIC_BASE_URL}/moderate/${incidente.id}/reject?reason=fuera_de_tulum&token=${MODERATION_TOKEN}`;
  const rejectOtroUrl = `${PUBLIC_BASE_URL}/moderate/${incidente.id}/reject?reason=otro&token=${MODERATION_TOKEN}`;
  const editUrl = `${PUBLIC_BASE_URL}/editar.html?id=${incidente.id}`;

  const texto = `🔔 Nuevo reporte pendiente de revisión

Categoría: ${incidente.categoria || "-"}
Subcategoría: ${incidente.subcategoria || "-"}
Descripción: ${incidente.descripcion || "-"}
Ubicación: ${incidente.ubicacion || "-"}
Mapa rápido: ${MAP_BASE_URL}?id=${incidente.id}

➕ Aprobar:
${approveUrl}

❌ Rechazar (datos insuficientes):
${rejectDatosUrl}

❌ Rechazar (fuera de Tulum):
${rejectFueraUrl}

❌ Rechazar (otro):
${rejectOtroUrl}

✏️ Editar ubicación:
${editUrl}
`;

  await sendWhatsAppMessage(MODERATOR_PHONE, texto);
}

// Crear incidente desde el flujo de Whats y lanzarlo como "pending"
async function createIncident(phone, incidentData) {
  if (!supabase) throw new Error("Supabase no configurado");

  const { data, error } = await supabase
    .from("incidentes")
    .insert({
      ...incidentData,
      phone, // nombre de la columna que acordamos
      status: "pending",
    })
    .select()
    .single();

  if (error) {
    console.error("❌ Error guardando incidente:", error);
    throw error;
  }

  console.log("✅ Incidente creado con id:", data.id);
  await notifyModerator(data);

  return data;
}

// =======================
//  RUTAS BÁSICAS
// =======================

app.get("/", (req, res) => {
  res.status(200).send("Tulum Reporta bot running");
});

app.get("/ping", (req, res) => {
  res.status(200).send("pong");
});

// =======================
//  WEBHOOK WHATSAPP
// =======================

// Verificación inicial del webhook (GET)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
    console.log("✅ Webhook verificado con Meta");
    res.status(200).send(challenge);
  } else {
    console.warn("⚠️ Intento de verificación fallido");
    res.sendStatus(403);
  }
});

// Recepción de mensajes (POST)
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    if (body.object === "whatsapp_business_account") {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const messages = changes?.value?.messages;

      if (messages && messages.length > 0) {
        const message = messages[0];
        await handleIncomingMessage(message);
      }
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("❌ Error procesando webhook:", e);
    res.sendStatus(500);
  }
});

// Lógica simplificada de entrada de mensajes
async function handleIncomingMessage(message) {
  const from = message.from; // teléfono del usuario
  const type = message.type;

  // Texto
  if (type === "text") {
    const text = message.text.body?.trim() || "";

    // 👇 EJEMPLO: si el usuario escribe "REPORTE DEMO" creamos un incidente de prueba
    if (text.toUpperCase().startsWith("REPORTE DEMO")) {
      const demoIncident = {
        categoria: "Demo",
        subcategoria: "Demo",
        descripcion: "Reporte de prueba creado por el bot.",
        ubicacion: "Tulum, ubicación demo",
        zona: "Tulum centro",
        lat: 20.2,
        lon: -87.4,
        peligro: "bajo",
      };

      try {
        await createIncident(from, demoIncident);
        await sendWhatsAppMessage(
          from,
          "✅ Recibimos tu reporte demo. Está pendiente de revisión."
        );
      } catch (e) {
        await sendWhatsAppMessage(
          from,
          "❌ Hubo un problema al guardar tu reporte. Intenta más tarde."
        );
      }
    } else {
      // AQUÍ VA TU FLUJO REAL ACTUAL:
      // - categorías
      // - subcategorías
      // - pedir foto, descripción, ubicación, etc.
      // Cuando tengas todos los datos, llamas a createIncident(from, incidentData)
      await sendWhatsAppMessage(
        from,
        "👋 Hola, este es el bot de Tulum Reporta. Pronto conectamos todo tu flujo completo aquí."
      );
    }
  }

  // Ubicación
  if (type === "location") {
    const loc = message.location;
    const lat = loc.latitude;
    const lon = loc.longitude;

    // Aquí puedes guardar lat/lon en tu estado de usuario y luego usarlo en incidentData
    console.log("📍 Ubicación recibida:", from, lat, lon);
    await sendWhatsAppMessage(
      from,
      "📍 Ubicación recibida. Continua tu reporte."
    );
  }

  // Imagen
  if (type === "image") {
    console.log("🖼️ Imagen recibida de", from);
    // Aquí va tu lógica de descarga/guardado de foto si ya la tienes implementada
    await sendWhatsAppMessage(
      from,
      "🖼️ Foto recibida. Gracias, continúa con tu reporte."
    );
  }
}

// =======================
//  RUTAS DE MODERACIÓN
// =======================

// Aprobar incidente
app.get("/moderate/:id/approve", async (req, res) => {
  const { id } = req.params;
  const { token } = req.query;

  if (token !== MODERATION_TOKEN) {
    return res.status(403).send("No autorizado");
  }

  try {
    const { data, error } = await supabase
      .from("incidentes")
      .update({
        status: "approved",
        moderated_at: new Date().toISOString(),
        moderated_by: "whatsapp_admin",
      })
      .eq("id", id)
      .select("id, phone");

    if (error || !data || !data.length) {
      console.error("❌ Error aprobando incidente:", error);
      return res.status(500).send("Error al aprobar el reporte");
    }

    const incidente = data[0];

    const msg = `✅ Tu reporte ya es público en Tulum Reporta.

Lo que reportas, importa.
Míralo en el mapa y compártelo:
${MAP_BASE_URL}?id=${incidente.id}`;

    if (incidente.phone) {
      await sendWhatsAppMessage(incidente.phone, msg);
    }

    res.send("Reporte aprobado y publicado ✅");
  } catch (e) {
    console.error("❌ Error inesperado al aprobar incidente:", e);
    res.status(500).send("Error inesperado");
  }
});

// Rechazar incidente
app.get("/moderate/:id/reject", async (req, res) => {
  const { id } = req.params;
  const { token, reason } = req.query;

  if (token !== MODERATION_TOKEN) {
    return res.status(403).send("No autorizado");
  }

  const reasonKey = reason || "otro";
  const rejection = REJECTION_MESSAGES[reasonKey] || REJECTION_MESSAGES.otro;

  try {
    const { data, error } = await supabase
      .from("incidentes")
      .update({
        status: "rejected",
        rejection_reason: rejection,
        moderated_at: new Date().toISOString(),
        moderated_by: "whatsapp_admin",
      })
      .eq("id", id)
      .select("id, phone");

    if (error || !data || !data.length) {
      console.error("❌ Error rechazando incidente:", error);
      return res.status(500).send("Error al rechazar el reporte");
    }

    const incidente = data[0];

    const msg = `🚫 Tu reporte en Tulum Reporta fue rechazado.

Motivo: ${rejection}

Si crees que es un error, puedes hacer un nuevo reporte con más detalles y foto clara.`;

    if (incidente.phone) {
      await sendWhatsAppMessage(incidente.phone, msg);
    }

    res.send("Reporte rechazado y propietario notificado 🚫");
  } catch (e) {
    console.error("❌ Error inesperado al rechazar incidente:", e);
    res.status(500).send("Error inesperado");
  }
});

// =======================
//  API PARA EL MAPA PÚBLICO
// =======================

app.get("/api/incidentes", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("incidentes")
      .select(
        "id, lat, lon, categoria, subcategoria, descripcion, zona, ubicacion, peligro, created_at"
      )
      .eq("status", "approved"); // solo aprobados

    if (error) {
      console.error("❌ Error consultando incidentes:", error);
      return res.status(500).json({ error: "Error consultando incidentes" });
    }

    res.json(data || []);
  } catch (e) {
    console.error("❌ Error inesperado /api/incidentes:", e);
    res.status(500).json({ error: "Error inesperado" });
  }
});

// =======================
//  ARRANCAR SERVIDOR
// =======================

app.listen(PORT, () => {
  console.log(`🚀 Servidor Tulum Reporta escuchando en el puerto ${PORT}`);
});
