// index.js

import { createClient } from "@supabase/supabase-js";
import express from "express";
import fetch from "node-fetch";
import { Buffer } from "node:buffer";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 3000;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log("Supabase inicializado");
} else {
  console.warn(
    "Supabase NO configurado (faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY)"
  );
}

app.use(express.json());

// =======================
//  STATIC (para mapa, etc.)
// =======================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));

// =======================
//  ESTADO EN MEMORIA
// =======================

const userStates = {}; // { phone: { state, data } }

function getUserState(phone) {
  if (!userStates[phone]) {
    userStates[phone] = { state: "IDLE", data: {} };
  }
  return userStates[phone];
}

function setUserState(phone, state, newData = {}) {
  const prev = userStates[phone] || { data: {} };
  userStates[phone] = {
    state,
    data: { ...prev.data, ...newData },
  };
  console.log("Nuevo estado usuario:", phone, userStates[phone]);
}

// =======================
//  RUTAS DE PRUEBA
// =======================

app.get("/", (req, res) => {
  res.status(200).send("Tulum Reporta bot running");
});

app.get("/ping", (req, res) => {
  res.status(200).send("pong");
});

// =======================
//  ENDPOINT PARA EL MAPA
// =======================

app.get("/api/incidentes", async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: "Supabase no configurado" });
  }

  try {
    const { data, error } = await supabase
      .from("incidentes")
      .select(
        "id, tipo, zona, descripcion, gravedad, prioridad, estado, lat, lng, created_at, ubicacion, fotos"
      );

    if (error) {
      console.error("Error consultando incidentes:", error);
      return res.status(500).json({ error: "Error consultando incidentes" });
    }

    const features = (data || [])
      .filter((row) => row.lat !== null && row.lng !== null)
      .map((row) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [row.lng, row.lat],
        },
        properties: {
          id: row.id,
          tipo: row.tipo,
          zona: row.zona,
          descripcion: row.descripcion,
          gravedad: row.gravedad,
          prioridad: row.prioridad,
          estado: row.estado,
          created_at: row.created_at,
          ubicacion: row.ubicacion,
          fotos: row.fotos,
        },
      }));

    return res.json({
      type: "FeatureCollection",
      features,
    });
  } catch (e) {
    console.error("Excepción en /api/incidentes:", e);
    return res.status(500).json({ error: "Excepción consultando incidentes" });
  }
});

// =======================
//  WEBHOOK VERIFICACIÓN (GET)
// =======================

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("Webhook verify call:", { mode, token, challenge });

  if (challenge) {
    return res.status(200).send(challenge);
  }

  return res.status(200).send("ok");
});

// =======================
//  WEBHOOK MENSAJES (POST)
// =======================

app.post("/webhook", async (req, res) => {
  try {
    console.log("POST /webhook recibido:");
    console.log(JSON.stringify(req.body, null, 2));

    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const messages = changes?.value?.messages || [];

    if (messages.length === 0) {
      console.log(
        "Webhook sin mensajes (posiblemente status u otro tipo de evento)"
      );
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const from = msg.from;
      const type = msg.type;
      const text = msg.text?.body?.trim() || "";
      const location = msg.location || null;
      const image = msg.image || null;

      console.log("Mensaje entrante:", { from, type, text, location, image });

      await handleIncomingMessage(from, text, location, image);
    }
  } catch (err) {
    console.error("Error procesando webhook:", err);
  }

  // WhatsApp solo necesita 200 rápido
  return res.sendStatus(200);
});

// =======================
//  LÓGICA DEL BOT
// =======================

async function handleIncomingMessage(phone, text, location, image) {
  const user = getUserState(phone);
  console.log("handleIncomingMessage estado actual:", phone, user.state);

  // Inicio de conversación
  if (user.state === "IDLE") {
    setUserState(phone, "ESPERANDO_TIPO");
    await sendMessage(
      phone,
      "Hola 👋, este es el bot de *Tulum Reporta*.\n¿Qué quieres reportar?\n1️⃣ Bache / camino\n2️⃣ Basura / escombro\n3️⃣ Drenaje / inundación\n4️⃣ Alumbrado\n5️⃣ Otro"
    );
    return;
  }

  switch (user.state) {
    // -----------------------
    //  SELECCIÓN DE TIPO
    // -----------------------
    case "ESPERANDO_TIPO": {
      const tipoMap = {
        "1": "Bache / camino",
        "2": "Basura / escombro",
        "3": "Drenaje / inundación",
        "4": "Alumbrado",
        "5": "Otro",
      };

      const tipo = tipoMap[text];
      if (!tipo) {
        await sendMessage(phone, "Responde con un número del 1 al 5.");
        return;
      }

      setUserState(phone, "ESPERANDO_ZONA", { tipo });
      await sendMessage(
        phone,
        "¿En qué zona / colonia está el problema?\nEjemplo: “Región 15, cerca de la tienda X”."
      );
      return;
    }

    // -----------------------
    //  ZONA
    // -----------------------
    case "ESPERANDO_ZONA": {
      setUserState(phone, "ESPERANDO_DESCRIPCION", { zona: text });
      await sendMessage(
        phone,
        "Describe brevemente el problema (tamaño, tiempo que lleva, si es peligroso, etc.)."
      );
      return;
    }

    // -----------------------
    //  DESCRIPCIÓN
    // -----------------------
    case "ESPERANDO_DESCRIPCION": {
      setUserState(phone, "ESPERANDO_UBICACION", { descripcion: text });
      await sendMessage(
        phone,
        "Envía la *ubicación* del lugar (adjuntar → ubicación en WhatsApp o pega un link de Google Maps)."
      );
      return;
    }

    // -----------------------
    //  UBICACIÓN
    // -----------------------
    case "ESPERANDO_UBICACION": {
      let ubicacionStr = text;
      let lat = null;
      let lng = null;

      if (location) {
        const { latitude, longitude, name, address } = location;
        lat = Number(latitude);
        lng = Number(longitude);

        const coords = `${lat},${lng}`;
        const mapsLink = `https://www.google.com/maps?q=${lat},${lng}`;
        ubicacionStr = `${coords} ${name ? " - " + name : ""} ${
          address ? " - " + address : ""
        } (${mapsLink})`;
      } else if (text) {
        const coords = extraerCoordsDeTexto(text);
        if (coords) {
          lat = coords.lat;
          lng = coords.lng;
        }
      }

      if (!ubicacionStr || ubicacionStr.trim() === "") {
        await sendMessage(
          phone,
          "No pude leer la ubicación. Envía la ubicación desde WhatsApp (adjuntar → ubicación) o pega un enlace de Google Maps."
        );
        return;
      }

      setUserState(phone, "ESPERANDO_GRAVEDAD", {
        ubicacion: ubicacionStr.trim(),
        lat,
        lng,
      });
      console.log(
        "Ubicación registrada para",
        phone,
        "=>",
        ubicacionStr,
        lat,
        lng
      );

      await sendMessage(
        phone,
        "Del 1 al 5, ¿qué tan grave es?\n1 = leve\n5 = peligro serio."
      );
      return;
    }

    // -----------------------
    //  GRAVEDAD
    // -----------------------
    case "ESPERANDO_GRAVEDAD": {
      const gravedad = parseInt(text, 10);
      if (isNaN(gravedad) || gravedad < 1 || gravedad > 5) {
        await sendMessage(phone, "Responde con un número del 1 al 5.");
        return;
      }

      setUserState(phone, "ESPERANDO_FOTO", {
        ...user.data,
        gravedad,
      });

      await sendMessage(
        phone,
        "Si puedes, envía ahora *una foto del problema*.\n\nSi no tienes foto, escribe *SIN FOTO*."
      );
      return;
    }

    // -----------------------
    //  FOTO (UNA SOLA OPCIONAL)
// -----------------------
    case "ESPERANDO_FOTO": {
      const data = user.data || {};
      const texto = (text || "").toLowerCase();

      // 1) Si llega una imagen: la guardamos y cerramos el reporte
      if (image) {
        const fotoUrl = await guardarImagenEnSupabase(image);
        const gravedad = data.gravedad;
        const prioridad = calcularPrioridad(data);

        if (supabase) {
          try {
            const { error } = await supabase.from("incidentes").insert({
              phone,
              tipo: data.tipo,
              zona: data.zona,
              descripcion: data.descripcion,
              ubicacion: data.ubicacion,
              gravedad,
              prioridad,
              estado: "pendiente",
              fotos: fotoUrl ? [fotoUrl] : [],
              lat: data.lat,
              lng: data.lng,
              raw: data,
            });

            if (error) {
              console.error("Error guardando en Supabase:", error);
            }
          } catch (e) {
            console.error("Excepción guardando en Supabase:", e);
          }
        } else {
          console.warn("Supabase no configurado, incidente NO guardado en BD");
        }

        await sendMessage(
          phone,
          `✅ Gracias, tu reporte fue registrado.\n\nTipo: ${data.tipo}\nZona: ${data.zona}\nGravedad: ${gravedad}\nPrioridad interna: ${prioridad}\nFotos adjuntas: 1`
        );

        setUserState(phone, "IDLE", {});
        return;
      }

      // 2) Usuario decide seguir sin foto
      if (texto === "sin foto") {
        const gravedad = data.gravedad;
        const prioridad = calcularPrioridad(data);

        if (supabase) {
          try {
            const { error } = await supabase.from("incidentes").insert({
              phone,
              tipo: data.tipo,
              zona: data.zona,
              descripcion: data.descripcion,
              ubicacion: data.ubicacion,
              gravedad,
              prioridad,
              estado: "pendiente",
              fotos: [],
              lat: data.lat,
              lng: data.lng,
              raw: data,
            });

            if (error) {
              console.error("Error guardando en Supabase:", error);
            }
          } catch (e) {
            console.error("Excepción guardando en Supabase:", e);
          }
        } else {
          console.warn("Supabase no configurado, incidente NO guardado en BD");
        }

        await sendMessage(
          phone,
          `✅ Gracias, tu reporte fue registrado *sin fotos*.\n\nTipo: ${data.tipo}\nZona: ${data.zona}\nGravedad: ${gravedad}\nPrioridad interna: ${prioridad}\nFotos adjuntas: 0`
        );

        setUserState(phone, "IDLE", {});
        return;
      }

      // 3) Cualquier otra cosa que no sea imagen ni "SIN FOTO"
      await sendMessage(
        phone,
        "Ahora estoy esperando *una foto* del problema.\nEnvía una foto o escribe *SIN FOTO* para continuar sin imagen."
      );
      return;
    }

    // -----------------------
    //  DEFAULT
    // -----------------------
    default: {
      setUserState(phone, "IDLE", {});
      await sendMessage(
        phone,
        "He reiniciado la conversación. Escribe cualquier cosa para empezar un nuevo reporte."
      );
      return;
    }
  }
}

// =======================
//  PRIORIDAD SIMPLE
// =======================

function calcularPrioridad(data) {
  return data.gravedad * 2;
}

// =======================
//  ENVÍO DE MENSAJES
// =======================

async function sendMessage(to, text) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  console.log("sendMessage llamado:", { to, text });
  console.log("ENV:", {
    hasToken: !!token,
    hasPhoneId: !!phoneId,
    phoneId,
  });

  if (!token || !phoneId) {
    console.error("Faltan WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID");
    return;
  }

  const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = await res.text();
    console.log("Respuesta API WhatsApp:", res.status, body);

    if (!res.ok) {
      console.error("Error al enviar mensaje:", body);
    }
  } catch (e) {
    console.error("Excepción enviando mensaje:", e);
  }
}

// =======================
//  GUARDAR IMAGEN EN SUPABASE
// =======================

async function guardarImagenEnSupabase(image) {
  if (!supabase) {
    console.warn("Supabase no configurado, no se guarda la imagen.");
    return null;
  }

  try {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!token) {
      console.error("Falta WHATSAPP_ACCESS_TOKEN para descargar la imagen.");
      return null;
    }

    const mediaId = image.id;

    // 1) Pedir a Meta la URL temporal del media
    const metaRes = await fetch(
      `https://graph.facebook.com/v20.0/${mediaId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!metaRes.ok) {
      console.error(
        "Error obteniendo metadata de media:",
        await metaRes.text()
      );
      return null;
    }

    const metaJson = await metaRes.json();
    const mediaUrl = metaJson.url;
    if (!mediaUrl) {
      console.error("No se recibió URL de media desde WhatsApp.");
      return null;
    }

    // 2) Descargar el binario de la imagen
    const fileRes = await fetch(mediaUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!fileRes.ok) {
      console.error("Error descargando media:", await fileRes.text());
      return null;
    }

    const arrayBuffer = await fileRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 3) Subir a Supabase Storage
    const ext = image.mime_type?.split("/")?.[1] || "jpg";
    const fileName = `incidente-${Date.now()}-${mediaId}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("incidentes-fotos")
      .upload(fileName, buffer, {
        contentType: image.mime_type || "image/jpeg",
        upsert: false,
      });

    if (uploadError) {
      console.error("Error subiendo imagen a Supabase:", uploadError);
      return null;
    }

    const { data: publicData } = supabase.storage
      .from("incidentes-fotos")
      .getPublicUrl(fileName);

    const publicUrl = publicData?.publicUrl || null;
    console.log("Imagen guardada en Supabase:", publicUrl);
    return publicUrl;
  } catch (e) {
    console.error("Excepción guardando imagen en Supabase:", e);
    return null;
  }
}

// =======================
//  UTIL: EXTRAER COORDENADAS
// =======================

function extraerCoordsDeTexto(texto) {
  const regex = /(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/;
  const match = texto.match(regex);
  if (!match) return null;
  return {
    lat: parseFloat(match[1]),
    lng: parseFloat(match[2]),
  };
}

// =======================
//  ARRANQUE DEL SERVIDOR
// =======================

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
