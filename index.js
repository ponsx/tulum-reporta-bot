// ===========================================================
// index.js — Versión limpia, final y alineada a tu nueva BD
// ===========================================================

import { createClient } from "@supabase/supabase-js";
import express from "express";
import fetch from "node-fetch";
import { Buffer } from "node:buffer";
import path from "path";
import { fileURLToPath } from "url";
import jwt from "jsonwebtoken";

// =======================
// CONFIG BÁSICA
// =======================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));
app.use(express.json());

// URL públicas
const MAP_BASE_URL =
  process.env.PUBLIC_MAP_BASE_URL || "https://bot.tulumreporta.com/mapa";
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || "https://bot.tulumreporta.com";

// Token edición
const EDIT_TOKEN_SECRET =
  process.env.EDIT_TOKEN_SECRET || "CAMBIA_ESTE_SECRET_EN_PROD";
const EDIT_TOKEN_EXP_SECONDS = 60 * 60 * 24;

// Admin
const ADMIN_PHONE = process.env.ADMIN_PHONE || null;
const ADMIN_MOD_TOKEN = process.env.ADMIN_MOD_TOKEN || null;

// =======================
// SUPABASE
// =======================

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log("Supabase inicializado");
} else {
  console.warn("Supabase NO configurado.");
}

// =======================
// CATEGORIZACIÓN
// =======================

const CATEGORIES = {
  "1": {
    nombre: "Calles y Carreteras 🚗",
    subcategorias: [
      "Hoyo en la calle",
      "Pavimento dañado",
      "Obstáculo en la vía",
      "Topes y reductores",
      "Zona de accidentes",
      "Señal rota o ausente",
    ],
    subcategoriaOtro: "Otro problema",
  },
  "2": {
    nombre: "Banquetas y Parques 🚶🏽",
    subcategorias: [
      "Banqueta dañada",
      "Árbol o rama caída",
      "Raíz o rama invadiendo",
      "Mobiliario urbano roto",
      "Area verde descuidada",
      "Estructura en mal estado",
    ],
    subcategoriaOtro: "Otro problema",
  },
  "3": {
    nombre: "Basura y Residuos ♻️",
    subcategorias: [
      "Basura acumulada",
      "Escombro suelto",
      "Tiradero ilegal",
      "Contenedor roto",
      "Animal muerto",
      "Residuo peligroso",
    ],
    subcategoriaOtro: "Otro problema",
  },
  "4": {
    nombre: "Agua y Drenaje 💧",
    subcategorias: [
      "Fuga de agua",
      "Alcantarilla tapada",
      "Encharcamiento/inundación",
      "Olor fuerte a drenaje",
      "Drenaje desbordado",
      "Pozo o registro abierto",
    ],
    subcategoriaOtro: "Otro problema",
  },
  "5": {
    nombre: "Luces y Electricidad 💡",
    subcategorias: [
      "Luminaria fallando",
      "Poste dañado",
      "Cables colgando",
      "Transformadores",
      "Zona muy oscura",
      "Riesgo eléctrico",
    ],
    subcategoriaOtro: "Otro problema",
  },
  "6": {
    nombre: "Animales y Fauna 🐾",
    subcategorias: [
      "Fauna salvaje peligrosa",
      "Panal de abejas/avispas",
      "Nidos en estructuras",
      "Animal herido/agresivo",
      "Animal doméstico suelto",
      "Plagas en vía pública",
    ],
    subcategoriaOtro: "Otro problema",
  },
  "7": {
    nombre: "Construcción y Obras 🚧",
    subcategorias: [
      "Zanja abierta",
      "Obra sin señalización",
      "Material de obra en calle",
      "Obra abandonada",
      "Valla/protección dañada",
      "Excavación peligrosa",
    ],
    subcategoriaOtro: "Otro problema",
  },
  "0": {
    nombre: "Otro tipo de problema",
    subcategorias: [],
    subcategoriaOtro: "Otro tipo de problema",
  },
};

// =======================
// ESTADO BOT
// =======================

const userStates = {};

function getUserState(phone) {
  if (!userStates[phone]) userStates[phone] = { state: "IDLE", data: {} };
  return userStates[phone];
}

function setUserState(phone, state, newData = {}) {
  const prev = userStates[phone] || { data: {} };
  userStates[phone] = { state, data: { ...prev.data, ...newData } };
}

// =======================
// TOKENS DE EDICIÓN
// =======================

function generateEditToken(incidentId, phone) {
  return jwt.sign({ incidentId, phone }, EDIT_TOKEN_SECRET, {
    expiresIn: EDIT_TOKEN_EXP_SECONDS,
  });
}

function verifyEditToken(token) {
  try {
    return jwt.verify(token, EDIT_TOKEN_SECRET);
  } catch {
    return null;
  }
}

function generateShortId() {
  return [...Array(8)].map(() => Math.random().toString(36)[2]).join("");
}

// =======================
// ADMIN AUTH
// =======================

function checkAdminAuth(req, res, next) {
  const token =
    req.headers["x-admin-token"] ||
    req.query.admin_token ||
    req.body?.admin_token;

  if (!ADMIN_MOD_TOKEN || token !== ADMIN_MOD_TOKEN) {
    return res.status(401).json({ error: "No autorizado" });
  }
  next();
}

// =======================
// RUTAS BÁSICAS
// =======================

app.get("/", (req, res) => res.send("Tulum Reporta bot running"));
app.get("/ping", (req, res) => res.send("pong"));

// =======================
// SHORT LINK /e/:id
// =======================

app.get("/e/:shortId", async (req, res) => {
  const { shortId } = req.params;

  const { data, error } = await supabase
    .from("edit_tokens")
    .select("incident_id, token, expires_at")
    .eq("short_id", shortId)
    .single();

  if (error || !data) return res.status(404).send("Enlace inválido");
  if (new Date(data.expires_at) < new Date())
    return res.status(410).send("Expirado");

  return res.redirect(
    `/editar.html?incidentId=${data.incident_id}&t=${encodeURIComponent(
      data.token
    )}`
  );
});

// =======================
// API MAPA (PÚBLICO)
// =======================

app.get("/api/reportes", async (req, res) => {
  const { data, error } = await supabase
    .from("reportes")
    .select(
      "id, categoria, subcategoria, descripcion, gravedad, estado, foto_url, lat, lon, created_at"
    )
    .eq("estado", "publicado")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: "Error leyendo reportes" });

  res.json(data);
});

// =======================
// API EDITOR: GET
// =======================

app.get("/api/reportes/:id", async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).json({ error: "Falta token" });

  const payload = verifyEditToken(token);
  if (!payload || payload.incidentId !== req.params.id)
    return res.status(403).json({ error: "Token inválido" });

  const { data, error } = await supabase
    .from("reportes")
    .select("id, foto_url, lat, lon")
    .eq("id", req.params.id)
    .single();

  if (error) return res.status(404).json({ error: "No encontrado" });
  res.json(data);
});

// =======================
// API EDITOR: UPDATE LOCATION
// =======================

app.put("/api/reportes/:id/location", async (req, res) => {
  const token = req.query.token;
  const { lat, lon } = req.body;

  if (!token) return res.status(401).json({ error: "Falta token" });

  const payload = verifyEditToken(token);
  if (!payload || payload.incidentId !== req.params.id)
    return res.status(403).json({ error: "Token inválido" });

  if (!isCoordInTulum(lat, lon))
    return res.status(400).json({ error: "Coordenadas fuera de Tulum" });

  const { data, error } = await supabase
    .from("reportes")
    .update({ lat, lon })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: "Error actualizando" });
  res.json({ ok: true, reporte: data });
});

// =======================
// MAPA VIEW
// =======================

app.get("/mapa", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "mapa.html"));
});

// =======================
// WEBHOOK
// =======================

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const verifyToken = process.env.VERIFY_TOKEN;

  if (mode === "subscribe" && token === verifyToken) {
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  const entry = req.body.entry?.[0];
  const changes = entry?.changes?.[0];
  const messages = changes?.value?.messages;

  if (messages?.length > 0) {
    const msg = messages[0];
    await handleIncomingMessage(
      msg.from,
      msg.text?.body?.trim() || "",
      msg.location || null,
      msg.image || null
    );
  }

  res.sendStatus(200);
});

// =======================
// BOT LOGIC
// =======================

async function handleIncomingMessage(phone, text, location, image) {
  const user = getUserState(phone);

  if (user.state === "IDLE") {
    const categorias = Object.entries(CATEGORIES)
      .filter(([k]) => k !== "0")
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
      .map(([k, v]) => `${k}. ${v.nombre}`);

    categorias.push(`0. ${CATEGORIES["0"].nombre}`);

    await sendMessage(
  phone,
  "Hola 👋, ¿qué tipo de problema quieres reportar?\n\n" +
    categorias.join("\n") +
    "\n\n_ℹ️ Solo atendemos reportes ciudadanos. Si tienes una emergencia, llama al 911._"
);
    return setUserState(phone, "ESPERANDO_CATEGORIA");
  }

  switch (user.state) {
    case "ESPERANDO_CATEGORIA": {
      const cat = CATEGORIES[text];
      if (!cat) return sendMessage(phone, "Elige un número válido (0–7)");

      // Si la categoría no tiene subcategorías (caso "0"),
      // saltamos directamente a pedir foto y usamos una subcategoría genérica.
      if (cat.subcategorias.length === 0) {
        setUserState(phone, "ESPERANDO_FOTO", {
          ...user.data,
          categoria: cat.nombre,
          subcategoria: "Otro tipo de problema",
        });

        return sendMessage(phone, "Envía una *foto* del problema.");
      }

      // Resto de categorías: pedir subcategoría numérica
      setUserState(phone, "ESPERANDO_SUBCATEGORIA", {
        categoria: cat.nombre,
      });

      const subMenu = cat.subcategorias
        .map((s, i) => `${i + 1}. ${s}`)
        .concat(`0. ${cat.subcategoriaOtro}`)
        .join("\n");

      return sendMessage(
        phone,
        `*${cat.nombre}*\nElige una opción:\n${subMenu}`
      );
    }

    case "ESPERANDO_SUBCATEGORIA": {
      const cat = Object.entries(CATEGORIES).find(
        ([, v]) => v.nombre === user.data.categoria
      )[1];

      let sub;
      if (cat.subcategorias.length === 0) sub = text;
      else {
        const idx = parseInt(text);
        if (idx === 0) sub = cat.subcategoriaOtro;
        else if (idx >= 1 && idx <= cat.subcategorias.length)
          sub = cat.subcategorias[idx - 1];
        else return sendMessage(phone, "Número inválido.");
      }

      setUserState(phone, "ESPERANDO_FOTO", { ...user.data, subcategoria: sub });
      return sendMessage(phone, "Envía una *foto* del problema.");
    }

    case "ESPERANDO_FOTO": {
      if (!image) return sendMessage(phone, "Necesito una foto.");

      const foto_url = await guardarImagenEnSupabase(image);

      if (!foto_url) {
        console.error("Error subiendo imagen a Supabase (reporte-foto)");
        return sendMessage(
          phone,
          "Ocurrió un error al guardar la foto de tu reporte. Intenta enviar la imagen de nuevo."
        );
      }

      setUserState(phone, "ESPERANDO_DESCRIPCION", {
        ...user.data,
        foto_url,
      });

      return sendMessage(phone, "Describe brevemente *el problema*.");
    }

    case "ESPERANDO_DESCRIPCION": {
      if (!text) return sendMessage(phone, "Escribe la descripción.");

      setUserState(phone, "ESPERANDO_UBICACION", {
        ...user.data,
        descripcion: text,
      });

      return sendMessage(
        phone,
        "Indica la *ubicación*: ubicación de WhatsApp o dirección completa _(Calle, número y colonia o población)_."
      );
    }

    case "ESPERANDO_UBICACION": {
      let lat = null,
        lon = null,
        direccion_text = null;

      if (location) {
        lat = parseFloat(location.latitude);
        lon = parseFloat(location.longitude);
        direccion_text = location.address || location.name || null;
      } else {
        const coord = text.match(/^\s*(-?\d+(\.\d+)?)\s*,\s*(-?\d+)/);
        if (coord) {
          lat = parseFloat(coord[1]);
          lon = parseFloat(coord[3]);
        } else {
          direccion_text = text;
          const geo = await geocodeAddress(direccion_text);
          if (!geo) return sendMessage(phone, "No encontré esa dirección.");
          lat = geo.lat;
          lon = geo.lon;
        }
      }

      if (!isCoordInTulum(lat, lon))
        return sendMessage(phone, "Las coordenadas no están en Tulum.");

      setUserState(phone, "ESPERANDO_REFERENCIAS", {
        ...user.data,
        lat,
        lon,
        direccion_text,
      });

      return sendMessage(
        phone,
        "Danos una *referencia visual* (al lado de X, frente a X, etc...)."
      );
    }

    case "ESPERANDO_REFERENCIAS": {
      setUserState(phone, "ESPERANDO_PELIGRO", {
        ...user.data,
        referencias: text,
      });

      return sendMessage(
        phone,
        "Del 1 al 5, ¿qué tan urgente es?\n1 = leve\n5 = serio"
      );
    }

    case "ESPERANDO_PELIGRO": {
      const gravedad = parseInt(text);
      if (isNaN(gravedad) || gravedad < 1 || gravedad > 5)
        return sendMessage(phone, "Responde con 1–5");

      const data = { ...user.data, gravedad };
      const prioridad = data.gravedad * 2;

      if (!data.foto_url) {
        console.error("Falta foto_url en datos antes del INSERT:", data);
        return sendMessage(
          phone,
          "Hubo un problema con la foto del reporte. Intenta empezar de nuevo."
        );
      }

      const { data: inserted, error } = await supabase
        .from("reportes")
        .insert({
          phone,
          categoria: data.categoria,
          subcategoria: data.subcategoria,
          descripcion: data.descripcion,
          foto_url: data.foto_url,
          lat: data.lat,
          lon: data.lon,
          direccion_text: data.direccion_text,
          referencias: data.referencias,
          gravedad,
          prioridad,
          estado: "pendiente",
          denied_reason: null,
        })
        .select()
        .single();

      if (error) {
        console.error("Supabase insert error:", error);
        return sendMessage(phone, "Hubo un error guardando tu reporte.");
      }

      const editToken = generateEditToken(inserted.id, phone);
      const shortId = generateShortId();

      await supabase.from("edit_tokens").insert({
        short_id: shortId,
        incident_id: inserted.id,
        token: editToken,
        expires_at: new Date(
          Date.now() + EDIT_TOKEN_EXP_SECONDS * 1000
        ).toISOString(),
      });

      const editUrl = `${PUBLIC_BASE_URL}/e/${shortId}`;

      await notifyAdminNuevoReporte(inserted, editUrl);

      await sendMessage(
        phone,
        `✅ Gracias por tu reporte de *${data.categoria}*.\n\n` +
          `Lo revisaremos antes de publicarlo, mientras, puedes revisar su ubicación y ajustarla aquí _(24 h)_:\n${editUrl}`+
          `\n\n*Lo que reportas, importa.*`
      );

      setUserState(phone, "IDLE");
      return;
    }
  }
}

// =======================
// VALIDACIÓN COORDENADAS
// =======================

function isCoordInTulum(lat, lon) {
  return (
    lat >= 19.776048 &&
    lat <= 20.519093 &&
    lon >= -87.998068 &&
    lon <= -87.299769
  );
}

// =======================
// ENVÍO DE MENSAJES
// =======================

async function sendMessage(to, text) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneId) {
    console.error(
      "Falta WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID para enviar mensajes."
    );
    return;
  }

  const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });

  if (!res.ok) {
    console.error(
      "Error enviando mensaje de WhatsApp:",
      res.status,
      await res.text()
    );
  }
}

// =======================
// NOTIFICACIONES
// =======================

// =======================
// NOTIFICACIONES
// =======================

async function notifyAdminNuevoReporte(reporte, editUrl) {
  if (!ADMIN_PHONE) return;

  const texto =
    `🔔 Nuevo reporte pendiente en *Tulum Reporta*.\n\n` +
    `Categoría: ${reporte.categoria}\n` +
    `Subcategoría: ${reporte.subcategoria}\n\n` +
    `Revísalo en el panel de reportes:\n` +
    `https://tulum-reporta.appsmith.com/app/tulum-reporta-admin/reportes-6926d7d2c3a22c0862948bae?environment=production`;

  await sendMessage(ADMIN_PHONE, texto);
}

async function notifyReporterPublicacion(reporte) {
  await sendMessage(
    reporte.phone,
    `✅ Tu reporte de *${reporte.categoria}* fue *publicado*.\n` +
      `${MAP_BASE_URL}?i=${reporte.id}\n\n` +
      `Daremos seguimiento con la autoridad, empresa o responsable correspondiente y actualizaremos el estado del reporte cuando haya avances.\n\n` +
      `De tu lado, puedes compartir este enlace con vecinos o autoridades y consultar el mapa para ver cómo evoluciona.\n\n` +
      `*Lo que reportas, importa.*`
  );
}

async function notifyReporterDenegado(reporte, motivo) {
  await sendMessage(
    reporte.phone,
    `❌ Tu reporte de *${reporte.categoria}* fue rechazado:\n\n` +
      `*${motivo || "Sin motivo."}*` +
      `\n\nPor favor revisa nuestras condiciones de uso:\nhttps://www.tulumreporta.com/condiciones.html\n\nCuando estés listo, envía un nuevo reporte con las correcciones.\n\n`
  );
}

async function notifyReporterAsignado(reporte) {
  await sendMessage(
    reporte.phone,
    `ℹ️ Tu reporte de *${reporte.categoria}* fue *asignado* a un responsable${
      reporte.responsable ? `: *${reporte.responsable}*` : ""
    }.\n` +
      `Ahora el siguiente paso es que el responsable atienda el problema; cuando se marque como resuelto te lo notificaremos.\n\n` +
      `De tu lado, puedes seguir revisando el estado desde el mapa y avisarnos si la situación empeora.\n\n` +
      `Lo que reportas, importa.`
  );
}

async function notifyReporterResuelto(reporte) {
  await sendMessage(
    reporte.phone,
    `✅ Tu reporte de *${reporte.categoria}* fue marcado como *resuelto*.\n` +
      `Ahora consideramos atendido este incidente.\n\n` +
      `Si el problema continúa o reaparece, puedes volver a reportarlo para que se genere un nuevo seguimiento.\n\n` +
      `Lo que reportas, importa.`
  );
}


// =======================
// GUARDAR IMAGEN
// =======================

async function guardarImagenEnSupabase(image) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) {
    console.error(
      "Falta WHATSAPP_ACCESS_TOKEN para descargar y guardar la imagen."
    );
    return null;
  }

  try {
    const metaRes = await fetch(
      `https://graph.facebook.com/v20.0/${image.id}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!metaRes.ok) {
      console.error(
        "Error leyendo metadatos de imagen WhatsApp:",
        metaRes.status,
        await metaRes.text()
      );
      return null;
    }

    const meta = await metaRes.json();

    const fileRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!fileRes.ok) {
      console.error(
        "Error descargando imagen desde WhatsApp:",
        fileRes.status,
        await fileRes.text()
      );
      return null;
    }

    const buffer = Buffer.from(await fileRes.arrayBuffer());
    const ext = image.mime_type?.split("/")?.[1] || "jpg";
    const fileName = `reporte-${Date.now()}-${image.id}.${ext}`;

    const { error } = await supabase.storage
      .from("reporte-foto")
      .upload(fileName, buffer, {
        contentType: image.mime_type,
      });

    if (error) {
      console.error("Error subiendo a reporte-foto:", error);
      return null;
    }

    const { data: publicData } = supabase.storage
      .from("reporte-foto")
      .getPublicUrl(fileName);

    return publicData.publicUrl;
  } catch (e) {
    console.error("Excepción en guardarImagenEnSupabase:", e);
    return null;
  }
}

// =======================
// GEOCODER
// =======================

async function geocodeAddress(text) {
  const apiKey = process.env.OPENCAGE_API_KEY;
  if (!apiKey) return null;

  const url = `https://api.opencagedata.com/geocode/v1/json?key=${apiKey}&q=${encodeURIComponent(
    text + ", Tulum, Quintana Roo"
  )}&limit=1&bounds=-87.998068,19.776048,-87.299769,20.519093&no_annotations=1`;

  const res = await fetch(url);
  const json = await res.json();
  const r = json.results?.[0];
  if (!r) return null;
  return { lat: r.geometry.lat, lon: r.geometry.lng };
}

// =======================
// ADMIN: MODERAR
// =======================

app.post("/admin/reportes/:id/approve", checkAdminAuth, async (req, res) => {
  const { id } = req.params;

  const { data: updated, error } = await supabase
    .from("reportes")
    .update({ estado: "publicado", denied_reason: null })
    .eq("id", id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: "Error actualizando" });

  await notifyReporterPublicacion(updated);
  res.json({ ok: true, reporte: updated });
});

app.post("/admin/reportes/:id/deny", checkAdminAuth, async (req, res) => {
  const { id } = req.params;
  const motivo = req.body?.motivo || null;

  const { data: updated, error } = await supabase
    .from("reportes")
    .update({ estado: "rechazado", denied_reason: motivo })
    .eq("id", id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: "Error actualizando" });

  await notifyReporterDenegado(updated, motivo);
  res.json({ ok: true, reporte: updated });
});

// =======================
// ADMIN: NOTIFICAR CAMBIO DE ESTADO
// =======================

app.post(
  "/admin/reportes/:id/notificar-estado",
  checkAdminAuth,
  async (req, res) => {
    const { id } = req.params;

    const { data: reporte, error } = await supabase
      .from("reportes")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !reporte) {
      console.error("Error leyendo reporte para notificar estado:", error);
      return res.status(404).json({ error: "Reporte no encontrado" });
    }

    try {
      switch (reporte.estado) {
        case "publicado":
          await notifyReporterPublicacion(reporte);
          break;
        case "rechazado":
          await notifyReporterDenegado(reporte, reporte.denied_reason);
          break;
        case "asignado":
          await notifyReporterAsignado(reporte);
          break;
        case "resuelto":
          await notifyReporterResuelto(reporte);
          break;
        default:
        // Estados que no generan notificación
      }

      return res.json({ ok: true });
    } catch (e) {
      console.error("Error enviando notificación de estado:", e);
      return res.status(500).json({ error: "Error enviando la notificación" });
    }
  }
);

// =======================
// ADMIN LISTA PENDIENTES
// =======================

app.get("/admin/reportes/pendientes", checkAdminAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("reportes")
    .select(
      "id, categoria, subcategoria, descripcion, gravedad, estado, foto_url, created_at"
    )
    .eq("estado", "pendiente")
    .order("created_at", { ascending: true });

  if (error) return res.status(500).json({ error: "Error leyendo" });

  res.json({ ok: true, reportes: data });
});

// =======================
// START
// =======================

app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
