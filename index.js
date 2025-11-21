// index.js

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

// Carpeta estática para mapa.html, editar.html y otros assets
app.use(express.static("public"));
app.use(express.json());

// URL que se envía al usuario para ver su reporte en el mapa
const MAP_BASE_URL =
  process.env.PUBLIC_MAP_BASE_URL || "https://www.tulumreporta.com/mapa";

// URL base pública del sitio (para armar enlaces)
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || "https://www.tulumreporta.com";

// Secret para firmar tokens de edición
const EDIT_TOKEN_SECRET =
  process.env.EDIT_TOKEN_SECRET || "CAMBIA_ESTE_SECRET_EN_PROD";
const EDIT_TOKEN_EXP_SECONDS = 60 * 60 * 24; // 24h

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
  console.warn(
    "Supabase NO configurado (faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY)"
  );
}

// =======================
// CATEGORÍAS PRINCIPALES
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
// ESTADO EN MEMORIA
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
// TOKENS DE EDICIÓN Y SHORT LINKS
// =======================

function generateEditToken(incidentId, phone) {
  return jwt.sign(
    {
      incidentId,
      phone,
    },
    EDIT_TOKEN_SECRET,
    { expiresIn: EDIT_TOKEN_EXP_SECONDS }
  );
}

function verifyEditToken(token) {
  try {
    const payload = jwt.verify(token, EDIT_TOKEN_SECRET);
    return payload;
  } catch (err) {
    console.error("Error verificando token de edición:", err.message);
    return null;
  }
}

function generateShortId() {
  // 8 chars base36 pseudoaleatorio, suficiente para MVP
  return [...Array(8)]
    .map(() => Math.random().toString(36)[2])
    .join("");
}

// =======================
// RUTAS BÁSICAS
// =======================

app.get("/", (req, res) => {
  res.status(200).send("Tulum Reporta bot running");
});

app.get("/ping", (req, res) => {
  res.status(200).send("pong");
});

// =======================
// RUTA CORTA DE EDICIÓN: /e/:shortId
// =======================

app.get("/e/:shortId", async (req, res) => {
  const { shortId } = req.params;

  if (!supabase) {
    return res.status(500).send("Supabase no configurado");
  }

  try {
    const { data, error } = await supabase
      .from("edit_tokens")
      .select("incident_id, token, expires_at")
      .eq("short_id", shortId)
      .single();

    if (error || !data) {
      console.error("edit_tokens: shortId no encontrado:", shortId, error);
      return res.status(404).send("Enlace inválido o expirado");
    }

    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return res.status(410).send("El enlace ha expirado");
    }

    const redirectUrl = `/editar.html?incidentId=${encodeURIComponent(
      data.incident_id
    )}&t=${encodeURIComponent(data.token)}`;

    return res.redirect(redirectUrl);
  } catch (err) {
    console.error("Error en /e/:shortId:", err);
    return res.status(500).send("Error interno");
  }
});

// =======================
// API PARA EL MAPA (PÚBLICO)
// =======================

app.get("/api/incidentes", async (req, res) => {
  if (!supabase) {
    return res
      .status(500)
      .json({ error: "Supabase no configurado en el servidor" });
  }

  try {
    const { data, error } = await supabase
      .from("incidentes")
      .select(
        "id, tipo, descripcion, gravedad, estado, foto_url, zona, ubicacion, lat, lon, created_at, raw"
      )
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error leyendo incidentes:", error);
      return res.status(500).json({ error: "Error leyendo incidentes" });
    }

    const incidentes = (data || []).map((row) => {
      // Preferimos columnas lat/lon directas
      let lat = row.lat ?? null;
      let lon = row.lon ?? null;

      // Fallback: intentar parsear de raw.ubicacionGps o de ubicacion (si es "lat,lon")
      if (lat === null || lon === null) {
        const source = row.raw?.ubicacionGps || row.ubicacion;
        if (source) {
          const m = String(source).match(
            /^\s*(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)\s*$/
          );
          if (m) {
            lat = parseFloat(m[1]);
            lon = parseFloat(m[3]);
          }
        }
      }

      return {
        id: row.id,
        tipo: row.tipo,
        descripcion: row.descripcion,
        gravedad: row.gravedad,
        estado: row.estado,
        foto_url: row.foto_url,
        zona: row.zona,
        lat,
        lon,
        created_at: row.created_at,
      };
    });

    res.json(incidentes);
  } catch (e) {
    console.error("Excepción leyendo incidentes:", e);
    res.status(500).json({ error: "Error inesperado leyendo incidentes" });
  }
});

// =======================
// API EDITOR: OBTENER UN INCIDENTE (CON TOKEN)
// =======================

app.get("/api/incidentes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const token = req.query.token;

    if (!token) {
      return res.status(401).json({ error: "Falta token" });
    }

    const payload = verifyEditToken(token);
    if (!payload || payload.incidentId != id) {
      return res.status(403).json({ error: "Token inválido o no coincide" });
    }

    const { data, error } = await supabase
      .from("incidentes")
      .select(
        "id, tipo, descripcion, gravedad, estado, foto_url, zona, ubicacion, lat, lon, created_at"
      )
      .eq("id", id)
      .single();

    if (error || !data) {
      console.error("Error buscando incidente para editar:", error);
      return res.status(404).json({ error: "Incidente no encontrado" });
    }

    res.json(data);
  } catch (err) {
    console.error("Error GET /api/incidentes/:id:", err);
    res.status(500).json({ error: "Error interno" });
  }
});

// =======================
// API EDITOR: ACTUALIZAR UBICACIÓN (CON TOKEN)
// =======================

app.put("/api/incidentes/:id/location", async (req, res) => {
  try {
    const { id } = req.params;
    const token = req.query.token;
    const { lat, lon, location_text } = req.body;

    if (!token) {
      return res.status(401).json({ error: "Falta token" });
    }

    const payload = verifyEditToken(token);
    if (!payload || payload.incidentId != id) {
      return res.status(403).json({ error: "Token inválido o no coincide" });
    }

    // Validación básica de coordenadas
    if (
      typeof lat !== "number" ||
      typeof lon !== "number" ||
      Number.isNaN(lat) ||
      Number.isNaN(lon)
    ) {
      return res.status(400).json({ error: "Coordenadas inválidas" });
    }

    if (!isCoordInTulum(lat, lon)) {
      return res.status(400).json({
        error:
          "Las coordenadas nuevas no parecen estar dentro del municipio de Tulum.",
      });
    }

    const updateObj = {
      lat,
      lon,
      ubicacion: `${lat},${lon}`,
    };

    if (location_text) {
      updateObj.zona = location_text;
    }

    const { data, error } = await supabase
      .from("incidentes")
      .update(updateObj)
      .eq("id", id)
      .select("id, lat, lon, zona, ubicacion")
      .single();

    if (error) {
      console.error("Error actualizando ubicación:", error);
      return res.status(500).json({ error: "Error actualizando ubicación" });
    }

    res.json({ ok: true, incidente: data });
  } catch (err) {
    console.error("Error PUT /api/incidentes/:id/location:", err);
    res.status(500).json({ error: "Error interno" });
  }
});

// =======================
// RUTA DEL MAPA (HTML)
// =======================

app.get("/mapa", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "mapa.html"));
});

// =======================
// WEBHOOK VERIFICACIÓN (GET)
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
// WEBHOOK MENSAJES (POST)
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
// LÓGICA DEL BOT
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
        if (isNaN(idx) || idx < 1 || idx > categoria.subcategorias.length) {
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

    // 5) UBICACIÓN (ADJUNTO O TEXTO / COORDENADAS -> SIEMPRE LAT/LON)
    case "ESPERANDO_UBICACION": {
      let direccionTexto = null;
      let ubicacionGps = null;
      let lat = null;
      let lon = null;

      // Ubicación nativa de WhatsApp
      if (location) {
        const { latitude, longitude, name, address } = location;
        lat = parseFloat(latitude);
        lon = parseFloat(longitude);

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
          lat = parseFloat(coordMatch[1]);
          lon = parseFloat(coordMatch[3]);

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
          // Texto como dirección -> geocodificar
          direccionTexto = text;

          const geo = await geocodeAddress(direccionTexto);
          if (!geo) {
            await sendMessage(
              phone,
              "No pude localizar esa dirección en el mapa.\n" +
                "Revisa que incluya calle, número y colonia, o envía la ubicación desde WhatsApp."
            );
            return;
          }

          lat = geo.lat;
          lon = geo.lon;

          if (!isCoordInTulum(lat, lon)) {
            await sendMessage(
              phone,
              "La dirección que enviaste parece estar fuera del municipio de Tulum.\n" +
                "Revisa la ubicación y envía de nuevo la dirección o la ubicación desde el mapa."
            );
            return;
          }

          ubicacionGps = `${lat},${lon}`;
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
        lat,
        lon,
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
      const zona =
        [data.direccionTexto, data.referencias].filter(Boolean).join(" | ") ||
        null;

      let incidenteId = null;

      // Guardar en Supabase
      if (supabase) {
        try {
          const { data: inserted, error } = await supabase
            .from("incidentes")
            .insert({
              phone,
              tipo: data.categoriaNombre, // categoría principal
              zona, // dirección + referencias
              descripcion: data.descripcion, // descripción del problema
              ubicacion: data.ubicacionGps || zona, // string "lat,lon" o texto
              lat: data.lat ?? null, // columna numérica
              lon: data.lon ?? null, // columna numérica
              gravedad: data.gravedad,
              prioridad, // interno
              estado: "pendiente",
              foto_url: data.foto_url || null,
              raw: data, // incluye subcategoria, direccionTexto, ubicacionGps, referencias, lat, lon...
            })
            .select()
            .single();

          if (error) {
            console.error("Error guardando en Supabase:", error);
          } else {
            console.log("Incidente guardado en Supabase:", inserted.id);
            incidenteId = inserted.id;

            // Generar token de edición
            const editToken = generateEditToken(inserted.id, phone);
            const shortId = generateShortId();

            // Guardar shortId en tabla edit_tokens
            try {
              const expiresAt = new Date(
                Date.now() + EDIT_TOKEN_EXP_SECONDS * 1000
              ).toISOString();

              const { error: tokenError } = await supabase
                .from("edit_tokens")
                .insert({
                  short_id: shortId,
                  incident_id: inserted.id,
                  token: editToken,
                  expires_at: expiresAt,
                });

              if (tokenError) {
                console.error(
                  "Error guardando edit_token, usando URL larga:",
                  tokenError
                );
                // Fallback: URL larga con token visible
                const longEditUrl = `${PUBLIC_BASE_URL}/editar.html?incidentId=${encodeURIComponent(
                  inserted.id
                )}&t=${encodeURIComponent(editToken)}`;
                const editMsg = [
                  "Si la ubicación del problema no quedó bien en el mapa, puedes ajustarla aquí:",
                  longEditUrl,
                  "",
                  "El enlace estará activo por 24 horas.",
                ].join("\n");
                await sendMessage(phone, editMsg);
              } else {
                // URL corta bonita
                const shortUrl = `${PUBLIC_BASE_URL}/e/${shortId}`;
                const editMsg = [
                  "Si la ubicación del problema no quedó bien en el mapa, puedes ajustarla aquí:",
                  shortUrl,
                  "",
                  "El enlace estará activo por 24 horas.",
                ].join("\n");
                await sendMessage(phone, editMsg);
              }
            } catch (e) {
              console.error(
                "Excepción guardando edit_token, usando URL larga:",
                e
              );
              const longEditUrl = `${PUBLIC_BASE_URL}/editar.html?incidentId=${encodeURIComponent(
                inserted.id
              )}&t=${encodeURIComponent(editToken)}`;
              const editMsg = [
                "Si la ubicación del problema no quedó bien en el mapa, puedes ajustarla aquí:",
                longEditUrl,
                "",
                "El enlace estará activo por 24 horas.",
              ].join("\n");
              await sendMessage(phone, editMsg);
            }
          }
        } catch (e) {
          console.error("Excepción guardando en Supabase:", e);
        }
      } else {
        console.warn("Supabase no configurado, incidente NO guardado en BD");
      }

      // Mensaje de confirmación al usuario
      let mensaje = "✅ Gracias, tu reporte fue registrado.\n\n";
      mensaje += `• Categoría: *${data.categoriaNombre}${
        data.subcategoria ? " - " + data.subcategoria : ""
      }*\n`;
      mensaje += `• Peligro percibido (1–5): *${gravedad}*\n`;
      mensaje += `• Foto adjunta: ${data.foto_url ? "✔️" : "✖️"}`;

      // Link al mapa si tenemos ID
      if (incidenteId) {
        const link = `${MAP_BASE_URL}?id=${incidenteId}`;
        mensaje += `\n\nPuedes ver tu reporte en el mapa aquí:\n${link}`;
      }

      await sendMessage(phone, mensaje);

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
// PRIORIDAD SIMPLE
// =======================

function calcularPrioridad(data) {
  return data.gravedad * 2;
}

// =======================
// VALIDACIÓN COORDENADAS TULUM
// =======================

function isCoordInTulum(lat, lon) {
  // Bounding box del municipio de Tulum basado en tus esquinas:
  // NO: 20.519093, -87.998068
  // SE: 19.776048, -87.299769
  const minLat = 19.776048;
  const maxLat = 20.519093;
  const minLon = -87.998068;
  const maxLon = -87.299769;

  if (lat < minLat || lat > maxLat) return false;
  if (lon < minLon || lon > maxLon) return false;
  return true;
}

// =======================
// ENVÍO DE MENSAJES
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
// GUARDAR IMAGEN EN SUPABASE
// =======================

async function guardarImagenEnSupabase(image) {
  if (!supabase) {
    console.warn("Supabase no configurado, no se guarda la imagen.");
    return null;
  }

  try {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!token) {
      console.error(
        "Falta WHATSAPP_ACCESS_TOKEN para descargar la imagen."
      );
      return null;
    }

    const mediaId = image.id;

    // 1) Metadatos del media
    const metaRes = await fetch(
      `https://graph.facebook.com/v20.0/${mediaId}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
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

    // 2) Descargar binario
    const fileRes = await fetch(mediaUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!fileRes.ok) {
      console.error(
        "Error descargando media:",
        await fileRes.text()
      );
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
// GEOCODIFICACIÓN DE DIRECCIONES
// =======================

async function geocodeAddress(direccionTexto) {
  const apiKey = process.env.OPENCAGE_API_KEY; // o el servicio que elijas

  if (!apiKey) {
    console.warn("OPENCAGE_API_KEY no configurado, no se puede geocodificar.");
    return null;
  }

  // Le damos contexto para forzar Tulum
  const query = `${direccionTexto}, Tulum, Quintana Roo, México`;

  // Bounding box del municipio de Tulum (usando tus esquinas NO/SE)
  // Formato OpenCage: bounds=minLon,minLat,maxLon,maxLat
  const bounds = "-87.998068,19.776048,-87.299769,20.519093";

  const params = new URLSearchParams({
    q: query,
    key: apiKey,
    limit: "1",
    language: "es",
    bounds,
    no_annotations: "1",
  });

  const url = `https://api.opencagedata.com/geocode/v1/json?${params.toString()}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error("Error en geocodificador:", await res.text());
      return null;
    }

    const json = await res.json();
    const result = json.results?.[0];
    if (!result) {
      console.warn("Geocoder: sin resultados para:", query);
      return null;
    }

    const lat = result.geometry?.lat;
    const lon = result.geometry?.lng;

    if (typeof lat !== "number" || typeof lon !== "number") {
      console.warn("Geocoder: resultado sin lat/lon válidos:", result);
      return null;
    }

    return { lat, lon };
  } catch (e) {
    console.error("Excepción en geocodeAddress:", e);
    return null;
  }
}

// =======================
// ARRANQUE DEL SERVIDOR
// =======================

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
