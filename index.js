// index.js

import { createClient } from "@supabase/supabase-js";
import express from "express";
import fetch from "node-fetch";
import { Buffer } from "node:buffer";

const app = express();
const PORT = process.env.PORT || 3000;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log("Supabase inicializado");
} else {
  console.warn("Supabase NO configurado (faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY)");
}

app.use(express.json());

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
    const messages = changes?.value?.messages;

    if (messages && messages.length > 0) {
      const msg = messages[0];
      const from = msg.from; // número del usuario
      const type = msg.type;
      const text = msg.text?.body?.trim() || "";
      const location = msg.location || null;
      const image = msg.image || null;

      console.log("Mensaje entrante:", { from, type, text, location, image });

      await handleIncomingMessage(from, text, location, image);
    } else {
      console.log(
        "Webhook sin mensajes (posiblemente status u otro tipo de evento)"
      );
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

    case "ESPERANDO_ZONA": {
      setUserState(phone, "ESPERANDO_DESCRIPCION", { zona: text });
      await sendMessage(
        phone,
        "Describe brevemente el problema (tamaño, tiempo que lleva, si es peligroso, etc.)."
      );
      return;
    }

    case "ESPERANDO_DESCRIPCION": {
      setUserState(phone, "ESPERANDO_UBICACION", { descripcion: text });
      await sendMessage(
        phone,
        "Envía la *ubicación* del lugar (adjuntar → ubicación en WhatsApp o pega un link de Google Maps)."
      );
      return;
    }

    case "ESPERANDO_UBICACION": {
      let ubicacionStr = text;

      // Si viene una ubicación nativa de WhatsApp, la convertimos a algo útil
      if (location) {
        const { latitude, longitude, name, address } = location;
        const coords = `${latitude},${longitude}`;
        const mapsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;
        ubicacionStr = `${coords} ${name ? " - " + name : ""} ${
          address ? " - " + address : ""
        } (${mapsLink})`;
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
      });
      console.log("Ubicación registrada para", phone, "=>", ubicacionStr);

      await sendMessage(
        phone,
        "Del 1 al 5, ¿qué tan grave es?\n1 = leve\n5 = peligro serio."
      );
      return;
    }

    case "ESPERANDO_GRAVEDAD": {
      const gravedad = parseInt(text, 10);
      if (isNaN(gravedad) || gravedad < 1 || gravedad > 5) {
        await sendMessage(phone, "Responde con un número del 1 al 5.");
        return;
      }

      // Guardamos gravedad pero aún NO escribimos en Supabase
      setUserState(phone, "ESPERANDO_FOTO", {
        ...user.data,
        gravedad,
      });

      await sendMessage(
        phone,
        "Si puedes, envía ahora una *foto del problema* (como imagen de WhatsApp). Si no tienes foto, responde con 'no'."
      );
      return;
    }

    case "ESPERANDO_FOTO": {
      let foto_url = null;

      // Si han mandado una imagen, la procesamos
      if (image) {
        foto_url = await guardarImagenEnSupabase(image);
      } else if (text && text.toLowerCase() === "no") {
        // Sin foto, seguimos
        foto_url = null;
      } else {
        // Ni foto ni "no" -> insiste
        await sendMessage(
          phone,
          "Envía una *foto del problema* o escribe 'no' si no quieres adjuntar imagen."
        );
        return;
      }

      const data = { ...user.data, foto_url };
      const gravedad = data.gravedad;
      const prioridad = calcularPrioridad(data);

      console.log("Incidente registrado:", { phone, ...data, prioridad });

      // Guardar en Supabase
      if (supabase) {
        try {
          const { error } = await supabase.from("incidentes").insert({
            phone,
            tipo: data.tipo,
            zona: data.zona,
            descripcion: data.descripcion,
            ubicacion: data.ubicacion,
            gravedad: data.gravedad,
            prioridad,
            estado: "pendiente",
            foto_url: data.foto_url || null,
            raw: data,
          });

          if (error) {
            console.error("Error guardando en Supabase:", error);
          } else {
            console.log("Incidente guardado en Supabase");
          }
        } catch (e) {
          console.error("Excepción guardando en Supabase:", e);
        }
      } else {
        console.warn("Supabase no configurado, incidente NO guardado en BD");
      }

      await sendMessage(
        phone,
        `✅ Gracias, tu reporte fue registrado.\n\nTipo: ${data.tipo}\nZona: ${data.zona}\nGravedad: ${gravedad}\nPrioridad interna: ${prioridad}${
          foto_url ? "\nFoto adjunta: ✔️" : ""
        }\n\nUsaremos estos datos para mapear y priorizar la atención.`
      );

      setUserState(phone, "IDLE", {});
      return;
    }

    default: {
      setUserState(phone, "IDLE", {});
      await sendMessage(
        phone,
        "He reiniciado la conversación. Escribe cualquier cosa para empezar un nuevo reporte."
      );
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
      console.error("Error obteniendo metadata de media:", await metaRes.text());
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
//  ARRANQUE DEL SERVIDOR
// =======================

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
