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
//  CATEGORÍAS PRINCIPALES
// =======================

const CATEGORIES = {
  "1": {
    nombre: "Baches y superficie de la calle",
    subcategorias: [
      "Bache en la calle",
      "Pavimento roto",
      "Hundimiento",
      "Tope en mal estado",
    ],
  },
  "2": {
    nombre: "Alumbrado público",
    subcategorias: [
      "Luminaria apagada",
      "Luminaria intermitente",
      "Poste dañado",
      "Zona sin alumbrado",
    ],
  },
  "3": {
    nombre: "Basura y limpieza",
    subcategorias: [
      "Basura acumulada",
      "Escombro",
      "Contenedor lleno o roto",
      "Tiradero ilegal",
    ],
  },
  "4": {
    nombre: "Drenaje y agua",
    subcategorias: [
      "Alcantarilla tapada",
      "Fuga de agua",
      "Encharcamiento / inundación",
      "Olor fuerte a drenaje",
    ],
  },
  "5": {
    nombre: "Señalización y semáforos",
    subcategorias: [
      "Señal caída o dañada",
      "Falta de señal",
      "Semáforo apagado",
      "Semáforo desfasado",
    ],
  },
  "6": {
    nombre: "Banquetas y espacio peatonal",
    subcategorias: [
      "Banqueta rota",
      "Obstrucción en banqueta",
      "Falta de rampa",
      "Tapa o registro suelto",
    ],
  },
  "7": {
    nombre: "Áreas verdes y árboles",
    subcategorias: [
      "Árbol caído",
      "Rama peligrosa",
      "Vegetación bloqueando el paso",
      "Falta de poda",
    ],
  },
  "8": {
    nombre: "Seguridad y vandalismo",
    subcategorias: [
      "Grafiti / vandalismo",
      "Punto con robos frecuentes",
      "Daño a mobiliario urbano",
      "Zona muy oscura e insegura",
    ],
  },
  "9": {
    nombre: "Ruido y molestias",
    subcategorias: [
      "Música muy alta",
      "Fiestas recurrentes",
      "Maquinaria ruidosa",
      "Otros ruidos constantes",
    ],
  },
  "0": {
    nombre: "Otro tipo de problema",
    subcategorias: [], // texto libre
  },
};

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
    setUserState(phone, "ESPERANDO_CATEGORIA");
    await sendMessage(
      phone,
      "Hola 👋, este es el bot de *Tulum Reporta*.\n¿Qué tipo de problema quieres reportar?\n" +
        "1️⃣ Baches y superficie de la calle\n" +
        "2️⃣ Alumbrado público\n" +
        "3️⃣ Basura y limpieza\n" +
        "4️⃣ Drenaje y agua\n" +
        "5️⃣ Señalización y semáforos\n" +
        "6️⃣ Banquetas y espacio peatonal\n" +
        "7️⃣ Áreas verdes y árboles\n" +
        "8️⃣ Seguridad y vandalismo\n" +
        "9️⃣ Ruido y molestias\n" +
        "0️⃣ Otro tipo de problema"
    );
    return;
  }

  switch (user.state) {
    // 1) CATEGORÍA PRINCIPAL
    case "ESPERANDO_CATEGORIA": {
      const categoria = CATEGORIES[text];
      if (!categoria) {
        await sendMessage(
          phone,
          "Responde con un número de la lista (0 a 9) para elegir la categoría."
        );
        return;
      }

      setUserState(phone, "ESPERANDO_SUBCATEGORIA", {
        categoriaClave: text,
        categoriaNombre: categoria.nombre,
      });

      if (categoria.subcategorias.length > 0) {
        const subMenu = categoria.subcategorias
          .map((s, idx) => `${idx + 1}. ${s}`)
          .join("\n");
        await sendMessage(
          phone,
          `Has elegido: *${categoria.nombre}*\nAhora elige una opción:\n${subMenu}`
        );
      } else {
        await sendMessage(
          phone,
          `Has elegido: *${categoria.nombre}*.\nEscribe brevemente qué tipo de problema es (subcategoría).`
        );
      }
      return;
    }

    // 2) SUBCATEGORÍA
    case "ESPERANDO_SUBCATEGORIA": {
      const { categoriaClave } = user.data;
      const categoria = CATEGORIES[categoriaClave];

      let subcategoria;

      if (!categoria) {
        setUserState(phone, "IDLE", {});
        await sendMessage(
          phone,
          "Hubo un problema con la categoría. Escribe cualquier cosa para empezar de nuevo."
        );
        return;
      }

      if (categoria.subcategorias.length > 0) {
        const idx = parseInt(text, 10);
        if (
          isNaN(idx) ||
          idx < 1 ||
          idx > categoria.subcategorias.length
        ) {
          const subMenu = categoria.subcategorias
            .map((s, i) => `${i + 1}. ${s}`)
            .join("\n");
          await sendMessage(
            phone,
            `Responde con un número de la lista:\n${subMenu}`
          );
          return;
        }
        subcategoria = categoria.subcategorias[idx - 1];
      } else {
        if (!text) {
          await sendMessage(
            phone,
            "Escribe brevemente qué tipo de problema es."
          );
          return;
        }
        subcategoria = text;
      }

      setUserState(phone, "ESPERANDO_FOTO", {
        ...user.data,
        subcategoria,
      });

      await sendMessage(
        phone,
        "Ahora envía una *foto del problema*. La foto es obligatoria para registrar el reporte."
      );
      return;
    }

    // 3) FOTO (OBLIGATORIA)
    case "ESPERANDO_FOTO": {
      if (!image) {
        await sendMessage(
          phone,
          "Necesito al menos *una foto* del problema para continuar. Adjunta una imagen del lugar."
        );
        return;
      }

      const foto_url = await guardarImagenEnSupabase(image);

      if (!foto_url) {
        await sendMessage(
          phone,
          "Hubo un problema al guardar la foto. Intenta enviar la imagen de nuevo."
        );
        return;
      }

      setUserState(phone, "ESPERANDO_DESCRIPCION", {
        ...user.data,
        foto_url,
      });

      await sendMessage(
        phone,
        "Describe brevemente el problema (qué pasa, desde cuándo, si afecta el paso, etc.)."
      );
      return;
    }

    // 4) DESCRIPCIÓN DEL REPORTE
    case "ESPERANDO_DESCRIPCION": {
      if (!text) {
        await sendMessage(
          phone,
          "Necesito que escribas una breve descripción del problema."
        );
        return;
      }

      setUserState(phone, "ESPERANDO_UBICACION", {
        ...user.data,
        descripcion: text,
      });

      await sendMessage(
        phone,
        "Ahora indica la *ubicación del problema*:\n\n" +
          "- Puedes adjuntar la ubicación desde WhatsApp (ubicación en el mapa), o\n" +
          "- Escribir la dirección textual (número, calle, colonia), o\n" +
          "- Enviar las coordenadas en formato: latitud,longitud"
      );
      return;
    }

    // 5) UBICACIÓN (ADJUNTO O TEXTO / COORDENADAS)
    case "ESPERANDO_UBICACION": {
      let direccionTexto = null;
      let ubicacionGps = null;

      // Ubicación nativa de WhatsApp
      if (location) {
        const { latitude, longitude, name, address } = location;
        const lat = parseFloat(latitude);
        const lon = parseFloat(longitude);

        if (!isCoordInTulum(lat, lon)) {
          await sendMessage(
            phone,
            "Las coordenadas que enviaste no parecen estar dentro del municipio de Tulum.\nRevisa la ubicación y envía de nuevo la ubicación o la dirección (número, calle, colonia)."
          );
          return;
        }

        ubicacionGps = `${lat},${lon}`;
        const labelParts = [];
        if (name) labelParts.push(name);
        if (address) labelParts.push(address);
        direccionTexto = labelParts.join(" - ") || null;
      } else if (text) {
        // ¿formato coordenadas "lat,lon"?
        const coordMatch = text.match(
          /^\s*(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)\s*$/
        );
        if (coordMatch) {
          const lat = parseFloat(coordMatch[1]);
          const lon = parseFloat(coordMatch[3]);

          if (!isCoordInTulum(lat, lon)) {
            await sendMessage(
              phone,
              "Las coordenadas que enviaste no parecen estar dentro del municipio de Tulum.\nRevisa la ubicación y envía de nuevo la ubicación o la dirección (número, calle, colonia)."
            );
            return;
          }

          ubicacionGps = `${lat},${lon}`;
          direccionTexto = null;
        } else {
          // Texto como dirección
          direccionTexto = text;
          ubicacionGps = null;
        }
      } else {
        await sendMessage(
          phone,
          "No pude leer la ubicación. Adjunta la ubicación en el mapa, escribe la dirección (número, calle, colonia) o envía las coordenadas en formato latitud,longitud."
        );
        return;
      }

      setUserState(phone, "ESPERANDO_REFERENCIAS", {
        ...user.data,
        direccionTexto,
        ubicacionGps,
      });

      await sendMessage(
        phone,
        "Para ayudar a encontrar el lugar exacto, escribe *referencias visuales específicas*, por ejemplo:\n" +
          "“Frente a la tienda X”, “a un lado del Oxxo”, “lado derecho de la calle”, “esquina con la calle Y”, etc."
      );
      return;
    }

    // 6) REFERENCIAS VISUALES ESPECÍFICAS
    case "ESPERANDO_REFERENCIAS": {
      if (!text) {
        await sendMessage(
          phone,
          "Escribe alguna referencia visual para encontrar el problema (frente a qué, esquina, lado de la calle, etc.)."
        );
        return;
      }

      setUserState(phone, "ESPERANDO_PELIGRO", {
        ...user.data,
        referencias: text,
      });

      await sendMessage(
        phone,
        "Del 1 al 5, ¿qué tan peligroso o urgente consideras este problema?\n1 = leve\n5 = peligro serio."
      );
      return;
    }

    // 7) PELIGRO PERCIBIDO (GRAVEDAD)
    case "ESPERANDO_PELIGRO": {
      const gravedad = parseInt(text, 10);
      if (isNaN(gravedad) || gravedad < 1 || gravedad > 5) {
        await sendMessage(
          phone,
          "Responde con un número del 1 al 5 para indicar el nivel de peligro."
        );
        return;
      }

      const data = { ...user.data, gravedad };
      const prioridad = calcularPrioridad(data); // interna

      console.log("Incidente registrado:", { phone, ...data, prioridad });

      // Construir "zona" combinando dirección textual + referencias
      const zona = [data.direccionTexto, data.referencias]
        .filter(Boolean)
        .join(" | ") || null;

      // Guardar en Supabase
      if (supabase) {
        try {
          const { error } = await supabase.from("incidentes").insert({
            phone,
            tipo: data.categoriaNombre,            // categoría principal
            zona,                                  // dirección + referencias
            descripcion: data.descripcion,         // descripción del problema
            ubicacion: data.ubicacionGps || zona,  // ubicación (gps o texto)
            gravedad: data.gravedad,
            prioridad,                             // interno, NO se muestra al usuario
            estado: "pendiente",
            foto_url: data.foto_url || null,
            raw: data,                             // incluye subcategoria, direccionTexto, ubicacionGps, referencias
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
        `✅ Gracias, tu reporte fue registrado.\n\n` +
          `Categoría: ${data.categoriaNombre}${
            data.subcategoria ? " - " + data.subcategoria : ""
          }\n` +
          `Peligro percibido (1–5): ${gravedad}\n` +
          `Foto adjunta: ${data.foto_url ? "✔️" : "✖️"}`
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
//  PRIORIDAD SIMPLE (INTERNA)
// =======================

function calcularPrioridad(data) {
  // Por ahora, simple: proporcional al peligro percibido
  return data.gravedad * 2;
}

// =======================
//  VALIDACIÓN COORDENADAS TULUM
// =======================
//
// Bounding box aproximado para el municipio de Tulum.
// Suficiente para filtrar cosas absurdamente fuera.
//
function isCoordInTulum(lat, lon) {
  // latitud ~19–21 N, longitud ~ -88.5 a -86.0 W
  if (lat < 19.0 || lat > 21.0) return false;
  if (lon < -88.5 || lon > -86.0) return false;
  return true;
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
